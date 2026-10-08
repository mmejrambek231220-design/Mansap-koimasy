# Мансап Компасы — деректер жинау қабаты (`collector/`)

## Мақсаты

Бұл папкада курстық жұмыстың **деректер жинау кодтары** бар. Жоба Қазақстанның еңбек нарығында
қандай дағдыларға сұраныс болатынын машиналық оқыту арқылы болжайды. Болжам жасау үшін алдымен
жұмыс сайттарынан нақты вакансияларды жинап, олардан дағдыларды шығарып алу керек. Бұл код
дәл осы жұмысты атқарады.

> **Маңызды:** сайт (`index.html`, `data/dataset.js`) қазір **демо (синтетикалық) деректерді**
> пайдаланады. `collector/` — сайттан бөлек тұрған, өз алдына іске қосылатын Python коды.
> Ол әзірге сайтқа қосылмаған. Келесі кезеңде SQLite базасындағы деректер тоқсан бойынша
> агрегатталып, сайттың деректер файлына шығарылады.

## Архитектура

```
 ┌──────────────┐  ┌──────────────────┐  ┌───────────────┐
 │  hh API      │  │  LinkedIn        │  │  Enbek.kz     │   дереккөздер
 │ api.hh.ru    │  │ (ашық API жоқ)   │  │               │
 └──────┬───────┘  └────────┬─────────┘  └───────┬───────┘
        │                   │                    │
 hh_collector.py   linkedin_collector.py  enbek_collector.py    ← коллекторлар
        │                   │                    │
        └──────────┬────────┴──────────┬─────────┘
                   ▼                   ▼
          common/models.py      common/skills.py
          Vacancy (бірыңғай      clean_html + extract_skills
          құрылым)               (47 дағды сөздігі, NLP)
                   │                   │
                   └─────────┬─────────┘
                             ▼
                      common/db.py  ──►  data/vacancies.db (SQLite)
                             │                │
                     export_csv / stats       ▼
                                   [келесі кезең] тоқсандық агрегация
                                          │
                                          ▼
                                   болжам моделі → сайт
```

`run_all.py` үш коллекторды кезекпен іске қосып, соңында статистиканы шығарады.

| Файл | Міндеті |
|------|---------|
| `common/models.py` | `Vacancy` — барлық дереккөзге ортақ dataclass |
| `common/config.py` | User-Agent, сұраныс аралығы (`REQUEST_DELAY`), DB жолы, 8 өңір, `normalize_region()`, іздеу сұраулары |
| `common/skills.py` | `SKILL_SYNONYMS` (47 дағды → орысша/ағылшынша синонимдер), `extract_skills()`, `clean_html()` |
| `common/db.py` | SQLite схемасы, `init_db`, `save_vacancies` (upsert), `export_csv`, `stats` |
| `hh_collector.py` | hh.kz вакансиялары, ресми hh API арқылы |
| `linkedin_collector.py` | LinkedIn коллекторы |
| `enbek_collector.py` | Enbek.kz коллекторы |
| `run_all.py` | Барлық коллекторды кезекпен іске қосу |
| `fixtures/` | Желісіз тексеруге арналған үлгі жауаптар |

## Өңдеу қадамдары (pipeline)

1. **Жинау (collect).** Әр лауазым үшін (`tools/search-queries.json`, мыс. «Python әзірлеуші» →
   «Python разработчик») дереккөзден вакансиялар жүктеледі. hh үшін: `area=40` (Қазақстан),
   бетте 100, бір сұранысқа 20 бетке дейін (hh 2000 нәтижеден тереңге бермейді).
2. **Тазалау (clean).** HTML тегтері алынады (`clean_html`), қала атауы 8 өңірдің біріне
   келтіріледі (`normalize_region`: «Нур-Султан» → «Астана», «Усть-Каменогорск» → «Өскемен»),
   валюта кодтары түзетіледі (`RUR` → `RUB`).
3. **Дағдыларды шығару (NLP-сөздік).** `extract_skills()` вакансия атауы, сипаттамасы және
   hh `key_skills` өрісі бойынша 47 дағдының қайсысы аталғанын анықтайды. Әр дағдыға
   орысша/ағылшынша синонимдер мен тұрақты өрнектер жазылған (мыс. «Django», «FastAPI» →
   *Python*; «МСФО», «IFRS» → *Бухгалтерлік есеп (ХҚЕС)*). Сөз шекарасы кириллицада да
   дұрыс тексеріледі, «ё» → «е» ауыстырылады.
4. **SQLite-қа сақтау.** `save_vacancies()` — upsert: бір вакансия `(source, external_id)`
   бойынша бір рет қана сақталады, қайта жинағанда жаңартылады.
5. **Тоқсандық агрегация** *(келесі кезең)*: `published_at` бойынша тоқсанға топтап, әр дағдының
   вакансиялардағы үлесін есептеу.
6. **Болжам моделі** *(келесі кезең)*: тоқсандық уақыт қатарлары бойынша келесі тоқсандарға
   дағдыға сұранысты болжау, нәтижесін сайтқа шығару.

## Орнату

```bash
python -m pip install -r collector/requirements.txt
```

Тек стандартты кітапхана + `requests` + `beautifulsoup4` қолданылады. Python 3.10+.

## hh API токенін алу

hh API қазір **анонимді сұраныстарға 403 (forbidden)** қайтарады, сондықтан токен қажет:

1. https://dev.hh.ru сайтына hh аккаунтымен кіріңіз.
2. «Мои приложения» бөлімінде жаңа қосымша тіркеңіз (атауы, сипаттамасы — курстық жұмыс).
3. Қосымша бекітілгеннен кейін access token алыңыз.
4. Токенді орта айнымалысына жазыңыз (кодқа ешқашан жазбаңыз):

```powershell
# Windows PowerShell
$env:HH_TOKEN = "<токен>"
```
```bash
# Linux / macOS
export HH_TOKEN=<токен>
```

Сұраныстарда `Authorization: Bearer <токен>` және `HH-User-Agent: MansapKompasy/1.0 (coursework project)`
тақырыптары жіберіледі.

## Іске қосу

```bash
# hh.kz — желісіз тексеру (токен керек емес)
python collector/hh_collector.py --mock collector/fixtures/hh_sample.json --details

# hh.kz — бір лауазым, 2 бет
python collector/hh_collector.py --query "Python әзірлеуші" --pages 2

# hh.kz — барлық лауазымдар + толық сипаттама мен key_skills (ұзақ жұмыс істейді)
python collector/hh_collector.py --details

# LinkedIn және Enbek.kz (опцияларын --help арқылы қараңыз)
python collector/linkedin_collector.py --help
python collector/enbek_collector.py --help

# Барлығын кезекпен + CSV экспорт
python collector/run_all.py --details --csv collector/data/vacancies.csv
python collector/run_all.py --only hh --hh-mock collector/fixtures/hh_sample.json
```

`hh_collector.py` опциялары:

| Опция | Мағынасы |
|-------|----------|
| `--query` | Лауазым(дар): қазақша атауы не орысша сұрау, үтірмен. Берілмесе — `tools/search-queries.json` бәрі |
| `--pages N` | Бір сұраныс үшін бет саны (1..20, әдепкі 20) |
| `--details` | `/vacancies/{id}` арқылы толық сипаттама мен `key_skills` алу (әр вакансияға +1 сұраныс) |
| `--mock FILE` | Желінің орнына fixture JSON (офлайн режим) |
| `--db PATH` | SQLite жолы (әдепкі `collector/data/vacancies.db`) |

## Деректер базасының схемасы

```
vacancies                                  skills
──────────────────────────────            ─────────────────
id            INTEGER PK                   id    INTEGER PK
source        TEXT   ┐ UNIQUE              name  TEXT UNIQUE   (қазақша канондық атау)
external_id   TEXT   ┘ (source, ext_id)
url           TEXT                         vacancy_skills
title         TEXT                         ─────────────────
company       TEXT                         vacancy_id  → vacancies.id ┐ PK
city          TEXT   (дереккөздегі қала)   skill_id    → skills.id    ┘
region        TEXT   (8 өңірдің бірі / NULL)
salary_from   REAL
salary_to     REAL
currency      TEXT   (KZT, RUB, USD…)
experience    TEXT   (noExperience, between1And3, between3And6, moreThan6)
published_at  TEXT   (ISO 8601)
description   TEXT   (HTML-сыз мәтін)
query         TEXT   (қай лауазым бойынша табылды)
collected_at  TEXT   (соңғы жиналған уақыт, UTC)
```

Мысал сұраныс — дағдылардың тоқсандық сұранысы:

```sql
SELECT substr(v.published_at, 1, 4) || '-Q' || ((CAST(substr(v.published_at, 6, 2) AS INT) + 2) / 3) AS quarter,
       s.name, COUNT(*) AS n
FROM vacancies v
JOIN vacancy_skills vs ON vs.vacancy_id = v.id
JOIN skills s ON s.id = vs.skill_id
GROUP BY quarter, s.name
ORDER BY quarter, n DESC;
```

## Этика және заңдылық

- **Ресми API бірінші.** Ресми API бар жерде (hh) тек соны қолданамыз. Пайдалану шарттары
  (Terms of Service) мен `robots.txt` ережелері сақталады.
- **Жүктемені шектеу.** Сұраныстар арасында кемінде `REQUEST_DELAY` = 1 секунд үзіліс бар.
  429/5xx жауабында экспоненциалды күтумен (backoff) қайталанады.
- **Ашық таныстыру.** `User-Agent: MansapKompasy/1.0 (coursework project)`. Жеке e-mail не
  құпия мәлімет кодқа жазылмайды, токен тек орта айнымалысында сақталады.
- **LinkedIn-нің ашық вакансиялар API-і жоқ.** LinkedIn пайдалану шарттары автоматты
  скрейпингке тыйым салады. Сондықтан LinkedIn коллекторын шарттар мен рұқсат шегінде ғана
  (мыс. қолмен экспортталған файлдар немесе fixture арқылы) қолдану керек.
- **Жеке деректер жиналмайды.** Тек вакансия туралы ақпарат (лауазым, компания, қала,
  жалақы, талаптар) сақталады. Үміткерлер мен байланыс адамдарының деректері алынбайды.
- Деректер тек оқу (курстық жұмыс) мақсатында, жиынтық статистика түрінде қолданылады.
