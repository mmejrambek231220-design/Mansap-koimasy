// ===== Мансап Компасы — «Дағдылар болжамы» беті =====
(function forecastPage() {
  const D = window.MK_DATA;
  if (!D) return;

  const Q0 = 2020;                                  // бірінші тоқсан: 2020 Q1
  const NQ = Math.floor(D.meta.months / 3);         // толық тоқсандар саны
  const LASTQ = NQ - 1;
  const qLabel = q => `${Q0 + Math.floor(q / 4)} Q${q % 4 + 1}`;
  const fmt = n => Math.round(n).toLocaleString('ru-RU');
  const pct = g => (g >= 0 ? '+' : '−') + Math.abs(g * 100).toFixed(0) + '%';
  const $ = id => document.getElementById(id);

  const els = {
    region: $('fRegion'), sector: $('fSector'), title: $('fTitle'), year: $('fYear'), skill: $('fSkill'),
    kVac: $('kpiVac'), kSkills: $('kpiSkills'), kMape: $('kpiMape'), kNaive: $('kpiNaive'),
    top: $('topList'), down: $('downList'), card: $('skillCard'), jobs: $('jobList'),
    chartTitle: $('chartTitle'), yearLbl: document.querySelectorAll('[data-year]'),
    mMape: $('mMape'), mNaive: $('mNaive'), mGain: $('mGain'), mVac: $('mVac'),
  };

  // --- Сүзгі тізімдерін толтыру ---
  D.regions.forEach((r, i) => els.region.add(new Option(r, i)));
  D.sectors.forEach((s, i) => els.sector.add(new Option(s, i)));
  // Мамандықтар: сала таңдалса, тек сол саланың мамандықтары көрсетіледі
  function fillTitles() {
    const sec = +els.sector.value, cur = +els.title.value;
    els.title.length = 1;
    D.titles.forEach((t, i) => { if (sec < 0 || D.titleSector[i] === sec) els.title.add(new Option(t, i)); });
    els.title.value = (sec < 0 || D.titleSector[cur] === sec) ? cur : -1;
  }
  const pTitle = +new URLSearchParams(location.search).get('title');
  if (new URLSearchParams(location.search).has('title') && D.titles[pTitle]) {
    els.sector.value = D.titleSector[pTitle];
    fillTitles();
    els.title.value = pTitle;
  } else fillTitles();
  [...D.skills.keys()].sort((a, b) => D.skills[a].localeCompare(D.skills[b], 'kk'))
    .forEach(k => els.skill.add(new Option(D.skills[k], k)));

  let state = { selected: null, results: [] };
  let chart = null;

  // --- 1. Деректерді жинақтау (сүзгі бойынша) ---
  function aggregate(region, sector, title) {
    const counts = D.skills.map(() => new Array(NQ).fill(0));
    const salSum = new Float64Array(D.skills.length), salN = new Uint32Array(D.skills.length);
    const bySector = D.skills.map(() => new Uint32Array(D.sectors.length));
    const byRegion = D.skills.map(() => new Uint32Array(D.regions.length));
    const recent = D.skills.map(() => []);
    let total = 0, totalLast = 0;

    for (let i = 0; i < D.v.length; i++) {
      const [m, r, s, t, , sal, ks] = D.v[i];
      if (region >= 0 && r !== region) continue;
      if (sector >= 0 && s !== sector) continue;
      if (title >= 0 && t !== title) continue;
      const q = Math.floor(m / 3);
      if (q > LASTQ) continue;
      total++;
      const last = q > LASTQ - 4;
      if (last) totalLast++;
      for (const k of ks) {
        counts[k][q]++;
        if (last) { salSum[k] += sal; salN[k]++; bySector[k][s]++; byRegion[k][r]++; recent[k].push(i); }
      }
    }
    return { counts, salSum, salN, bySector, byRegion, recent, total, totalLast };
  }

  // --- 2. Әр дағдыға модель үйрету және болжау ---
  function compute() {
    const region = +els.region.value, sector = +els.sector.value, title = +els.title.value, year = +els.year.value;
    const agg = aggregate(region, sector, title);
    const minBase = title >= 0 ? 8 : 24;            // бір мамандық бойынша деректер азырақ
    const horizon = (year - Q0) * 4 + 3 - LASTQ;   // таңдалған жылдың соңына дейінгі тоқсандар

    const results = [];
    let mapeSum = 0, naiveSum = 0, nTest = 0;
    D.skills.forEach((name, k) => {
      const series = agg.counts[k];
      const base = series.slice(-4).reduce((a, b) => a + b, 0);
      if (base < minBase) return;                          // деректер тым аз — болжам сенімсіз
      const model = MKModel.fit(series);
      const fc = MKModel.forecast(model, horizon);
      const sumY = arr => arr.slice(-4).reduce((a, b) => a + b, 0);
      const bt = MKModel.backtest(series);
      mapeSum += bt.mape; naiveSum += bt.naiveMape; nTest++;
      results.push({
        k, name, series, model, fc, bt, base,
        target: sumY(fc.mean), lo: sumY(fc.lo), hi: sumY(fc.hi),
        growth: sumY(fc.mean) / base - 1,
        salary: agg.salN[k] ? agg.salSum[k] / agg.salN[k] : 0,
        share: base / Math.max(1, agg.totalLast),
      });
    });

    state = { ...state, agg, results, year, horizon, region, sector, title,
      mape: mapeSum / Math.max(1, nTest), naive: naiveSum / Math.max(1, nTest) };
    if (!results.find(r => r.k === state.selected)) {
      state.selected = results.length ? [...results].sort((a, b) => b.growth - a.growth)[0].k : null;
    }
    render();
  }

  // --- 3. Көрсету ---
  function render() {
    const { results, agg, year } = state;
    els.yearLbl.forEach(e => { e.textContent = year; });
    els.kVac.textContent = fmt(agg.total);
    els.kSkills.textContent = results.length;
    els.kMape.textContent = (state.mape * 100).toFixed(1) + '%';
    els.kNaive.textContent = (state.naive * 100).toFixed(1) + '%';
    els.mMape.textContent = (state.mape * 100).toFixed(1) + '%';
    els.mNaive.textContent = (state.naive * 100).toFixed(1) + '%';
    els.mGain.textContent = state.naive > 0 ? Math.round((1 - state.mape / state.naive) * 100) + '%' : '—';
    els.mVac.textContent = fmt(agg.total);

    if (!results.length) {
      els.top.innerHTML = els.down.innerHTML = '<li class="empty">Бұл сүзгі бойынша деректер жеткіліксіз. Басқа өңір немесе сала таңдаңыз.</li>';
      els.card.innerHTML = ''; els.jobs.innerHTML = '';
      if (chart) { chart.destroy(); chart = null; }
      return;
    }

    // Ең көп өсетін 10 дағды
    const up = [...results].sort((a, b) => b.growth - a.growth).slice(0, 10);
    const max = Math.max(...up.map(r => r.growth), 0.01);
    els.top.innerHTML = up.map((r, i) => `
      <li><button class="bar ${r.k === state.selected ? 'is-active' : ''}" data-k="${r.k}">
        <span class="bar__rank">${String(i + 1).padStart(2, '0')}</span>
        <span class="bar__name">${r.name}</span>
        <span class="bar__track"><span class="bar__fill" style="--w:${Math.max(2, r.growth / max * 100)}%"></span></span>
        <span class="bar__val">${pct(r.growth)}</span>
      </button></li>`).join('');

    // Сұранысы төмендейтін дағдылар
    const down = [...results].filter(r => r.growth < 0).sort((a, b) => a.growth - b.growth).slice(0, 6);
    els.down.innerHTML = down.length ? down.map(r => `
      <li><button class="down ${r.k === state.selected ? 'is-active' : ''}" data-k="${r.k}">
        <span>${r.name}</span><b>${pct(r.growth)}</b>
      </button></li>`).join('') : '<li class="empty">Төмендейтін дағдылар табылмады.</li>';

    requestAnimationFrame(() => document.querySelectorAll('.bar__fill').forEach(b => b.classList.add('is-in')));
    els.skill.value = state.selected;
    renderSkill();
  }

  function renderSkill() {
    const r = state.results.find(x => x.k === state.selected);
    if (!r) return;
    const { agg, year } = state;
    document.querySelectorAll('[data-k]').forEach(b => b.classList.toggle('is-active', +b.dataset.k === r.k));
    els.chartTitle.textContent = r.name;

    // Ең көп сұраныс бар салалар / өңірлер
    const dist = state.sector >= 0 ? agg.byRegion[r.k] : agg.bySector[r.k];
    const names = state.sector >= 0 ? D.regions : D.sectors;
    const tot = dist.reduce((a, b) => a + b, 0) || 1;
    const topD = [...dist.keys()].sort((a, b) => dist[b] - dist[a]).slice(0, 3)
      .map(i => `<li><span>${names[i]}</span><b>${Math.round(dist[i] / tot * 100)}%</b></li>`).join('');

    const up = r.growth >= 0;
    els.card.innerHTML = `
      <p class="sc__label">Таңдалған дағды</p>
      <h3 class="sc__name">${r.name}</h3>
      <div class="sc__growth ${up ? 'is-up' : 'is-down'}">${up ? '▲' : '▼'} ${pct(r.growth)} <small>${year} жылға дейін</small></div>
      <dl class="sc__stats">
        <div><dt>Соңғы 12 айдағы вакансиялар</dt><dd>${fmt(r.base)}</dd></div>
        <div><dt>${year} жылғы болжам</dt><dd>${fmt(r.target)} <small>(${fmt(r.lo)}–${fmt(r.hi)})</small></dd></div>
        <div><dt>Орташа жалақы</dt><dd>${fmt(r.salary)} мың ₸</dd></div>
        <div><dt>Вакансиялардағы үлесі</dt><dd>${(r.share * 100).toFixed(1)}%</dd></div>
      </dl>
      <p class="sc__sub">${state.sector >= 0 ? 'Сұраныс жоғары өңірлер' : 'Сұраныс жоғары салалар'}</p>
      <ul class="sc__dist">${topD}</ul>
      <p class="sc__model">Модель: α=${r.model.alpha}, β=${r.model.beta}, φ=${r.model.phi} · тексеру қателігі (MAPE) ${(r.bt.mape * 100).toFixed(1)}%</p>`;

    // Соңғы вакансиялар
    const ids = agg.recent[r.k].slice(-4).reverse();
    els.jobs.innerHTML = ids.map(i => {
      const [m, reg, , ti, co, sal, ks] = D.v[i];
      const y = D.meta.start.y + Math.floor((D.meta.start.m - 1 + m) / 12);
      const mo = (D.meta.start.m - 1 + m) % 12;
      const months = ['қаң', 'ақп', 'нау', 'сәу', 'мам', 'мау', 'шіл', 'там', 'қыр', 'қаз', 'қар', 'жел'];
      return `<article class="job">
        <h4>${D.titles[ti]}</h4>
        <p class="job__meta">${D.companies[co]} · ${D.regions[reg]} · ${months[mo]} ${y}</p>
        <p class="job__sal">${fmt(sal)} 000 ₸</p>
        <ul class="job__tags">${ks.map(k => `<li class="${k === r.k ? 'is-hl' : ''}">${D.skills[k]}</li>`).join('')}</ul>
      </article>`;
    }).join('');

    drawChart(r);
  }

  function drawChart(r) {
    const n = NQ + state.horizon;
    const labels = Array.from({ length: n }, (_, q) => qLabel(q));
    const pad = (arr, from) => Array.from({ length: n }, (_, q) => (q >= from && q - from < arr.length ? arr[q - from] : null));
    const lastVal = r.series[LASTQ];
    const actual = pad(r.series, 0);
    const fc = pad([lastVal, ...r.fc.mean], LASTQ);
    const hi = pad([lastVal, ...r.fc.hi], LASTQ);
    const lo = pad([lastVal, ...r.fc.lo], LASTQ);
    const datasets = [
      { label: 'Жоғарғы шек', data: hi, borderWidth: 0, pointRadius: 0, fill: '+1', backgroundColor: 'rgba(232,80,106,.14)' },
      { label: 'Төменгі шек', data: lo, borderWidth: 0, pointRadius: 0, fill: false },
      { label: 'Нақты сұраныс', data: actual, borderColor: '#2B0C1F', backgroundColor: '#2B0C1F', borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5, tension: .3 },
      { label: 'Болжам', data: fc, borderColor: '#E8506A', backgroundColor: '#E8506A', borderWidth: 2.5, borderDash: [7, 6], pointRadius: 0, pointHoverRadius: 5, tension: .3 },
    ];

    if (chart) {
      chart.data.labels = labels;
      chart.data.datasets.forEach((d, i) => { d.data = datasets[i].data; });
      chart.update();
      return;
    }
    chart = new Chart($('trendChart'), {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        animation: { duration: 700 },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#2B0C1F', padding: 12, titleFont: { family: 'Inter', weight: '600' }, bodyFont: { family: 'Inter' },
            filter: i => i.raw !== null && !(i.datasetIndex === 3 && i.dataIndex === LASTQ),
            callbacks: { label: c => ` ${c.dataset.label}: ${fmt(c.raw)} вакансия` },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { family: 'Inter' }, color: '#777', autoSkip: false, maxRotation: 0,
            callback(v, i) { // тар экранда жылдарды бір жыл аралатып көрсетеміз
              const step = this.chart.width < 560 ? 8 : 4;
              return i % step === 0 ? String(Q0 + i / 4) : '';
            } } },
          y: { beginAtZero: true, grid: { color: '#EEE' }, border: { display: false },
            ticks: { font: { family: 'Inter' }, color: '#777', callback: v => fmt(v) },
            title: { display: true, text: 'Тоқсандағы вакансиялар', color: '#777', font: { family: 'Inter' } } },
        },
      },
      plugins: [{ // болжам басталатын жерді белгілейтін тік сызық
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

  // --- Оқиғалар ---
  els.sector.addEventListener('change', () => { fillTitles(); compute(); });
  [els.region, els.title, els.year].forEach(e => e.addEventListener('change', compute));
  els.skill.addEventListener('change', () => {
    const k = +els.skill.value;
    if (!state.results.find(r => r.k === k)) {
      alert('Бұл дағды бойынша таңдалған сүзгіде деректер жеткіліксіз.');
      els.skill.value = state.selected; return;
    }
    state.selected = k; renderSkill();
  });
  document.addEventListener('click', e => {
    const b = e.target.closest('button[data-k]');
    if (!b) return;
    state.selected = +b.dataset.k; renderSkill();
    if (window.innerWidth < 1024) $('trend').scrollIntoView({ behavior: 'smooth' });
  });

  compute();
})();
