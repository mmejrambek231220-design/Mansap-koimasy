"""Мансап Компасы — коллекторларға ортақ модульдер.

    models  — бірыңғай Vacancy құрылымы
    config  — баптаулар (User-Agent, кідіріс, DB жолы, өңірлер, іздеу сұраулары)
    skills  — дағдылар сөздігі және мәтіннен дағды шығару (NLP-сөздік әдісі)
    db      — SQLite сақтау, CSV экспорт, статистика
"""

import sys

# Windows консолі әдепкіде cp1251 қолданады және қазақ әріптерін (ә, ғ, қ, ң, ү, ұ, һ, і, ө)
# шығара алмайды — барлық скрипттің шығысын UTF-8-ге ауыстырамыз.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, 'reconfigure'):
        _stream.reconfigure(encoding='utf-8', errors='replace')
