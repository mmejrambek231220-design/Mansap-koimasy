// ===== Мансап Компасы — «Мамандық болжамы» беті (profession.html?id=T) =====
// Тәуелділіктер: mk-core.js (MK), professions.js (MKProf)
(function professionPage() {
  const D = MK.D;
  const $ = id => document.getElementById(id);
  const esc = MK.esc;
  const t = MK.param('id') === null || MK.param('id') === '' ? NaN : Number(MK.param('id'));

  // --- Қате id ---
  if (!Number.isInteger(t) || t < 0 || t >= D.titles.length) {
    $('pfBody').hidden = true;
    $('pfFilters').hidden = true;
    $('pfMissing').hidden = false;
    $('crumbName').textContent = 'Табылмады';
    $('pfName').textContent = 'Мамандық табылмады';
    document.querySelector('.fc-hero__lead').textContent = 'Мұндай мамандық біздің деректер базасында жоқ.';
    return;
  }

  const name = D.titles[t];
  document.title = `${name} — мамандық болжамы — Мансап Компасы`;
  $('crumbName').textContent = name;
  $('pfName').textContent = name;
  $('pfSector').innerHTML = `Сала: <a href="professions.html?sector=${D.titleSector[t]}">${esc(D.sectors[D.titleSector[t]])}</a>`;
  document.querySelectorAll('.pf-tname').forEach(e => { e.textContent = name; });

  D.regions.forEach((r, i) => $('fRegion').add(new Option(r, i)));
  const pr = MK.param('region');
  if (pr !== null && D.regions[+pr]) $('fRegion').value = pr;

  // Дереккөз сілтемелері және «барлық вакансиялар»
  $('srcQuery').textContent = D.titleQuery[t];
  $('srcLinks').innerHTML = MK.searchLinks(t).map(s =>
    `<a class="src-btn" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)} ↗</a>`).join('');
  $('allVac').href = `vacancies.html?title=${t}`;

  // Ұқсас мамандықтар (сол сала)
  const sim = D.titles.map((n, i) => i).filter(i => i !== t && D.titleSector[i] === D.titleSector[t]);
  $('similar').innerHTML = sim.length ? sim.map(i => {
    const p = MKProf.analyze(i, { year: 2030 });
    const g = p.demand.growth;
    return `<a class="sim" href="${MK.link.profession(i)}">
      <b>${esc(D.titles[i])}</b>
      <span>${MK.fmt(p.agg.totalLast)} вакансия · сұраныс <i class="${g >= 0 ? 'is-up' : 'is-down'}">${MK.pct(g)}</i></span>
      <small>${p.future.map(s => esc(s.name)).join(' · ') || '—'}</small>
    </a>`;
  }).join('') : '<p class="empty">Осы салада басқа мамандық жоқ.</p>';

  let st = { p: null, selected: null, mode: 'share' };
  let skillChart = null, demandChart = null;

  // --- Есептеу ---
  function compute() {
    const region = +$('fRegion').value, year = +$('fYear').value;
    const p = MKProf.analyze(t, { region, year, backtest: true });
    st.p = p;
    if (!p.skills.find(s => s.k === st.selected)) st.selected = (p.future[0] || p.byShare[0] || {}).k ?? null;
    render();
  }

  function metric(s) { return st.mode === 'share' ? s.delta : s.growth; }
  const fmtMetric = v => (st.mode === 'share' ? MKProf.pp(v) : MK.pct(v));

  function render() {
    const p = st.p, { year } = p;
    document.querySelectorAll('[data-year]').forEach(e => { e.textContent = year; });
    $('minBaseNote').textContent = p.minBase;

    // KPI
    const g = p.demand.growth;
    $('kpiVac').textContent = MK.fmt(p.agg.totalLast);
    $('kpiGrowth').textContent = MK.pct(g);
    $('kpiGrowth').className = g >= 0 ? 'is-up' : 'is-down';
    $('kpiSal').textContent = p.salary ? MK.fmt(p.salary / 1000) + ' мың ₸' : '—';
    $('kpiMape').textContent = p.mape !== null ? (p.mape * 100).toFixed(1) + '%' : '—';
    $('kpiNaive').textContent = p.naive !== null ? (p.naive * 100).toFixed(1) + '%' : '—';

    renderDemand();

    if (!p.skills.length) {
      const msg = '<li class="empty">Бұл өңір бойынша осы мамандыққа деректер жеткіліксіз. «Барлық Қазақстан» таңдаңыз.</li>';
      $('topList').innerHTML = $('downList').innerHTML = msg;
      $('matrix').innerHTML = '<tr><td colspan="6" class="empty">Деректер жеткіліксіз.</td></tr>';
      $('skillCard').innerHTML = ''; $('chartTitle').textContent = '—'; $('topNote').textContent = '';
      if (skillChart) { skillChart.destroy(); skillChart = null; }
    } else {
      renderTop();
      renderDown();
      renderMatrix();
      renderSkill();
    }
    renderJobs();
  }

  function renderTop() {
    const p = st.p;
    $('topNote').textContent = st.mode === 'share'
      ? `Дағдының осы мамандық вакансияларындағы үлесі ${p.year} жылға қарай қалай өзгереді (пайыздық тармақпен, п.т.). Дағдыны басыңыз.`
      : `Дағды талап етілетін вакансиялар санының соңғы 12 аймен салыстырғандағы ${p.year} жылғы өсуі. Дағдыны басыңыз.`;
    // Маңызы артатындар (мән > 0); олар аз болса — тұрақты дағдылармен толықтырамыз (кемінде 5)
    const sorted = p.skills.filter(s => s.cat !== 'down').sort((a, b) => metric(b) - metric(a));
    const pos = sorted.filter(s => metric(s) > 0);
    const list = (pos.length >= 5 ? pos : sorted.slice(0, 5)).slice(0, 10);
    if (!list.length) { $('topList').innerHTML = '<li class="empty">Маңызы артатын дағдылар табылмады.</li>'; return; }
    const max = Math.max(...list.map(metric), 0.01);
    $('topList').innerHTML = list.map((s, i) => {
      const v = metric(s);
      return `<li><button class="bar ${s.k === st.selected ? 'is-active' : ''}" data-k="${s.k}" title="${esc(MKProf.CATS[s.cat].name)}">
        <span class="bar__rank">${String(i + 1).padStart(2, '0')}</span>
        <span class="bar__name">${esc(s.name)}${s.core ? ' <em class="core">негізгі</em>' : ''}</span>
        <span class="bar__track"><span class="bar__fill ${v < 0 ? 'is-neg' : ''}" style="--w:${Math.max(2, Math.abs(v) / max * 100)}%"></span></span>
        <span class="bar__val ${v < 0 ? 'is-neg' : ''}">${fmtMetric(v)}</span>
      </button></li>`;
    }).join('');
    requestAnimationFrame(() => document.querySelectorAll('#topList .bar__fill').forEach(b => b.classList.add('is-in')));
  }

  function renderDown() {
    const d = st.p.declining.slice(0, 7);
    $('downList').innerHTML = d.length ? d.map(s => `
      <li><button class="down ${s.k === st.selected ? 'is-active' : ''}" data-k="${s.k}">
        <span>${esc(s.name)}<small>${MKProf.share(s.shareNow)} → ${MKProf.share(s.shareFut)}</small></span><b>${MKProf.pp(s.delta)}</b>
      </button></li>`).join('') : '<li class="empty">Үлесі айтарлықтай азаятын дағдылар табылмады.</li>';
  }

  function renderMatrix() {
    const order = { key: 0, up: 1, flat: 2, down: 3 };
    const rows = [...st.p.skills].sort((a, b) => order[a.cat] - order[b.cat] || b.delta - a.delta);
    $('matrix').innerHTML = rows.map(s => `
      <tr data-k="${s.k}" class="${s.k === st.selected ? 'is-active' : ''}">
        <td><a href="${MK.link.skill(s.k)}">${esc(s.name)}</a>${s.core ? ' <em class="core">негізгі</em>' : ''}${s.base < 15 ? ' <em class="few" title="Деректер аз — болжам сенімсіз">аз дерек</em>' : ''}</td>
        <td class="num">${MKProf.share(s.shareNow)}</td>
        <td class="num"><b>${MKProf.share(s.shareFut)}</b></td>
        <td class="num ${s.delta >= 0 ? 'is-up' : 'is-down'}">${MKProf.pp(s.delta)}</td>
        <td class="num">${MK.pct(s.growth)}</td>
        <td>${MKProf.badge(s.cat)}</td>
      </tr>`).join('');
  }

  function renderSkill() {
    const p = st.p, s = p.skills.find(x => x.k === st.selected);
    if (!s) return;
    document.querySelectorAll('[data-k]').forEach(b => b.classList.toggle('is-active', +b.dataset.k === s.k));
    $('chartTitle').textContent = `${s.name} · ${name}`;
    const up = s.rel >= 0;
    $('skillCard').innerHTML = `
      <p class="sc__label">Таңдалған дағды</p>
      <h3 class="sc__name"><a href="${MK.link.skill(s.k)}">${esc(s.name)}</a></h3>
      <p class="sc__cat">${MKProf.badge(s.cat)}</p>
      <div class="sc__growth ${up ? 'is-up' : 'is-down'}">${MKProf.share(s.shareNow)} → ${MKProf.share(s.shareFut)}
        <small>мамандық вакансияларындағы үлесі, ${p.year} жылға дейін (${MKProf.pp(s.delta)})</small></div>
      <dl class="sc__stats">
        <div><dt>Соңғы 12 айдағы вакансиялар</dt><dd>${MK.fmt(s.base)}</dd></div>
        <div><dt>${p.year} жылғы болжам</dt><dd>${MK.fmt(s.target)} <small>(${MK.fmt(s.lo)}–${MK.fmt(s.hi)})</small></dd></div>
        <div><dt>Сұраныс өсуі</dt><dd>${MK.pct(s.growth)}</dd></div>
        <div><dt>Орташа жалақы</dt><dd>${s.salary ? MK.fmt(s.salary / 1000) + ' мың ₸' : '—'}</dd></div>
      </dl>
      <p class="sc__model">Модель: α=${s.model.alpha}, β=${s.model.beta}, φ=${s.model.phi}${s.bt ? ` · MAPE ${(s.bt.mape * 100).toFixed(1)}%` : ''}${s.base < 15 ? '<br>⚠ Деректер аз — болжам сенімсіз' : ''}</p>`;
    skillChart = MK.drawForecastChart($('skillChart'), s.series, s, skillChart);
  }

  function renderDemand() {
    const p = st.p, d = p.demand;
    demandChart = MK.drawForecastChart($('demandChart'), p.agg.total, d, demandChart);
    const up = d.growth >= 0;
    const reg = p.region >= 0 ? D.regions[p.region] : 'Барлық Қазақстан';
    $('demandCard').innerHTML = `
      <p class="sc__label">${esc(reg)}</p>
      <h3 class="sc__name">${esc(name)}</h3>
      <div class="sc__growth ${up ? 'is-up' : 'is-down'}">${up ? '▲' : '▼'} ${MK.pct(d.growth)} <small>${p.year} жылға дейінгі сұраныс</small></div>
      <dl class="sc__stats">
        <div><dt>Соңғы 12 айдағы вакансиялар</dt><dd>${MK.fmt(d.base)}</dd></div>
        <div><dt>${p.year} жылғы болжам</dt><dd>${MK.fmt(d.target)} <small>(${MK.fmt(d.lo)}–${MK.fmt(d.hi)})</small></dd></div>
      </dl>
      <p class="sc__model">Модель: α=${d.model.alpha}, β=${d.model.beta}, φ=${d.model.phi}</p>`;
  }

  function renderJobs() {
    const ids = [...st.p.ids].sort((a, b) => D.v[b][0] - D.v[a][0] || b - a).slice(0, 4);
    $('jobList').innerHTML = ids.length ? ids.map(i => {
      const v = MK.vacancy(i);
      return `<article class="job job--link">
        <h4><a href="${MK.link.vacancy(i)}">${esc(v.titleName)}</a></h4>
        <p class="job__meta">${esc(v.company)} · ${esc(v.regionName)} · ${v.date}</p>
        <p class="job__sal">${MK.fmt(v.salary)} ₸</p>
        <ul class="job__tags">${v.skills.map(k => `<li class="${k === st.selected ? 'is-hl' : ''}"><a href="${MK.link.skill(k)}">${esc(D.skills[k])}</a></li>`).join('')}</ul>
      </article>`;
    }).join('') : '<p class="empty">Вакансиялар табылмады.</p>';
  }

  // --- Оқиғалар ---
  $('fRegion').addEventListener('change', compute);
  $('fYear').addEventListener('change', compute);
  document.querySelector('.seg').addEventListener('click', e => {
    const b = e.target.closest('button[data-mode]');
    if (!b || b.dataset.mode === st.mode) return;
    st.mode = b.dataset.mode;
    document.querySelectorAll('.seg button').forEach(x => x.classList.toggle('is-active', x === b));
    renderTop();
  });
  document.addEventListener('click', e => {
    if (e.target.closest('a')) return;
    const b = e.target.closest('[data-k]');
    if (!b || !st.p) return;
    st.selected = +b.dataset.k;
    renderSkill();
    renderJobs();
    if (b.tagName === 'TR') $('trend').scrollIntoView({ behavior: 'smooth' });
  });

  compute();
})();
