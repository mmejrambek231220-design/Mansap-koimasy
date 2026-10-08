"""Мансап Компасы — барлық коллекторларды кезекпен іске қосу.

    hh.kz (hh API) → LinkedIn → Enbek.kz → жалпы статистика

Әр коллектор жеке импортталады (lazy import): біреуі қате берсе немесе
файлы жоқ болса, қалғандары бәрібір орындалады.

Іске қосу:
    python collector/run_all.py                       # толық жинау
    python collector/run_all.py --pages 2 --details
    python collector/run_all.py --hh-mock collector/fixtures/hh_sample.json --only hh
    python collector/run_all.py --csv collector/data/vacancies.csv
"""
from __future__ import annotations

import argparse
import importlib
import inspect
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common.config import DB_PATH  # noqa: E402
from common.db import export_csv, init_db, print_stats  # noqa: E402

# (қысқа атау, модуль, сипаттама)
COLLECTORS = [
    ('hh', 'hh_collector', 'hh.kz (ресми hh API)'),
    ('linkedin', 'linkedin_collector', 'LinkedIn'),
    ('enbek', 'enbek_collector', 'Enbek.kz'),
]


def _call_collect(func, **kwargs):
    """collect() функциясын тек ол қабылдайтын аргументтермен шақыру."""
    params = inspect.signature(func).parameters
    if any(p.kind is p.VAR_KEYWORD for p in params.values()):
        accepted = kwargs
    else:
        accepted = {k: v for k, v in kwargs.items() if k in params and v is not None}
    return func(**accepted)


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding='utf-8')
        except (AttributeError, ValueError):
            pass
    p = argparse.ArgumentParser(description='Барлық коллекторларды кезекпен іске қосу')
    p.add_argument('--db', default=str(DB_PATH), help='SQLite базасының жолы')
    p.add_argument('--pages', type=int, default=None, help='бет саны (коллектор қолдаса)')
    p.add_argument('--details', action='store_true', help='толық вакансия мәтінін жүктеу (hh)')
    p.add_argument('--hh-mock', metavar='FIXTURE.json', help='hh коллекторын желісіз іске қосу')
    p.add_argument('--only', help='тек осы коллекторлар, үтірмен: hh,linkedin,enbek')
    p.add_argument('--csv', help='соңында базаны осы CSV файлына экспорттау')
    args = p.parse_args(argv)

    init_db(args.db)
    only = {x.strip() for x in args.only.split(',')} if args.only else None
    summary = []
    for key, module_name, label in COLLECTORS:
        if only and key not in only:
            continue
        print(f'\n=== {label} ===')
        t0 = time.monotonic()
        try:
            module = importlib.import_module(module_name)       # lazy import
            kwargs = {'db': args.db, 'pages': args.pages}
            if key == 'hh':
                kwargs.update(details=args.details, mock=args.hh_mock)
            new = _call_collect(module.collect, **kwargs)
            summary.append((label, 'OK', new))
        except ImportError as e:
            print(f'  Өткізілді: модуль жүктелмеді ({e})')
            summary.append((label, 'жоқ', None))
        except SystemExit as e:
            print(f'  Коллектор тоқтады (код {e.code})')
            summary.append((label, 'қате', None))
        except Exception as e:  # noqa: BLE001 — бір коллектордың қатесі қалғандарын тоқтатпауы керек
            print(f'  Қате: {e.__class__.__name__}: {e}')
            summary.append((label, 'қате', None))
        print(f'  Уақыт: {time.monotonic() - t0:.1f} с')

    print('\n=== Қорытынды ===')
    for label, status, new in summary:
        print(f'  {label:<24} {status:<5} жаңа: {new if new is not None else "—"}')
    print()
    print_stats(args.db)
    if args.csv:
        n = export_csv(args.csv, args.db)
        print(f'\nCSV: {args.csv} ({n} жол)')
    return 0 if all(s == 'OK' for _, s, _ in summary) else 1


if __name__ == '__main__':
    sys.exit(main())
