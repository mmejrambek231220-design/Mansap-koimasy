"""Мансап Компасы — SQLite қоймасы.

Кесте құрылымы (3-ші қалыпты форма):

    vacancies       — бір вакансия = бір жол; (source, external_id) бірегей
    skills          — дағдылар анықтамалығы (қазақша канондық атау)
    vacancy_skills  — «көп-көпке» байланыс: қай вакансияда қай дағды бар

Келесі қадамда (агрегация → болжам моделі) осы кестелерден тоқсандық
сұраныс есептеледі: published_at бойынша топтап, әр дағдының үлесін санау.
"""
from __future__ import annotations

import csv
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from .config import DB_PATH
from .models import Vacancy

SCHEMA = """
CREATE TABLE IF NOT EXISTS vacancies (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    source        TEXT NOT NULL,          -- 'hh.kz' | 'LinkedIn' | 'Enbek.kz'
    external_id   TEXT NOT NULL,          -- дереккөздегі ID
    url           TEXT,
    title         TEXT NOT NULL,
    company       TEXT,
    city          TEXT,
    region        TEXT,                   -- 8 өңірдің бірі немесе NULL
    salary_from   REAL,
    salary_to     REAL,
    currency      TEXT,
    experience    TEXT,
    published_at  TEXT,                   -- ISO 8601
    description   TEXT,
    query         TEXT,                   -- қай іздеу сұрауымен табылды
    collected_at  TEXT NOT NULL,          -- соңғы рет жиналған уақыт (UTC)
    UNIQUE (source, external_id)
);
CREATE TABLE IF NOT EXISTS skills (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS vacancy_skills (
    vacancy_id  INTEGER NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
    skill_id    INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    PRIMARY KEY (vacancy_id, skill_id)
);
CREATE INDEX IF NOT EXISTS idx_vacancies_published ON vacancies(published_at);
CREATE INDEX IF NOT EXISTS idx_vacancies_region    ON vacancies(region);
CREATE INDEX IF NOT EXISTS idx_vacancy_skills_skill ON vacancy_skills(skill_id);
"""

# Vacancy өрістері → vacancies бағандары (id мен collected_at-тан басқа)
_COLUMNS = ['source', 'external_id', 'url', 'title', 'company', 'city', 'region',
            'salary_from', 'salary_to', 'currency', 'experience', 'published_at',
            'description', 'query']


def _connect(path) -> sqlite3.Connection:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.execute('PRAGMA foreign_keys = ON')
    return conn


def init_db(path=DB_PATH) -> None:
    """Базаны және кестелерді құру (бар болса — ештеңе өзгермейді)."""
    with _connect(path) as conn:
        conn.executescript(SCHEMA)
    conn.close()


def _skill_id(conn: sqlite3.Connection, name: str) -> int:
    conn.execute('INSERT OR IGNORE INTO skills(name) VALUES (?)', (name,))
    return conn.execute('SELECT id FROM skills WHERE name = ?', (name,)).fetchone()[0]


def save_vacancies(vacancies: list[Vacancy], path=DB_PATH) -> int:
    """Вакансияларды сақтау (upsert). Қайтарады: жаңа қосылған жолдар саны.

    Бұрыннан бар (source, external_id) жазбасы жаңартылады, дағдылар тізімі
    қайта жазылады. Барлығы бір транзакцияда орындалады.
    """
    init_db(path)
    now = datetime.now(timezone.utc).isoformat(timespec='seconds')
    new_rows = 0
    conn = _connect(path)
    try:
        with conn:  # транзакция: қате болса — бәрі кері қайтарылады
            for v in vacancies:
                row = conn.execute('SELECT id FROM vacancies WHERE source = ? AND external_id = ?',
                                   (v.source, str(v.external_id))).fetchone()
                values = [getattr(v, c) for c in _COLUMNS]
                values[1] = str(values[1])
                if row is None:
                    cols = ', '.join(_COLUMNS + ['collected_at'])
                    marks = ', '.join('?' * (len(_COLUMNS) + 1))
                    cur = conn.execute(f'INSERT INTO vacancies ({cols}) VALUES ({marks})', values + [now])
                    vid = cur.lastrowid
                    new_rows += 1
                else:
                    vid = row[0]
                    sets = ', '.join(f'{c} = ?' for c in _COLUMNS[2:]) + ', collected_at = ?'
                    conn.execute(f'UPDATE vacancies SET {sets} WHERE id = ?', values[2:] + [now, vid])
                    conn.execute('DELETE FROM vacancy_skills WHERE vacancy_id = ?', (vid,))
                for name in sorted(set(v.skills or [])):
                    conn.execute('INSERT OR IGNORE INTO vacancy_skills(vacancy_id, skill_id) VALUES (?, ?)',
                                 (vid, _skill_id(conn, name)))
    finally:
        conn.close()
    return new_rows


def export_csv(path_csv, db=DB_PATH) -> int:
    """Барлық вакансияларды дағдыларымен бірге CSV-ге шығару (Excel/pandas үшін).

    Дағдылар бір бағанда «; » арқылы біріктіріледі. Қайтарады: жол саны.
    """
    init_db(db)
    conn = _connect(db)
    try:
        cur = conn.execute("""
            SELECT v.id, v.source, v.external_id, v.url, v.title, v.company, v.city, v.region,
                   v.salary_from, v.salary_to, v.currency, v.experience, v.published_at, v.query,
                   v.collected_at, COALESCE(GROUP_CONCAT(s.name, '; '), '') AS skills
            FROM vacancies v
            LEFT JOIN vacancy_skills vs ON vs.vacancy_id = v.id
            LEFT JOIN skills s ON s.id = vs.skill_id
            GROUP BY v.id
            ORDER BY v.published_at
        """)
        header = [d[0] for d in cur.description]
        rows = cur.fetchall()
    finally:
        conn.close()
    Path(path_csv).parent.mkdir(parents=True, exist_ok=True)
    # utf-8-sig — Excel кириллица мен қазақ әріптерін дұрыс ашуы үшін
    with open(path_csv, 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)
    return len(rows)


def stats(db=DB_PATH, top: int = 10) -> dict:
    """Қысқа статистика: барлығы, дереккөз/өңір бойынша сан, ең жиі дағдылар."""
    init_db(db)
    conn = _connect(db)
    try:
        total = conn.execute('SELECT COUNT(*) FROM vacancies').fetchone()[0]
        by_source = dict(conn.execute(
            'SELECT source, COUNT(*) FROM vacancies GROUP BY source ORDER BY 2 DESC').fetchall())
        by_region = dict(conn.execute(
            "SELECT COALESCE(region, '(басқа)'), COUNT(*) FROM vacancies GROUP BY 1 ORDER BY 2 DESC").fetchall())
        top_skills = conn.execute("""
            SELECT s.name, COUNT(*) AS n FROM vacancy_skills vs
            JOIN skills s ON s.id = vs.skill_id
            GROUP BY s.id ORDER BY n DESC, s.name LIMIT ?
        """, (top,)).fetchall()
        with_salary = conn.execute(
            'SELECT COUNT(*) FROM vacancies WHERE salary_from IS NOT NULL OR salary_to IS NOT NULL').fetchone()[0]
    finally:
        conn.close()
    return {
        'total': total,
        'by_source': by_source,
        'by_region': by_region,
        'with_salary': with_salary,
        'top_skills': [(name, n) for name, n in top_skills],
    }


def print_stats(db=DB_PATH) -> None:
    """stats() нәтижесін оқуға ыңғайлы түрде басып шығару."""
    s = stats(db)
    print(f'База: {db}')
    print(f'Барлық вакансия: {s["total"]} (жалақысы көрсетілген: {s["with_salary"]})')
    print('Дереккөздер бойынша:', ', '.join(f'{k}: {v}' for k, v in s['by_source'].items()) or '—')
    print('Өңірлер бойынша:', ', '.join(f'{k}: {v}' for k, v in s['by_region'].items()) or '—')
    print('Ең жиі дағдылар:')
    for name, n in s['top_skills']:
        print(f'  {n:>5}  {name}')
