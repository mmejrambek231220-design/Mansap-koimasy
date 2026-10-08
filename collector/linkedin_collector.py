"""Мансап Компасы — LinkedIn вакансияларын жинау модулі.

МАҢЫЗДЫ ЕСКЕРТУ
---------------
LinkedIn-нің вакансиялар үшін ашық (public) API-і ЖОҚ. LinkedIn пайдаланушы
келісімі (User Agreement, 8.2-бөлім) сайтты автоматты түрде жинауға (scraping)
тыйым салады, ал robots.txt файлы роботтардың көп бөлімдерге кіруіне рұқсат
бермейді. Сондықтан бұл модульде үш режим бар:

1. ``--csv PATH``  (ҰСЫНЫЛАТЫН, заңды жол)
   Kaggle-дағы ашық «LinkedIn Job Postings (2023–2024)» датасетін
   (arshkon/linkedin-job-postings, файл: postings.csv) импорттау.
   Файл ағынмен (stream) жол-жолымен оқылады, сондықтан үлкен CSV те
   жадқа толық жүктелмейді.

2. ``--mock [PATH]``  (тест / көрсетілім режимі)
   ``fixtures/`` бумасындағы сақталған HTML үлгілерін талдайды. Желіге
   ешқандай сұраныс жіберілмейді. Мұғалімге парсер қалай жұмыс істейтінін
   көрсету үшін ыңғайлы.

3. ``--live``  (ТЕК ОҚУ МАҚСАТЫНДАҒЫ демо, әдепкі бойынша ӨШІРУЛІ)
   LinkedIn-нің «қонақ» (guest) іздеу бетінің HTML-ін BeautifulSoup арқылы
   талдайды. Іске қоспас бұрын ToS туралы ескерту шығады, беттер саны 5-пен
   шектелген, сұраныстар арасында ≥2 секунд кідіріс бар, 429/999 жауабы
   келсе бірден тоқтайды. Бұл режимді жүйелі деректер жинау үшін ҚОЛДАНБАҢЫЗ.

Мысалдар (``collector/`` бумасының ішінен іске қосу)::

    python linkedin_collector.py --csv data/postings.csv --location Kazakhstan --limit 5000
    python linkedin_collector.py --mock
    python linkedin_collector.py --live --query "Python" --pages 1 --details

Бұл код сайтқа қосылмаған, жеке (standalone) скрипт ретінде жұмыс істейді.
"""
from __future__ import annotations

import argparse
import csv
import os
import random
import re
import sys
import time
from datetime import datetime, timezone
from typing import Iterable, Iterator, Optional
from urllib.parse import quote_plus

# Скрипт кез келген бумадан іске қосылса да ``common`` пакеті табылуы үшін
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import requests
from bs4 import BeautifulSoup

from common.models import Vacancy
from common.skills import extract_skills, clean_html
from common.db import save_vacancies, init_db
from common.config import USER_AGENT, REQUEST_DELAY, DB_PATH, normalize_region, SEARCH_QUERIES

SOURCE = 'LinkedIn'

# --- Тұрақтылар -------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FIXTURES_DIR = os.path.join(BASE_DIR, 'fixtures')
MOCK_SEARCH_HTML = os.path.join(FIXTURES_DIR, 'linkedin_search_sample.html')
MOCK_JOB_HTML = os.path.join(FIXTURES_DIR, 'linkedin_job_sample.html')

# LinkedIn-нің қонақтарға арналған (тіркелусіз) HTML фрагменттері
SEARCH_URL = ('https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search'
              '?keywords={keywords}&location={location}&start={start}')
JOB_URL = 'https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{job_id}'

MAX_PAGES = 5            # live режимінде беттердің ең көп саны
MIN_DELAY = 2.0          # сұраныстар арасындағы ең аз кідіріс (секунд)
STOP_STATUSES = {429, 999}  # 429 = Too Many Requests, 999 = LinkedIn-нің бот-блогы
CSV_BATCH = 1000         # CSV импортында базаға неше жолдан сақтаймыз

# LinkedIn тәжірибе деңгейлерін Vacancy.experience форматына сәйкестендіру
EXPERIENCE_MAP = {
    'internship': 'noExperience',
    'entry level': 'noExperience',
    'associate': 'between1And3',
    'mid-senior level': 'between3And6',
    'director': 'moreThan6',
    'executive': 'moreThan6',
}

# Жалақы кезеңін айлық жалақыға келтіру коэффициенттері (Kaggle: pay_period)
PAY_PERIOD_TO_MONTH = {
    'MONTHLY': 1.0,
    'YEARLY': 1 / 12,
    'WEEKLY': 52 / 12,
    'BIWEEKLY': 26 / 12,
    'HOURLY': 168.0,      # шамамен 40 сағ/апта × 4.2 апта
}

LIVE_WARNING = """
================================================================================
 ЕСКЕРТУ: LinkedIn live режимі (тек оқу мақсатындағы демонстрация)
--------------------------------------------------------------------------------
 * LinkedIn-нің ашық вакансия API-і жоқ.
 * LinkedIn пайдаланушы келісімі сайтты автоматты түрде жинауға тыйым салады,
   robots.txt роботтарға көп бөлімдерді жабады.
 * Бұл режим тек парсердің жұмыс принципін көрсету үшін: беттер саны ≤ {max_pages},
   сұраныстар арасында ≥ {delay:.0f} с кідіріс, 429/999 жауабында бірден тоқтау.
 * Курстық жұмыстың нақты деректері үшін --csv (Kaggle датасеті) режимін қолданыңыз.
================================================================================
""".strip('\n')


# --- Көмекші функциялар -----------------------------------------------------
def _text(node) -> Optional[str]:
    """BeautifulSoup түйінінің мәтінін бос орындарсыз қайтарады (жоқ болса None)."""
    if node is None:
        return None
    value = ' '.join(node.get_text(' ', strip=True).split())
    return value or None


def _job_id_from(value: Optional[str]) -> Optional[str]:
    """'urn:li:jobPosting:123' немесе '/jobs/view/slug-123?...' жолынан ID алу."""
    if not value:
        return None
    m = re.search(r'jobPosting:(\d+)', value) or re.search(r'-(\d{6,})(?:[/?]|$)', value) \
        or re.search(r'/jobs/view/(\d+)', value)
    return m.group(1) if m else None


def _clean_url(url: Optional[str]) -> Optional[str]:
    """Сілтемеден бақылау (tracking) параметрлерін алып тастау."""
    return url.split('?', 1)[0] if url else url


def _city_from_location(location: Optional[str]) -> Optional[str]:
    """'Almaty, Almaty, Kazakhstan' → 'Almaty' (бірінші бөлігі — қала)."""
    if not location:
        return None
    return location.split(',')[0].strip() or None


def _parse_salary_text(text: Optional[str]):
    """'KZT 900,000 - KZT 1,400,000' → (900000.0, 1400000.0, 'KZT')."""
    if not text:
        return None, None, None
    currency = None
    m = re.search(r'\b([A-Z]{3})\b', text)
    if m:
        currency = m.group(1)
    elif '$' in text:
        currency = 'USD'
    nums = [float(n.replace(',', '')) for n in re.findall(r'\d[\d,]*(?:\.\d+)?', text)]
    if not nums:
        return None, None, currency
    return nums[0], (nums[1] if len(nums) > 1 else None), currency


def _to_float(value) -> Optional[float]:
    try:
        return float(value) if value not in (None, '') else None
    except (TypeError, ValueError):
        return None


def _map_experience(level: Optional[str]) -> Optional[str]:
    return EXPERIENCE_MAP.get((level or '').strip().lower())


# --- HTML парсерлері (live және mock режимдеріне ортақ) ----------------------
def parse_search_html(html: str) -> list[dict]:
    """Іздеу нәтижелерінің HTML фрагментінен вакансия карточкаларын алу.

    Әр карточка — ``div.base-card`` элементі. Қайтарылатын сөздіктің кілттері:
    id, title, company, location, published_at, url, salary_text.
    """
    soup = BeautifulSoup(html, 'html.parser')
    cards = []
    for card in soup.select('div.base-card'):
        link = card.select_one('a.base-card__full-link')
        href = link.get('href') if link else None
        job_id = _job_id_from(card.get('data-entity-urn')) or _job_id_from(href)
        title = _text(card.select_one('h3.base-search-card__title'))
        if not job_id or not title:
            continue  # жарнама немесе толық емес карточка
        time_tag = card.select_one('time[datetime]')
        cards.append({
            'id': job_id,
            'title': title,
            'company': _text(card.select_one('h4.base-search-card__subtitle')),
            'location': _text(card.select_one('span.job-search-card__location')),
            'published_at': time_tag.get('datetime') if time_tag else None,
            'url': _clean_url(href) or f'https://www.linkedin.com/jobs/view/{job_id}/',
            'salary_text': _text(card.select_one('span.job-search-card__salary-info')),
        })
    return cards


def parse_job_html(html: str) -> dict:
    """Бір вакансия бетінің HTML-інен сипаттама мен критерийлерді алу.

    Қайтарады: id, title, company, location, description (тегсіз мәтін),
    seniority, employment_type, criteria (барлық критерийлер сөздігі).
    """
    soup = BeautifulSoup(html, 'html.parser')
    markup = soup.select_one('div.show-more-less-html__markup')
    criteria = {}
    for item in soup.select('li.description__job-criteria-item'):
        key = _text(item.select_one('.description__job-criteria-subheader'))
        val = _text(item.select_one('.description__job-criteria-text'))
        if key:
            criteria[key] = val
    title_link = soup.select_one('a.topcard__link')
    return {
        'id': _job_id_from(title_link.get('href') if title_link else None),
        'title': _text(soup.select_one('.topcard__title')),
        'company': _text(soup.select_one('a.topcard__org-name-link')),
        'location': _text(soup.select_one('span.topcard__flavor--bullet')),
        'description': clean_html(str(markup)) if markup else '',
        'seniority': criteria.get('Seniority level'),
        'employment_type': criteria.get('Employment type'),
        'criteria': criteria,
    }


def card_to_vacancy(card: dict, details: Optional[dict] = None,
                    query: Optional[str] = None) -> Vacancy:
    """Іздеу карточкасын (және қажет болса толық бетті) Vacancy-ге түрлендіру."""
    details = details or {}
    city = _city_from_location(card.get('location') or details.get('location'))
    salary_from, salary_to, currency = _parse_salary_text(card.get('salary_text'))
    description = details.get('description') or ''
    # Сипаттама болмаса, дағдыларды кем дегенде лауазым атауынан іздейміз
    skills_text = f"{card.get('title', '')}\n{description}"
    published = card.get('published_at')
    if published and len(published) == 10:       # '2026-10-05' → ISO 8601
        published = f'{published}T00:00:00+00:00'
    return Vacancy(
        source=SOURCE,
        external_id=str(card['id']),
        url=card.get('url') or f"https://www.linkedin.com/jobs/view/{card['id']}/",
        title=card.get('title') or details.get('title') or '',
        company=card.get('company') or details.get('company'),
        city=city,
        region=normalize_region(city) if city else None,
        salary_from=salary_from,
        salary_to=salary_to,
        currency=currency,
        experience=_map_experience(details.get('seniority')),
        published_at=published,
        description=description,
        skills=extract_skills(skills_text),
        query=query,
    )


# --- Kaggle CSV ------------------------------------------------------------
def _ms_to_iso(value) -> Optional[str]:
    """Kaggle listed_time (миллисекундтық epoch) → ISO 8601 (UTC)."""
    ms = _to_float(value)
    if ms is None:
        return None
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat(timespec='seconds')


def row_to_vacancy(row: dict, query: Optional[str] = None) -> Optional[Vacancy]:
    """Kaggle postings.csv жолын Vacancy-ге түрлендіру (жарамсыз жол → None)."""
    job_id = (row.get('job_id') or '').strip()
    title = (row.get('title') or '').strip()
    if not job_id or not title:
        return None

    # Жалақы: min/max болмаса — med_salary; кезеңін айлыққа келтіреміз
    lo, hi = _to_float(row.get('min_salary')), _to_float(row.get('max_salary'))
    med = _to_float(row.get('med_salary'))
    if lo is None and hi is None and med is not None:
        lo = hi = med
    factor = PAY_PERIOD_TO_MONTH.get((row.get('pay_period') or '').strip().upper(), 1.0)
    lo = round(lo * factor, 2) if lo is not None else None
    hi = round(hi * factor, 2) if hi is not None else None
    currency = (row.get('currency') or '').strip() or None
    if currency is None and (lo is not None or hi is not None):
        currency = 'USD'  # датасет негізінен АҚШ вакансиялары, валюта көрсетілмесе — USD

    description = clean_html(row.get('description') or '')
    skills_desc = clean_html(row.get('skills_desc') or '')
    city = _city_from_location(row.get('location'))
    return Vacancy(
        source=SOURCE,
        external_id=job_id,
        url=(row.get('job_posting_url') or '').strip()
            or f'https://www.linkedin.com/jobs/view/{job_id}/',
        title=title,
        company=(row.get('company_name') or '').strip() or None,
        city=city,
        region=normalize_region(city) if city else None,
        salary_from=lo,
        salary_to=hi,
        currency=currency,
        experience=_map_experience(row.get('formatted_experience_level')),
        published_at=_ms_to_iso(row.get('listed_time') or row.get('original_listed_time')),
        description=description,
        skills=extract_skills(f'{title}\n{description}\n{skills_desc}'),
        query=query,
    )


def _raise_csv_field_limit() -> None:
    """Kaggle сипаттамалары өте ұзын болуы мүмкін — csv өріс шегін көтереміз."""
    limit = sys.maxsize
    while True:
        try:
            csv.field_size_limit(limit)
            return
        except OverflowError:   # Windows-та C long 32-биттік
            limit //= 10


def iter_csv(path: str, location: Optional[str] = None,
             limit: Optional[int] = None, query: Optional[str] = None) -> Iterator[Vacancy]:
    """CSV файлын ағынмен оқып, Vacancy объектілерін бір-бірлеп береді."""
    _raise_csv_field_limit()
    needle = location.lower() if location else None
    count = 0
    with open(path, encoding='utf-8-sig', newline='') as f:
        for row in csv.DictReader(f):
            if needle and needle not in (row.get('location') or '').lower():
                continue
            vac = row_to_vacancy(row, query=query)
            if vac is None:
                continue
            yield vac
            count += 1
            if limit and count >= limit:
                break


# --- Live режимі (тек демо) -------------------------------------------------
def _sleep() -> None:
    """Сұраныстар арасындағы кідіріс: ≥2 с + кездейсоқ «jitter»."""
    time.sleep(max(float(REQUEST_DELAY), MIN_DELAY) + random.uniform(0.5, 2.0))


class StopCrawl(Exception):
    """LinkedIn шектеу қойды (429/999) — жинауды тоқтату керек."""


def _get(session: requests.Session, url: str) -> Optional[str]:
    resp = session.get(url, timeout=20)
    if resp.status_code in STOP_STATUSES:
        raise StopCrawl(f'HTTP {resp.status_code}: LinkedIn сұраныстарды шектеді, тоқтаймыз.')
    if resp.status_code != 200:
        print(f'  [!] HTTP {resp.status_code}: {url}')
        return None
    return resp.text


def fetch_live(query: str, pages: int = 1, details: bool = False,
               location: str = 'Kazakhstan') -> list[Vacancy]:
    """LinkedIn қонақ іздеу бетінен вакансияларды алу (оқу мақсатында ғана)."""
    pages = max(1, min(int(pages), MAX_PAGES))
    session = requests.Session()
    session.headers.update({'User-Agent': USER_AGENT,
                            'Accept-Language': 'en-US,en;q=0.9,ru;q=0.8'})
    vacancies: list[Vacancy] = []
    start = 0
    try:
        for page in range(pages):
            url = SEARCH_URL.format(keywords=quote_plus(query),
                                    location=quote_plus(location), start=start)
            print(f'  -> бет {page + 1}/{pages}: {url}')
            html = _get(session, url)
            _sleep()
            cards = parse_search_html(html) if html else []
            if not cards:
                break  # нәтиже бітті
            for card in cards:
                info = None
                if details:
                    job_html = _get(session, JOB_URL.format(job_id=card['id']))
                    _sleep()
                    info = parse_job_html(job_html) if job_html else None
                vacancies.append(card_to_vacancy(card, info, query=query))
            start += len(cards)
    except StopCrawl as exc:
        print(f'  [STOP] {exc}')
    except requests.RequestException as exc:
        print(f'  [!] Желі қатесі: {exc}')
    return vacancies


# --- Mock режимі -----------------------------------------------------------
def load_mock(search_path: Optional[str] = None, details: bool = True,
              query: Optional[str] = None) -> list[Vacancy]:
    """Сақталған HTML үлгілерін талдау (желіге сұраныс жоқ)."""
    with open(search_path or MOCK_SEARCH_HTML, encoding='utf-8') as f:
        cards = parse_search_html(f.read())
    job_info = {}
    if details and os.path.exists(MOCK_JOB_HTML):
        with open(MOCK_JOB_HTML, encoding='utf-8') as f:
            info = parse_job_html(f.read())
        if info.get('id'):
            job_info[info['id']] = info
    return [card_to_vacancy(c, job_info.get(c['id']), query=query) for c in cards]


# --- Басты функция ---------------------------------------------------------
def _save_in_batches(items: Iterable[Vacancy], db: str) -> int:
    saved, batch = 0, []
    for vac in items:
        batch.append(vac)
        if len(batch) >= CSV_BATCH:
            saved += save_vacancies(batch, db)
            batch = []
    if batch:
        saved += save_vacancies(batch, db)
    return saved


def collect(csv_path: Optional[str] = None, live: bool = False, query: Optional[str] = None,
            pages: int = 1, db: str = DB_PATH, mock=None, location: Optional[str] = None,
            limit: Optional[int] = None, details: bool = False) -> int:
    """LinkedIn деректерін жинап, SQLite базасына сақтайды. Сақталған жол санын қайтарады.

    Режимді таңдау реті: csv_path → mock → live. Ешқайсысы берілмесе — 0.
    ``mock`` = True (әдепкі fixture) немесе HTML файлының жолы.
    """
    init_db(db)

    if csv_path:
        print(f'[LinkedIn] Kaggle CSV импорты: {csv_path}'
              + (f' (location ∋ "{location}")' if location else ''))
        return _save_in_batches(iter_csv(csv_path, location, limit, query), db)

    if mock:
        path = mock if isinstance(mock, str) else None
        vacancies = load_mock(path, details=True, query=query)
        print(f'[LinkedIn] Mock режимі: {len(vacancies)} вакансия fixture-ден оқылды')
        return save_vacancies(vacancies[:limit] if limit else vacancies, db)

    if live:
        print(LIVE_WARNING.format(max_pages=MAX_PAGES, delay=MIN_DELAY))
        queries = [query] if query else _default_queries()
        total = 0
        for q in queries:
            print(f'[LinkedIn] Live іздеу: "{q}"')
            vacancies = fetch_live(q, pages=pages, details=details,
                                   location=location or 'Kazakhstan')
            if limit:
                vacancies = vacancies[:limit]
            total += save_vacancies(vacancies, db)
        return total

    print('[LinkedIn] Режим таңдалмады: --csv, --mock немесе --live көрсетіңіз. '
          'LinkedIn-ді автоматты жинау әдепкі бойынша өшірулі.')
    return 0


def _default_queries() -> list[str]:
    """config.SEARCH_QUERIES-тен алғашқы 3 сұрау (live жүктемесін азайту үшін)."""
    qs = SEARCH_QUERIES
    if isinstance(qs, dict):
        qs = list(qs.values()) if all(isinstance(v, str) for v in qs.values()) else list(qs)
    return [str(q) for q in list(qs)[:3]]


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description='Мансап Компасы: LinkedIn вакансияларын жинау '
                    '(Kaggle CSV / mock / оқу мақсатындағы live демо)')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--csv', metavar='PATH',
                      help='Kaggle «LinkedIn Job Postings» postings.csv файлы (ұсынылады)')
    mode.add_argument('--mock', nargs='?', const=True, metavar='HTML',
                      help='fixtures/ ішіндегі сақталған HTML-ді талдау (желісіз)')
    mode.add_argument('--live', action='store_true',
                      help='LinkedIn қонақ бетін талдау — ТЕК ОҚУ ДЕМОСЫ, ToS-ты оқыңыз')
    parser.add_argument('--query', help='іздеу сөзі (live), немесе жазбаларға белгі')
    parser.add_argument('--location', help='CSV: location бағанындағы ішкі жол сүзгісі; '
                                           'live: іздеу аймағы (әдепкі Kazakhstan)')
    parser.add_argument('--pages', type=int, default=1, help=f'live беттер саны (≤ {MAX_PAGES})')
    parser.add_argument('--details', action='store_true',
                        help='live: әр вакансияның толық сипаттамасын да жүктеу')
    parser.add_argument('--limit', type=int, help='ең көп вакансия саны')
    parser.add_argument('--db', default=DB_PATH, help=f'SQLite базасы (әдепкі: {DB_PATH})')
    args = parser.parse_args(argv)

    if not (args.csv or args.mock or args.live):
        parser.print_help()
        print('\nРежимді көрсетіңіз: --csv PATH (ұсынылады), --mock немесе --live.')
        return 2

    saved = collect(csv_path=args.csv, live=args.live, query=args.query, pages=args.pages,
                    db=args.db, mock=args.mock, location=args.location,
                    limit=args.limit, details=args.details)
    print(f'[LinkedIn] Базаға жаңа вакансия қосылды: {saved} (бұрыннан барлары жаңартылды) → {args.db}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
