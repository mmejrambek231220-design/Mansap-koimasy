"""Мансап Компасы — деректер жинау қабатының ортақ баптаулары.

Барлық коллекторлар (hh.kz, LinkedIn, Enbek.kz) осы тұрақтыларды қолданады,
сондықтан User-Agent, сұраныстар арасындағы кідіріс пен база жолы бір жерде.
"""
from __future__ import annotations

import json
from pathlib import Path

# --- Жолдар -----------------------------------------------------------------
COLLECTOR_DIR = Path(__file__).resolve().parent.parent      # .../collector
PROJECT_ROOT = COLLECTOR_DIR.parent                          # .../mansap-kompasy
DATA_DIR = COLLECTOR_DIR / 'data'                            # жиналған деректер
DB_PATH = DATA_DIR / 'vacancies.db'                          # SQLite базасы
FIXTURES_DIR = COLLECTOR_DIR / 'fixtures'                    # желісіз тексеру файлдары

# --- Желі этикеті -----------------------------------------------------------
# Сайттарға өзімізді ашық таныстырамыз. Мұнда ешқашан жеке e-mail жазбаймыз.
USER_AGENT = 'MansapKompasy/1.0 (coursework project)'
# Сұраныстар арасындағы ең аз кідіріс (секунд) — серверге артық жүктеме бермеу үшін.
REQUEST_DELAY = 1.0
# Бір сұранысқа күту уақыты (секунд).
REQUEST_TIMEOUT = 30

# --- Өңірлер ----------------------------------------------------------------
# Сайттағы 8 өңір (data/dataset.js ішіндегі regions тізімімен бірдей ретте).
REGIONS = ['Алматы', 'Астана', 'Шымкент', 'Қарағанды', 'Атырау', 'Ақтөбе', 'Павлодар', 'Өскемен']

# Қала атауының орысша / ағылшынша / қазақша жазылу нұсқалары → өңір.
REGION_ALIASES: dict[str, list[str]] = {
    'Алматы': ['алматы', 'almaty', 'алма-ата', 'alma-ata'],
    'Астана': ['астана', 'astana', 'нур-султан', 'нұр-сұлтан', 'nur-sultan', 'nursultan', 'целиноград'],
    'Шымкент': ['шымкент', 'shymkent', 'чимкент', 'chimkent'],
    'Қарағанды': ['караганда', 'қарағанды', 'karaganda', 'karagandy', 'qaraghandy'],
    'Атырау': ['атырау', 'atyrau', 'гурьев'],
    'Ақтөбе': ['актобе', 'ақтөбе', 'aktobe', 'aqtobe', 'актюбинск'],
    'Павлодар': ['павлодар', 'pavlodar'],
    'Өскемен': ['усть-каменогорск', 'өскемен', 'оскемен', 'ust-kamenogorsk', 'ust kamenogorsk', 'oskemen', 'öskemen'],
}
_ALIAS_INDEX = {alias: region for region, names in REGION_ALIASES.items() for alias in names}


def normalize_region(city: str | None) -> str | None:
    """Қала атауын (кез келген тілде) сайттағы 8 өңірдің біріне келтіреді.

    Мысалы: 'Nur-Sultan' → 'Астана', 'Усть-Каменогорск' → 'Өскемен'.
    'Almaty, Kazakhstan' сияқты толық жолдардың бірінші бөлігі қаралады.
    Сәйкес келмесе — None.
    """
    if not city:
        return None
    text = str(city).strip().lower().replace('ё', 'е')
    if text in _ALIAS_INDEX:
        return _ALIAS_INDEX[text]
    # «Almaty, Almaty Region, Kazakhstan» / «г. Алматы» сияқты нұсқалар
    for part in text.replace('г.', ' ').replace('(', ',').replace(')', ',').split(','):
        part = part.strip()
        if part in _ALIAS_INDEX:
            return _ALIAS_INDEX[part]
    return None


# --- Іздеу сұраулары --------------------------------------------------------
# tools/search-queries.json: қазақша лауазым атауы → орысша іздеу сұрауы.
_FALLBACK_QUERIES = {
    'Python әзірлеуші': 'Python разработчик',
    'Деректер талдаушысы': 'Аналитик данных',
    'Бухгалтер': 'Бухгалтер',
    'Мейірбике': 'Медсестра',
    'Мектеп мұғалімі': 'Учитель',
    'Логист': 'Логист',
    'Маркетолог': 'Маркетолог',
    'Энергетик-инженер': 'Инженер-энергетик',
}


def _load_search_queries() -> dict[str, str]:
    path = PROJECT_ROOT / 'tools' / 'search-queries.json'
    try:
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
        if isinstance(data, dict) and data:
            return {str(k): str(v) for k, v in data.items()}
    except (OSError, ValueError):
        pass
    return dict(_FALLBACK_QUERIES)  # файл жоқ не бүлінген болса — қысқа әдепкі тізім


SEARCH_QUERIES: dict[str, str] = _load_search_queries()
