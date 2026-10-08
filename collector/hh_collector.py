"""Мансап Компасы — hh.kz вакансияларын ресми hh API арқылы жинау.

Дереккөз: https://api.hh.ru (hh.kz та осы API-ді қолданады), area=40 — Қазақстан.
Құжаттама: https://api.hh.ru/openapi/redoc

Маңызды: hh API қазір анонимді сұраныстарға 403 (forbidden) қайтарады, сондықтан
https://dev.hh.ru сайтында қосымша тіркеп, access token алу керек:
    PowerShell:  $env:HH_TOKEN = "<токен>"
    bash:        export HH_TOKEN=<токен>

Іске қосу мысалдары:
    python collector/hh_collector.py --query "Python әзірлеуші" --pages 2
    python collector/hh_collector.py --details                    # барлық лауазымдар + key_skills
    python collector/hh_collector.py --mock collector/fixtures/hh_sample.json --details   # желісіз

Ағын:  fetch_page (іздеу беті) → [fetch_details (толық вакансия)] → parse_item (Vacancy)
       → extract_skills (дағдылар сөздігі) → save_vacancies (SQLite)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import requests

# Скрипт ретінде іске қосылғанда да `common` пакеті табылуы үшін
sys.path.insert(0, str(Path(__file__).resolve().parent))

from common.config import DB_PATH, REQUEST_DELAY, REQUEST_TIMEOUT, SEARCH_QUERIES, USER_AGENT, normalize_region  # noqa: E402
from common.db import init_db, print_stats, save_vacancies  # noqa: E402
from common.models import Vacancy  # noqa: E402
from common.skills import clean_html, extract_skills  # noqa: E402

SOURCE = 'hh.kz'
API = 'https://api.hh.ru'
AREA_KZ = 40            # hh анықтамалығындағы «Қазақстан» коды
PER_PAGE = 100          # бір беттегі ең көп вакансия
MAX_DEPTH = 2000        # hh бір сұраныс бойынша 2000-нан артық нәтиже бермейді
MAX_PAGES = MAX_DEPTH // PER_PAGE   # = 20
MAX_RETRIES = 4         # 429 / 5xx кезіндегі қайталау саны

# hh валюта кодтары → ISO (hh рубльді 'RUR' деп жазады)
CURRENCY_FIX = {'RUR': 'RUB'}

TOKEN_HELP = """\
hh.ru API рұқсат бермеді.
  • hh API анонимді сұраныстарға 403 (forbidden) қайтарады — токен міндетті.
  • Токен алу: https://dev.hh.ru → «Мои приложения» → қосымшаны тіркеу → access token.
  • Содан кейін:
        PowerShell:  $env:HH_TOKEN = "<токен>";  python collector/hh_collector.py
        bash:        HH_TOKEN=<токен> python collector/hh_collector.py
  • Токеннің мерзімі өтпегенін және қосымшаның бекітілгенін тексеріңіз.
  • Желісіз тексеру:  python collector/hh_collector.py --mock collector/fixtures/hh_sample.json --details"""


class HHAuthError(RuntimeError):
    """Токен жоқ, жарамсыз немесе hh сұранысқа тыйым салды (401/403)."""


# ---------------------------------------------------------------------------
# 1. Желі: токен, шектеу (throttle), 429/5xx кезінде экспоненциалды қайталау
# ---------------------------------------------------------------------------
_last_call = 0.0


def _throttle() -> None:
    """Сұраныстар арасында кемінде REQUEST_DELAY секунд күту."""
    global _last_call
    wait = _last_call + REQUEST_DELAY - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    _last_call = time.monotonic()


def make_session(token: str | None = None) -> requests.Session:
    """hh талап ететін тақырыптары бар HTTP сессия жасау."""
    token = token or os.environ.get('HH_TOKEN')
    if not token:
        raise HHAuthError('HH_TOKEN орта айнымалысы орнатылмаған.\n' + TOKEN_HELP)
    s = requests.Session()
    s.headers.update({
        'Authorization': f'Bearer {token}',
        'HH-User-Agent': USER_AGENT,     # hh бұл тақырыпты міндетті түрде сұрайды
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
    })
    return s


def _get(session: requests.Session, url: str, params: dict | None = None) -> dict | None:
    """GET сұранысы: JSON қайтарады; 404 болса — None; 401/403 — HHAuthError."""
    for attempt in range(MAX_RETRIES + 1):
        _throttle()
        try:
            r = session.get(url, params=params, timeout=REQUEST_TIMEOUT)
        except requests.RequestException as e:
            if attempt >= MAX_RETRIES:
                raise
            print(f'  Желі қатесі ({e.__class__.__name__}), {2 ** attempt} с кейін қайталаймыз...')
            time.sleep(2 ** attempt)
            continue
        if r.ok:
            return r.json()
        if r.status_code in (401, 403):
            raise HHAuthError(f'HTTP {r.status_code}: {r.text[:300]}\n' + TOKEN_HELP)
        if r.status_code == 404:
            return None                                   # вакансия жабылған/жойылған
        if (r.status_code == 429 or r.status_code >= 500) and attempt < MAX_RETRIES:
            delay = int(r.headers.get('Retry-After', 0) or 0) or 2 ** (attempt + 1)
            print(f'  HTTP {r.status_code}: {delay} с күтіп, қайталаймыз ({attempt + 1}/{MAX_RETRIES})')
            time.sleep(delay)
            continue
        r.raise_for_status()
    raise RuntimeError(f'Сұраныс сәтсіз аяқталды: {url}')


# ---------------------------------------------------------------------------
# 2. API шақырулары (немесе fixture — желісіз режим)
#    Fixture құрылымы: {"queries": {"<сұраныс>": {items, found, pages}}, "details": {"<id>": {...}}}
# ---------------------------------------------------------------------------
def fetch_page(session: requests.Session | None, query: str, page: int, mock: dict | None = None) -> dict:
    """/vacancies іздеуінің бір беті (100 вакансияға дейін)."""
    if mock is not None:
        r = mock.get('queries', {}).get(query)
        return r if (r and page == 0) else {'items': [], 'found': 0, 'pages': 0, 'page': page}
    params = {
        'text': query,
        'area': AREA_KZ,
        'search_field': 'name',          # тек лауазым атауынан іздеу — нәтиже дәлірек
        'per_page': PER_PAGE,
        'page': page,
        'order_by': 'publication_time',
    }
    return _get(session, f'{API}/vacancies', params) or {'items': [], 'pages': 0}


def fetch_details(session: requests.Session | None, vacancy_id: str, mock: dict | None = None) -> dict | None:
    """/vacancies/{id}: толық сипаттама (description) және key_skills."""
    if mock is not None:
        return mock.get('details', {}).get(str(vacancy_id))
    return _get(session, f'{API}/vacancies/{vacancy_id}')


# ---------------------------------------------------------------------------
# 3. hh JSON → Vacancy
# ---------------------------------------------------------------------------
def parse_item(item: dict, detail: dict | None = None, query: str | None = None) -> Vacancy:
    """hh іздеу нәтижесінің бір элементін (және толық нұсқасын) Vacancy-ге айналдыру."""
    d = detail or {}
    salary = d.get('salary') or item.get('salary') or {}
    area = (d.get('area') or item.get('area') or {}).get('name')
    experience = (d.get('experience') or item.get('experience') or {}).get('id')
    employer = (d.get('employer') or item.get('employer') or {}).get('name')
    currency = salary.get('currency')

    # Мәтін: толық сипаттама болса — соны, болмаса іздеудегі қысқа үзінді (snippet)
    snippet = item.get('snippet') or {}
    if d.get('description'):
        description = clean_html(d['description'])
    else:
        description = clean_html(' '.join(filter(None, [snippet.get('requirement'), snippet.get('responsibility')])))
    key_skills = [s.get('name', '') for s in d.get('key_skills') or []]

    title = item.get('name') or d.get('name') or ''
    vid = str(item.get('id') or d.get('id'))
    return Vacancy(
        source=SOURCE,
        external_id=vid,
        url=item.get('alternate_url') or d.get('alternate_url') or f'https://hh.kz/vacancy/{vid}',
        title=title,
        company=employer,
        city=area,
        region=normalize_region(area),
        salary_from=salary.get('from'),
        salary_to=salary.get('to'),
        currency=CURRENCY_FIX.get(currency, currency),
        experience=experience,
        published_at=item.get('published_at') or d.get('published_at'),
        description=description,
        # Дағдылар лауазым атауынан, сипаттамадан және hh key_skills өрісінен алынады
        skills=extract_skills(f'{title}\n{description}', key_skills),
        query=query,
    )


# ---------------------------------------------------------------------------
# 4. Жинау
# ---------------------------------------------------------------------------
def _resolve_queries(query: str | None) -> list[tuple[str, str]]:
    """--query мәнін (қазақша атау не орысша сұрау, үтірмен) [(атау, сұрау)] тізіміне айналдыру."""
    if not query:
        return list(SEARCH_QUERIES.items())
    out = []
    reverse = {v: k for k, v in SEARCH_QUERIES.items()}
    for q in (x.strip() for x in query.split(',')):
        if not q:
            continue
        if q in SEARCH_QUERIES:
            out.append((q, SEARCH_QUERIES[q]))
        else:
            out.append((reverse.get(q, q), q))           # тізімде жоқ болса — сол күйі іздейміз
    return out


def collect(query: str | None = None, pages: int = MAX_PAGES, details: bool = False,
            mock: str | Path | None = None, db=DB_PATH, token: str | None = None) -> int:
    """hh-тан вакансияларды жинап, SQLite-қа сақтау. Қайтарады: жаңа жазбалар саны.

    query   — бір не бірнеше лауазым (үтірмен); None болса — tools/search-queries.json бәрі
    pages   — бір сұраныс үшін бет саны (1..20)
    details — әр вакансияның толық нұсқасын (key_skills, description) жүктеу
    mock    — желінің орнына fixture JSON файлы
    """
    pages = max(1, min(int(pages), MAX_PAGES))
    fixture = None
    session = None
    if mock:
        with open(mock, encoding='utf-8') as f:
            fixture = json.load(f)
        print(f'Fixture режимі (желісіз): {mock}')
    else:
        session = make_session(token)
        print(f'hh API: area={AREA_KZ}, {pages} бет × {PER_PAGE}, details={details}')

    init_db(db)
    total_new = 0
    for title_kz, text in _resolve_queries(query):
        batch: list[Vacancy] = []
        for page in range(pages):
            res = fetch_page(session, text, page, mock=fixture)
            for item in res.get('items') or []:
                detail = fetch_details(session, item['id'], mock=fixture) if details else None
                batch.append(parse_item(item, detail, query=title_kz))
            if page + 1 >= (res.get('pages') or 0):    # беттер бітті
                break
        new = save_vacancies(batch, db) if batch else 0
        total_new += new
        print(f'  {title_kz} («{text}»): {len(batch)} вакансия, жаңасы {new}')
    return total_new


# ---------------------------------------------------------------------------
# 5. Командалық жол
# ---------------------------------------------------------------------------
def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):           # Windows консолінде қазақ әріптері үшін
        try:
            stream.reconfigure(encoding='utf-8')
        except (AttributeError, ValueError):
            pass
    p = argparse.ArgumentParser(description='hh.kz вакансияларын hh API арқылы жинау (Мансап Компасы)')
    p.add_argument('--query', help='лауазым(дар): қазақша атауы не орысша сұрау, үтірмен бөлінген')
    p.add_argument('--pages', type=int, default=MAX_PAGES, help=f'бір сұраныс үшін бет саны (1..{MAX_PAGES})')
    p.add_argument('--details', action='store_true', help='/vacancies/{id} арқылы key_skills пен толық сипаттама')
    p.add_argument('--mock', metavar='FIXTURE.json', help='желісіз режим: API орнына fixture файлы')
    p.add_argument('--db', default=str(DB_PATH), help='SQLite базасының жолы')
    args = p.parse_args(argv)

    try:
        new = collect(query=args.query, pages=args.pages, details=args.details, mock=args.mock, db=args.db)
    except HHAuthError as e:
        print(f'Қате: {e}', file=sys.stderr)
        return 1
    except requests.RequestException as e:
        print(f'Желі қатесі: {e}', file=sys.stderr)
        return 1
    print(f'\nЖаңа вакансиялар: {new}\n')
    print_stats(args.db)
    return 0


if __name__ == '__main__':
    sys.exit(main())
