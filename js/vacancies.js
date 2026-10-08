// ===== Мансап Компасы — «Вакансиялар» тізімі және «Вакансия» беті =====
// Тәуелділіктер: data/dataset.js, js/model.js, js/mk-core.js (MK).
// <body data-page="list"> → vacancies.html, <body data-page="detail"> → vacancy.html?id=N

const VC = (() => {
  const D = MK.D;
  const LASTM = D.meta.months - 1;
  const PER_PAGE = 20;
  const SRC_CLASS = ['hh', 'li', 'en'];

  const num = v => (v === null || v === undefined || v === '' || isNaN(+v) ? -1 : +v);
  const money = v => MK.fmt(v) + ' ₸';
  const median = arr => {
    if (!arr.length) return 0;
    const a = Float64Array.from(arr).sort();
    const h = a.length >> 1;
    return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2;
  };

  // ---------- Деректерді өңдеу (DOM-сыз) ----------

  // Тізім: сүзгі + сұрыптау + статистика
  function query(st) {
    const ids = MK.filter({
      region: st.region, sector: st.sector, title: st.title, skill: st.skill,
      src: st.src, exp: st.exp, from: st.from, text: st.text ? st.text.trim() : '',
    });
    // MK.filter индекс ретімен қайтарады (ай бойынша өсу ретімен) → «жаңалары» = кері рет
    let sorted = ids.slice().reverse();
    if (st.sort === 'sal-desc') sorted.sort((a, b) => D.v[b][5] - D.v[a][5] || b - a);
    else if (st.sort === 'sal-asc') sorted.sort((a, b) => D.v[a][5] - D.v[b][5] || b - a);

    const skillCnt = new Uint32Array(D.skills.length);
    const companies = new Set();
    const sal = new Float64Array(ids.length);
    ids.forEach((i, n) => {
      const r = D.v[i];
      sal[n] = r[5];
      companies.add(r[4]);
      for (const k of r[6]) skillCnt[k]++;
    });
    const topSkills = Array.from(skillCnt, (c, k) => ({ k, name: D.skills[k], count: c }))
      .filter(s => s.count > 0).sort((a, b) => b.count - a.count).slice(0, 10);
    return {
      ids: sorted, count: ids.length,
      medianSalary: median(sal) * 1000,
      topSkills, companies: companies.size,
    };
  }

  // Беттеу: көрсетілетін бет нөмірлері (null = «…»)
  function pageList(cur, total) {
    if (total <= 9) return Array.from({ length: total }, (_, i) => i);
    const set = new Set([0, total - 1, cur - 2, cur - 1, cur, cur + 1, cur + 2].filter(p => p >= 0 && p < total));
    const pages = [...set].sort((a, b) => a - b), out = [];
    pages.forEach((p, i) => { if (i && p - pages[i - 1] > 1) out.push(null); out.push(p); });
    return out;
  }

  // Бір вакансияның толық деректері
  let fcCache = null;
  function skillForecasts() {
    if (!fcCache) {
      const agg = MK.aggregate(MK.filter({}));
      fcCache = { agg, byK: new Map() };
    }
    return fcCache;
  }
  function skillGrowth(k) {
    const c = skillForecasts();
    if (!c.byK.has(k)) c.byK.set(k, MK.forecastSeries(c.agg.counts[k], 2030).growth);
    return c.byK.get(k);
  }

  function detail(id) {
    const v = MK.vacancy(id);
    if (!v) return null;
    // Осы мамандық бойынша соңғы 12 айдағы орташа жалақы
    const peers = MK.filter({ title: v.title, from: LASTM - 11 });
    const avg = peers.length ? peers.reduce((s, i) => s + D.v[i][5], 0) / peers.length * 1000 : 0;
    const same = MK.filter({ title: v.title });
    const similar = [];
    for (let n = same.length - 1; n >= 0 && similar.length < 4; n--) if (same[n] !== id) similar.push(MK.vacancy(same[n]));
    return {
      v,
      avgSalary: avg, peers: peers.length,
      diff: avg ? v.salary / avg - 1 : 0,
      skills: v.skills.map(k => ({ k, name: D.skills[k], growth: skillGrowth(k) })),
      links: MK.searchLinks(v.title),
      similar,
      text: describe(v),
    };
  }

  // Шаблон бойынша сипаттама мәтіні
  function describe(v) {
    const sk = v.skillNames;
    const lvl = ['тәжірибесі жоқ үміткерлерді де қарастырамыз', '1–3 жыл тәжірибе', '3–6 жыл тәжірибе', '6 жылдан астам тәжірибе'][v.exp] || v.expName;
    return {
      about: `${v.company} — ${v.sectorName} саласында жұмыс істейтін компания. Біз ${v.regionName} қаласындағы командамызды кеңейтіп, «${v.titleName}» лауазымына білікті маман іздейміз.`,
      duties: [
        `${v.titleName} ретінде күнделікті міндеттерді сапалы әрі уақытында орындау`,
        sk.length > 1 ? `«${sk[0]}» және «${sk[1]}» дағдыларын қолдана отырып жұмыс процестерін жетілдіру`
          : `«${sk[0]}» дағдысын қолдана отырып жұмыс процестерін жетілдіру`,
        `${v.sectorName} саласындағы әріптестермен және басқа бөлімдермен тығыз жұмыс істеу`,
        'Атқарылған жұмыс бойынша есептер дайындау және нәтижелерді талдау',
      ],
      reqs: [
        ...sk.map(n => `${n} дағдысы`),
        v.exp === 0 ? 'Жұмыс тәжірибесі міндетті емес — оқуға дайын болу маңызды' : `Осы бағытта ${lvl}`,
        'Командада жұмыс істеу және өз ойын нақты жеткізе білу',
      ],
      offer: [
        `Нарықтағы бәсекеге қабілетті жалақы: ${money(v.salary)}`,
        'Ресми жұмысқа орналасу, ҚР Еңбек кодексіне сай әлеуметтік пакет',
        'Кәсіби дамуға арналған курстар мен тәлімгерлік',
        `${v.regionName} қаласындағы ыңғайлы кеңсе және икемді жұмыс кестесі`,
      ],
    };
  }

  // ---------- Ортақ HTML бөліктері ----------
  const srcBadge = (src, name) => `<span class="vc-src vc-src--${SRC_CLASS[src] || 'hh'}">${MK.esc(name)}</span>`;
  const extLink = (url, label, cls = '') => `<a class="${cls}" href="${MK.esc(url)}" target="_blank" rel="noopener">${label}</a>`;
  const growthTxt = g => MK.pct(g);

  // ---------- vacancies.html ----------
  function initList() {
    const $ = id => document.getElementById(id);
    const sel = {
      region: $('fRegion'), sector: $('fSector'), title: $('fTitle'),
      src: $('fSrc'), exp: $('fExp'), from: $('fFrom'), sort: $('fSort'),
    };
    const fill = (el, names) => names.forEach((n, i) => el.add(new Option(n, i)));
    fill(sel.region, D.regions);
    fill(sel.sector, D.sectors);
    // Мамандықтар — әліпби бойынша
    D.titles.map((n, i) => [n, i]).sort((a, b) => a[0].localeCompare(b[0], 'kk'))
      .forEach(([n, i]) => sel.title.add(new Option(n, i)));
    fill(sel.src, D.sources.map(s => s.name));
    fill(sel.exp, D.experience);
    [['Барлығы', -1], ['Соңғы 3 ай', LASTM - 2], ['Соңғы 12 ай', LASTM - 11], ['Соңғы 3 жыл', LASTM - 35]]
      .forEach(([n, v]) => sel.from.add(new Option(n, v)));

    // URL параметрлері
    const p = new URLSearchParams(location.search);
    const st = {
      region: num(p.get('region')), sector: num(p.get('sector')), title: num(p.get('title')),
      skill: num(p.get('skill')), src: num(p.get('src')), exp: num(p.get('exp')),
      from: num(p.get('from')), text: p.get('q') || '', sort: p.get('sort') || 'new', page: 0,
    };
    if (!(st.skill < D.skills.length)) st.skill = -1;
    for (const key of ['region', 'sector', 'title', 'src', 'exp', 'from']) {
      if ([...sel[key].options].some(o => +o.value === st[key])) sel[key].value = st[key];
      else st[key] = -1;
    }
    if (!['new', 'sal-desc', 'sal-asc'].includes(st.sort)) st.sort = 'new';
    sel.sort.value = st.sort;
    $('fText').value = st.text;

    let res = null;

    function syncUrl() {
      const q = new URLSearchParams();
      ['region', 'sector', 'title', 'skill', 'src', 'exp', 'from'].forEach(k => { if (st[k] >= 0) q.set(k, st[k]); });
      if (st.text.trim()) q.set('q', st.text.trim());
      if (st.sort !== 'new') q.set('sort', st.sort);
      const s = q.toString();
      history.replaceState(null, '', location.pathname + (s ? '?' + s : ''));
    }

    function run() {
      res = query(st);
      st.page = 0;
      syncUrl();
      renderStats();
      renderList();
    }

    function renderStats() {
      $('kpiCount').textContent = MK.fmt(res.count);
      $('kpiMedian').textContent = res.count ? money(res.medianSalary) : '—';
      const top = res.topSkills[0];
      $('kpiSkill').innerHTML = top ? `<a href="${MK.link.skill(top.k)}">${MK.esc(top.name)}</a>` : '—';
      $('kpiCompanies').textContent = MK.fmt(res.companies);

      const max = res.topSkills.length ? res.topSkills[0].count : 1;
      $('topSkills').innerHTML = res.topSkills.length ? res.topSkills.map((s, n) => `
        <li class="vc-skill${s.k === st.skill ? ' is-active' : ''}">
          <a href="${MK.link.skill(s.k)}" class="vc-skill__name"><i>${n + 1}</i>${MK.esc(s.name)}</a>
          <span class="vc-skill__cnt">${MK.fmt(s.count)}</span>
          <button type="button" class="vc-skill__add" data-skill="${s.k}" title="Осы дағды бойынша сүзу" aria-label="${MK.esc(s.name)} бойынша сүзу">＋</button>
          <span class="vc-skill__bar"><span style="width:${(s.count / max * 100).toFixed(1)}%"></span></span>
        </li>`).join('') : '<li class="empty">Дағдылар табылмады</li>';

      $('resultCount').innerHTML = `<b>${MK.fmt(res.count)}</b> вакансия табылды`;
      const chips = [];
      if (st.skill >= 0) chips.push(`<button type="button" class="vc-chip" data-clear="skill">Дағды: ${MK.esc(D.skills[st.skill])} <span aria-hidden="true">✕</span></button>`);
      if (st.text.trim()) chips.push(`<button type="button" class="vc-chip" data-clear="text">Іздеу: «${MK.esc(st.text.trim())}» <span aria-hidden="true">✕</span></button>`);
      const any = chips.length || ['region', 'sector', 'title', 'src', 'exp', 'from'].some(k => st[k] >= 0);
      if (any) chips.push('<button type="button" class="vc-chip vc-chip--reset" data-clear="all">Барлық сүзгілерді тазалау</button>');
      $('activeChips').innerHTML = chips.join('');
    }

    function card(i) {
      const v = MK.vacancy(i);
      const tags = v.skills.map(k => `<li${k === st.skill ? ' class="is-hl"' : ''}><a href="${MK.link.skill(k)}">${MK.esc(D.skills[k])}</a></li>`).join('');
      return `
      <article class="job vc-job">
        <div class="vc-job__main">
          <div class="vc-job__top">
            ${srcBadge(v.source, v.sourceName)}
            <span class="job__meta">${MK.esc(v.date)}</span>
          </div>
          <h3><a href="${MK.link.vacancy(i)}">${MK.esc(v.titleName)}</a></h3>
          <p class="job__meta"><b class="vc-job__co">${MK.esc(v.company)}</b> · ${MK.esc(v.regionName)} · ${MK.esc(v.sectorName)} · Тәжірибе: ${MK.esc(v.expName)}</p>
          <ul class="job__tags">${tags}</ul>
        </div>
        <div class="vc-job__side">
          <p class="job__sal vc-job__sal">${money(v.salary)}<small>айына</small></p>
          <a class="btn btn--dark btn--sm" href="${MK.link.vacancy(i)}">Толығырақ <span>→</span></a>
          ${extLink(v.sourceUrl, `${MK.esc(v.sourceName)}-те ұқсас вакансиялар ↗`, 'vc-ext')}
        </div>
      </article>`;
    }

    function renderList() {
      const pages = Math.ceil(res.ids.length / PER_PAGE);
      const slice = res.ids.slice(st.page * PER_PAGE, (st.page + 1) * PER_PAGE);
      $('vacList').innerHTML = slice.length ? slice.map(card).join('')
        : `<div class="vc-empty"><h3>Вакансия табылмады</h3><p>Сүзгілерді өзгертіп немесе іздеу сөзін қысқартып көріңіз.</p>
           <button type="button" class="btn btn--pink btn--sm" data-clear="all">Сүзгілерді тазалау</button></div>`;
      $('pager').innerHTML = pages > 1 ? [
        `<button type="button" data-page="${st.page - 1}" ${st.page === 0 ? 'disabled' : ''} aria-label="Алдыңғы бет">←</button>`,
        ...pageList(st.page, pages).map(p => p === null ? '<span>…</span>'
          : `<button type="button" data-page="${p}"${p === st.page ? ' class="is-cur" aria-current="page"' : ''}>${p + 1}</button>`),
        `<button type="button" data-page="${st.page + 1}" ${st.page >= pages - 1 ? 'disabled' : ''} aria-label="Келесі бет">→</button>`,
      ].join('') : '';
    }

    // Оқиғалар
    for (const key of Object.keys(sel)) {
      sel[key].addEventListener('change', () => {
        st[key] = key === 'sort' ? sel.sort.value : +sel[key].value;
        run();
      });
    }
    let t = 0;
    $('fText').addEventListener('input', e => {
      clearTimeout(t);
      t = setTimeout(() => { st.text = e.target.value; run(); }, 250);
    });

    document.addEventListener('click', e => {
      const add = e.target.closest('[data-skill]');
      if (add) { st.skill = +add.dataset.skill; run(); return; }
      const clr = e.target.closest('[data-clear]');
      if (clr) {
        const what = clr.dataset.clear;
        if (what === 'skill' || what === 'all') st.skill = -1;
        if (what === 'text' || what === 'all') { st.text = ''; $('fText').value = ''; }
        if (what === 'all') for (const key of Object.keys(sel)) {
          if (key === 'sort') continue;
          st[key] = -1; sel[key].value = -1;
        }
        run();
        return;
      }
      const pg = e.target.closest('#pager [data-page]');
      if (pg && !pg.disabled) {
        st.page = +pg.dataset.page;
        renderList();
        document.querySelector('.vc-layout').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    run();
  }

  // ---------- vacancy.html ----------
  function initDetail() {
    const raw = MK.param('id');
    const id = raw !== null && /^\d+$/.test(raw) ? +raw : -1;
    const d = id >= 0 ? detail(id) : null;
    const hero = document.getElementById('heroBody'), body = document.getElementById('vacBody');

    if (!d) {
      document.getElementById('crumbTitle').textContent = 'Табылмады';
      hero.innerHTML = `<h1>Вакансия <span class="grad-text">табылмады</span></h1>
        <p class="fc-hero__lead">Сілтеме қате немесе мұндай вакансия базада жоқ. Барлық вакансиялар тізіміне оралып, қажеттісін табыңыз.</p>
        <p class="vc-hero__actions"><a class="btn btn--pink" href="vacancies.html">Вакансиялар тізіміне өту <span>→</span></a></p>`;
      return;
    }
    const { v } = d;
    document.title = `${v.titleName} — ${v.company} — Мансап Компасы`;
    document.getElementById('crumbTitle').textContent = v.titleName;

    hero.innerHTML = `
      <div class="vc-hero__top">${srcBadge(v.source, v.sourceName)}<span>${MK.esc(v.date)}</span><span>ID ${v.id}</span></div>
      <h1>${MK.esc(v.titleName)}</h1>
      <p class="vc-hero__meta"><b>${MK.esc(v.company)}</b><span>·</span>${MK.esc(v.regionName)}<span>·</span>${MK.esc(v.sectorName)}</p>
      <p class="vc-hero__actions">
        <a class="btn btn--pink" href="${MK.link.profession(v.title)}">Мамандық болжамын көру <span>→</span></a>
        ${extLink(v.sourceUrl, `${MK.esc(v.sourceName)}-те ұқсас вакансияларды ашу ↗`, 'btn vc-btn-ghost')}
      </p>`;

    const t = d.text;
    const li = arr => arr.map(x => `<li>${MK.esc(x)}</li>`).join('');
    const up = d.diff >= 0;
    const maxSal = Math.max(v.salary, d.avgSalary) || 1;

    const skills = d.skills.map(s => `
      <a class="vc-sk" href="${MK.link.skill(s.k)}">
        <b>${MK.esc(s.name)}</b>
        <span class="vc-sk__g ${s.growth >= 0 ? 'is-up' : 'is-down'}">2030 жылға болжам: ${growthTxt(s.growth)}</span>
        <span class="vc-sk__more">Дағды беті →</span>
      </a>`).join('');

    const similar = d.similar.map(s => `
      <article class="job">
        ${srcBadge(s.source, s.sourceName)}
        <h4><a href="${MK.link.vacancy(s.id)}">${MK.esc(s.titleName)}</a></h4>
        <p class="job__meta">${MK.esc(s.company)} · ${MK.esc(s.regionName)} · ${MK.esc(s.date)}</p>
        <p class="job__sal">${money(s.salary)}</p>
        <ul class="job__tags">${s.skills.map(k => `<li${v.skills.includes(k) ? ' class="is-hl"' : ''}>${MK.esc(D.skills[k])}</li>`).join('')}</ul>
      </article>`).join('');

    body.innerHTML = `
    <section class="vc-detail container">
      <div class="vc-detail__main">
        <div class="vc-facts">
          <div><span>Жалақы</span><b>${money(v.salary)}</b><small>айына, салық шегерілгенге дейін</small></div>
          <div><span>Тәжірибе</span><b>${MK.esc(v.expName)}</b></div>
          <div><span>Сала</span><b>${MK.esc(v.sectorName)}</b></div>
          <div><span>Өңір</span><b>${MK.esc(v.regionName)}</b></div>
        </div>

        <div class="panel-box vc-desc">
          <h2>Біз туралы</h2>
          <p>${MK.esc(t.about)}</p>
          <h2>Міндеттер</h2>
          <ul>${li(t.duties)}</ul>
          <h2>Талаптар</h2>
          <ul>${li(t.reqs)}</ul>
          <h2>Біз ұсынамыз</h2>
          <ul>${li(t.offer)}</ul>
          <p class="vc-desc__note">ⓘ Сипаттама демо деректер негізінде шаблон бойынша жасалған. Нақты вакансияларды дереккөздегі іздеу нәтижелерінен қараңыз.</p>
        </div>

        <div class="panel-box">
          <div class="panel-box__head">
            <h2>Талап етілетін дағдылар</h2>
            <p>Әр дағдыға сұраныстың 2030 жылға дейінгі болжамы (соңғы 12 аймен салыстырғанда). Дағдыны басып, толық болжамды қараңыз.</p>
          </div>
          <div class="vc-sks">${skills}</div>
        </div>
      </div>

      <aside class="vc-detail__side">
        <div class="skill-card">
          <p class="sc__label">Дереккөзде қарау</p>
          <p class="vc-side__txt">«${MK.esc(v.titleName)}» мамандығы бойынша нақты вакансияларды ашу:</p>
          <div class="vc-srcs">
            ${d.links.map((l, n) => extLink(l.url, `<i class="vc-dot vc-dot--${SRC_CLASS[n]}"></i>${MK.esc(l.name)} <span>↗</span>`, 'vc-srcbtn')).join('')}
          </div>
          <a class="btn btn--pink vc-side__btn" href="${MK.link.profession(v.title)}">Мамандық болжамын көру <span>→</span></a>
        </div>

        <div class="panel-box vc-cmp">
          <p class="sc__label vc-cmp__label">Жалақыны салыстыру</p>
          <p class="vc-cmp__diff ${up ? 'is-up' : 'is-down'}">${d.avgSalary ? growthTxt(d.diff) : '—'}</p>
          <p class="vc-cmp__sub">осы мамандықтың орташа жалақысымен салыстырғанда (соңғы 12 ай, ${MK.fmt(d.peers)} вакансия)</p>
          <div class="vc-cmp__rows">
            <div><span>Осы вакансия</span><b>${money(v.salary)}</b><i><em style="width:${(v.salary / maxSal * 100).toFixed(1)}%"></em></i></div>
            <div><span>Орташа: ${MK.esc(v.titleName)}</span><b>${d.avgSalary ? money(d.avgSalary) : '—'}</b><i><em class="is-avg" style="width:${(d.avgSalary / maxSal * 100).toFixed(1)}%"></em></i></div>
          </div>
        </div>

        <a class="vc-back" href="vacancies.html?title=${v.title}">← «${MK.esc(v.titleName)}» бойынша барлық вакансиялар</a>
      </aside>
    </section>

    <section class="container jobs-sec vc-similar">
      <h2 class="jobs-sec__title">Ұқсас вакансиялар</h2>
      ${similar ? `<div class="jobs">${similar}</div>` : '<p class="empty">Ұқсас вакансиялар табылмады.</p>'}
    </section>`;
  }

  if (typeof document !== 'undefined' && document.body) {
    const page = document.body.dataset.page;
    if (page === 'list') initList();
    else if (page === 'detail') initDetail();
  }

  return { query, pageList, detail, describe, skillGrowth };
})();
