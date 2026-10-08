// ===== Мансап Компасы — демо сауалнамалар генераторы =====
// Ойдан шығарылған жұмыс берушілер (~150) мен оқу орындарының бағдарламаларын (~60) жасайды.
// Жауаптар data/dataset.js трендтеріне сай: өсіп жатқан дағдыларға көбіне «өседі» (+1),
// азайып жатқандарға «азаяды» (−1) деп жауап беріледі; оқу орындары жаңа дағдыларды кешігіп оқытады.
// Іске қосу:  node tools/generate-surveys.js
// Нәтиже:     data/surveys-demo.json (шикі жауаптар, демо) және data/surveys.js (window.MK_SURVEYS)
// SQL Server-ге жүктеу: cd server && npm run db:seed

const fs = require('fs');
const path = require('path');
const { D, demand, trend, nT, nK, nS } = require('../server/market');
const { buildSurveys, toJs, YEARS } = require('../server/surveys-agg');

// --- Қайталанатын кездейсоқ сандар (mulberry32, generate-data.js сияқты) ---
let seed = 20261008;
function rnd() {
  seed |= 0; seed = seed + 0x6D2B79F5 | 0;
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
}
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const pickW = (items, w) => {
  let s = 0; for (const x of w) s += x;
  let r = rnd() * s;
  for (let i = 0; i < items.length; i++) { r -= w[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
};
const randInt = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const range = n => Array.from({ length: n }, (_, i) => i);
const sample = (items, w, n) => { // қайталанбайтын салмақты таңдау
  items = [...items]; w = [...w];
  const out = [];
  while (out.length < n && items.length) {
    const x = pickW(items, w), i = items.indexOf(x);
    out.push(x); items.splice(i, 1); w.splice(i, 1);
  }
  return out;
};

// Өңір салмақтары — вакансиялар үлесі бойынша
const regionW = Array(D.regions.length).fill(0);
D.v.forEach(r => regionW[r[1]]++);
const titlesOf = sec => range(nT).filter(t => D.titleSector[t] === sec);
const isUniversal = k => !D.skillSectors[k].length;

// Соңғы 12 айдағы мамандықтың орташа жалақысы (мың ₸)
const M = D.meta.months;
const salSum = Array(nT).fill(0), salN = Array(nT).fill(0);
D.v.forEach(r => { if (r[0] >= M - 12) { salSum[r[3]] += r[5]; salN[r[3]]++; } });

// --- Жұмыс берушілер ---
const roots = ['Ақжол', 'Көктем', 'Жұлдыз', 'Сарыжайлау', 'Таңшолпан', 'Шалқар', 'Бозторғай', 'Құлагер', 'Күнбатыс',
  'Қарлығаш', 'Мөлдір', 'Арман', 'Тұмар', 'Ақмарал', 'Інжу', 'Сұңқар', 'Тұлпар', 'Дәулет', 'Шаңырақ', 'Өркен',
  'Ақниет', 'Кемел', 'Жігер', 'Үміт', 'Жайлау', 'Ақтерек', 'Бірлік', 'Самғау', 'Шапағат', 'Нұрсәт', 'Ырыс', 'Қуаныш'];
const suffixes = [
  ['Софт', 'Технолоджис', 'Цифрлық шешімдер', 'Дата Лаб'],
  ['Финанс', 'Капитал', 'Инвест', 'Сақтандыру'],
  ['Медикал', 'Клиникасы', 'Емханасы', 'Мед орталығы'],
  ['Академиясы', 'Оқу орталығы', 'Мектебі', 'Білім орталығы'],
  ['Индастри', 'Зауыты', 'Машинажасау', 'Инжиниринг'],
  ['Логистик', 'Сауда үйі', 'Маркет', 'Транс'],
  ['Медиа', 'Агенттігі', 'Брэнд', 'Коммуникациялар'],
  ['Энерджи', 'Қуат', 'Электр', 'Жылу'],
];
const usedNames = new Set();
function orgName(sec) {
  for (;;) {
    const name = `«${roots[randInt(0, roots.length - 1)]} ${suffixes[sec][randInt(0, 3)]}» ЖШС`;
    if (!usedNames.has(name)) { usedNames.add(name); return name; }
  }
}

const SIZES = ['small', 'medium', 'large'];
const HIRE_RANGE = { small: [1, 4], medium: [3, 15], large: [10, 60] };
const sectorW = [0.17, 0.13, 0.12, 0.12, 0.14, 0.17, 0.09, 0.08];

// Дағды трендіне сай жауап: softmax([12x, 1 − 4|x|, −12x])
function drawTrend(x) {
  const w = [Math.exp(12 * x), Math.exp(1 - 4 * Math.abs(x)), Math.exp(-12 * x)];
  return pickW([1, 0, -1], w);
}

const employers = [];
for (let i = 0; i < 150; i++) {
  const sector = i < nS * 12 ? i % nS : pickW(range(nS), sectorW);
  const size = pickW(SIZES, [0.45, 0.35, 0.2]);
  const region = pickW(range(D.regions.length), regionW);
  const bias = 0.03 * gauss(); // ұйымның жалпы оптимизмі

  // 8–15 дағды, негізінен өз саласынан
  const w = range(nK).map(k => isUniversal(k) ? 1.5
    : D.skillSectors[k][0] === sector ? 4 : D.skillSectors[k].includes(sector) ? 3 : 0.15);
  const ks = sample(range(nK), w, randInt(8, 15)).sort((a, b) => a - b);
  const skills = ks.map(skill => {
    const x = trend(sector, skill) + bias + 0.04 * gauss();
    const tr = drawTrend(x);
    const hard = rnd() < clamp(0.08 + 1.6 * x + (tr > 0 ? 0.1 : 0), 0.03, 0.8);
    return { skill, trend: tr, hardToFind: hard };
  });

  // 1–4 мамандық бойынша жоспарланған жұмысқа алу
  const ts = titlesOf(sector);
  const tw = ts.map(t => Math.exp(3 * D.titleSkills[t].reduce((a, k) => a + trend(sector, k), 0) / D.titleSkills[t].length));
  const hiresT = sample(ts, tw, Math.min(ts.length, randInt(1, 4))).sort((a, b) => a - b);
  const [lo, hi] = HIRE_RANGE[size];
  const horizonYears = pickW([1, 2, 3], [0.3, 0.45, 0.25]);
  const hires = hiresT.map(title => ({ title, count: Math.round(randInt(lo, hi) * (1 + 0.3 * (horizonYears - 1))) }));
  const salaries = hiresT.filter(() => rnd() < 0.6).map(title => {
    const avg = salSum[title] / Math.max(1, salN[title]) * (0.9 + 0.2 * rnd());
    return { title, from: Math.round(avg * 0.8 / 10) * 10, to: Math.round(avg * 1.2 / 10) * 10 };
  });

  employers.push({ name: orgName(sector), sector, region, size, horizonYears, hires, skills, salaries });
}

// --- Оқу орындары ---
// [атауы, түрі, бейіндік салалар]
const institutions = [
  ['Алатау техникалық колледжі', 'college', [0, 4, 7]],
  ['Сарыарқа политехникалық колледжі', 'college', [4, 7, 0]],
  ['Ертіс гуманитарлық колледжі', 'college', [3, 6]],
  ['Жайық медициналық колледжі', 'college', [2]],
  ['Қаратау экономикалық колледжі', 'college', [1, 5]],
  ['Шалқар сауда және сервис колледжі', 'college', [5, 1, 6]],
  ['Ақсу цифрлық технологиялар колледжі', 'college', [0]],
  ['Көкжайлау педагогикалық колледжі', 'college', [3]],
  ['Самғау IT колледжі', 'college', [0, 6]],
  ['Ұлытау инженерлік-технологиялық университеті', 'university', [4, 7, 0]],
  ['Есіл қаржы-экономикалық университеті', 'university', [1, 5, 6]],
  ['Тұран-Дала цифрлық университеті', 'university', [0, 1]],
  ['Шапағат медицина университеті', 'university', [2, 0]],
  ['Ақниет педагогикалық университеті', 'university', [3, 6]],
  ['Бірлік көпсалалы университеті', 'university', [0, 1, 3, 6]],
  ['Мөлдір энергетика университеті', 'university', [7, 4]],
  ['Жұлдыз бизнес және технологиялар университеті', 'university', [0, 1, 6, 5]],
  ['Құлагер халықаралық университеті', 'university', [0, 3, 1]],
];
// Мамандыққа сай білім беру бағдарламасының атауы (D.titles ретімен)
const programNames = [
  'Бағдарламалық инженерия', 'Веб-әзірлеу', 'Бағдарламалық қамтамасыз ету', 'Веб-бағдарламалау',
  'Бизнес-қосымшаларды бағдарламалау', 'Жасанды интеллект және машиналық оқыту', 'Деректер ғылымы',
  'Бұлттық жүйелер және DevOps', 'Ақпараттық қауіпсіздік жүйелері', 'IT өнімдерді басқару',
  'Қаржы', 'Есеп және аудит', 'Банк ісі', 'Қаржылық тәуекелдер', 'Іс жүргізу және құжаттану',
  'Мейіргер ісі', 'Жалпы медицина', 'Медициналық статистика және тіркеу', 'Денсаулық сақтау информатикасы',
  'Бастауыш және орта білім беру педагогикасы', 'Шетел тілі: екі шетел тілі', 'Цифрлық педагогика және EdTech',
  'Өндірісті автоматтандыру және басқару', 'Машинажасау', 'Еңбек қорғау және өнеркәсіптік қауіпсіздік',
  'Логистика', 'Қойма шаруашылығы', 'Сауда ісі және коммерция', 'Сату және маркетинг негіздері',
  'Маркетинг', 'Цифрлық медиа және SMM', 'Интернет-маркетинг', 'Электр энергетикасы', 'Жаңартылатын энергия көздері',
];
const sectorTitleW = [3, 2, 1, 2.5, 1, 1, 1, 1]; // IT, білім, қаржы бағдарламалары көбірек

const coreTrend = t => D.titleSkills[t].reduce((a, k) => a + trend(D.titleSector[t], k), 0) / D.titleSkills[t].length;

function makeProgram(title, type) {
  const sec = D.titleSector[title];
  const core = D.titleSkills[title];
  const taught = new Set();
  // Негізгі дағдылар — өсіп жатқан жаңа дағдылар сирек оқытылады (кешігу)
  core.forEach(k => { if (rnd() < clamp(0.97 - 1.2 * Math.max(0, trend(sec, k)), 0.55, 0.97)) taught.add(k); });
  // Мамандыққа сұранысы бар басқа дағдылар
  range(nK).filter(k => !core.includes(k) && demand[title][k] >= 0.08).forEach(k => {
    if (rnd() < clamp(0.8 - 2.2 * Math.max(0, trend(sec, k)), 0.2, 0.8)) taught.add(k);
  });
  // Ескірген салалық дағдылар әлі оқытылуда
  range(nK).filter(k => D.skillSectors[k].includes(sec) && trend(sec, k) < -0.08).forEach(k => {
    if (rnd() < 0.35) taught.add(k);
  });
  const soft = [43, 44, 27, 45].filter(k => !taught.has(k));
  while (taught.size < 3) taught.add(soft.splice(randInt(0, soft.length - 1), 1)[0]);

  // Жоспарланған жаңа курстар — өсіп жатқан, оқытылмайтын дағдылар
  const plannedSkills = range(nK).filter(k => !taught.has(k) && trend(sec, k) > 0.1 &&
    (demand[title][k] >= 0.03 || D.skillSectors[k].includes(sec)) && rnd() < 0.35).slice(0, 4);

  const [lo, hi] = type === 'college' ? [20, 120] : [40, 200];
  const base = randInt(lo, hi), drift = 0.03 * gauss() + 0.1 * coreTrend(title);
  const graduates = Object.fromEntries(YEARS.map((y, i) =>
    [String(y), clamp(Math.round(base * (1 + drift * i) * (1 + 0.05 * gauss())), 20, 200)]));
  const employmentRate = clamp(Math.round(72 + 60 * coreTrend(title) + 6 * gauss()), 55, 95);

  return { title, name: programNames[title], graduates, employmentRate,
    skills: [...taught].sort((a, b) => a - b), plannedSkills };
}

const education = institutions.map(([name, type, sectors]) => {
  const ts = sectors.flatMap(titlesOf);
  const w = ts.map(t => sectorTitleW[D.titleSector[t]] * (sectors.indexOf(D.titleSector[t]) === 0 ? 1.5 : 1));
  const n = type === 'college' ? randInt(2, 4) : randInt(3, 5);
  const programs = sample(ts, w, n).sort((a, b) => a - b).map(t => makeProgram(t, type));
  return { name, type, region: pickW(range(D.regions.length), regionW), programs };
});
// Әр мамандықта кемінде бір бағдарлама болсын және жалпы саны ~60-қа жетсін
const covered = new Set(education.flatMap(e => e.programs.map(p => p.title)));
let total = education.reduce((a, e) => a + e.programs.length, 0);
for (let i = 0; total < 60 || covered.size < nT; i = (i + 1) % education.length) {
  const e = education[i], sectors = institutions[i][2];
  let ts = sectors.flatMap(titlesOf).filter(t => !e.programs.some(p => p.title === t));
  if (covered.size < nT) ts = ts.filter(t => !covered.has(t));
  if (!ts.length) continue;
  const t = pickW(ts, ts.map(t => sectorTitleW[D.titleSector[t]]));
  e.programs.push(makeProgram(t, e.type));
  e.programs.sort((a, b) => a.title - b.title);
  covered.add(t); total++;
}

// --- Жазу ---
const programs = education.flatMap(e => e.programs);
const demo = {
  demo: true,
  note: 'ДЕМО: ойдан шығарылған ұйымдар мен жауаптар (tools/generate-surveys.js). Нақты сауалнама емес.',
  generated: new Date().toISOString(),
  employers, education,
};
const dataDir = path.join(__dirname, '..', 'data');
fs.writeFileSync(path.join(dataDir, 'surveys-demo.json'), JSON.stringify(demo, null, 1) + '\n');
const agg = buildSurveys({ employers, programs, demo: true });
fs.writeFileSync(path.join(dataDir, 'surveys.js'), toJs(agg, 'tools/generate-surveys.js (демо)'));

const show = k => `${D.skills[k]}: ${agg.votes[k].join('/')}`;
console.log(`Жұмыс берушілер: ${employers.length}, оқу орындары: ${education.length}, бағдарламалар: ${programs.length}`);
console.log('Дауыстар (өседі/тұрақты/азаяды/табу қиын):');
[6, 12, 16, 0, 26, 19, 34, 31].forEach(k => console.log('  ' + show(k)));
