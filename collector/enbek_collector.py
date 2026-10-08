"""Мансап Компасы — Enbek.kz (Электрондық еңбек биржасы) вакансия коллекторы.

Enbek.kz — Қазақстан Еңбек министрлігінің мемлекеттік жұмыспен қамту порталы.
Бұл модуль сайттың ашық HTML беттерінен вакансияларды жинап, оларды ортақ
Vacancy құрылымына түрлендіреді және SQLite базасына сақтайды.

Жұмыс тәртібі
-------------
1. Әр желілік сұраныс алдында robots.txt тексеріледі (urllib.robotparser +
   Google стиліндегі '*' / '$' үлгілерін қосымша тексеру, өйткені Python-ның
   ескі нұсқаларындағы robotparser оларды түсінбейді).
2. Сұраныстар арасында REQUEST_DELAY кідіріс сақталады, қате болса —
   экспоненциалды күтумен (backoff) қайталау.
3. Тізім беті → parse_search_html(); вакансия беті → parse_vacancy_html().
4. Жалақы мәтіні parse_salary() арқылы (from, to, currency) болып бөлінеді.
5. Дағдылар common.skills.extract_skills() арқылы мәтіннен шығарылады.

Маңызды ескерту (2026-10-07 тексерілді)
---------------------------------------
Enbek.kz robots.txt файлы «Disallow: /*/search/*» ережесін қамтиды, яғни
/ru/search/vacancy?prof=... іздеу беттерін роботтарға жинауға РҰҚСАТ ЖОҚ.
Сондықтан коллектор іздеу бетіне сұраныс жібермейді, оның орнына рұқсат
етілген басты беттегі «Соңғы вакансиялар» блогын (/ru) және жеке вакансия
беттерін (/ru/vacancy/<slug>~<id>) ғана оқиды. Іздеу бетін талдау коды
(parse_search_html) сол карточка компонентін өңдейді және --mock режимінде
фикстуралармен тексеріледі.

Іске қосу мысалдары
-------------------
    python enbek_collector.py --mock fixtures --details --db data/test_enbek.db
    python enbek_collector.py --query "Бухгалтер" --pages 1 --details
"""
from __future__ import annotations

import argparse
import logging
import os
import re
import sys
import time
import urllib.robotparser
from datetime import datetime
from pathlib import Path
from typing import Optional
from urllib.parse import quote_plus, unquote, urljoin, urlsplit

import requests
from bs4 import BeautifulSoup

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from common.models import Vacancy  # noqa: E402
from common.skills import extract_skills, clean_html  # noqa: E402
from common.db import save_vacancies, init_db  # noqa: E402
from common.config import USER_AGENT, REQUEST_DELAY, DB_PATH, normalize_region, SEARCH_QUERIES  # noqa: E402

log = logging.getLogger('enbek')

# --- Тұрақтылар -------------------------------------------------------------
SOURCE = 'Enbek.kz'
BASE_URL = 'https://www.enbek.kz'
ROBOTS_URL = BASE_URL + '/robots.txt'
# Сайттың өз іздеу формасы осы адреске prof=<сөз> параметрімен жібереді.
SEARCH_URL = BASE_URL + '/ru/search/vacancy?prof={query}&page={page}'
# robots.txt рұқсат ететін басты бет: «Вакансии» блогында соңғы вакансиялар.
FEED_URL = BASE_URL + '/ru'
TIMEOUT = 30
MAX_RETRIES = 3

# Mock режиміндегі фикстура файлдарының аттары.
MOCK_SEARCH_FILE = 'enbek_search_sample.html'
MOCK_VACANCY_FILE = 'enbek_vacancy_sample.html'

# Вакансия сілтемесі: /ru/vacancy/<slug>~<сандық id> (қазақша нұсқасы /kk/...).
VACANCY_HREF_RE = re.compile(r'/(?:ru|kk|en)/vacancy/[^"\s?#]*~(\d+)')


class BlockedError(RuntimeError):
    """Сайт captcha / бұғаттау бетін қайтарды — жинауды тоқтатамыз."""


# =============================================================================
# 1. robots.txt — әр сұраныс алдында тексеру
# =============================================================================
class RobotsGuard:
    """robots.txt ережелерін сақтайтын қорғаушы.

    urllib.robotparser файлды талдайды (User-agent топтары, Allow/Disallow).
    Бірақ ескі Python нұсқаларында ол жолдарды тек префикс бойынша салыстырады, ал
    Enbek.kz ережелері '*' және '$' үлгілерін қолданады (мыс. /*/search/*).
    Сондықтан салыстыруды өзіміз жасаймыз: ең ұзын сәйкес ереже жеңеді,
    тең болса Allow басым (Google / RFC 9309 тәртібі).
    """

    def __init__(self, session: requests.Session, user_agent: str = USER_AGENT):
        self.session = session
        self.user_agent = user_agent
        self.parser = urllib.robotparser.RobotFileParser(ROBOTS_URL)
        self.loaded = False
        self.raw = ''

    def load(self) -> None:
        if self.loaded:
            return
        try:
            resp = self.session.get(ROBOTS_URL, timeout=TIMEOUT)
            if resp.status_code == 200:
                self.raw = resp.text
                self.parser.parse(self.raw.splitlines())
            elif 400 <= resp.status_code < 500:
                self.parser.allow_all = True        # robots.txt жоқ → бәріне рұқсат
            else:
                self.parser.disallow_all = True     # сервер қатесі → сақтықпен тыйым
        except requests.RequestException as exc:
            log.warning('robots.txt жүктелмеді (%s) — желілік сұраныстарға тыйым салынады', exc)
            self.parser.disallow_all = True
        self.loaded = True

    def load_text(self, text: str) -> None:
        """Тест үшін: robots.txt мәтінін желісіз жүктеу."""
        self.raw = text
        self.parser.parse(text.splitlines())
        self.loaded = True

    def _rules(self) -> list[tuple[str, bool]]:
        """Біздің User-Agent-ке қатысты (үлгі, рұқсат) жұптары."""
        p = self.parser
        entries = [e for e in p.entries if e.applies_to(self.user_agent)]
        if not entries and p.default_entry is not None:
            entries = [p.default_entry]
        rules = []
        for entry in entries:
            for line in entry.rulelines:
                rules.append((unquote(line.path), line.allowance))
        return rules

    @staticmethod
    def _pattern_to_regex(pattern: str) -> re.Pattern:
        anchored = pattern.endswith('$')
        if anchored:
            pattern = pattern[:-1]
        body = '.*'.join(re.escape(part) for part in pattern.split('*'))
        return re.compile('^' + body + ('$' if anchored else ''))

    def can_fetch(self, url: str) -> bool:
        self.load()
        if self.parser.disallow_all:
            return False
        if self.parser.allow_all:
            return True
        # Алдымен стандартты тексеру (префикс ережелері үшін).
        if not self.parser.can_fetch(self.user_agent, url):
            return False
        # Содан кейін '*' / '$' үлгілерін ескеретін толық тексеру.
        parts = urlsplit(url)
        path = unquote(parts.path or '/') + (('?' + unquote(parts.query)) if parts.query else '')
        best_len, allowed = -1, True
        for pattern, allowance in self._rules():
            if not pattern:            # бос «Disallow:» — бәріне рұқсат
                continue
            if self._pattern_to_regex(pattern).match(path):
                if len(pattern) > best_len or (len(pattern) == best_len and allowance):
                    best_len, allowed = len(pattern), allowance
        return allowed


# =============================================================================
# 2. HTTP клиенті — кідіріс, қайталау, robots тексеруі
# =============================================================================
class EnbekClient:
    def __init__(self, delay: float = REQUEST_DELAY):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'ru,kk;q=0.9',
        })
        self.delay = delay
        self.robots = RobotsGuard(self.session)
        self._last_request = 0.0

    def _throttle(self) -> None:
        """Екі сұраныс арасында кемінде self.delay секунд өтуін қамтамасыз етеді."""
        wait = self._last_request + self.delay - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        self._last_request = time.monotonic()

    def allowed(self, url: str) -> bool:
        return self.robots.can_fetch(url)

    def get(self, url: str) -> Optional[str]:
        """Бетті жүктейді. robots тыйым салса — None. Қатеде backoff-пен қайталайды."""
        if not self.robots.can_fetch(url):
            log.warning('robots.txt тыйым салады, өткізіп жібереміз: %s', url)
            return None
        for attempt in range(1, MAX_RETRIES + 1):
            self._throttle()
            try:
                resp = self.session.get(url, timeout=TIMEOUT, allow_redirects=True)
            except requests.RequestException as exc:
                log.warning('Желі қатесі (%d/%d) %s: %s', attempt, MAX_RETRIES, url, exc)
            else:
                # Қайта бағыттаудан кейін де robots ережесін тексереміз.
                if resp.url != url and not self.robots.can_fetch(resp.url):
                    log.warning('Қайта бағытталған адреске robots тыйым салады: %s', resp.url)
                    return None
                if 'captcha' in resp.url.lower() or 'captcha' in resp.text[:5000].lower():
                    raise BlockedError(f'Сайт captcha көрсетті: {resp.url}')
                if resp.status_code == 200:
                    resp.encoding = resp.encoding or 'utf-8'
                    return resp.text
                if resp.status_code in (403, 404, 410):
                    log.warning('HTTP %d, қайталамаймыз: %s', resp.status_code, url)
                    return None
                log.warning('HTTP %d (%d/%d): %s', resp.status_code, attempt, MAX_RETRIES, url)
                retry_after = resp.headers.get('Retry-After', '')
                if resp.status_code == 429 and retry_after.isdigit():
                    time.sleep(min(int(retry_after), 120))
            if attempt < MAX_RETRIES:
                time.sleep(self.delay * (2 ** attempt))   # 2, 4, 8 ... секунд
        log.error('Бет жүктелмеді: %s', url)
        return None


# =============================================================================
# 3. Талдаушылар (parsers) — желісіз, тек HTML мәтінімен жұмыс істейді
# =============================================================================
def _text(el) -> str:
    """Элементтің мәтіні (бос орындар қысылған) немесе ''."""
    if el is None:
        return ''
    return re.sub(r'\s+', ' ', el.get_text(' ', strip=True)).strip()


def _first(card, selectors: str) -> str:
    """CSS селекторлар тізімінен бірінші табылған элементтің мәтіні (title атрибуты басым)."""
    el = card.select_one(selectors)
    if el is None:
        return ''
    title = el.get('title')
    return re.sub(r'\s+', ' ', title).strip() if title else _text(el)


def _vacancy_id(href: str) -> Optional[str]:
    m = VACANCY_HREF_RE.search(href or '')
    return m.group(1) if m else None


def parse_search_html(html: str) -> list[dict]:
    """Тізім бетінен (іздеу нәтижесі не басты беттегі блок) вакансия карточкаларын алады.

    Қайтарады: [{'id', 'title', 'company', 'city', 'category', 'salary', 'url'}, ...]
    Enbek.kz карточкасы (2026 ж. нақты құрылым):
        div.vacancy-item
          .vacancy-name[title]     — лауазым
          .vacancy-company[title]  — жұмыс беруші (толық атауы title-да)
          .vacancy-area            — сала/категория (қала ЕМЕС!)
          .vacancy-price           — жалақы, мыс. «от 180 000 тг.»
          a[href=/ru/vacancy/<slug>~<id>]
    Ескі/басқа дизайн үшін (.item-list, .title, .company, .location, .price) де қолдау бар.
    """
    soup = BeautifulSoup(html, 'html.parser')
    cards = soup.select('div.vacancy-item, div.item-list')
    if not cards:
        # Резервтік жол: вакансия сілтемесінің ата-аналық блогы — карточка.
        cards = [a.find_parent(['div', 'li', 'article']) or a
                 for a in soup.find_all('a', href=VACANCY_HREF_RE)]

    results, seen = [], set()
    for card in cards:
        link = card.find('a', href=VACANCY_HREF_RE)
        if link is None:
            continue                       # бұл вакансия карточкасы емес (мыс. компания блогы)
        vid = _vacancy_id(link['href'])
        if not vid or vid in seen:
            continue
        seen.add(vid)
        title = _first(card, '.vacancy-name, .title a, .title, h3, h4') or _text(link)
        city = _first(card, '.vacancy-city, .vacancy-location, .location, li.location')
        if '/' in city:                    # «г. Астана / г. Астана, көше ...» → бірінші бөлік
            city = city.split('/')[0].strip()
        results.append({
            'id': vid,
            'title': title,
            'company': _first(card, '.vacancy-company, .company') or None,
            'city': city or None,
            'category': _first(card, '.vacancy-area, .category') or None,
            'salary': _first(card, '.vacancy-price, .price') or None,
            'url': urljoin(BASE_URL, link['href'].split('?')[0]),
        })
    return results


# Вакансия бетіндегі «белгі → мән» өрістерінің орысша/қазақша атаулары.
_LABELS = {
    'experience': ('опыт работы', 'жұмыс тәжірибесі', 'тәжірибе'),
    'region': ('регион', 'өңір', 'место работы', 'жұмыс орны'),
    'duties': ('обязанности', 'должностные обязанности', 'міндеттері', 'лауазымдық міндеттер'),
    'requirements': ('требования', 'талаптар', 'қойылатын талаптар'),
    'conditions': ('условия', 'шарттар', 'жұмыс шарттары'),
    'additional': ('дополнительно', 'дополнительная информация', 'қосымша ақпарат', 'қосымша'),
    'skills': ('профессиональные навыки', 'кәсіби дағдылар', 'навыки', 'дағдылар'),
    'personal': ('личные качества', 'жеке қасиеттер'),
    'education': ('образование', 'білімі', 'білім'),
    'employment': ('тип занятости', 'жұмыспен қамту түрі'),
    'schedule': ('график работы', 'жұмыс кестесі'),
}


def _label_key(label: str) -> Optional[str]:
    label = label.strip().strip(':').lower()
    for key, names in _LABELS.items():
        if label in names:
            return key
    return None


def parse_vacancy_html(html: str) -> dict:
    """Жеке вакансия бетін талдайды.

    Негізгі кілттер: description, requirements, experience, salary.
    Қосымша: id, title, company, city, category, published_at, key_skills,
    education, employment, schedule.
    """
    soup = BeautifulSoup(html, 'html.parser')
    fields: dict[str, str] = {}
    lists: dict[str, list[str]] = {}

    # «ul.info > li > span.label + span» — қысқа ақпарат (тәжірибе, білім, кесте ...)
    for li in soup.select('ul.info li'):
        label = li.find(class_='label')
        if label is None:
            continue
        key = _label_key(_text(label))
        value = _text(label.find_next_sibling())
        if key and value:
            fields.setdefault(key, value)

    # «div.single-line > .label + .value» — ұзын мәтіндер (міндеттер, талаптар, дағдылар)
    for block in soup.select('.single-line'):
        label, value = block.select_one('.label'), block.select_one('.value')
        if label is None or value is None:
            continue
        key = _label_key(_text(label))
        if not key:
            continue
        items = [_text(li).rstrip(';').strip() for li in value.find_all('li')]
        items = [i for i in items if i]
        if items:
            lists[key] = items
            fields[key] = '; '.join(items)
        else:
            fields[key] = clean_html(str(value))

    # Тақырып, жалақы, жұмыс беруші, санат
    title = _text(soup.select_one('h4.title, h1.title, h1, h4'))
    salary = _text(soup.select_one('.price'))
    company = _text(soup.select_one('.company-box .info a, .item-list .title a'))
    category = _text(soup.select_one('.category'))

    # Жарияланған күн: «Вакансия опубликована 07.10.2026» / «... жарияланды 07.10.2026»
    published_at = None
    m = re.search(r'(?:опубликована|жарияланды|жарияланған)\D{0,20}(\d{2})\.(\d{2})\.(\d{4})', soup.get_text(' '))
    if m:
        published_at = f'{m.group(3)}-{m.group(2)}-{m.group(1)}'

    # Қала: «Регион» өрісі, болмаса breadcrumbs-тағы өңір сілтемесі (region_id=...)
    city = fields.get('region')
    if not city:
        crumb = soup.select_one('ul.breadcrumbs a[href*="region_id"]')
        city = _text(crumb) or None

    # Вакансия ID: canonical сілтеме / тіл ауыстырғыш / шағым батырмасы
    vid = None
    for el in soup.select('link[rel=canonical], a[data-language-switch], a[href*="/vacancy/"]'):
        vid = _vacancy_id(el.get('href', ''))
        if vid:
            break
    if not vid:
        el = soup.select_one('[data-entity-type=vacancy][data-entity-id]')
        vid = el['data-entity-id'] if el else None

    # Сипаттама: барлық мәтіндік бөлімдерді бір мәтінге біріктіреміз.
    parts = []
    for key, head in (('duties', 'Міндеттері'), ('requirements', 'Талаптар'),
                      ('skills', 'Кәсіби дағдылар'), ('personal', 'Жеке қасиеттер'),
                      ('conditions', 'Шарттар'), ('additional', 'Қосымша')):
        if fields.get(key):
            parts.append(f'{head}: {fields[key]}')
    requirements = '; '.join(x for x in (fields.get('requirements'), fields.get('skills')) if x)

    return {
        'id': vid,
        'title': title or None,
        'company': company or None,
        'city': city,
        'category': category or None,
        'salary': salary or None,
        'published_at': published_at,
        'experience': fields.get('experience'),
        'education': fields.get('education'),
        'employment': fields.get('employment'),
        'schedule': fields.get('schedule'),
        'key_skills': lists.get('skills', []),
        'requirements': requirements,
        'description': '\n'.join(parts),
    }


# --- Жалақы ------------------------------------------------------------------
_CURRENCIES = (
    ('KZT', ('₸', 'тг', 'тенге', 'теңге', 'kzt')),
    ('USD', ('$', 'usd', 'долл')),
    ('EUR', ('€', 'eur', 'евро')),
    ('RUB', ('₽', 'руб', 'rub')),
)
_NEGOTIABLE = ('договор', 'келісім', 'по результатам собеседования', 'не указана', 'көрсетілмеген')
_NUM = r'(\d[\d\s  ]*(?:[.,]\d+)?)'


def _to_number(s: str) -> float:
    return float(re.sub(r'[\s  ]', '', s).replace(',', '.'))


def parse_salary(text: Optional[str]) -> tuple[Optional[float], Optional[float], Optional[str]]:
    """Жалақы мәтінін (from, to, currency) кортежіне түрлендіреді.

    >>> parse_salary('от 300 000 до 450 000 тг')
    (300000.0, 450000.0, 'KZT')
    >>> parse_salary('250 000 ₸')
    (250000.0, 250000.0, 'KZT')
    >>> parse_salary('договорная')
    (None, None, None)
    """
    if not text:
        return None, None, None
    t = text.lower().replace(' ', ' ').replace('–', '-').replace('—', '-')
    if any(w in t for w in _NEGOTIABLE) and not re.search(r'\d', t):
        return None, None, None

    currency = None
    for code, marks in _CURRENCIES:
        if any(mk in t for mk in marks):
            currency = code
            break

    lo = hi = None
    # Орысша: «от X до Y» (сөз саннан бұрын); қазақша: «X бастап Y дейін» (сөз саннан кейін).
    m_from = re.search(_NUM + r'\s*(?:[^\d\s]+\s*)?бастап', t) or re.search(r'\bот\s*' + _NUM, t)
    m_to = re.search(_NUM + r'\s*(?:[^\d\s]+\s*)?дейін', t) or re.search(r'\bдо\s*' + _NUM, t)
    m_range = re.search(_NUM + r'\s*-\s*' + _NUM, t)
    if m_from:
        lo = _to_number(m_from.group(1))
    if m_to:
        hi = _to_number(m_to.group(1))
    if lo is None and hi is None:
        if m_range:
            lo, hi = _to_number(m_range.group(1)), _to_number(m_range.group(2))
        else:
            m = re.search(_NUM, t)
            if m:
                lo = hi = _to_number(m.group(1))      # «250 000 ₸» — нақты сома
    if lo is None and hi is None:
        return None, None, None
    return lo, hi, currency or 'KZT'                  # Enbek.kz-те валюта әдетте теңге


# --- Тәжірибе ----------------------------------------------------------------
def experience_code(text: Optional[str]) -> Optional[str]:
    """«5 лет», «без опыта», «1-3 года», «тәжірибесіз», «2 жыл» → hh.kz кодтары."""
    if not text:
        return None
    t = text.lower()
    if any(w in t for w in ('без опыта', 'не требуется', 'тәжірибесіз', 'қажет емес', 'нет опыта')):
        return 'noExperience'
    nums = [float(n.replace(',', '.')) for n in re.findall(r'\d+(?:[.,]\d+)?', t)]
    if not nums:
        return None
    years = max(nums) if ('более' in t or 'артық' in t or 'свыше' in t) else min(nums)
    if 'более' in t or 'свыше' in t or 'артық' in t:
        years += 0.01
    if years < 1:
        return 'noExperience'
    if years < 3:
        return 'between1And3'
    if years <= 6:
        return 'between3And6'
    return 'moreThan6'


# =============================================================================
# 4. Vacancy құрылымына түрлендіру
# =============================================================================
def to_vacancy(card: dict, detail: Optional[dict] = None, query: Optional[str] = None) -> Vacancy:
    """Тізім карточкасын (және болса — вакансия бетінің деректерін) Vacancy-ге біріктіреді."""
    detail = detail or {}
    salary_text = detail.get('salary') or card.get('salary')
    s_from, s_to, currency = parse_salary(salary_text)
    city = detail.get('city') or card.get('city')

    description = detail.get('description') or ''
    # Карточкада сипаттама жоқ — дағдыларды кем дегенде лауазым мен санаттан іздейміз.
    skill_text = ' '.join(x for x in (card.get('title'), card.get('category'),
                                      detail.get('requirements'), description) if x)
    skills = extract_skills(skill_text, key_skills=detail.get('key_skills') or None)

    published = detail.get('published_at')
    if published:
        try:
            published = datetime.strptime(published, '%Y-%m-%d').strftime('%Y-%m-%dT00:00:00+05:00')
        except ValueError:
            pass

    return Vacancy(
        source=SOURCE,
        external_id=str(card.get('id') or detail.get('id')),
        url=card.get('url') or '',
        title=detail.get('title') or card.get('title') or '',
        company=detail.get('company') or card.get('company'),
        city=city,
        region=normalize_region(city),
        salary_from=s_from,
        salary_to=s_to,
        currency=currency,
        experience=experience_code(detail.get('experience')),
        published_at=published,
        description=description,
        skills=skills,
        query=query,
    )


# =============================================================================
# 5. Жинау
# =============================================================================
def _collect_mock(mock_dir: str, details: bool, query: Optional[str]) -> list[Vacancy]:
    """Желісіз режим: fixtures/ ішіндегі сақталған HTML беттерін талдайды."""
    folder = Path(mock_dir)
    cards = parse_search_html((folder / MOCK_SEARCH_FILE).read_text(encoding='utf-8'))
    detail_by_id: dict[str, dict] = {}
    vac_file = folder / MOCK_VACANCY_FILE
    if details and vac_file.exists():
        d = parse_vacancy_html(vac_file.read_text(encoding='utf-8'))
        if d.get('id'):
            detail_by_id[d['id']] = d
    log.info('Mock: %d карточка, %d толық бет', len(cards), len(detail_by_id))
    return [to_vacancy(c, detail_by_id.get(c['id']), query=query) for c in cards]


def _collect_live(queries: list[str], pages: int, details: bool) -> list[Vacancy]:
    client = EnbekClient()
    found: dict[str, tuple[dict, Optional[str]]] = {}   # id → (карточка, сұрау)

    # 5.1 Іздеу беттері — тек robots.txt рұқсат етсе.
    search_blocked = False
    for q in queries:
        for page in range(1, pages + 1):
            url = SEARCH_URL.format(query=quote_plus(q), page=page)
            if not client.allowed(url):
                search_blocked = True
                break
            html = client.get(url)
            if not html:
                break
            cards = parse_search_html(html)
            log.info('«%s», %d-бет: %d вакансия', q, page, len(cards))
            if not cards:
                break
            for c in cards:
                found.setdefault(c['id'], (c, q))
        if search_blocked:
            break

    # 5.2 Іздеуге тыйым болса — рұқсат етілген басты беттегі соңғы вакансиялар.
    if search_blocked:
        log.warning('robots.txt іздеу беттеріне (/*/search/*) тыйым салады. '
                    'Оның орнына басты беттегі соңғы вакансиялар жиналады: %s', FEED_URL)
        html = client.get(FEED_URL)
        for c in parse_search_html(html or ''):
            found.setdefault(c['id'], (c, None))

    # 5.3 Әр вакансияның толық беті (міндеттер, талаптар, тәжірибе, дағдылар).
    vacancies = []
    for vid, (card, q) in found.items():
        detail = None
        if details:
            page_html = client.get(card['url'])
            detail = parse_vacancy_html(page_html) if page_html else None
        vacancies.append(to_vacancy(card, detail, query=q))
    return vacancies


def collect(query: Optional[str] = None, pages: int = 1, details: bool = False,
            db=DB_PATH, mock: Optional[str] = None) -> int:
    """Enbek.kz вакансияларын жинап, базаға сақтайды. Сақталған жазбалар санын қайтарады.

    query   — іздеу сөзі; None болса config.SEARCH_QUERIES мәндері қолданылады
    pages   — әр сұрау үшін тізім беттерінің саны
    details — әр вакансияның жеке бетін де жүктеу (дағдылар толығырақ болады)
    db      — SQLite файлының жолы
    mock    — фикстуралар бумасы (берілсе, желіге шықпайды)
    """
    if mock:
        vacancies = _collect_mock(mock, details, query)
    else:
        queries = [query] if query else list(SEARCH_QUERIES.values())
        try:
            vacancies = _collect_live(queries, pages, details)
        except BlockedError as exc:
            log.error('%s — жинау тоқтатылды (captcha-ны айналып өтпейміз).', exc)
            vacancies = []

    def _money(x: Optional[float]) -> str:
        return f'{x:,.0f}'.replace(',', ' ') if x is not None else '…'

    for v in vacancies:
        sal = (f'{_money(v.salary_from)}–{_money(v.salary_to)} {v.currency}'
               if v.salary_from or v.salary_to else '—')
        log.info('  [%s] %s | %s | %s | %s | %s', v.external_id, v.title, v.company or '—',
                 v.region or v.city or '—', sal, ', '.join(v.skills) or '—')
    if not vacancies:
        log.warning('Ешқандай вакансия табылмады.')
        return 0
    Path(db).parent.mkdir(parents=True, exist_ok=True)
    init_db(db)
    saved = save_vacancies(vacancies, path=db)
    log.info('Enbek.kz: %d вакансия базаға сақталды → %s', saved, db)
    return saved


def main(argv: Optional[list[str]] = None) -> int:
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except AttributeError:
        pass
    parser = argparse.ArgumentParser(description='Мансап Компасы — Enbek.kz вакансия коллекторы')
    parser.add_argument('--query', help='іздеу сөзі (әдепкі: config.SEARCH_QUERIES)')
    parser.add_argument('--pages', type=int, default=1, help='әр сұрау үшін беттер саны')
    parser.add_argument('--details', action='store_true', help='әр вакансияның толық бетін жүктеу')
    parser.add_argument('--mock', metavar='DIR', help='желісіз режим: фикстуралар бумасы')
    parser.add_argument('--db', default=str(DB_PATH), help='SQLite базасының жолы')
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format='%(levelname)s %(name)s: %(message)s')
    saved = collect(query=args.query, pages=args.pages, details=args.details,
                    db=args.db, mock=args.mock)
    print(f'Enbek.kz: сақталды {saved} вакансия')
    return 0


if __name__ == '__main__':
    sys.exit(main())
