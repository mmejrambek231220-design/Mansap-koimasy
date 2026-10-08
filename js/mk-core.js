// ===== Мансап Компасы — ортақ деректер кітапханасы =====
// Барлық беттер қолданады. Тәуелділіктер: data/dataset.js (window.MK_DATA), js/model.js (MKModel), Chart.js (графиктер үшін),
// js/mk-ensemble.js (MKEnsemble — міндетті емес: болса, дағды болжамдары сауалнамамен біріктіріледі).
//
// Вакансия жазбасы: [ай, өңір, сала, лауазым(мамандық), компания, жалақы (мың ₸), [дағдылар], дереккөз, тәжірибе]

const MK = (() => {
  const D = window.MK_DATA;
  const Q0 = 2020;
  const NQ = Math.floor(D.meta.months / 3);   // толық тоқсандар (2020 Q1 … соңғы)
  const LASTQ = NQ - 1;
  const MONTHS = ['қаң', 'ақп', 'нау', 'сәу', 'мам', 'мау', 'шіл', 'там', 'қыр', 'қаз', 'қар', 'жел'];

  const fmt = n => Math.round(n).toLocaleString('ru-RU');
  const pct = g => (g >= 0 ? '+' : '−') + Math.abs(g * 100).toFixed(0) + '%';
  const qLabel = q => `${Q0 + Math.floor(q / 4)} Q${q % 4 + 1}`;
  const monthLabel = m => {
    const y = D.meta.start.y + Math.floor((D.meta.start.m - 1 + m) / 12);
    return `${MONTHS[(D.meta.start.m - 1 + m) % 12]} ${y}`;
  };
  const param = name => new URLSearchParams(location.search).get(name);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Беттер арасындағы сілтемелер
  const link = {
    vacancy: i => `vacancy.html?id=${i}`,
    skill: k => `skill.html?id=${k}`,
    profession: t => `profession.html?id=${t}`,
  };

  // --- Вакансия объектісі ---
  function vacancy(i) {
    const r = D.v[i];
    if (!r) return null;
    const [m, reg, sec, ti, co, sal, ks, src, exp] = r;
    const source = D.sources[src];
    return {
      id: i, month: m, date: monthLabel(m), quarter: Math.floor(m / 3),
      region: reg, regionName: D.regions[reg],
      sector: sec, sectorName: D.sectors[sec],
      title: ti, titleName: D.titles[ti],
      company: D.companies[co], salary: sal * 1000,
      skills: ks, skillNames: ks.map(k => D.skills[k]),
      source: src, sourceName: source.name,
      // Нақты деректе (tools/fetch-hh.js) вакансияның өз сілтемесі r[9] болады,
      // демо деректе — дереккөздегі осы мамандық бойынша нақты іздеу беті
      sourceUrl: r[9] || source.search + encodeURIComponent(D.titleQuery[ti]),
      isDirect: Boolean(r[9]),
      exp, expName: D.experience[exp],
    };
  }
  // Барлық дереккөздегі іздеу сілтемелері (мамандық бойынша)
  const searchLinks = ti => D.sources.map(s => ({ name: s.name, url: s.search + encodeURIComponent(D.titleQuery[ti]) }));

  // --- Сүзгі: {region, sector, title, skill, src, exp, text, from} → индекстер массиві ---
  function filter(f = {}) {
    const out = [];
    const text = f.text ? f.text.toLowerCase() : null;
    for (let i = 0; i < D.v.length; i++) {
      const r = D.v[i];
      if (f.region >= 0 && r[1] !== f.region) continue;
      if (f.sector >= 0 && r[2] !== f.sector) continue;
      if (f.title >= 0 && r[3] !== f.title) continue;
      if (f.skill >= 0 && !r[6].includes(f.skill)) continue;
      if (f.src >= 0 && r[7] !== f.src) continue;
      if (f.exp >= 0 && r[8] !== f.exp) continue;
      if (f.from >= 0 && r[0] < f.from) continue;
      if (text && !(D.titles[r[3]].toLowerCase().includes(text) || D.companies[r[4]].toLowerCase().includes(text) ||
        r[6].some(k => D.skills[k].toLowerCase().includes(text)))) continue;
      out.push(i);
    }
    return out;
  }

  // --- Жинақтау: индекстер → әр дағдының тоқсандық сериясы және статистика ---
  function aggregate(ids) {
    const S = D.skills.length;
    const counts = Array.from({ length: S }, () => new Array(NQ).fill(0));
    const total = new Array(NQ).fill(0);
    const salSum = new Float64Array(S), salN = new Uint32Array(S);
    const bySector = Array.from({ length: S }, () => new Uint32Array(D.sectors.length));
    const byRegion = Array.from({ length: S }, () => new Uint32Array(D.regions.length));
    const byTitle = Array.from({ length: S }, () => new Uint32Array(D.titles.length));
    let totalLast = 0;
    for (const i of ids) {
      const [m, r, s, t, , sal, ks] = D.v[i];
      const q = Math.floor(m / 3);
      if (q > LASTQ) continue;
      total[q]++;
      const last = q > LASTQ - 4;
      if (last) totalLast++;
      for (const k of ks) {
        counts[k][q]++;
        if (last) { salSum[k] += sal; salN[k]++; bySector[k][s]++; byRegion[k][r]++; byTitle[k][t]++; }
      }
    }
    return { counts, total, salSum, salN, bySector, byRegion, byTitle, totalLast, n: ids.length };
  }

  // --- Болжам: бір серия үшін ---
  // year — болжам жылы (мыс. 2030). Нәтиже: соңғы 12 ай (base), сол жылдағы болжам (target, lo, hi), өсу.
  // ens = {k, f} берілсе (дағды сериясы), нәтиже сауалнамамен ансамбльге біріктіріледі (js/mk-ensemble.js):
  // growthModel — тек модель, growthSurvey — жұмыс берушілер, surveyN/surveyW — жауап саны мен салмағы, growth — ансамбль.
  function forecastSeries(series, year, ens) {
    const horizon = Math.max(4, (year - Q0) * 4 + 3 - LASTQ);
    const model = MKModel.fit(series);
    const fc = MKModel.forecast(model, horizon);
    const last4 = a => a.slice(-4).reduce((x, y) => x + y, 0);
    const base = last4(series);
    const target = last4(fc.mean);
    const r = { model, fc, horizon, base, target, lo: last4(fc.lo), hi: last4(fc.hi), growth: base ? target / base - 1 : 0 };
    if (ens && ens.k >= 0 && typeof MKEnsemble !== 'undefined') MKEnsemble.blend(r, ens.k, ens.f || {}, horizon);
    return r;
  }

  // --- Барлық дағдыға болжам: сүзгі бойынша (мамандық, өңір, сала) ---
  // minBase — соңғы 12 айда кемінде осынша вакансия болуы керек (әйтпесе болжам сенімсіз)
  function forecastSkills(f = {}, year = 2030, { minBase = 24, backtest = false } = {}) {
    const agg = aggregate(filter(f));
    const res = [];
    D.skills.forEach((name, k) => {
      const series = agg.counts[k];
      const r = forecastSeries(series, year, { k, f });
      if (r.base < minBase) return;
      res.push({
        k, name, series, ...r,
        salary: agg.salN[k] ? agg.salSum[k] / agg.salN[k] * 1000 : 0,
        share: r.base / Math.max(1, agg.totalLast),            // соңғы 12 айдағы вакансиялардағы үлесі
        bt: backtest ? MKModel.backtest(series) : null,
      });
    });
    return { results: res.sort((a, b) => b.growth - a.growth), agg };
  }

  // --- Тренд + болжам графигі (Chart.js) ---
  // canvas, series (тоқсандық нақты), r = forecastSeries(...) нәтижесі. Бар графикті қайта қолдану үшін prev береді.
  function drawForecastChart(canvas, series, r, prev) {
    const n = NQ + r.horizon;
    const labels = Array.from({ length: n }, (_, q) => qLabel(q));
    const pad = (arr, from) => Array.from({ length: n }, (_, q) => (q >= from && q - from < arr.length ? arr[q - from] : null));
    const lastVal = series[LASTQ];
    const data = [
      pad([lastVal, ...r.fc.hi], LASTQ), pad([lastVal, ...r.fc.lo], LASTQ),
      pad(series, 0), pad([lastVal, ...r.fc.mean], LASTQ),
    ];
    if (prev) {
      prev.data.labels = labels;
      prev.data.datasets.forEach((d, i) => { d.data = data[i]; });
      prev.update();
      return prev;
    }
    return new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Жоғарғы шек', data: data[0], borderWidth: 0, pointRadius: 0, fill: '+1', backgroundColor: 'rgba(232,80,106,.14)' },
          { label: 'Төменгі шек', data: data[1], borderWidth: 0, pointRadius: 0, fill: false },
          { label: 'Нақты сұраныс', data: data[2], borderColor: '#2B0C1F', backgroundColor: '#2B0C1F', borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5, tension: .3 },
          { label: 'Болжам', data: data[3], borderColor: '#E8506A', backgroundColor: '#E8506A', borderWidth: 2.5, borderDash: [7, 6], pointRadius: 0, pointHoverRadius: 5, tension: .3 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#2B0C1F', padding: 12,
            filter: i => i.raw !== null && !(i.datasetIndex === 3 && i.dataIndex === LASTQ),
            callbacks: { label: c => ` ${c.dataset.label}: ${fmt(c.raw)} вакансия` },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#777', autoSkip: false, maxRotation: 0,
            callback(v, i) { return i % (this.chart.width < 560 ? 8 : 4) === 0 ? String(Q0 + i / 4) : ''; } } },
          y: { beginAtZero: true, grid: { color: '#EEE' }, border: { display: false },
            ticks: { color: '#777', callback: v => fmt(v) },
            title: { display: true, text: 'Тоқсандағы вакансиялар', color: '#777' } },
        },
      },
      plugins: [{
        id: 'nowLine',
        afterDatasetsDraw(c) {
          const x = c.scales.x.getPixelForValue(LASTQ), { top, bottom } = c.chartArea, ctx = c.ctx;
          ctx.save(); ctx.strokeStyle = '#BBB'; ctx.setLineDash([3, 4]);
          ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
          ctx.fillStyle = '#777'; ctx.font = '12px Inter'; ctx.fillText('Болжам →', x + 8, top + 14);
          ctx.restore();
        },
      }],
    });
  }
  if (window.Chart) Chart.defaults.font.family = 'Inter, system-ui, sans-serif';

  return { D, Q0, NQ, LASTQ, fmt, pct, qLabel, monthLabel, param, esc, link, vacancy, searchLinks,
    filter, aggregate, forecastSeries, forecastSkills, drawForecastChart };
})();
