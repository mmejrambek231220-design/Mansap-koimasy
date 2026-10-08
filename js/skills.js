// ===== «Дағдылар» каталогы (skills.html) + ортақ көмекші функциялар (skill.html да қолданады) =====
// Тәуелділіктер: data/dataset.js, js/model.js, js/mk-core.js; міндетті емес: data/surveys.js + js/mk-ensemble.js (ансамбль)

const MKSkills = (() => {
  const D = MK.D;
  const SOFT = 'soft'; // салаға байланбаған жалпы дағдылар (skillSectors[k] = [])

  // Дағдының сала тегтері
  const sectorNames = k => (D.skillSectors[k].length ? D.skillSectors[k].map(s => D.sectors[s]) : ['Жалпы дағдылар']);
  const isSoft = k => D.skillSectors[k].length === 0;

  // Кішкентай SVG спарклайн: тоқсандық нақты серия + болжам (орта мән) + 80% аралық
  function sparkline(series, fc, { w = 260, h = 56, cls = 'spark' } = {}) {
    const n = series.length + fc.mean.length;
    const last = series.length - 1;
    const peak = Math.max(1, ...series, ...fc.mean);
    const max = peak * 1.15;
    const x = i => (i / (n - 1)) * w;
    const y = v => h - 3 - (Math.min(v, max) / max) * (h - 6);
    const pts = (arr, from) => arr.map((v, i) => `${x(from + i).toFixed(1)},${y(v).toFixed(1)}`);
    const lastV = series[last];
    const actual = pts(series, 0).join(' ');
    const mean = pts([lastV, ...fc.mean], last).join(' ');
    const band = [...pts([lastV, ...fc.hi], last), ...pts([lastV, ...fc.lo], last).reverse()].join(' ');
    const nx = x(last).toFixed(1);
    return `<svg class="${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <polygon points="${band}" fill="rgba(232,80,106,.14)"/>
      <line x1="${nx}" y1="0" x2="${nx}" y2="${h}" stroke="#D9CFD5" stroke-dasharray="2 3" vector-effect="non-scaling-stroke"/>
      <polyline points="${actual}" fill="none" stroke="#2B0C1F" stroke-width="1.8" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
      <polyline points="${mean}" fill="none" stroke="#E8506A" stroke-width="1.8" stroke-dasharray="4 3" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    </svg>`;
  }

  const badge = g => `<span class="sk-badge ${g >= 0 ? 'is-up' : 'is-down'}">${g >= 0 ? '▲' : '▼'} ${MK.pct(g)}</span>`;
  const money = s => (s ? `${MK.fmt(s / 1000)} мың ₸` : '—');

  // Сауалнама жоқ болса — «Жұмыс берушілер бағасы» сұрыптауын алып тастаймыз
  // (mk-filters.js чиптерді DOMContentLoaded-ке дейін жасайды, сондықтан бірден)
  if (typeof document !== 'undefined' && !(typeof MKEnsemble !== 'undefined' && MKEnsemble.has)) {
    const o = document.querySelector('#fSort option[value="survey"]');
    if (o) o.remove();
  }

  // ---------- Каталог ----------
  function catalog() {
    const $ = id => document.getElementById(id);
    const grid = $('skGrid');
    if (!grid) return;

    const els = { q: $('fQuery'), sector: $('fSector'), sort: $('fSort'), year: $('fYear'), chips: $('skChips'), count: $('skCount') };
    const state = { year: 2030, results: [], cat: 'all' };

    D.sectors.forEach((s, i) => els.sector.add(new Option(s, i)));
    els.sector.add(new Option('Жалпы дағдылар', SOFT));

    // URL параметрлері: ?q=..&sector=..
    const pq = MK.param('q'), ps = MK.param('sector');
    if (pq) els.q.value = pq;
    if (ps !== null && [...els.sector.options].some(o => o.value === ps)) els.sector.value = ps;

    const CATS = [
      { id: 'all', name: 'Барлығы', test: () => true },
      { id: 'fast', name: 'Жылдам өсетін', test: r => r.growth >= 0.25 },
      { id: 'up', name: 'Өсуде', test: r => r.growth >= 0 },
      { id: 'down', name: 'Төмендеуде', test: r => r.growth < 0 },
      { id: 'soft', name: 'Жалпы дағдылар', test: r => isSoft(r.k) },
    ];

    function compute() {
      state.year = +els.year.value;
      state.results = MK.forecastSkills({}, state.year, { minBase: 1 }).results;
      document.querySelectorAll('[data-year]').forEach(e => { e.textContent = state.year; });
      renderKpis();
      render();
    }

    function renderKpis() {
      const rs = state.results;
      const top = rs[0];
      const dem = rs.reduce((a, b) => (b.base > a.base ? b : a), rs[0]);
      $('kpiCount').textContent = rs.length;
      $('kpiTop').innerHTML = `<a href="${MK.link.skill(top.k)}">${MK.esc(top.name)}</a>`;
      $('kpiTopSub').textContent = `${MK.pct(top.growth)} · ${state.year} жылға дейін`;
      $('kpiDem').innerHTML = `<a href="${MK.link.skill(dem.k)}">${MK.esc(dem.name)}</a>`;
      $('kpiDemSub').textContent = `${MK.fmt(dem.base)} вакансия · соңғы 12 ай`;
      $('kpiDown').textContent = rs.filter(r => r.growth < 0).length;
    }

    function filtered(ignoreCat) {
      const q = els.q.value.trim().toLowerCase();
      const sec = els.sector.value;
      let rs = state.results.filter(r => {
        if (q && !r.name.toLowerCase().includes(q)) return false;
        if (sec === SOFT) return isSoft(r.k);
        if (sec !== '-1' && !D.skillSectors[r.k].includes(+sec)) return false;
        return true;
      });
      if (!ignoreCat) rs = rs.filter(CATS.find(c => c.id === state.cat).test);
      return rs;
    }

    function renderChips() {
      const base = filtered(true);
      els.chips.innerHTML = CATS.map(c =>
        `<button type="button" class="sk-chip${c.id === state.cat ? ' is-active' : ''}" data-cat="${c.id}" aria-pressed="${c.id === state.cat}">
          ${c.name} <i>${base.filter(c.test).length}</i></button>`).join('');
    }

    function render() {
      renderChips();
      const rs = filtered(false);
      const sort = els.sort.value;
      const cmp = {
        growth: (a, b) => b.growth - a.growth,
        demand: (a, b) => b.base - a.base,
        salary: (a, b) => b.salary - a.salary,
        az: (a, b) => a.name.localeCompare(b.name, 'kk'),
        // Жұмыс берушілер бағасы: дауыстар сальдосы (өседі − азаяды) / n, тең болса — «табу қиын» үлесі
        survey: (a, b) => (b.surveyScore ?? -9) - (a.surveyScore ?? -9) || (b.hardShare ?? 0) - (a.hardShare ?? 0),
      }[sort] || ((a, b) => b.growth - a.growth);
      rs.sort(cmp);
      els.count.textContent = rs.length;

      if (!rs.length) {
        grid.innerHTML = `<div class="sk-empty"><b>Ештеңе табылмады</b><p>Іздеу сөзін немесе сүзгілерді өзгертіп көріңіз.</p></div>`;
        return;
      }
      grid.innerHTML = rs.map(r => `
        <a class="skc" href="${MK.link.skill(r.k)}">
          <div class="skc__top">
            <h3>${MK.esc(r.name)}</h3>
            ${badge(r.growth)}
          </div>
          <ul class="skc__tags">${sectorNames(r.k).map(s => `<li>${MK.esc(s)}</li>`).join('')}</ul>
          ${r.surveyN ? `<p class="skc__svy" title="Ансамбль: (1 − w) · модель + w · сауалнама, w = ${r.surveyW.toFixed(2)}">Модель ${MK.pct(r.growthModel)} · жұмыс берушілер ${MK.pct(r.growthSurvey)} <small>(n=${r.surveyN})</small> · табу қиын ${Math.round(r.hardShare * 100)}%</p>` : ''}
          <div class="skc__spark">${sparkline(r.series, r.fc)}
            <div class="skc__axis"><span>2020</span><span>қазір</span><span>${state.year}</span></div></div>
          <dl class="skc__stats">
            <div><dt>Сұраныс</dt><dd>${MK.fmt(r.base)}</dd><small>вакансия / 12 ай</small></div>
            <div><dt>${state.year} болжам</dt><dd>${MK.fmt(r.target)}</dd><small>вакансия / жыл</small></div>
            <div><dt>Жалақы</dt><dd>${r.salary ? MK.fmt(r.salary / 1000) : '—'}</dd><small>мың ₸, орташа</small></div>
          </dl>
          <span class="skc__more">Толығырақ <span>→</span></span>
        </a>`).join('');
    }

    els.year.addEventListener('change', compute);
    [els.sector, els.sort].forEach(e => e.addEventListener('change', render));
    els.q.addEventListener('input', render);
    els.chips.addEventListener('click', e => {
      const b = e.target.closest('[data-cat]');
      if (!b) return;
      state.cat = b.dataset.cat;
      render();
    });
    $('skReset').addEventListener('click', () => {
      els.q.value = ''; els.sector.value = '-1'; els.sort.value = 'growth'; state.cat = 'all'; render();
    });

    compute();
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', catalog);
    else catalog();
  }

  return { SOFT, sectorNames, isSoft, sparkline, badge, money };
})();
