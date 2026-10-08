// ===== Мансап Компасы — hh.ru API арқылы нақты деректер жинау =====
// Қазақстандағы (area=40) ашық вакансияларды ресми hh.ru API-нен жүктеп,
// сайт түсінетін форматқа (window.MK_DATA) айналдырады.
//
// Іске қосу:
//   HH_TOKEN=... node tools/fetch-hh.js                 (барлық лауазым, әрқайсысына 20 бет)
//   HH_TOKEN=... node tools/fetch-hh.js --details       (+ әр вакансияның key_skills өрісі)
//   node tools/fetch-hh.js --mock tools/fixtures/hh-sample.json   (желісіз тексеру)
//
// Опциялар:
//   --pages N        бір сұраныс үшін бет саны (әдепкі 20, бетінде 100; hh 2000 нәтижеден тереңдікке бермейді)
//   --query T        тек осы лауазым(дар) бойынша іздеу (қазақша атауы немесе индексі; үтірмен бірнешеуі)
//   --details        /vacancies/{id} арқылы key_skills пен сипаттаманы алу (~4 сұраныс/сек)
//   --mock FILE      желінің орнына fixture файлын қолдану
//   --store FILE     жинақталған қойма (әдепкі data/real-vacancies.json)
//   --out FILE       нәтиже (әдепкі data/dataset-real.js)
//   --base FILE      анықтамалықтар алынатын демо датасет (әдепкі data/dataset.js)
//
// Нәтиже:
//   data/real-vacancies.json — барлық жиналған вакансиялар (hh id бойынша, қайталанбайды).
//     API тек қазір ашық вакансияларды береді, сондықтан скриптті күн сайын іске қосып,
//     тарихты осы қоймада біртіндеп жинаймыз.
//   data/dataset-real.js — сайтқа арналған window.MK_DATA (data/dataset.js қозғалмайды).
//
// Жазба форматы (generate-data.js-пен бірдей + 2 қосымша өріс):
//   [ай, өңір, сала, лауазым, компания, жалақы (мың ₸), [дағдылар], дереккөз, тәжірибе, hh сілтемесі, жалақы толтырылды(0/1)]

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const API = 'https://api.hh.ru';
const USER_AGENT = 'MansapKompasy/1.0 (coursework)';
const AREA_KZ = 40;
const PER_PAGE = 100;
const MAX_DEPTH = 2000;          // hh бір сұраныс бойынша 2000-нан артық нәтиже бермейді
const DELAY_MS = 250;            // ~4 сұраныс/сек
const START = { y: 2020, m: 1 }; // ай индексінің басы (generate-data.js-пен бірдей)

// --- Валюта бағамдары (тұрақты, шамамен 2026 ж.) — теңгеге аудару үшін ---
// Нақты бағам құбылады; курстық жұмыс үшін тұрақты шама жеткілікті.
const RATES = { KZT: 1, RUR: 6.2, RUB: 6.2, USD: 510, EUR: 590 };

// ---------------------------------------------------------------------------
// 1. Командалық жол опциялары
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const o = { pages: 20, query: null, details: false, mock: null,
    store: path.join(ROOT, 'data', 'real-vacancies.json'),
    out: path.join(ROOT, 'data', 'dataset-real.js'),
    base: path.join(ROOT, 'data', 'dataset.js') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i];
    if (a === '--pages') o.pages = Math.max(1, parseInt(next(), 10) || 20);
    else if (a === '--query') o.query = next();
    else if (a === '--details') o.details = true;
    else if (a === '--mock') o.mock = path.resolve(next());
    else if (a === '--store') o.store = path.resolve(next());
    else if (a === '--out') o.out = path.resolve(next());
    else if (a === '--base') o.base = path.resolve(next());
    else if (a === '--help' || a === '-h') { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(0, 24).join('\n')); process.exit(0); }
    else { console.error(`Белгісіз опция: ${a}`); process.exit(1); }
  }
  o.pages = Math.min(o.pages, MAX_DEPTH / PER_PAGE);
  return o;
}

// ---------------------------------------------------------------------------
// 2. Анықтамалықтар: өңірлер, салалар, дағдылар, лауазымдар — демо датасеттен
//    (индекстер сайттағымен дәл сәйкес болуы үшін generate-data.js шығысын қолданамыз)
// ---------------------------------------------------------------------------
function loadBase(file) {
  if (!fs.existsSync(file)) {
    console.error(`Анықтамалық файлы табылмады: ${file}\nАлдымен іске қосыңыз: node tools/generate-data.js`);
    process.exit(1);
  }
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), ctx);
  return ctx.window.MK_DATA;
}

// ---------------------------------------------------------------------------
// 3. Өңірлер: hh area.name → сайттағы 8 өңірдің бірі (қалғандары тасталады)
// ---------------------------------------------------------------------------
const REGION_ALIASES = {
  'Алматы': ['алматы', 'almaty', 'алма-ата'],
  'Астана': ['астана', 'astana', 'нур-султан', 'нұр-сұлтан', 'nur-sultan'],
  'Шымкент': ['шымкент', 'shymkent', 'чимкент'],
  'Қарағанды': ['караганда', 'қарағанды', 'karaganda', 'karagandy'],
  'Атырау': ['атырау', 'atyrau'],
  'Ақтөбе': ['актобе', 'ақтөбе', 'aktobe', 'актюбинск'],
  'Павлодар': ['павлодар', 'pavlodar'],
  'Өскемен': ['усть-каменогорск', 'өскемен', 'ust-kamenogorsk', 'oskemen'],
};
function regionIndex(areaName, regions) {
  const a = String(areaName || '').toLowerCase().trim();
  for (const [kz, names] of Object.entries(REGION_ALIASES)) {
    if (names.includes(a)) return regions.indexOf(kz);
  }
  return -1;
}

// --- Тәжірибе: hh experience.id → 0..3 ---
const EXP = { noExperience: 0, between1And3: 1, between3And6: 2, moreThan6: 3 };

// ---------------------------------------------------------------------------
// 4. Дағдылар сөздігі: орысша / ағылшынша синонимдер → сайттағы дағды атауы
//    Әр үлгі — тұрақты өрнек; сөз шекарасы Unicode әріптерімен тексеріледі.
// ---------------------------------------------------------------------------
const L = '[\\p{L}\\p{N}]';
const w = s => `(?<!${L})(?:${s})(?!${L})`;       // «тұтас сөз» шекарасы (кириллицада да жұмыс істейді)
const SKILL_SYNONYMS = {
  'Python': [w('python'), w('django'), w('fastapi'), w('flask'), w('pandas')],
  'SQL': [w('sql'), w('postgresql|postgres'), w('mysql'), w('ms sql|mssql'), w('oracle'), w('t-sql|pl/sql'), w('clickhouse'), 'базы? данных', 'субд'],
  'JavaScript': [w('javascript|js'), w('typescript'), w('react(?:\\.js)?'), w('vue(?:\\.js)?'), w('angular'), w('node\\.?js'), w('next\\.js')],
  'Java': [w('java') + '(?!\\s*script)', w('spring(?: boot)?'), w('kotlin'), w('hibernate')],
  'PHP': [w('php'), w('laravel'), w('symfony'), w('yii2?'), w('bitrix|битрикс')],
  '1С бағдарламалау': [w('1с|1c'), '1с\\s*:?\\s*предприятие', w('bsl')],
  'Машиналық оқыту': ['машинн\\p{L}* обучени\\p{L}*', w('machine learning'), w('ml'), w('deep learning'), 'нейронн\\p{L}* сет\\p{L}*', w('pytorch'), w('tensorflow'), w('scikit-learn|sklearn'), w('nlp'), w('computer vision')],
  'Деректерді талдау': ['анализ\\p{L}* данных', w('data analysis|data analytics'), 'аналитик\\p{L}* данных', w('статистик\\p{L}*'), w('a/b'), w('tableau')],
  'Киберқауіпсіздік': ['информационн\\p{L}* безопасност\\p{L}*', 'кибербезопасност\\p{L}*', w('cyber ?security|information security|infosec'), w('siem'), w('soc'), w('pentest|пентест'), w('iso 27001')],
  'Бұлттық технологиялар': [w('aws'), w('azure'), w('gcp|google cloud'), 'облачн\\p{L}*', w('cloud'), w('yandex cloud')],
  'DevOps': [w('devops'), w('ci/cd'), w('gitlab ci'), w('jenkins'), w('ansible'), w('terraform'), w('linux')],
  'Docker / Kubernetes': [w('docker'), w('kubernetes|k8s'), w('helm'), w('openshift')],
  'Жасанды интеллект құралдары': [w('chatgpt|gpt'), w('llm'), 'искусственн\\p{L}* интеллект\\p{L}*', w('ии'), w('generative ai|genai|ai'), w('midjourney'), w('copilot'), 'нейросет\\p{L}*', w('prompt'), w('промпт\\p{L}*')],
  'UX/UI дизайн': [w('ux|ui'), w('figma'), 'ux/ui|ui/ux', 'дизайн интерфейс\\p{L}*', w('прототипирован\\p{L}*')],
  'Қаржылық талдау': ['финансов\\p{L}* анализ\\p{L}*', 'финансов\\p{L}* моделировани\\p{L}*', w('financial analysis|financial modeling'), w('бюджетировани\\p{L}*'), w('p&l'), w('dcf')],
  'Microsoft Excel': [w('excel'), w('ms office|microsoft office'), 'сводн\\p{L}* таблиц\\p{L}*', w('vba'), w('впр|vlookup')],
  'Power BI': [w('power ?bi'), w('dax'), w('power query')],
  'Бухгалтерлік есеп (ХҚЕС)': ['бухгалтерск\\p{L}* учет\\p{L}*|бухгалтерск\\p{L}* учёт\\p{L}*', w('бухучет|бухучёт'), w('мсфо|ifrs'), w('налогов\\p{L}* (?:учет|учёт|отчетност\\p{L}*)'), '1с\\s*:?\\s*бухгалтерия', w('первичн\\p{L}* документаци\\p{L}*')],
  'Тәуекелдерді басқару': ['управлени\\p{L}* риск\\p{L}*', w('risk management'), w('риск-менеджмент'), w('кредитн\\p{L}* риск\\p{L}*'), w('базель|basel'), w('aml|kyc')],
  'Қолмен деректер енгізу': ['ввод\\p{L}* данных', w('data entry'), 'набор\\p{L}* текст\\p{L}*', 'внесени\\p{L}* данных'],
  'Кассалық операциялар': ['кассов\\p{L}* операци\\p{L}*', 'работ\\p{L}* (?:на|с) касс\\p{L}*', w('кассов\\p{L}* дисциплин\\p{L}*'), w('инкассаци\\p{L}*'), w('pos-терминал\\p{L}*')],
  'Медициналық ақпараттық жүйелер': ['медицинск\\p{L}* информационн\\p{L}* систем\\p{L}*', w('мис'), w('дамумед|damumed'), w('кмис'), 'электронн\\p{L}* медицинск\\p{L}* карт\\p{L}*'],
  'Телемедицина': [w('телемедицин\\p{L}*'), 'онлайн-консультаци\\p{L}*|онлайн консультаци\\p{L}*', w('telemedicine')],
  'Мейірбике ісі': ['сестринск\\p{L}* дел\\p{L}*', w('медсестр\\p{L}*|медбрат\\p{L}*'), w('инъекци\\p{L}*'), 'уход\\p{L}* за пациент\\p{L}*'],
  'Клиникалық диагностика': [w('диагностик\\p{L}*'), w('клиническ\\p{L}*'), w('терапи\\p{L}*'), 'лечени\\p{L}*', w('узи|экг')],
  'Цифрлық оқыту (LMS)': [w('lms'), w('moodle'), 'дистанционн\\p{L}* обучени\\p{L}*', w('e-learning|онлайн-обучени\\p{L}*'), w('google classroom'), w('getcourse')],
  'Педагогика': [w('педагогик\\p{L}*'), w('педагогическ\\p{L}*'), w('методик\\p{L}* преподавани\\p{L}*'), w('обучени\\p{L}* детей'), w('учебн\\p{L}* план\\p{L}*')],
  'Ағылшын тілі': ['английск\\p{L}* язык\\p{L}*', w('english'), w('ielts|toefl'), w('upper-intermediate|intermediate|advanced')],
  'Өнеркәсіптік автоматтандыру': [w('асу тп'), w('scada'), w('plc|плк'), w('siemens'), w('кипиа'), 'автоматизаци\\p{L}* технологическ\\p{L}*', w('codesys|tia portal')],
  'AutoCAD': [w('autocad|автокад'), w('solidworks'), w('компас-3d'), w('revit'), w('inventor')],
  'Еңбек қауіпсіздігі': ['охран\\p{L}* труда', w('техник\\p{L}* безопасност\\p{L}*'), w('hse|ohs'), w('промышленн\\p{L}* безопасност\\p{L}*'), w('iso 45001')],
  'Сызбаларды қолмен сызу': ['ручн\\p{L}* черчени\\p{L}*', w('черчени\\p{L}*'), 'чтени\\p{L}* чертеж\\p{L}*'],
  'Жеткізу тізбегін басқару': ['цеп\\p{L}* поставок', w('supply chain|scm'), w('логистик\\p{L}*'), w('закуп\\p{L}*'), w('вэд'), w('incoterms')],
  'Қойма есебі (WMS)': [w('wms'), 'складск\\p{L}* учет\\p{L}*|складск\\p{L}* учёт\\p{L}*', w('инвентаризаци\\p{L}*'), w('складск\\p{L}* логистик\\p{L}*')],
  'Қағаз құжат айналымы': [w('документооборот\\p{L}*'), w('делопроизводств\\p{L}*'), w('архив\\p{L}*'), 'работ\\p{L}* с документ\\p{L}*'],
  'Телефон арқылы сату': [w('холодн\\p{L}* звонк\\p{L}*'), 'телефонн\\p{L}* продаж\\p{L}*', w('телемаркетинг'), w('cold calls?'), 'активн\\p{L}* продаж\\p{L}*'],
  'Цифрлық маркетинг': ['интернет-маркетинг\\p{L}*|интернет маркетинг\\p{L}*', w('digital(?:-| )?маркетинг|digital marketing'), w('google ads'), w('яндекс\\.?директ'), w('таргет\\p{L}*'), w('контекстн\\p{L}* реклам\\p{L}*'), w('google analytics')],
  'SMM': [w('smm'), 'социальн\\p{L}* сет\\p{L}*', w('instagram|tiktok|facebook'), w('таргетолог\\p{L}*')],
  'SEO': [w('seo'), 'поисков\\p{L}* оптимизаци\\p{L}*', w('семантическ\\p{L}* ядр\\p{L}*'), w('google search console')],
  'Контент жасау': [w('контент\\p{L}*'), w('копирайтинг|copywriting'), w('content'), w('видеомонтаж'), w('сторителлинг')],
  'Жаңартылатын энергетика': ['возобновляем\\p{L}* (?:источник\\p{L}* )?энерг\\p{L}*', w('виэ'), w('солнечн\\p{L}*'), w('ветров\\p{L}*|вэс|сэс'), w('renewable')],
  'Энергия аудиті': [w('энергоаудит\\p{L}*'), w('энергоэффективност\\p{L}*'), w('энергосбережени\\p{L}*'), 'энергетическ\\p{L}* обследовани\\p{L}*'],
  'Жобаларды басқару (Agile)': [w('agile'), w('scrum'), w('kanban'), 'управлени\\p{L}* проект\\p{L}*', w('project management'), w('jira'), w('pmp')],
  'Коммуникация': [w('коммуникабельност\\p{L}*|коммуникабельн\\p{L}*'), 'деловое общени\\p{L}*', w('communication'), w('переговор\\p{L}*'), 'навык\\p{L}* общени\\p{L}*'],
  'Командада жұмыс': ['работ\\p{L}* в команде', w('командн\\p{L}*'), w('teamwork|team player')],
  'Сыни ойлау': ['аналитическ\\p{L}* мышлени\\p{L}*', 'критическ\\p{L}* мышлени\\p{L}*', w('critical thinking'), 'системн\\p{L}* мышлени\\p{L}*'],
  'Кеңсе хатшылығы': [w('секретар\\p{L}*'), w('офис-менеджер\\p{L}*'), w('ресепшн|ресепшен'), 'прием\\p{L}* звонк\\p{L}*|приём\\p{L}* звонк\\p{L}*', w('делопроизводств\\p{L}*')],
};

// Сөздікті тұрақты өрнектерге айналдыру (дағды индексімен)
function compileSkills(skills) {
  const compiled = [];
  skills.forEach((name, k) => {
    const pats = SKILL_SYNONYMS[name];
    if (!pats) { console.warn(`Ескерту: «${name}» дағдысына синоним жоқ`); return; }
    compiled.push([k, new RegExp(pats.join('|'), 'iu')]);
  });
  return compiled;
}
function matchSkills(texts, compiled) {
  const t = texts.filter(Boolean).join(' \n ').toLowerCase().replace(/ё/g, 'е');
  const out = [];
  for (const [k, re] of compiled) if (re.test(t)) out.push(k);
  return out;
}
// HTML тегтерін алып тастау (snippet пен description-да <highlighttext> т.б. болады)
const stripHtml = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------
// 5. Жалақы: from/to орташасы, теңгеге аудару, мың ₸
// ---------------------------------------------------------------------------
function salaryThousands(s) {
  if (!s) return null;
  const vals = [s.from, s.to].filter(x => typeof x === 'number' && x > 0);
  if (!vals.length) return null;
  const rate = RATES[s.currency];
  if (!rate) return null;                                // белгісіз валюта — жалақысыз деп есептейміз
  const k = vals.reduce((a, b) => a + b, 0) / vals.length * rate / 1000;
  if (k < 30 || k > 20000) return null;                  // ақылға қонбайтын мәндер
  return Math.round(k / 5) * 5;
}

// published_at ("2026-10-01T10:00:00+0300") → 2020-01-ден бастап ай индексі
function monthIndex(published) {
  const m = /^(\d{4})-(\d{2})/.exec(published || '');
  if (!m) return -1;
  return (+m[1] - START.y) * 12 + (+m[2] - START.m);
}

// ---------------------------------------------------------------------------
// 6. Желі: токенмен сұраныс, ~4 сұраныс/сек шектеу, 429/5xx кезінде қайталау
// ---------------------------------------------------------------------------
const sleep = ms => new Promise(r => setTimeout(r, ms));
let lastCall = 0;
async function hhGet(url, token, attempt = 1) {
  const wait = lastCall + DELAY_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'HH-User-Agent': USER_AGENT,
      'User-Agent': USER_AGENT,
      'Accept': 'application/json',
    },
  });
  if (res.ok) return res.json();
  const body = await res.text().catch(() => '');
  if ((res.status === 429 || res.status >= 500) && attempt <= 4) {
    await sleep(1000 * 2 ** attempt);                    // экспоненциалды күту
    return hhGet(url, token, attempt + 1);
  }
  if (res.status === 403 || res.status === 401) {
    console.error(`hh.ru рұқсат бермеді (${res.status}): ${body}\nHH_TOKEN дұрыс па, мерзімі өтпеді ме — тексеріңіз.`);
    process.exit(1);
  }
  throw new Error(`HTTP ${res.status} ${url}: ${body.slice(0, 200)}`);
}

// Желі немесе fixture арқылы жұмыс істейтін «клиент»
function makeClient(opts) {
  if (opts.mock) {
    // Fixture құрылымы: { queries: { "<сұраныс>": { items, found, pages } }, details: { "<id>": {...} } }
    const fx = JSON.parse(fs.readFileSync(opts.mock, 'utf8'));
    return {
      search: async (text, page) => {
        const r = fx.queries[text];
        return page === 0 && r ? r : { items: [], found: 0, pages: 0, page };
      },
      detail: async id => fx.details[id] || null,
    };
  }
  const token = process.env.HH_TOKEN;
  if (!token) {
    console.error([
      'Қате: HH_TOKEN орта айнымалысы орнатылмаған.',
      'hh.ru API анонимді сұраныстарға рұқсат бермейді (403 forbidden).',
      'Токен алу: https://dev.hh.ru → қосымшаны тіркеу → access token.',
      'Содан кейін:  HH_TOKEN=<токен> node tools/fetch-hh.js',
      '(Windows PowerShell:  $env:HH_TOKEN="<токен>"; node tools/fetch-hh.js)',
      'Желісіз тексеру үшін:  node tools/fetch-hh.js --mock tools/fixtures/hh-sample.json',
    ].join('\n'));
    process.exit(1);
  }
  return {
    search: (text, page) => {
      const q = new URLSearchParams({ area: AREA_KZ, text, search_field: 'name', per_page: PER_PAGE, page, order_by: 'publication_time' });
      return hhGet(`${API}/vacancies?${q}`, token);
    },
    detail: id => hhGet(`${API}/vacancies/${encodeURIComponent(id)}`, token),
  };
}

// ---------------------------------------------------------------------------
// 7. Қойма (data/real-vacancies.json): hh id → қалыпты жазба. Атаулармен сақталады,
//    сондықтан анықтамалық индекстері өзгерсе де қоймадан қайта құруға болады.
// ---------------------------------------------------------------------------
function loadStore(file) {
  if (!fs.existsSync(file)) return { version: 1, updated: null, vacancies: {} };
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// hh вакансиясын (тізімнен + қажет болса толық) қойма жазбасына айналдыру
function normalize(item, titleName, detail, compiled, D) {
  const d = detail || {};
  const descSkills = d.description ? matchSkills([stripHtml(d.description)], compiled).map(k => D.skills[k]) : [];
  return {
    id: String(item.id),
    title: titleName,                                       // қай іздеу сұранысы тапты
    name: item.name,
    area: item.area && item.area.name,
    published: item.published_at,
    employer: (item.employer && item.employer.name) || '—',
    salary: item.salary ? { from: item.salary.from, to: item.salary.to, currency: item.salary.currency, gross: item.salary.gross } : null,
    exp: (d.experience || item.experience || {}).id || null,
    roles: (item.professional_roles || []).map(r => r.name),
    keySkills: (d.key_skills || []).map(s => s.name),
    descSkills,
    snippet: stripHtml([item.snippet && item.snippet.requirement, item.snippet && item.snippet.responsibility].join(' ')),
    url: item.alternate_url || `https://hh.kz/vacancy/${item.id}`,
    fetched: new Date().toISOString().slice(0, 10),
  };
}

// ---------------------------------------------------------------------------
// 8. Жинау
// ---------------------------------------------------------------------------
async function collect(opts, D, store, compiled) {
  const client = makeClient(opts);
  let titleIdx = D.titles.map((_, i) => i);
  if (opts.query) {
    const want = opts.query.split(',').map(s => s.trim());
    titleIdx = titleIdx.filter(i => want.includes(D.titles[i]) || want.includes(String(i)) || want.includes(D.titleQuery[i]));
    if (!titleIdx.length) { console.error(`--query бойынша лауазым табылмады: ${opts.query}`); process.exit(1); }
  }

  let added = 0, updated = 0, skippedRegion = 0;
  for (const ti of titleIdx) {
    const text = D.titleQuery[ti];
    let got = 0;
    for (let page = 0; page < opts.pages; page++) {
      const res = await client.search(text, page);
      for (const item of res.items || []) {
        const area = item.area && item.area.name;
        if (regionIndex(area, D.regions) < 0) { skippedRegion++; continue; }
        const id = String(item.id);
        const old = store.vacancies[id];
        // Толық ақпарат: тек жаңа немесе әлі key_skills жоқ вакансиялар үшін
        const needDetail = opts.details && !(old && old.keySkills && old.keySkills.length);
        const detail = needDetail ? await client.detail(id) : null;
        const rec = normalize(item, old ? old.title : D.titles[ti], detail, compiled, D);
        if (old) {
          // Бар жазба: алғашқы лауазым мен жарияланған күнді сақтап, қалғанын жаңартамыз
          rec.title = old.title;
          rec.published = old.published || rec.published;
          if (!detail) { rec.keySkills = old.keySkills || []; rec.descSkills = old.descSkills || []; }
          rec.firstSeen = old.firstSeen || old.fetched;
          updated++;
        } else {
          rec.firstSeen = rec.fetched;
          added++;
        }
        store.vacancies[id] = rec;
        got++;
      }
      if (page + 1 >= (res.pages || 0)) break;               // беттер бітті
    }
    console.log(`  ${D.titles[ti]} («${text}»): ${got}`);
  }
  return { added, updated, skippedRegion };
}

// ---------------------------------------------------------------------------
// 9. Қоймадан window.MK_DATA құру
// ---------------------------------------------------------------------------
function build(D, store, compiled) {
  const T = Object.fromEntries(D.titles.map((t, i) => [t, i]));
  const companies = [], C = new Map();
  const companyIdx = name => {
    if (!C.has(name)) { C.set(name, companies.length); companies.push(name); }
    return C.get(name);
  };

  const rows = [];
  for (const r of Object.values(store.vacancies)) {
    const ti = T[r.title];
    const reg = regionIndex(r.area, D.regions);
    const m = monthIndex(r.published);
    if (ti === undefined || reg < 0 || m < 0) continue;
    const ks = new Set(matchSkills([r.name, r.snippet, ...(r.keySkills || [])], compiled));
    for (const s of r.descSkills || []) { const k = D.skills.indexOf(s); if (k >= 0) ks.add(k); }
    rows.push({ r, m, reg, ti, sal: salaryThousands(r.salary), ks: [...ks].sort((a, b) => a - b) });
  }

  // Жалақысы көрсетілмеген вакансиялар (hh-та көп): сол лауазымның медианасымен толтырамыз,
  // әйтпесе сайттағы орташа жалақы бұрмаланады. Толтырылғаны соңғы өрісте 1 деп белгіленеді.
  const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const byTitle = D.titles.map((_, ti) => rows.filter(x => x.ti === ti && x.sal != null).map(x => x.sal));
  const all = rows.filter(x => x.sal != null).map(x => x.sal);
  const globalMed = median(all);

  let imputed = 0;
  const v = rows.sort((a, b) => a.m - b.m || a.r.id.localeCompare(b.r.id)).map(x => {
    let sal = x.sal, flag = 0;
    if (sal == null) { sal = median(byTitle[x.ti]) || globalMed; flag = 1; imputed++; }
    const exp = EXP[x.r.exp] ?? 1;
    return [x.m, x.reg, D.titleSector[x.ti], x.ti, companyIdx(x.r.employer), sal, x.ks, 0, exp, x.r.url, flag];
  });

  const now = new Date();
  const curMonth = (now.getFullYear() - START.y) * 12 + now.getMonth() + 1 - START.m;
  const months = Math.max(curMonth + 1, v.length ? v[v.length - 1][0] + 1 : 1);
  return {
    meta: {
      source: 'hh.ru API (api.hh.ru, area=40 — Қазақстан) — нақты вакансиялар',
      generated: now.toISOString().slice(0, 10),
      start: START, months, count: v.length,
      realUrls: true,
      salaryImputed: imputed,
      // [ай, өңір, сала, лауазым, компания, жалақы (мың ₸), [дағдылар], дереккөз, тәжірибе, hh сілтемесі, жалақы толтырылды]
    },
    regions: D.regions,
    sectors: D.sectors,
    skills: D.skills,
    titles: D.titles,
    titleSector: D.titleSector,
    titleSkills: D.titleSkills,
    titleQuery: D.titleQuery,
    experience: D.experience,
    sources: D.sources,              // 0 = hh.kz (барлық нақты жазбалар осы дереккөзден)
    skillSectors: D.skillSectors,
    companies,
    v,
  };
}

// ---------------------------------------------------------------------------
// 10. Негізгі ағын
// ---------------------------------------------------------------------------
(async () => {
  const opts = parseArgs(process.argv.slice(2));
  const D = loadBase(opts.base);
  const compiled = compileSkills(D.skills);
  const store = loadStore(opts.store);
  const before = Object.keys(store.vacancies).length;

  console.log(opts.mock ? `Fixture режимі: ${opts.mock}` : `hh.ru API: ${opts.pages} бет × ${PER_PAGE}, details=${opts.details}`);
  const st = await collect(opts, D, store, compiled);

  store.updated = new Date().toISOString();
  fs.mkdirSync(path.dirname(opts.store), { recursive: true });
  fs.writeFileSync(opts.store, JSON.stringify(store));

  const out = build(D, store, compiled);
  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  fs.writeFileSync(opts.out, '// Автоматты жасалған файл: tools/fetch-hh.js (hh.ru API нақты деректері)\nwindow.MK_DATA = ' + JSON.stringify(out) + ';\n');

  console.log(`Жаңа: ${st.added}, жаңартылды: ${st.updated}, өңірі сәйкес келмеді: ${st.skippedRegion}`);
  console.log(`Қоймада: ${before} → ${Object.keys(store.vacancies).length} вакансия (${path.relative(ROOT, opts.store)})`);
  console.log(`Датасет: ${out.v.length} жазба, жалақысы толтырылған: ${out.meta.salaryImputed}, файл: ${path.relative(ROOT, opts.out)} (${(fs.statSync(opts.out).size / 1024).toFixed(0)} KB)`);
})().catch(e => { console.error('Қате:', e.message); process.exit(1); });
