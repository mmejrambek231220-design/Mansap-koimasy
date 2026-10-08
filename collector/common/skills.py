"""Мансап Компасы — дағдылар сөздігі және мәтіннен дағды шығару.

Әдіс: сөздікке негізделген NLP (dictionary-based extraction). Әр дағдының
қазақша канондық атауына орысша/ағылшынша синонимдер мен тұрақты өрнектер
сәйкестендірілген (tools/fetch-hh.js сөздігінен көшірілген, 47 дағды).

Сөз шекарасы кириллицада да дұрыс жұмыс істеуі үшін \\b орнына
«алдында/артында әріп не цифр жоқ» деген lookaround қолданылады:
    (?<![^\\W_])  ...  (?![^\\W_])
Python `re` модулі \\p{L} білмейді, сондықтан «кез келген әріп» үшін
[^\\W\\d_] класы қолданылады (Unicode әріптері, цифрсыз, астын сызусыз).
"""
from __future__ import annotations

import html as _html
import re

from bs4 import BeautifulSoup

# Unicode әріп (JS-тегі \p{L} баламасы)
LETTER = r'[^\W\d_]'
# Әріп немесе цифр — сөз шекарасын тексеру үшін
_ALNUM = r'[^\W_]'


def _w(pattern: str) -> str:
    """Үлгіні «тұтас сөз» шекарасымен қоршау (кириллица/латын бірдей)."""
    return rf'(?<!{_ALNUM})(?:{pattern})(?!{_ALNUM})'


def _L(pattern: str) -> str:
    """Үлгідегі \\p{L} белгісін Python-ға түсінікті әріп класына ауыстыру."""
    return pattern.replace(r'\p{L}', LETTER)


# Ыңғайлы болу үшін үлгілер JS нұсқасындағыдай \p{L} арқылы жазылады,
# содан кейін _L() арқылы түрлендіріледі. Барлық үлгілер кіші әріппен.
_RAW: dict[str, list[str]] = {
    'Python': [_w('python'), _w('django'), _w('fastapi'), _w('flask'), _w('pandas')],
    'SQL': [_w('sql'), _w('postgresql|postgres'), _w('mysql'), _w('ms sql|mssql'), _w('oracle'), _w('t-sql|pl/sql'),
            _w('clickhouse'), r'базы? данных', r'субд'],
    'JavaScript': [_w('javascript|js'), _w('typescript'), _w(r'react(?:\.js)?'), _w(r'vue(?:\.js)?'), _w('angular'),
                   _w(r'node\.?js'), _w(r'next\.js')],
    'Java': [_w('java') + r'(?!\s*script)', _w('spring(?: boot)?'), _w('kotlin'), _w('hibernate')],
    'PHP': [_w('php'), _w('laravel'), _w('symfony'), _w('yii2?'), _w('bitrix|битрикс')],
    '1С бағдарламалау': [_w('1с|1c'), r'1с\s*:?\s*предприятие', _w('bsl')],
    'Машиналық оқыту': [r'машинн\p{L}* обучени\p{L}*', _w('machine learning'), _w('ml'), _w('deep learning'),
                        r'нейронн\p{L}* сет\p{L}*', _w('pytorch'), _w('tensorflow'), _w('scikit-learn|sklearn'),
                        _w('nlp'), _w('computer vision')],
    'Деректерді талдау': [r'анализ\p{L}* данных', _w('data analysis|data analytics'), r'аналитик\p{L}* данных',
                          _w(r'статистик\p{L}*'), _w('a/b'), _w('tableau')],
    'Киберқауіпсіздік': [r'информационн\p{L}* безопасност\p{L}*', r'кибербезопасност\p{L}*',
                         _w('cyber ?security|information security|infosec'), _w('siem'), _w('soc'),
                         _w('pentest|пентест'), _w('iso 27001')],
    'Бұлттық технологиялар': [_w('aws'), _w('azure'), _w('gcp|google cloud'), r'облачн\p{L}*', _w('cloud'),
                              _w('yandex cloud')],
    'DevOps': [_w('devops'), _w('ci/cd'), _w('gitlab ci'), _w('jenkins'), _w('ansible'), _w('terraform'), _w('linux')],
    'Docker / Kubernetes': [_w('docker'), _w('kubernetes|k8s'), _w('helm'), _w('openshift')],
    'Жасанды интеллект құралдары': [_w('chatgpt|gpt'), _w('llm'), r'искусственн\p{L}* интеллект\p{L}*', _w('ии'),
                                    _w('generative ai|genai|ai'), _w('midjourney'), _w('copilot'), r'нейросет\p{L}*',
                                    _w('prompt'), _w(r'промпт\p{L}*')],
    'UX/UI дизайн': [_w('ux|ui'), _w('figma'), r'ux/ui|ui/ux', r'дизайн интерфейс\p{L}*', _w(r'прототипирован\p{L}*')],
    'Қаржылық талдау': [r'финансов\p{L}* анализ\p{L}*', r'финансов\p{L}* моделировани\p{L}*',
                        _w('financial analysis|financial modeling'), _w(r'бюджетировани\p{L}*'), _w('p&l'), _w('dcf')],
    'Microsoft Excel': [_w('excel'), _w('ms office|microsoft office'), r'сводн\p{L}* таблиц\p{L}*', _w('vba'),
                        _w('впр|vlookup')],
    'Power BI': [_w('power ?bi'), _w('dax'), _w('power query')],
    'Бухгалтерлік есеп (ХҚЕС)': [r'бухгалтерск\p{L}* учет\p{L}*', _w('бухучет'), _w('мсфо|ifrs'),
                                 _w(r'налогов\p{L}* (?:учет|отчетност\p{L}*)'), r'1с\s*:?\s*бухгалтерия',
                                 _w(r'первичн\p{L}* документаци\p{L}*')],
    'Тәуекелдерді басқару': [r'управлени\p{L}* риск\p{L}*', _w('risk management'), _w('риск-менеджмент'),
                             _w(r'кредитн\p{L}* риск\p{L}*'), _w('базель|basel'), _w('aml|kyc')],
    'Қолмен деректер енгізу': [r'ввод\p{L}* данных', _w('data entry'), r'набор\p{L}* текст\p{L}*',
                               r'внесени\p{L}* данных'],
    'Кассалық операциялар': [r'кассов\p{L}* операци\p{L}*', r'работ\p{L}* (?:на|с) касс\p{L}*',
                             _w(r'кассов\p{L}* дисциплин\p{L}*'), _w(r'инкассаци\p{L}*'), _w(r'pos-терминал\p{L}*')],
    'Медициналық ақпараттық жүйелер': [r'медицинск\p{L}* информационн\p{L}* систем\p{L}*', _w('мис'),
                                       _w('дамумед|damumed'), _w('кмис'),
                                       r'электронн\p{L}* медицинск\p{L}* карт\p{L}*'],
    'Телемедицина': [_w(r'телемедицин\p{L}*'), r'онлайн-консультаци\p{L}*|онлайн консультаци\p{L}*',
                     _w('telemedicine')],
    'Мейірбике ісі': [r'сестринск\p{L}* дел\p{L}*', _w(r'медсестр\p{L}*|медбрат\p{L}*'), _w(r'инъекци\p{L}*'),
                      r'уход\p{L}* за пациент\p{L}*'],
    'Клиникалық диагностика': [_w(r'диагностик\p{L}*'), _w(r'клиническ\p{L}*'), _w(r'терапи\p{L}*'), r'лечени\p{L}*',
                               _w('узи|экг')],
    'Цифрлық оқыту (LMS)': [_w('lms'), _w('moodle'), r'дистанционн\p{L}* обучени\p{L}*',
                            _w(r'e-learning|онлайн-обучени\p{L}*'), _w('google classroom'), _w('getcourse')],
    'Педагогика': [_w(r'педагогик\p{L}*'), _w(r'педагогическ\p{L}*'), _w(r'методик\p{L}* преподавани\p{L}*'),
                   _w(r'обучени\p{L}* детей'), _w(r'учебн\p{L}* план\p{L}*')],
    'Ағылшын тілі': [r'английск\p{L}* язык\p{L}*', _w('english'), _w('ielts|toefl'),
                     _w('upper-intermediate|intermediate|advanced')],
    'Өнеркәсіптік автоматтандыру': [_w('асу тп'), _w('scada'), _w('plc|плк'), _w('siemens'), _w('кипиа'),
                                    r'автоматизаци\p{L}* технологическ\p{L}*', _w('codesys|tia portal')],
    'AutoCAD': [_w('autocad|автокад'), _w('solidworks'), _w('компас-3d'), _w('revit'), _w('inventor')],
    'Еңбек қауіпсіздігі': [r'охран\p{L}* труда', _w(r'техник\p{L}* безопасност\p{L}*'), _w('hse|ohs'),
                           _w(r'промышленн\p{L}* безопасност\p{L}*'), _w('iso 45001')],
    'Сызбаларды қолмен сызу': [r'ручн\p{L}* черчени\p{L}*', _w(r'черчени\p{L}*'), r'чтени\p{L}* чертеж\p{L}*'],
    'Жеткізу тізбегін басқару': [r'цеп\p{L}* поставок', _w('supply chain|scm'), _w(r'логистик\p{L}*'),
                                 _w(r'закуп\p{L}*'), _w('вэд'), _w('incoterms')],
    'Қойма есебі (WMS)': [_w('wms'), r'складск\p{L}* учет\p{L}*', _w(r'инвентаризаци\p{L}*'),
                          _w(r'складск\p{L}* логистик\p{L}*')],
    'Қағаз құжат айналымы': [_w(r'документооборот\p{L}*'), _w(r'делопроизводств\p{L}*'), _w(r'архив\p{L}*'),
                             r'работ\p{L}* с документ\p{L}*'],
    'Телефон арқылы сату': [_w(r'холодн\p{L}* звонк\p{L}*'), r'телефонн\p{L}* продаж\p{L}*', _w('телемаркетинг'),
                            _w('cold calls?'), r'активн\p{L}* продаж\p{L}*'],
    'Цифрлық маркетинг': [r'интернет-маркетинг\p{L}*|интернет маркетинг\p{L}*',
                          _w('digital(?:-| )?маркетинг|digital marketing'), _w('google ads'),
                          _w(r'яндекс\.?директ'), _w(r'таргет\p{L}*'), _w(r'контекстн\p{L}* реклам\p{L}*'),
                          _w('google analytics')],
    'SMM': [_w('smm'), r'социальн\p{L}* сет\p{L}*', _w('instagram|tiktok|facebook'), _w(r'таргетолог\p{L}*')],
    'SEO': [_w('seo'), r'поисков\p{L}* оптимизаци\p{L}*', _w(r'семантическ\p{L}* ядр\p{L}*'),
            _w('google search console')],
    'Контент жасау': [_w(r'контент\p{L}*'), _w('копирайтинг|copywriting'), _w('content'), _w('видеомонтаж'),
                      _w('сторителлинг')],
    'Жаңартылатын энергетика': [r'возобновляем\p{L}* (?:источник\p{L}* )?энерг\p{L}*', _w('виэ'),
                                _w(r'солнечн\p{L}*'), _w(r'ветров\p{L}*|вэс|сэс'), _w('renewable')],
    'Энергия аудиті': [_w(r'энергоаудит\p{L}*'), _w(r'энергоэффективност\p{L}*'), _w(r'энергосбережени\p{L}*'),
                       r'энергетическ\p{L}* обследовани\p{L}*'],
    'Жобаларды басқару (Agile)': [_w('agile'), _w('scrum'), _w('kanban'), r'управлени\p{L}* проект\p{L}*',
                                  _w('project management'), _w('jira'), _w('pmp')],
    'Коммуникация': [_w(r'коммуникабельност\p{L}*|коммуникабельн\p{L}*'), r'деловое общени\p{L}*',
                     _w('communication'), _w(r'переговор\p{L}*'), r'навык\p{L}* общени\p{L}*'],
    'Командада жұмыс': [r'работ\p{L}* в команде', _w(r'командн\p{L}*'), _w('teamwork|team player')],
    'Сыни ойлау': [r'аналитическ\p{L}* мышлени\p{L}*', r'критическ\p{L}* мышлени\p{L}*', _w('critical thinking'),
                   r'системн\p{L}* мышлени\p{L}*'],
    'Кеңсе хатшылығы': [_w(r'секретар\p{L}*'), _w(r'офис-менеджер\p{L}*'), _w('ресепшн|ресепшен'),
                        r'прием\p{L}* звонк\p{L}*', _w(r'делопроизводств\p{L}*')],
}

# Канондық атау → Python `re` үшін дайын үлгілер тізімі (47 дағды).
# Мәтін алдын ала кіші әріпке келтіріліп, «ё» → «е» ауыстырылады,
# сондықтан үлгілерде «ё» нұсқалары қажет емес.
SKILL_SYNONYMS: dict[str, list[str]] = {name: [_L(p) for p in pats] for name, pats in _RAW.items()}

# Әр дағдыға бір біріктірілген тұрақты өрнек (бір рет компиляцияланады)
_COMPILED: dict[str, re.Pattern] = {
    name: re.compile('|'.join(pats), re.IGNORECASE) for name, pats in SKILL_SYNONYMS.items()
}


def _norm(text: str) -> str:
    """Мәтінді салыстыруға дайындау: кіші әріп, ё→е, артық бос орындар."""
    return re.sub(r'\s+', ' ', text.lower().replace('ё', 'е')).strip()


def extract_skills(text: str, key_skills: list[str] | None = None) -> list[str]:
    """Вакансия мәтінінен (және key_skills тізімінен) дағдыларды табу.

    Қайтарады: сұрыпталған, қайталанбайтын қазақша канондық атаулар.
    key_skills ішіндегі мән канондық атаумен дәл сәйкес келсе, ол да есептеледі.
    """
    parts = [text or '']
    found: set[str] = set()
    for ks in key_skills or []:
        if not ks:
            continue
        if ks in SKILL_SYNONYMS:          # мыс. дереккөз қазақша атауды тікелей берсе
            found.add(ks)
        parts.append(str(ks))
    # Бөліктер арасына жаңа жол қоямыз — көрші сөздер бір-біріне «жабысып» қалмасын
    haystack = _norm(' \n '.join(parts))
    for name, rx in _COMPILED.items():
        if rx.search(haystack):
            found.add(name)
    return sorted(found)


def clean_html(html: str | None) -> str:
    """HTML тегтерін алып тастап, таза мәтін қайтару (<highlighttext>, &nbsp; т.б.)."""
    if not html:
        return ''
    text = BeautifulSoup(str(html), 'html.parser').get_text(' ')
    return re.sub(r'\s+', ' ', _html.unescape(text)).strip()
