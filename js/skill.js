// ===== Бір дағдының беті (skill.html?id=K) =====
// Тәуелділіктер: data/dataset.js, js/model.js, js/mk-core.js, js/skills.js (MKSkills), Chart.js

(() => {
  const { D, fmt, pct, esc, link, LASTQ } = MK;
  const { sparkline, badge, money, sectorNames, isSoft } = MKSkills;
  const $ = id => document.getElementById(id);
  const MIN_TITLE_BASE = 12; // мамандық бойынша болжам үшін соңғы 12 айдағы ең аз вакансия саны

  const raw = MK.param('id');
  const k = raw !== null && /^\d+$/.test(raw) ? +raw : -1;

  // --- Жарамсыз id ---
  if (!(k >= 0 && k < D.skills.length)) {
    document.title = 'Дағды табылмады — Мансап Компасы';
    $('sdCrumb').textContent = 'Табылмады';
    $('sdHead').innerHTML = `<div><h1>Дағды <span class="grad-text">табылмады</span></h1>
      <p class="fc-hero__lead">Сілтеме қате немесе мұндай дағды каталогта жоқ. Барлық дағдылар тізімінен қажеттісін таңдаңыз.</p>
      <p class="sd-notfound"><a class="btn btn--pink" href="skills.html">Дағдылар каталогына <span>→</span></a></p></div>`;
    $('sdFilters').style.display = 'none';
    $('sdBody').hidden = true;
    return;
  }

  const name = D.skills[k];
  document.title = `${name} — Дағдылар — Мансап Компасы`;
  $('sdCrumb').textContent = name;
  $('sdName').textContent = name;
  $('sdTags').innerHTML = sectorNames(k).map((s, i) => {
    const sec = isSoft(k) ? MKSkills.SOFT : D.skillSectors[k][i];
    return `<li><a href="skills.html?sector=${sec}">${esc(s)}</a></li>`;
  }).join('');

  // --- Сүзгілер ---
  const els = { region: $('fRegion'), title: $('fTitle'), year: $('fYear') };
  D.regions.forEach((r, i) => els.region.add(new Option(r, i)));
  const all = MK.aggregate(MK.filter({}));
  const titleCounts = [...all.byTitle[k]].map((c, t) => ({ t, c })).filter(x => x.c > 0).sort((a, b) => b.c - a.c);
  titleCounts.forEach(({ t, c }) => els.title.add(new Option(`${D.titles[t]} (${fmt(c)})`, t)));
  const pr = MK.param('region'), pt = MK.param('title'), py = MK.param('year');
  if (pr !== null && els.region.querySelector(`option[value="${+pr}"]`)) els.region.value = +pr;
  if (pt !== null && els.title.querySelector(`option[value="${+pt}"]`)) els.title.value = +pt;
  if (py && ['2027', '2028', '2030'].includes(py)) els.year.value = py;

  let chart = null;

  function compute() {
    const region = +els.region.value, title = +els.title.value, year = +els.year.value;
    document.querySelectorAll('[data-year]').forEach(e => { e.textContent = year; });

    // 1) Осы дағдының серия мен болжамы (сүзгі бойынша)
    const agg = MK.aggregate(MK.filter({ region, title }));
    const series = agg.counts[k];
    const r = MK.forecastSeries(series, year);
    const bt = MKModel.backtest(series);
    const salary = agg.salN[k] ? agg.salSum[k] / agg.salN[k] * 1000 : 0;
    const share = r.base / Math.max(1, agg.totalLast);

    // Бет басы — үлкен сан
    const up = r.growth >= 0;
    $('sdBig').className = `sd-big ${up ? 'is-up' : 'is-down'}`;
    $('sdBig').innerHTML = `<span class="sd-big__lbl">Болжамды өзгеріс</span>
      <b>${up ? '▲' : '▼'} ${pct(r.growth)}</b>
      <span class="sd-big__sub">${year} жылы соңғы 12 аймен салыстырғанда</span>`;

    const scope = [region >= 0 ? D.regions[region] : 'Барлық Қазақстан', title >= 0 ? D.titles[title] : null].filter(Boolean).join(' · ');
    $('sdScope').textContent = scope;

    // KPI
    $('kpiBase').textContent = fmt(r.base);
    $('kpiTarget').innerHTML = `${fmt(r.target)}`;
    $('kpiRange').textContent = `80% аралық: ${fmt(r.lo)}–${fmt(r.hi)}`;
    $('kpiSal').textContent = money(salary);
    $('kpiShare').textContent = `${(share * 100).toFixed(1)}%`;

    // Негізгі график
    $('chartTitle').textContent = `${name}: сұраныс тренді және ${year} жылға дейінгі болжам`;
    $('chartScope').textContent = scope;
    $('sdWarn').hidden = r.base >= MIN_TITLE_BASE;
    if (window.Chart) chart = MK.drawForecastChart($('trendChart'), series, r, chart);

    // Модель картасы
    const gain = bt.naiveMape > 0 ? 1 - bt.mape / bt.naiveMape : 0;
    $('sdModel').innerHTML = `
      <p class="sc__label">Болжам моделі</p>
      <h3 class="sc__name">Holt damped trend</h3>
      <div class="sc__growth ${up ? 'is-up' : 'is-down'}">${fmt(r.target)} <small>${year} жылғы болжамды вакансиялар (${fmt(r.lo)}–${fmt(r.hi)})</small></div>
      <dl class="sc__stats">
        <div><dt>α (деңгей)</dt><dd>${r.model.alpha}</dd></div>
        <div><dt>β (тренд)</dt><dd>${r.model.beta}</dd></div>
        <div><dt>φ (демпфер)</dt><dd>${r.model.phi}</dd></div>
        <div><dt>Болжам көкжиегі</dt><dd>${r.horizon} <small>тоқсан</small></dd></div>
        <div><dt>Тексеру қателігі (MAPE)</dt><dd>${(bt.mape * 100).toFixed(1)}%</dd></div>
        <div><dt>Қарапайым әдіс (MAPE)</dt><dd>${(bt.naiveMape * 100).toFixed(1)}%</dd></div>
      </dl>
      <p class="sc__model">Тексеру: соңғы 4 тоқсан модельден жасырылып, болжаммен салыстырылды.
      ${gain > 0 ? `Модель қарапайым әдістен ${(gain * 100).toFixed(0)}% дәлірек.` : 'Бұл серияда қарапайым әдіс те жақсы нәтиже береді.'}
      Үйрету деректері: ${series.length} тоқсан, ${fmt(series.reduce((a, b) => a + b, 0))} вакансия.</p>`;

    renderTitles(region, year, title);
    renderRegions(title);
    renderCo(region, title);
    renderJobs(region, title);
  }

  // 2) Мамандықтар бойынша болжам: әр мамандыққа жеке серия → жеке модель
  function renderTitles(region, year, selTitle) {
    const S = D.titles.length;
    const ser = Array.from({ length: S }, () => new Array(MK.NQ).fill(0));
    const totLast = new Uint32Array(S);
    for (const i of MK.filter({ region })) {
      const [m, , , t, , , ks] = D.v[i];
      const q = Math.floor(m / 3);
      if (q > LASTQ) continue;
      if (q > LASTQ - 4) totLast[t]++;
      if (ks.includes(k)) ser[t][q]++;
    }
    const rows = [], few = [];
    for (let t = 0; t < S; t++) {
      const total = ser[t].reduce((a, b) => a + b, 0);
      if (!total) continue;
      const r = MK.forecastSeries(ser[t], year);
      const row = { t, r, share: r.base / Math.max(1, totLast[t]) };
      (r.base >= MIN_TITLE_BASE ? rows : few).push(row);
    }
    rows.sort((a, b) => b.r.growth - a.r.growth);
    const maxG = Math.max(0.01, ...rows.map(x => Math.abs(x.r.growth)));

    $('titleCount').textContent = rows.length;
    $('titleTable').innerHTML = rows.length ? rows.map(({ t, r, share }) => {
      const w = (Math.abs(r.growth) / maxG * 50).toFixed(1);
      return `<tr class="${t === selTitle ? 'is-sel' : ''}">
        <td><a class="sd-t__name" href="${link.profession(t)}">${esc(D.titles[t])}</a><small>${esc(D.sectors[D.titleSector[t]])}</small></td>
        <td class="num">${fmt(r.base)}</td>
        <td class="num">${(share * 100).toFixed(0)}%</td>
        <td>${sparkline(r.series || ser[t], r.fc, { w: 150, h: 34, cls: 'spark spark--sm' })}</td>
        <td class="num">${fmt(r.target)} <small>${fmt(r.lo)}–${fmt(r.hi)}</small></td>
        <td><div class="gbar"><i class="${r.growth >= 0 ? 'is-up' : 'is-down'}" style="width:${w}%"></i></div></td>
        <td class="num">${badge(r.growth)}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="7" class="empty">Таңдалған өңірде мамандықтар бойынша болжам жасауға деректер жеткіліксіз.</td></tr>`;

    $('titleFew').innerHTML = few.length
      ? `Деректері аз мамандықтар (соңғы 12 айда ${MIN_TITLE_BASE}-ден аз вакансия): ` +
        few.map(({ t, r }) => `<a href="${link.profession(t)}">${esc(D.titles[t])}</a> (${fmt(r.base)})`).join(', ')
      : '';
  }

  // 3) Өңірлер бойынша (соңғы 12 ай)
  function renderRegions(title) {
    const agg = MK.aggregate(MK.filter({ title, skill: k }));
    const tot = agg.byRegion[k].reduce((a, b) => a + b, 0);
    const rows = [...agg.byRegion[k]].map((c, i) => ({ i, c })).sort((a, b) => b.c - a.c);
    const max = Math.max(1, rows[0] ? rows[0].c : 1);
    $('regionList').innerHTML = tot ? rows.map((x, n) => `
      <li><button type="button" class="bar${+els.region.value === x.i ? ' is-active' : ''}" data-region="${x.i}">
        <span class="bar__rank">${String(n + 1).padStart(2, '0')}</span>
        <span class="bar__name">${esc(D.regions[x.i])}</span>
        <span class="bar__track"><i class="bar__fill" style="--w:${(x.c / max * 100).toFixed(1)}%"></i></span>
        <span class="bar__val">${fmt(x.c)} <small>${(x.c / tot * 100).toFixed(0)}%</small></span>
      </button></li>`).join('') : '<li class="empty">Деректер жоқ.</li>';
    requestAnimationFrame(() => requestAnimationFrame(() =>
      $('regionList').querySelectorAll('.bar__fill').forEach(f => f.classList.add('is-in'))));
  }

  // 4) Бірге жиі сұралатын дағдылар (соңғы 12 ай)
  function renderCo(region, title) {
    const co = new Uint32Array(D.skills.length);
    let n = 0;
    for (const i of MK.filter({ region, title, skill: k })) {
      const [m, , , , , , ks] = D.v[i];
      const q = Math.floor(m / 3);
      if (q > LASTQ || q <= LASTQ - 4) continue;
      n++;
      for (const s of ks) if (s !== k) co[s]++;
    }
    const top = [...co].map((c, s) => ({ s, c })).filter(x => x.c > 0).sort((a, b) => b.c - a.c).slice(0, 10);
    $('coList').innerHTML = top.length ? top.map(x => {
      const p = x.c / n;
      return `<li><a class="co" href="${link.skill(x.s)}">
        <span class="co__name">${esc(D.skills[x.s])}</span>
        <span class="co__track"><i style="width:${(p * 100).toFixed(1)}%"></i></span>
        <span class="co__val">${(p * 100).toFixed(0)}%</span></a></li>`;
    }).join('') : '<li class="empty">Деректер жоқ.</li>';
  }

  // 5) Соңғы вакансиялар
  function renderJobs(region, title) {
    const ids = MK.filter({ region, title, skill: k }).sort((a, b) => D.v[b][0] - D.v[a][0] || b - a).slice(0, 6);
    $('jobList').innerHTML = ids.length ? ids.map(i => {
      const v = MK.vacancy(i);
      return `<a class="job" href="${link.vacancy(i)}">
        <h4>${esc(v.titleName)}</h4>
        <p class="job__meta">${esc(v.company)} · ${esc(v.regionName)} · ${v.date}</p>
        <p class="job__sal">${fmt(v.salary)} ₸</p>
        <ul class="job__tags">${v.skills.map(s => `<li class="${s === k ? 'is-hl' : ''}">${esc(D.skills[s])}</li>`).join('')}</ul>
      </a>`;
    }).join('') : '<p class="empty">Таңдалған сүзгі бойынша вакансиялар табылмады.</p>';
    const qs = new URLSearchParams({ skill: k });
    if (region >= 0) qs.set('region', region);
    if (title >= 0) qs.set('title', title);
    $('allJobs').href = `vacancies.html?${qs}`;
  }

  // --- Оқиғалар ---
  Object.values(els).forEach(e => e.addEventListener('change', compute));
  $('sdReset').addEventListener('click', () => { els.region.value = -1; els.title.value = -1; els.year.value = 2030; compute(); });
  $('regionList').addEventListener('click', e => {
    const b = e.target.closest('[data-region]');
    if (!b) return;
    els.region.value = +els.region.value === +b.dataset.region ? -1 : b.dataset.region;
    compute();
    $('trend').scrollIntoView({ behavior: 'smooth' });
  });

  compute();
})();
