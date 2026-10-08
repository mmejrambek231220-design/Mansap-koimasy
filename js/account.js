// ===== Жеке кабинет =====
// Рөлге сай мазмұн: жұмыс беруші — кадр қажеттілігі анкетасы, оқу орны — білім беру бағдарламасы,
// студент — мамандыққа дайындық (тек браузерде сақталады). API келісімі: server/server.js.
(() => {
  const D = window.MK_DATA;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => Number(n || 0).toLocaleString('ru-RU'); // мыңдықтар бос орынмен: 100 286
  const pct = (v, d = 0) => `${(v * 100).toFixed(d)}%`;
  // Браузерлер kk-KZ айларын дұрыс бермейді — өз атауларымыз
  const MONTHS = ['қаңтар', 'ақпан', 'наурыз', 'сәуір', 'мамыр', 'маусым', 'шілде', 'тамыз', 'қыркүйек', 'қазан', 'қараша', 'желтоқсан'];
  const date = s => {
    const d = s ? new Date(s) : null;
    return d && !Number.isNaN(+d) ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : '';
  };
  const byName = (a, b) => D.skills[a].localeCompare(D.skills[b], 'kk');

  const SIZE = { small: 'Шағын (50-ге дейін)', medium: 'Орта (50–250)', large: 'Ірі (250-ден көп)' };
  const SIZE_SHORT = { small: 'Шағын', medium: 'Орта', large: 'Ірі' };
  const TREND = { '-1': 'Азаяды', 0: 'Өзгермейді', 1: 'Артады' };
  const YEARS = ['2026', '2027', '2028', '2029', '2030'];
  const MIN_SKILLS = 3;

  // --- API (cookie сессиясы, бір origin) ---
  async function api(method, path, body) {
    try {
      const res = await fetch(path, {
        method, credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        const message = data.message || (res.status === 404 ? 'Бұл мүмкіндік серверде әлі қосылмаған.' : 'Қате орын алды. Кейінірек қайталаңыз.');
        return { ...data, ok: false, message };
      }
      return { ...data, ok: true };
    } catch {
      return { ok: false, message: 'Серверге қосылу мүмкін болмады.' };
    }
  }

  // --- Нарық көрсеткіштері (вакансиялар деректерінен, соңғы 12 ай мен оған дейінгі 12 ай) ---
  let M = null;
  function market() {
    if (M) return M;
    const nT = D.titles.length, nS = D.skills.length, last = D.meta.months;
    const cur = D.titles.map(() => new Float64Array(nS)), prev = D.titles.map(() => new Float64Array(nS));
    const nCur = new Float64Array(nT), nPrev = new Float64Array(nT), sal = D.titles.map(() => []);
    const allCur = new Float64Array(nS), allPrev = new Float64Array(nS);
    let tCur = 0, tPrev = 0;
    for (const r of D.v) {
      const m = r[0], t = r[3];
      if (m >= last - 12) {
        nCur[t]++; tCur++;
        if (r[5] > 0) sal[t].push(r[5]);
        for (const s of r[6]) { cur[t][s]++; allCur[s]++; }
      } else if (m >= last - 24) {
        nPrev[t]++; tPrev++;
        for (const s of r[6]) { prev[t][s]++; allPrev[s]++; }
      }
    }
    const growth = (a, b) => (b > 0 ? a / b - 1 : a > 0 ? 1 : 0);
    const median = sal.map(list => {
      if (!list.length) return 0;
      list.sort((a, b) => a - b);
      return list[Math.floor(list.length / 2)];
    });
    M = {
      share: (t, s) => (nCur[t] ? cur[t][s] / nCur[t] : 0),
      trend: (t, s) => growth(nCur[t] ? cur[t][s] / nCur[t] : 0, nPrev[t] ? prev[t][s] / nPrev[t] : 0),
      skillShare: s => (tCur ? allCur[s] / tCur : 0),
      skillTrend: s => growth(tCur ? allCur[s] / tCur : 0, tPrev ? allPrev[s] / tPrev : 0),
      median: t => median[t],
      // Мамандықтың ең көп сұралатын дағдылары (үлес бойынша кему ретімен)
      top: (t, k) => D.skills.map((_, s) => s).filter(s => cur[t][s] > 0)
        .sort((a, b) => cur[t][b] - cur[t][a]).slice(0, k),
    };
    return M;
  }

  // Тренд көрсеткісі: g — салыстырмалы өзгеріс (0.12 = +12%)
  function arrow(g) {
    if (!Number.isFinite(g)) return '';
    const v = Math.round(g * 100);
    if (v >= 3) return `<span class="ac-trend is-up" title="Соңғы 12 айдағы өзгеріс">↑ +${v}%</span>`;
    if (v <= -3) return `<span class="ac-trend is-down" title="Соңғы 12 айдағы өзгеріс">↓ ${v}%</span>`;
    return `<span class="ac-trend" title="Соңғы 12 айдағы өзгеріс">→ ${v > 0 ? '+' : ''}${v}%</span>`;
  }

  // Сақиналы көрсеткіш (0–100)
  function ring(value, label) {
    const v = Math.max(0, Math.min(100, Math.round(value || 0)));
    const c = 2 * Math.PI * 52;
    const tone = v >= 75 ? 'good' : v >= 50 ? 'mid' : 'low';
    return `<div class="ac-ring is-${tone}" role="img" aria-label="${esc(label)}: ${v}%">
      <svg viewBox="0 0 120 120"><circle class="ac-ring__track" cx="60" cy="60" r="52"/>
        <circle class="ac-ring__bar" cx="60" cy="60" r="52" stroke-dasharray="${(c * v / 100).toFixed(1)} ${c.toFixed(1)}"/></svg>
      <div class="ac-ring__val"><b>${v}<small>%</small></b><span>${esc(label)}</span></div></div>`;
  }

  const options = (names, value, placeholder) => (placeholder ? `<option value="">${placeholder}</option>` : '')
    + names.map((n, i) => `<option value="${i}"${String(value) === String(i) ? ' selected' : ''}>${esc(n)}</option>`).join('');

  // Мамандықтар тізімі салалар бойынша топталған
  const titleOptions = (value, placeholder) => `<option value="">${placeholder}</option>` + D.sectors.map((sec, si) =>
    `<optgroup label="${esc(sec)}">${D.titles.map((t, ti) => (D.titleSector[ti] === si
      ? `<option value="${ti}"${String(value) === String(ti) ? ' selected' : ''}>${esc(t)}</option>` : '')).join('')}</optgroup>`).join('');

  function flash(el, text, ok = false) {
    el.textContent = text;
    el.classList.toggle('is-ok', ok);
    el.hidden = !text;
  }

  // Екі рет басу арқылы жою (кездейсоқ басудан қорғау)
  function armDelete(btn, run) {
    if (btn.dataset.armed) { run(); return; }
    btn.dataset.armed = '1';
    const text = btn.textContent;
    btn.textContent = 'Растау — жою';
    btn.classList.add('is-armed');
    setTimeout(() => { delete btn.dataset.armed; btn.textContent = text; btn.classList.remove('is-armed'); }, 3000);
  }

  // --- Дағды чиптерін таңдау (іздеуі бар) ---
  // selected — Set; order() — көрсету реті; hint(s) — чиптегі қосымша мәтін; locked() — таңдауға болмайтындар
  function chipPicker(box, { selected, order, hint = () => '', locked = () => new Set(), onChange = () => {}, placeholder }) {
    box.classList.add('ac-picker');
    box.innerHTML = `<div class="ac-picker__top"><input type="search" class="ac-input ac-picker__q" placeholder="${placeholder || 'Дағдыны іздеу…'}" aria-label="Дағдыны іздеу">
      <span class="ac-picker__count"></span></div><div class="ac-chips ac-picker__chips"></div>`;
    const q = box.querySelector('.ac-picker__q'), list = box.querySelector('.ac-picker__chips'), count = box.querySelector('.ac-picker__count');
    function render() {
      const term = q.value.trim().toLowerCase(), lock = locked();
      const ids = order().filter(s => !term || D.skills[s].toLowerCase().includes(term));
      list.innerHTML = ids.map(s => {
        const on = selected.has(s), dis = lock.has(s);
        const h = hint(s);
        return `<button type="button" class="ac-chip${on ? ' is-on' : ''}" data-s="${s}" aria-pressed="${on}"${dis ? ' disabled title="Басқа тізімде таңдалған"' : ''}>
          ${on ? '✓ ' : ''}${esc(D.skills[s])}${h ? `<small>${h}</small>` : ''}</button>`;
      }).join('') || '<p class="ac-empty-line">Ештеңе табылмады.</p>';
      count.textContent = `Таңдалды: ${selected.size}`;
    }
    q.addEventListener('input', render);
    list.addEventListener('click', e => {
      const b = e.target.closest('.ac-chip');
      if (!b || b.disabled) return;
      const s = +b.dataset.s;
      if (selected.has(s)) selected.delete(s); else selected.add(s);
      render();
      onChange();
    });
    render();
    return { render };
  }

  // ===================== Кіру / бет басы =====================
  let USER = null, ORG = null, STATS = null;

  MKAuth.ready.then(user => {
    USER = user;
    if (!user) return renderGuest();
    renderHero();
    api('GET', '/api/surveys/stats').then(r => { STATS = r.ok ? r : null; renderStats(); });
    if (user.role === 'employer') initEmployer();
    else if (user.role === 'education') initEducation();
    else initStudent();
    renderHow();
  });

  function renderGuest() {
    $('acTitle').textContent = 'Жеке кабинет';
    $('acAvatar').hidden = true;
    document.querySelector('.ac-hero').classList.add('ac-hero--guest');
    $('acLead').textContent = 'Кабинетте жұмыс берушілер кадр қажеттілігі туралы анкета толтырады, оқу орындары бағдарламасын нарықпен салыстырады, ал студенттер мамандыққа дайындығын бағалайды.';
    $('acBody').innerHTML = `<div class="ac-guest">
      <div class="ac-guest__card">
        <svg class="ac-guest__icon" aria-hidden="true"><use href="#compass"/></svg>
        <h2>Кабинетті көру үшін аккаунтыңызға кіріңіз</h2>
        <p>Тіркелу бір минут алады. Жұмыс берушілер мен оқу орындарының жауаптары болжам моделіне қосымша дерек ретінде беріледі.</p>
        <div class="ac-guest__actions">
          <a class="btn btn--dark" href="login.html">Кіру <span>→</span></a>
          <a class="btn btn--ghost" href="login.html#register">Тіркелу</a>
        </div>
      </div>
      <ul class="ac-guest__roles">
        <li><b>Студенттерге</b><span>Мамандыққа дайындық пайызы және үйренуге тұрарлық дағдылар тізімі.</span></li>
        <li><b>Жұмыс берушілерге</b><span>Кадр қажеттілігі анкетасы және басқа компаниялармен анонимді салыстыру.</span></li>
        <li><b>Оқу орындарына</b><span>Білім беру бағдарламасының нарыққа сәйкестігі және жетіспейтін дағдылар.</span></li>
      </ul></div>`;
  }

  function renderHero() {
    const first = USER.fullName.split(/\s+/)[0];
    ORG = USER.organization || null;
    $('acAvatar').innerHTML = MKAuth.roleIcon(USER.role);
    $('acTitle').innerHTML = `Сәлем, <span class="grad-text">${esc(first)}</span>!`;
    const bits = [`<span class="ac-badge ac-badge--${esc(USER.role)}">${esc(MKAuth.ROLE_NAMES[USER.role] || '')}</span>`];
    if (ORG && ORG.name) bits.push(`<span class="ac-hero__org">${esc(ORG.name)}</span>`);
    if (ORG && D.sectors[ORG.sector] != null) bits.push(`<span>${esc(D.sectors[ORG.sector])}</span>`);
    if (ORG && D.regions[ORG.region] != null) bits.push(`<span>${esc(D.regions[ORG.region])}</span>`);
    const contact = USER.phone ? `+7 ${USER.phone.slice(2).replace(/(\d{3})(\d{3})(\d{2})(\d{2})/, '$1 $2 $3 $4')}` : USER.email;
    if (contact) bits.push(`<span class="ac-hero__mail">${esc(contact)}</span>`);
    $('acMeta').innerHTML = bits.join('<i aria-hidden="true">·</i>');
    $('acLead').textContent = {
      employer: 'Алдағы 1–3 жылдағы кадр қажеттілігіңізді бөлісіңіз: қай мамандарды жалдайсыз, қай дағдыларға сұраныс артады. Сіздің жауаптарыңыз вакансиялар моделімен біріктіріліп, 2030 жылғы болжамды нақтылайды.',
      education: 'Бағдарламаңызды енгізіп, оның еңбек нарығына қаншалықты сәйкес екенін көріңіз. Түлектер саны мен оқытылатын дағдылар болжамдағы ұсыныс жағын нақтылайды.',
      student: 'Мамандықты таңдап, білетін дағдыларыңызды белгілеңіз — жұмыс берушілер соңғы 12 айда ең көп сұраған дағдылар бойынша дайындығыңызды есептейміз.',
    }[USER.role] || '';
  }

  // «Сіздің үлесіңіз» жолағы
  let myStats = [];
  function renderStats() {
    const box = $('acStats');
    if (!USER) return;
    const items = [...myStats];
    if (STATS) {
      const real = STATS.real || {};
      items.push({
        v: num(STATS.employers), l: 'жұмыс беруші анкетасы',
        s: real.employers != null ? `оның ішінде ${num(real.employers)} — тіркелген компаниялардан` : 'болжамға қосылған',
      });
      items.push({
        v: num(STATS.programs), l: 'білім беру бағдарламасы',
        s: real.programs != null ? `оның ішінде ${num(real.programs)} — тіркелген оқу орындарынан` : 'болжамға қосылған',
      });
    }
    box.innerHTML = `<p class="ac-stats__title">Сіздің үлесіңіз</p>` + items.slice(0, 4).map((it, i) =>
      `<div class="ac-stat${i >= myStats.length ? ' ac-stat--community' : ''}"><b>${esc(it.v)}</b><span>${esc(it.l)}</span>${it.s ? `<small>${esc(it.s)}</small>` : ''}</div>`).join('');
    box.hidden = !items.length;
  }
  function setMyStats(list) { myStats = list; renderStats(); }

  function renderHow() {
    const first = {
      employer: ['Сіз анкета толтырасыз', 'Жалдау жоспары, дағдыларға сұраныс трендтері және табу қиын дағдылар.'],
      education: ['Сіз бағдарлама енгізесіз', 'Түлектер саны, жұмысқа орналасу деңгейі және оқытылатын дағдылар.'],
      student: ['Сіз дағдыларыңызды белгілейсіз', 'Деректер тек осы браузерде сақталады және серверге жіберілмейді.'],
    }[USER.role];
    const steps = [first,
      ['Вакансиялар моделімен біріктіріледі', '100 000-нан астам вакансиядағы тоқсандық сұраныс сериясына жұмыс берушілердің күтулері мен оқу орындарының ұсынысы қосылады.'],
      ['2030 жылғы болжам нақтыланады', 'Holt моделінің трендтері түзетіліп, «Дағдылар болжамы» мен мамандық беттерінде олқылықтар (сұраныс − ұсыныс) көрсетіледі.']];
    $('acHowSteps').innerHTML = steps.map(([h, p], i) => `<li><span class="ac-how__n">0${i + 1}</span><b>${esc(h)}</b><p>${esc(p)}</p></li>`).join('');
    $('acHow').hidden = false;
  }

  // ===================== ЖҰМЫС БЕРУШІ =====================
  function initEmployer() {
    $('acBody').innerHTML = `<div class="ac-grid">
      <div class="ac-main">
        <article class="ac-card" id="wizard">
          <header class="ac-card__head">
            <p class="eyebrow eyebrow--dark">Кадр қажеттілігі анкетасы</p>
            <h2 id="wzTitle">Алдағы жылдары кімді жалдайсыз?</h2>
            <p>4 қадам, шамамен 3 минут. Жауаптар компания бойынша жеке көрсетілмейді — тек салалық жинақталған түрде.</p>
          </header>
          <ol class="ac-steps" id="wzSteps"></ol>
          <div class="ac-step" id="wzBody"></div>
          <p class="ac-msg" id="wzMsg" role="alert" hidden></p>
          <footer class="ac-wz-foot">
            <button type="button" class="btn btn--ghost" id="wzBack">← Артқа</button>
            <span class="ac-wz-foot__hint" id="wzHint"></span>
            <button type="button" class="btn btn--dark" id="wzNext">Келесі <span>→</span></button>
          </footer>
        </article>
        <article class="ac-card" id="insights" hidden></article>
      </div>
      <aside class="ac-side">
        <div class="ac-card ac-card--soft">
          <header class="ac-card__head ac-card__head--sm"><h3>Менің анкеталарым</h3>
            <button type="button" class="ac-link" id="wzNew">＋ Жаңа анкета</button></header>
          <div id="surveyList" class="ac-list"><p class="ac-empty-line">Жүктелуде…</p></div>
        </div>
        <div class="ac-note">
          <b>Неге бұл маңызды?</b>
          <p>Вакансиялар өткенді көрсетеді, ал сіздің жоспарыңыз — болашақты. «Артады» деп белгіленген дағдылардың болжамы жоғары түзетіледі, «Табу қиын» белгісі олқылық талдауында ескеріледі.</p>
        </div>
      </aside></div>`;

    let surveys = [], step = 1, wz = blank();

    function blank() {
      return {
        id: null, sector: ORG && ORG.sector != null ? ORG.sector : '', region: ORG && ORG.region != null ? ORG.region : '',
        size: '', horizonYears: 0, hires: new Map(), skillList: [], skills: new Map(), salaries: new Map(), skillsSeeded: false,
      };
    }

    const STEPS = ['Компания', 'Жалдау жоспары', 'Дағдылар', 'Жалақы және жіберу'];
    const body = $('wzBody'), msg = $('wzMsg');

    function rated() { return [...wz.skills.values()].filter(v => v.trend != null).length; }

    function validate(n) {
      if (n === 1) {
        if (wz.sector === '' || wz.region === '') return 'Сала мен өңірді таңдаңыз.';
        if (!wz.size) return 'Компания көлемін таңдаңыз.';
        if (!wz.horizonYears) return 'Жоспарлау горизонтын таңдаңыз.';
      }
      if (n === 2 && ![...wz.hires.values()].some(c => c > 0)) return 'Кемінде бір мамандық пен адам санын көрсетіңіз.';
      if (n === 3 && rated() < MIN_SKILLS) return `Кемінде ${MIN_SKILLS} дағдыны бағалаңыз (қазір ${rated()}).`;
      if (n === 4) {
        for (const [t, s] of wz.salaries) {
          if (!wz.hires.get(t)) continue;
          if (Boolean(s.from) !== Boolean(s.to)) return `«${D.titles[t]}»: жалақының екі шегін де толтырыңыз немесе екеуін де бос қалдырыңыз.`;
          if (s.from && s.to && +s.from > +s.to) return `«${D.titles[t]}»: жалақының төменгі шегі жоғарғысынан үлкен.`;
        }
      }
      return '';
    }

    // Сала мен таңдалған мамандықтарға сай ұсынылатын ~15 дағды
    function seedSkills() {
      if (wz.skillsSeeded) return;
      const pick = [];
      const add = s => { if (!pick.includes(s)) pick.push(s); };
      wz.hires.forEach((_, t) => (D.titleSkills[t] || []).forEach(add));
      D.skills.forEach((_, s) => { if ((D.skillSectors[s] || []).includes(+wz.sector)) add(s); });
      [27, 42, 12, 45, 43, 44].forEach(add);
      wz.skillList = pick.slice(0, 15);
      wz.skillsSeeded = true;
    }

    function renderSteps() {
      $('wzSteps').innerHTML = STEPS.map((name, i) => {
        const n = i + 1, state = n === step ? 'is-current' : n < step ? 'is-done' : '';
        return `<li class="${state}"><button type="button" data-step="${n}"${n > step ? ' disabled' : ''}>
          <span class="ac-steps__n">${n < step ? '✓' : n}</span><span>${name}</span></button></li>`;
      }).join('');
    }

    function renderStep() {
      renderSteps();
      flash(msg, '');
      $('wzBack').hidden = step === 1;
      $('wzNext').innerHTML = step === 4 ? (wz.id ? 'Өзгерістерді сақтау' : 'Анкетаны жіберу') + ' <span>→</span>' : 'Келесі <span>→</span>';
      $('wzTitle').textContent = wz.id ? 'Анкетаны өңдеу' : 'Алдағы жылдары кімді жалдайсыз?';
      $('wzHint').textContent = step === 3 ? `Бағаланды: ${rated()} · кемінде ${MIN_SKILLS}` : `${step}-қадам / 4`;
      body.innerHTML = [null, step1, step2, step3, step4][step]();
    }

    const seg = (key, opts, value) => `<div class="ac-seg" role="radiogroup">${opts.map(([v, l]) =>
      `<button type="button" role="radio" aria-checked="${String(value) === String(v)}" class="${String(value) === String(v) ? 'is-on' : ''}" data-act="seg" data-key="${key}" data-v="${v}">${l}</button>`).join('')}</div>`;

    function step1() {
      return `<div class="ac-form-grid">
        <label class="ac-field"><span>Сала</span><select class="ac-select" data-key="sector">${options(D.sectors, wz.sector, 'Таңдаңыз')}</select></label>
        <label class="ac-field"><span>Өңір</span><select class="ac-select" data-key="region">${options(D.regions, wz.region, 'Таңдаңыз')}</select></label>
      </div>
      <div class="ac-field"><span>Компания көлемі</span>${seg('size', Object.entries(SIZE), wz.size)}</div>
      <div class="ac-field"><span>Жоспарлау горизонты</span>${seg('horizonYears', [[1, '1 жыл'], [2, '2 жыл'], [3, '3 жыл']], wz.horizonYears)}
        <small class="ac-help">Қанша жыл алға жоспарлайсыз — сол кезеңнің болжамына салмақ беріледі.</small></div>`;
    }

    function step2() {
      const sec = +wz.sector;
      const own = D.titles.map((_, t) => t).filter(t => D.titleSector[t] === sec);
      const others = D.titles.map((_, t) => t).filter(t => D.titleSector[t] !== sec && !wz.hires.has(t));
      const rows = [...wz.hires.entries()].map(([t, c]) => `<li class="ac-hire">
          <div><b>${esc(D.titles[t])}</b><small>${esc(D.sectors[D.titleSector[t]])}</small></div>
          <div class="ac-stepper"><button type="button" data-act="dec" data-t="${t}" aria-label="Азайту">−</button>
            <input type="number" min="1" max="10000" value="${c}" data-key="hire" data-t="${t}" aria-label="Адам саны">
            <button type="button" data-act="inc" data-t="${t}" aria-label="Көбейту">+</button></div>
          <button type="button" class="ac-x" data-act="hire-del" data-t="${t}" aria-label="Өшіру">×</button></li>`).join('');
      return `<div class="ac-field"><span>${esc(D.sectors[sec])} саласының мамандықтары</span>
        <div class="ac-chips">${own.map(t => `<button type="button" class="ac-chip${wz.hires.has(t) ? ' is-on' : ''}" data-act="hire-toggle" data-t="${t}">${wz.hires.has(t) ? '✓ ' : '＋ '}${esc(D.titles[t])}</button>`).join('')}</div></div>
        <label class="ac-field"><span>Басқа саладан қосу</span>
          <select class="ac-select" data-key="hire-add"><option value="">Мамандықты таңдаңыз…</option>${others.map(t => `<option value="${t}">${esc(D.titles[t])} — ${esc(D.sectors[D.titleSector[t]])}</option>`).join('')}</select></label>
        <div class="ac-field"><span>Жалдау жоспары (${wz.horizonYears} жылда, адам)</span>
          ${rows ? `<ul class="ac-hires">${rows}</ul>` : '<p class="ac-empty-line">Жоғарыдан мамандықты таңдаңыз.</p>'}</div>`;
    }

    function step3() {
      seedSkills();
      const m = market();
      const rows = wz.skillList.map(s => {
        const a = wz.skills.get(s) || { trend: null, hardToFind: false };
        return `<li class="ac-rate${a.trend != null ? ' is-rated' : ''}">
          <div class="ac-rate__name"><b>${esc(D.skills[s])}</b><small>Вакансияларда ${pct(m.skillShare(s), 1)} ${arrow(m.skillTrend(s))}</small></div>
          ${seg(`trend-${s}`, [[-1, '↓ Азаяды'], [0, 'Өзгермейді'], [1, '↑ Артады']], a.trend == null ? '' : a.trend)}
          <label class="ac-switch" title="Бұл дағдысы бар маманды табу қиын"><input type="checkbox" data-act="hard" data-s="${s}"${a.hardToFind ? ' checked' : ''}><i></i><span>Табу қиын</span></label>
          <button type="button" class="ac-x" data-act="skill-del" data-s="${s}" aria-label="Тізімнен алып тастау">×</button></li>`;
      }).join('');
      return `<p class="ac-help ac-help--lead">Алдағы ${wz.horizonYears} жылда компанияңызда осы дағдыларға қажеттілік қалай өзгереді? Білмейтін дағдыны бос қалдырыңыз — тек бағаланғандары жіберіледі.</p>
        <div class="ac-add">
          <input type="search" class="ac-input" id="skillQ" placeholder="Басқа дағдыны қосу: мысалы, Power BI…" autocomplete="off" aria-label="Дағды іздеу">
          <div class="ac-add__pop" id="skillPop" hidden></div>
        </div>
        <ul class="ac-rates">${rows}</ul>`;
    }

    function step4() {
      const m = market();
      const hires = [...wz.hires.entries()].filter(([, c]) => c > 0);
      const rows = hires.map(([t]) => {
        const s = wz.salaries.get(t) || {}, med = m.median(t);
        return `<li class="ac-sal"><div><b>${esc(D.titles[t])}</b><small>Нарық медианасы: ${med ? `${num(med)} мың ₸` : 'дерек жоқ'}</small></div>
          <label><span>бастап</span><input type="number" class="ac-input" min="0" step="10" value="${s.from ?? ''}" data-key="sal-from" data-t="${t}" placeholder="${med ? Math.round(med * 0.85) : ''}"></label>
          <label><span>дейін</span><input type="number" class="ac-input" min="0" step="10" value="${s.to ?? ''}" data-key="sal-to" data-t="${t}" placeholder="${med ? Math.round(med * 1.2) : ''}"></label>
          <em>мың ₸</em></li>`;
      }).join('');
      const vals = [...wz.skills.values()].filter(v => v.trend != null);
      const people = hires.reduce((a, [, c]) => a + c, 0);
      return `<div class="ac-field"><span>Жоспарланған жалақы (міндетті емес)</span>
          <ul class="ac-sals">${rows}</ul></div>
        <div class="ac-review">
          <p class="ac-review__title">Жіберу алдында тексеріңіз</p>
          <dl>
            <div><dt>Компания</dt><dd>${esc(D.sectors[wz.sector])} · ${esc(D.regions[wz.region])} · ${esc(SIZE_SHORT[wz.size])}</dd></div>
            <div><dt>Горизонт</dt><dd>${wz.horizonYears} жыл</dd></div>
            <div><dt>Жалдау</dt><dd>${hires.length} мамандық, барлығы ${num(people)} адам</dd></div>
            <div><dt>Дағдылар</dt><dd>${vals.length} бағаланды: ↑ ${vals.filter(v => v.trend === 1).length} · → ${vals.filter(v => v.trend === 0).length} · ↓ ${vals.filter(v => v.trend === -1).length} · табу қиын ${vals.filter(v => v.hardToFind).length}</dd></div>
          </dl>
        </div>`;
    }

    function skillPop() {
      const q = $('skillQ'), pop = $('skillPop');
      const term = q.value.trim().toLowerCase();
      if (!term) { pop.hidden = true; return; }
      const found = D.skills.map((_, s) => s).filter(s => !wz.skillList.includes(s) && D.skills[s].toLowerCase().includes(term)).slice(0, 8);
      pop.innerHTML = found.length ? found.map(s => `<button type="button" data-act="skill-add" data-s="${s}">＋ ${esc(D.skills[s])}</button>`).join('')
        : '<p class="ac-empty-line">Табылмады немесе тізімде бар.</p>';
      pop.hidden = false;
    }

    body.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b || b.tagName === 'INPUT') return;
      const t = +b.dataset.t, s = +b.dataset.s;
      switch (b.dataset.act) {
        case 'seg': {
          // Сегменттер орнында жаңарады — фокус пен айналдыру сақталады
          const key = b.dataset.key;
          let value = b.dataset.v;
          if (key.startsWith('trend-')) {
            const id = +key.slice(6), a = wz.skills.get(id) || { trend: null, hardToFind: false };
            a.trend = a.trend === +value ? null : +value; // қайта басу — бағаны алып тастау
            wz.skills.set(id, a);
            value = a.trend == null ? '' : String(a.trend);
            b.closest('.ac-rate').classList.toggle('is-rated', a.trend != null);
            $('wzHint').textContent = `Бағаланды: ${rated()} · кемінде ${MIN_SKILLS}`;
          } else wz[key] = key === 'horizonYears' ? +value : value;
          b.parentElement.querySelectorAll('button').forEach(x => {
            const on = x.dataset.v === value;
            x.classList.toggle('is-on', on);
            x.setAttribute('aria-checked', String(on));
          });
          return;
        }
        case 'hire-toggle': if (wz.hires.has(t)) wz.hires.delete(t); else wz.hires.set(t, 1); wz.skillsSeeded = false; break;
        case 'hire-del': wz.hires.delete(t); wz.salaries.delete(t); break;
        case 'inc': wz.hires.set(t, Math.min(10000, (wz.hires.get(t) || 0) + 1)); break;
        case 'dec': wz.hires.set(t, Math.max(1, (wz.hires.get(t) || 1) - 1)); break;
        case 'skill-del': wz.skillList = wz.skillList.filter(x => x !== s); wz.skills.delete(s); break;
        case 'skill-add': wz.skillList.unshift(s); break;
        default: return;
      }
      const y = window.scrollY;
      renderStep();
      window.scrollTo(0, y);
    });

    body.addEventListener('change', e => {
      const el = e.target, key = el.dataset.key;
      if (el.dataset.act === 'hard') {
        const s = +el.dataset.s, a = wz.skills.get(s) || { trend: null, hardToFind: false };
        a.hardToFind = el.checked;
        wz.skills.set(s, a);
        return;
      }
      if (key === 'sector') { wz.sector = el.value === '' ? '' : +el.value; wz.skillsSeeded = false; }
      if (key === 'region') wz.region = el.value === '' ? '' : +el.value;
      if (key === 'hire-add' && el.value !== '') { wz.hires.set(+el.value, 1); wz.skillsSeeded = false; renderStep(); }
    });

    body.addEventListener('input', e => {
      const el = e.target, key = el.dataset.key, t = +el.dataset.t;
      if (el.id === 'skillQ') return skillPop();
      if (key === 'hire') wz.hires.set(t, Math.max(0, Math.min(10000, Math.round(+el.value || 0))));
      if (key === 'sal-from' || key === 'sal-to') {
        const s = wz.salaries.get(t) || {};
        s[key === 'sal-from' ? 'from' : 'to'] = el.value === '' ? null : Math.max(0, +el.value);
        wz.salaries.set(t, s);
      }
    });

    $('wzSteps').addEventListener('click', e => {
      const b = e.target.closest('[data-step]');
      if (b && !b.disabled) { step = +b.dataset.step; renderStep(); }
    });
    $('wzBack').addEventListener('click', () => { step = Math.max(1, step - 1); renderStep(); });
    $('wzNext').addEventListener('click', async () => {
      const err = validate(step);
      if (err) return flash(msg, err);
      if (step < 4) { step++; renderStep(); $('wizard').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      await submit();
    });
    $('wzNew').addEventListener('click', () => { wz = blank(); step = 1; renderStep(); $('wizard').scrollIntoView({ behavior: 'smooth' }); });

    function payload() {
      const hires = [...wz.hires.entries()].filter(([, c]) => c > 0);
      const body = {
        sector: +wz.sector, region: +wz.region, size: wz.size, horizonYears: wz.horizonYears,
        hires: hires.map(([title, count]) => ({ title, count })),
        skills: wz.skillList.filter(s => wz.skills.get(s) && wz.skills.get(s).trend != null)
          .map(s => ({ skill: s, trend: wz.skills.get(s).trend, hardToFind: Boolean(wz.skills.get(s).hardToFind) })),
        salaries: hires.map(([title]) => ({ title, ...(wz.salaries.get(title) || {}) }))
          .filter(x => x.from > 0 && x.to > 0).map(x => ({ title: x.title, from: Math.round(x.from), to: Math.round(x.to) })),
      };
      if (wz.id != null) body.id = wz.id;
      return body;
    }

    async function submit() {
      const btn = $('wzNext');
      btn.disabled = true;
      const res = await api('POST', '/api/surveys/employer', payload());
      btn.disabled = false;
      if (!res.ok) return flash(msg, res.message);
      const id = res.id ?? wz.id;
      const edited = wz.id != null;
      wz = blank(); step = 1;
      renderStep();
      flash(msg, edited ? 'Анкета жаңартылды. Рақмет!' : 'Анкета қабылданды. Рақмет — жауаптарыңыз келесі болжам есебіне қосылады.', true);
      await loadMine();
      const sv = surveys.find(x => String(x.id) === String(id));
      if (sv) showInsights(sv, true);
      api('GET', '/api/surveys/stats').then(r => { if (r.ok) { STATS = r; renderStats(); } });
    }

    function edit(sv) {
      wz = blank();
      Object.assign(wz, { id: sv.id, sector: sv.sector, region: sv.region, size: sv.size, horizonYears: sv.horizonYears, skillsSeeded: true });
      (sv.hires || []).forEach(h => wz.hires.set(+h.title, +h.count));
      (sv.skills || []).forEach(k => { wz.skills.set(+k.skill, { trend: +k.trend, hardToFind: Boolean(k.hardToFind) }); wz.skillList.push(+k.skill); });
      (sv.salaries || []).forEach(x => wz.salaries.set(+x.title, { from: x.from, to: x.to }));
      step = 1;
      renderStep();
      $('wizard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    async function loadMine() {
      const res = await api('GET', '/api/surveys/mine');
      const list = $('surveyList');
      if (!res.ok) {
        list.innerHTML = `<p class="ac-empty-line">${esc(res.message)}</p>`;
        setMyStats([{ v: '0', l: 'жіберілген анкета' }, { v: '0', l: 'бағаланған дағды' }]);
        return;
      }
      if (res.organization) ORG = res.organization;
      surveys = res.employerSurveys || [];
      const skillsRated = surveys.reduce((a, s) => a + (s.skills || []).length, 0);
      const distinct = new Set(surveys.flatMap(s => (s.skills || []).map(k => k.skill))).size;
      setMyStats([
        { v: num(surveys.length), l: 'жіберілген анкета', s: surveys.length ? `соңғысы: ${date(surveys[0].updatedAt)}` : 'алғашқысын толтырыңыз' },
        { v: num(skillsRated), l: 'дағды бағасы', s: `${distinct} түрлі дағдының болжамына әсер етеді` },
      ]);
      list.innerHTML = surveys.length ? surveys.map(sv => {
        const people = (sv.hires || []).reduce((a, h) => a + (+h.count || 0), 0);
        return `<div class="ac-item" data-id="${esc(sv.id)}">
          <div class="ac-item__top"><b>${esc(D.sectors[sv.sector] || '—')}</b><span>${esc(D.regions[sv.region] || '')}</span></div>
          <p>${esc(SIZE_SHORT[sv.size] || '')} компания · ${sv.horizonYears} жыл · ${num(people)} адам · ${(sv.skills || []).length} дағды</p>
          <small>${date(sv.updatedAt)}</small>
          <div class="ac-item__actions">
            <button type="button" data-act="cmp">Салыстыру</button>
            <button type="button" data-act="edit">Өңдеу</button>
            <button type="button" data-act="del" class="is-danger">Жою</button></div></div>`;
      }).join('') : '<p class="ac-empty-line">Әзірге анкета жоқ. Сол жақтағы форманы толтырыңыз — 3 минут.</p>';
    }

    $('surveyList').addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const sv = surveys.find(x => String(x.id) === b.closest('.ac-item').dataset.id);
      if (!sv) return;
      if (b.dataset.act === 'edit') edit(sv);
      if (b.dataset.act === 'cmp') showInsights(sv, true);
      if (b.dataset.act === 'del') armDelete(b, async () => {
        const res = await api('DELETE', `/api/surveys/employer/${encodeURIComponent(sv.id)}`);
        if (!res.ok) { b.textContent = 'Қате'; return; }
        if (String(wz.id) === String(sv.id)) { wz = blank(); step = 1; renderStep(); }
        $('insights').hidden = true;
        await loadMine();
        api('GET', '/api/surveys/stats').then(r => { if (r.ok) { STATS = r; renderStats(); } });
      });
    });

    // «Нарықпен салыстыру» — басқа жұмыс берушілердің анонимді жауаптары
    async function showInsights(sv, scroll) {
      const box = $('insights');
      box.hidden = false;
      box.innerHTML = '<p class="ac-empty-line">Салыстыру жүктелуде…</p>';
      if (scroll) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const res = await api('GET', `/api/insights/employer?sector=${encodeURIComponent(sv.sector)}`);
      const peers = new Map((res.ok ? res.skills || [] : []).map(k => [+k.skill, k]));
      const mine = sv.skills || [];
      const rows = mine.map(k => {
        const p = peers.get(+k.skill);
        const tot = p ? (+p.up || 0) + (+p.same || 0) + (+p.down || 0) : 0;
        const w = v => (tot ? (v || 0) / tot * 100 : 0);
        const bar = tot ? `<div class="ac-stack" title="Азаяды ${Math.round(w(p.down))}% · Өзгермейді ${Math.round(w(p.same))}% · Артады ${Math.round(w(p.up))}%">
            <i class="is-down" style="width:${w(p.down)}%"></i><i class="is-same" style="width:${w(p.same)}%"></i><i class="is-up" style="width:${w(p.up)}%"></i></div>
            <span class="ac-stack__lbl"><b>${Math.round(w(p.up))}%</b> артады · ${Math.round(w(p.down))}% азаяды</span>`
          : '<span class="ac-stack__none">Әзірге басқа жауап жоқ</span>';
        const t = String(+k.trend);
        return `<li class="ac-cmp">
          <b class="ac-cmp__name">${esc(D.skills[k.skill])}${k.hardToFind ? '<em class="ac-tag">табу қиын</em>' : ''}</b>
          <span class="ac-answer is-${t === '1' ? 'up' : t === '-1' ? 'down' : 'same'}">${t === '1' ? '↑' : t === '-1' ? '↓' : '→'} ${TREND[t]}</span>
          <div class="ac-cmp__bar">${bar}</div></li>`;
      }).join('');
      const hires = res.ok && res.hires && res.hires.length ? `<div class="ac-peer-hires"><p class="ac-review__title">Салада ең көп жоспарланған жалдау</p>
        <ol>${res.hires.slice(0, 5).map(h => `<li><span>${esc(D.titles[h.title] || '—')}</span><b>${num(h.count)} адам</b></li>`).join('')}</ol></div>` : '';
      box.innerHTML = `<header class="ac-card__head">
          <p class="eyebrow eyebrow--dark">Нарықпен салыстыру</p>
          <h2>Сіздің бағаңыз және ${esc(D.sectors[sv.sector] || '')} саласындағы басқа компаниялар</h2>
          <p>${res.ok ? `${num(res.n || 0)} компанияның анонимді жауаптары негізінде.` : esc(res.message)} Жеке компаниялардың жауаптары көрсетілмейді.</p>
        </header>
        <div class="ac-impact"><b>${mine.length}</b><p>Сіздің жауабыңыз <strong>${mine.length} дағдының</strong> болжамына әсер етеді. ${esc(D.sectors[sv.sector] || '')} саласы бойынша ${sv.horizonYears} жылдық трендке салмақ ретінде қосылады.</p></div>
        <div class="ac-legend"><span><i class="is-down"></i>Азаяды</span><span><i class="is-same"></i>Өзгермейді</span><span><i class="is-up"></i>Артады</span></div>
        <ul class="ac-cmps">${rows}</ul>${hires}`;
    }

    renderStep();
    loadMine();
  }

  // ===================== ОҚУ ОРНЫ =====================
  function initEducation() {
    $('acBody').innerHTML = `<div class="ac-grid">
      <div class="ac-main">
        <article class="ac-card" id="progCard">
          <header class="ac-card__head">
            <p class="eyebrow eyebrow--dark">Білім беру бағдарламасы</p>
            <h2 id="pfTitle">Бағдарламаны қосу</h2>
            <p>Бағдарлама қандай маманды дайындайды, қанша түлек шығады және қандай дағдылар оқытылады — осы деректер бойынша нарыққа сәйкестікті есептейміз.</p>
          </header>
          <form id="progForm" class="ac-form" novalidate>
            <div class="ac-form-grid">
              <label class="ac-field"><span>Мамандық</span><select class="ac-select" name="title"></select></label>
              <label class="ac-field"><span>Бағдарлама атауы</span><input class="ac-input" name="name" maxlength="150" placeholder="Мысалы: 6B06101 — Ақпараттық жүйелер"></label>
            </div>
            <div class="ac-field"><span>Болжамды түлектер саны</span>
              <div class="ac-years">${YEARS.map(y => `<label><small>${y}</small><input class="ac-input" type="number" min="0" max="100000" name="g${y}" placeholder="0"></label>`).join('')}</div></div>
            <div class="ac-field"><span>Түлектердің жұмысқа орналасу деңгейі</span>
              <div class="ac-range"><input type="range" min="0" max="100" step="1" name="employmentRate" value="70"><output id="pfRate">70%</output></div></div>
            <div class="ac-field"><span>Оқытылатын дағдылар <em class="ac-req">кемінде ${MIN_SKILLS}</em></span>
              <small class="ac-help">Пайыз — таңдалған мамандықтың соңғы 12 айдағы вакансияларында дағды кездесетін үлес.</small>
              <div id="pfSkills"></div></div>
            <div class="ac-field"><span>Жоспарланған жаңа дағдылар <em class="ac-opt">міндетті емес</em></span>
              <small class="ac-help">Алдағы 1–2 жылда бағдарламаға енгізуді жоспарлап отырған дағдылар.</small>
              <div id="pfPlanned"></div></div>
            <p class="ac-msg" id="pfMsg" role="alert" hidden></p>
            <div class="ac-form-foot">
              <button type="button" class="btn btn--ghost" id="pfCancel" hidden>Болдырмау</button>
              <button type="submit" class="btn btn--dark" id="pfSubmit">Бағдарламаны сақтау <span>→</span></button>
            </div>
          </form>
        </article>
      </div>
      <aside class="ac-side">
        <div class="ac-card ac-card--soft">
          <header class="ac-card__head ac-card__head--sm"><h3>Менің бағдарламаларым</h3></header>
          <div id="progMini" class="ac-list"><p class="ac-empty-line">Жүктелуде…</p></div>
        </div>
        <div class="ac-note">
          <b>Сәйкестік қалай есептеледі?</b>
          <p>Мамандық вакансияларында ең көп сұралатын дағдылар бағдарламадағы дағдылармен салыстырылады, сұраныс үлесі бойынша салмақталады. Түлектер саны болжамдағы ұсыныс жағына қосылады.</p>
        </div>
      </aside></div>
      <div id="progList" class="ac-progs"></div>`;

    const form = $('progForm'), F = form.elements, m = market();
    let programs = [], editId = null;
    const taught = new Set(), planned = new Set();
    F.title.innerHTML = titleOptions('', 'Мамандықты таңдаңыз');

    // Таңдалған мамандықтағы сұраныс бойынша сұрыптау
    const order = () => {
      const t = F.title.value === '' ? null : +F.title.value;
      const ids = D.skills.map((_, s) => s);
      return t == null ? ids.sort(byName) : ids.sort((a, b) => m.share(t, b) - m.share(t, a) || byName(a, b));
    };
    const hint = s => (F.title.value === '' ? '' : pct(m.share(+F.title.value, s)));
    const pTaught = chipPicker($('pfSkills'), { selected: taught, order, hint, locked: () => planned, onChange: () => pPlanned.render() });
    const pPlanned = chipPicker($('pfPlanned'), { selected: planned, order, hint, locked: () => taught, onChange: () => pTaught.render(), placeholder: 'Жоспарланған дағдыны іздеу…' });

    F.title.addEventListener('change', () => { pTaught.render(); pPlanned.render(); });
    F.employmentRate.addEventListener('input', () => { $('pfRate').textContent = `${F.employmentRate.value}%`; });

    function reset() {
      form.reset();
      editId = null;
      taught.clear(); planned.clear();
      $('pfRate').textContent = `${F.employmentRate.value}%`;
      $('pfTitle').textContent = 'Бағдарламаны қосу';
      $('pfCancel').hidden = true;
      $('pfSubmit').innerHTML = 'Бағдарламаны сақтау <span>→</span>';
      pTaught.render(); pPlanned.render();
    }
    $('pfCancel').addEventListener('click', () => { reset(); flash($('pfMsg'), ''); });

    function edit(p) {
      reset();
      editId = p.id;
      F.title.value = p.title;
      F.name.value = p.name || '';
      YEARS.forEach(y => { F[`g${y}`].value = (p.graduates || {})[y] ?? ''; });
      F.employmentRate.value = p.employmentRate ?? 70;
      $('pfRate').textContent = `${F.employmentRate.value}%`;
      (p.skills || []).forEach(s => taught.add(+s));
      (p.plannedSkills || []).forEach(s => planned.add(+s));
      $('pfTitle').textContent = 'Бағдарламаны өңдеу';
      $('pfCancel').hidden = false;
      $('pfSubmit').innerHTML = 'Өзгерістерді сақтау <span>→</span>';
      pTaught.render(); pPlanned.render();
      $('progCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const msg = $('pfMsg');
      if (F.title.value === '') return flash(msg, 'Мамандықты таңдаңыз.');
      if (F.name.value.trim().length < 2) { F.name.focus(); return flash(msg, 'Бағдарлама атауын жазыңыз.'); }
      if (taught.size < MIN_SKILLS) return flash(msg, `Кемінде ${MIN_SKILLS} оқытылатын дағдыны таңдаңыз (қазір ${taught.size}).`);
      const graduates = {};
      for (const y of YEARS) {
        const v = F[`g${y}`].value;
        if (v !== '' && (+v < 0 || !Number.isFinite(+v))) return flash(msg, `${y} жылғы түлектер саны дұрыс емес.`);
        graduates[y] = Math.round(+v || 0);
      }
      const body = {
        title: +F.title.value, name: F.name.value.trim(), graduates, employmentRate: +F.employmentRate.value,
        skills: [...taught], plannedSkills: [...planned],
      };
      if (editId != null) body.id = editId;
      const btn = $('pfSubmit');
      btn.disabled = true;
      const res = await api('POST', '/api/programs', body);
      btn.disabled = false;
      if (!res.ok) return flash(msg, res.message);
      const id = res.id ?? editId;
      reset();
      flash(msg, 'Бағдарлама сақталды. Төменде оның нарыққа сәйкестігін қараңыз.', true);
      await load();
      const card = document.querySelector(`.ac-prog[data-id="${CSS.escape(String(id))}"]`);
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      api('GET', '/api/surveys/stats').then(r => { if (r.ok) { STATS = r; renderStats(); } });
    });

    async function load() {
      const res = await api('GET', '/api/surveys/mine');
      if (!res.ok) {
        $('progMini').innerHTML = `<p class="ac-empty-line">${esc(res.message)}</p>`;
        $('progList').innerHTML = '';
        setMyStats([{ v: '0', l: 'бағдарлама' }, { v: '0', l: 'оқытылатын дағды' }]);
        return;
      }
      programs = res.programs || [];
      const grads = programs.reduce((a, p) => a + YEARS.reduce((b, y) => b + (+(p.graduates || {})[y] || 0), 0), 0);
      const distinct = new Set(programs.flatMap(p => p.skills || [])).size;
      setMyStats([
        { v: num(programs.length), l: 'енгізілген бағдарлама', s: `2026–2030 жж. ${num(grads)} түлек` },
        { v: num(distinct), l: 'оқытылатын дағды', s: 'болжамның ұсыныс жағына қосылады' },
      ]);
      $('progMini').innerHTML = programs.length ? programs.map(p => `<div class="ac-item" data-id="${esc(p.id)}">
          <div class="ac-item__top"><b>${esc(p.name)}</b></div>
          <p>${esc(D.titles[p.title] || '—')} · ${(p.skills || []).length} дағды</p>
          <small>${date(p.updatedAt)}</small>
          <div class="ac-item__actions"><button type="button" data-act="go">Сәйкестік</button>
            <button type="button" data-act="edit">Өңдеу</button><button type="button" data-act="del" class="is-danger">Жою</button></div></div>`).join('')
        : '<p class="ac-empty-line">Әзірге бағдарлама жоқ. Сол жақтағы форманы толтырыңыз.</p>';
      $('progList').innerHTML = programs.length ? `<div class="ac-progs__head"><p class="eyebrow eyebrow--dark">Нарыққа сәйкестік</p>
        <h2>Бағдарламаларыңыз еңбек нарығымен салыстырғанда</h2></div>` + programs.map(progCard).join('') : '';
      programs.forEach(loadFit);
    }

    function progCard(p) {
      const g = YEARS.map(y => +(p.graduates || {})[y] || 0), max = Math.max(1, ...g);
      return `<article class="ac-prog" data-id="${esc(p.id)}">
        <header class="ac-prog__head">
          <div><p class="ac-prog__title">${esc(D.titles[p.title] || '—')}</p><h3>${esc(p.name)}</h3>
            <small>Жаңартылды: ${date(p.updatedAt)} · жұмысқа орналасу ${Math.round(+p.employmentRate || 0)}%</small></div>
          <div class="ac-item__actions"><a href="profession.html?id=${+p.title}">Мамандық болжамы →</a>
            <button type="button" data-act="edit">Өңдеу</button><button type="button" data-act="del" class="is-danger">Жою</button></div>
        </header>
        <div class="ac-prog__grid">
          <div class="ac-prog__fit" data-slot="ring">${ring(0, 'сәйкестік')}</div>
          <div><p class="ac-review__title">Жетіспейтін дағдылар <small>вакансия үлесі · жұмыс берушілер бағасы</small></p><ul class="ac-skl" data-slot="missing"><li class="ac-empty-line">Жүктелуде…</li></ul></div>
          <div><p class="ac-review__title">Маңызы азайып бара жатқандар</p><ul class="ac-skl" data-slot="outdated"><li class="ac-empty-line">Жүктелуде…</li></ul></div>
          <div class="ac-grads"><p class="ac-review__title">Түлектер</p>
            <div class="ac-grads__bars">${g.map((v, i) => `<span title="${YEARS[i]}: ${num(v)}"><i style="height:${Math.round(v / max * 100)}%"></i><b>${num(v)}</b><small>${YEARS[i].slice(2)}</small></span>`).join('')}</div></div>
        </div>
        <div class="ac-prog__covered"><p class="ac-review__title">Нарық сұранысын жабатын дағдылар</p><div class="ac-chips" data-slot="covered"></div>
          ${(p.plannedSkills || []).length ? `<p class="ac-review__title">Жоспарланған</p><div class="ac-chips">${p.plannedSkills.map(s => `<span class="ac-chip is-plan">${esc(D.skills[s])}</span>`).join('')}</div>` : ''}</div>
      </article>`;
    }

    // trendScore — жұмыс берушілер бағасы: (артады − азаяды) / бағалар саны, −1…+1; null — баға жоқ
    const consensus = v => {
      if (v == null || !Number.isFinite(+v)) return '<span class="ac-trend" title="Жұмыс берушілер әлі бағаламаған">баға жоқ</span>';
      const x = Math.round(+v * 100), t = 'Жұмыс берушілер бағасы: −100 (бәрі «азаяды») … +100 (бәрі «артады»)';
      if (x >= 15) return `<span class="ac-trend is-up" title="${t}">↑ +${x}</span>`;
      if (x <= -15) return `<span class="ac-trend is-down" title="${t}">↓ ${x}</span>`;
      return `<span class="ac-trend" title="${t}">→ ${x > 0 ? '+' : ''}${x}</span>`;
    };
    const shareOf = v => (+v > 1 ? +v / 100 : +v || 0);

    async function loadFit(p) {
      const card = document.querySelector(`.ac-prog[data-id="${CSS.escape(String(p.id))}"]`);
      if (!card) return;
      const slot = n => card.querySelector(`[data-slot="${n}"]`);
      const res = await api('GET', `/api/insights/program/${encodeURIComponent(p.id)}`);
      if (!res.ok) {
        slot('missing').innerHTML = `<li class="ac-empty-line">${esc(res.message)}</li>`;
        slot('outdated').innerHTML = '';
        return;
      }
      slot('ring').innerHTML = ring(res.fit, 'сәйкестік') + `<p class="ac-prog__fit-note">${res.fit >= 75 ? 'Бағдарлама нарыққа жақсы сәйкес.' : res.fit >= 50 ? 'Бірнеше маңызды дағды жетіспейді.' : 'Бағдарламаны жаңарту ұсынылады.'}</p>`;
      slot('missing').innerHTML = (res.missing || []).slice(0, 6).map(k => `<li><span>${esc(D.skills[k.skill])}</span>
          <span class="ac-skl__bar"><i style="width:${Math.min(100, shareOf(k.demandShare) * 100)}%"></i></span>
          <b>${pct(shareOf(k.demandShare))}</b>${consensus(k.trendScore)}${k.planned ? '<em class="ac-tag ac-tag--plan">жоспарда</em>' : ''}</li>`).join('')
        || '<li class="ac-empty-line">Негізгі дағдылардың бәрі оқытылады.</li>';
      slot('outdated').innerHTML = (res.outdated || []).slice(0, 6).map(k => `<li><span>${esc(D.skills[k.skill])}</span>${consensus(k.trendScore)}</li>`).join('')
        || '<li class="ac-empty-line">Ескірген дағды жоқ.</li>';
      slot('covered').innerHTML = (res.covered || []).map(s => `<span class="ac-chip is-on">✓ ${esc(D.skills[s])}</span>`).join('')
        || '<p class="ac-empty-line">Сұранысқа ие дағды табылмады.</p>';
    }

    function onAction(e) {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const holder = b.closest('[data-id]');
      const p = programs.find(x => String(x.id) === holder.dataset.id);
      if (!p) return;
      if (b.dataset.act === 'edit') edit(p);
      if (b.dataset.act === 'go') document.querySelector(`.ac-prog[data-id="${CSS.escape(String(p.id))}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (b.dataset.act === 'del') armDelete(b, async () => {
        const res = await api('DELETE', `/api/programs/${encodeURIComponent(p.id)}`);
        if (!res.ok) { b.textContent = 'Қате'; return; }
        if (String(editId) === String(p.id)) reset();
        await load();
        api('GET', '/api/surveys/stats').then(r => { if (r.ok) { STATS = r; renderStats(); } });
      });
    }
    $('progMini').addEventListener('click', onAction);
    $('progList').addEventListener('click', onAction);

    reset();
    load();
  }

  // ===================== СТУДЕНТ =====================
  function initStudent() {
    const KEY = `mk-student:${USER.id}`;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { saved = {}; }
    let title = Number.isInteger(saved.title) && D.titles[saved.title] ? saved.title : null;
    const known = new Set((saved.skills || []).filter(s => D.skills[s] != null));
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ title, skills: [...known] })); } catch { /* жеке режим — сақталмайды */ } };
    const m = market();
    const TOP = 10, LIST = 15;

    $('acBody').innerHTML = `<div class="ac-grid">
      <div class="ac-main">
        <article class="ac-card">
          <header class="ac-card__head">
            <p class="eyebrow eyebrow--dark">Мамандыққа дайындық</p>
            <h2>Қай мамандыққа дайындаласыз?</h2>
            <p>Мамандықты таңдаңыз да, білетін дағдыларыңызды белгілеңіз. Тізім — жұмыс берушілер соңғы 12 айда осы мамандық үшін ең жиі сұраған дағдылар.</p>
          </header>
          <label class="ac-field"><span>Мамандық</span><select class="ac-select" id="stTitle">${titleOptions(title ?? '', 'Мамандықты таңдаңыз')}</select></label>
          <div id="stSkills"></div>
          <details class="ac-more" id="stMore"><summary>Басқа білетін дағдыларым</summary><div id="stOther"></div></details>
        </article>
      </div>
      <aside class="ac-side" id="stSide"></aside></div>`;

    const other = chipPicker($('stOther'), {
      selected: known,
      order: () => { const top = title == null ? [] : m.top(title, LIST); return D.skills.map((_, s) => s).filter(s => !top.includes(s)).sort(byName); },
      onChange: () => { save(); render(); },
    });

    function render() {
      const box = $('stSkills'), side = $('stSide');
      if (title == null) {
        box.innerHTML = '<p class="ac-empty-line ac-empty-line--big">Мамандықты таңдағанда, оған қажетті дағдылар осында шығады.</p>';
        side.innerHTML = `<div class="ac-card ac-card--soft ac-ready">${ring(0, 'дайындық')}<p class="ac-help">Мамандық таңдалмаған.</p></div>`;
        setMyStats([{ v: '—', l: 'таңдалған мамандық' }, { v: num(known.size), l: 'белгіленген дағды' }]);
        return;
      }
      const list = m.top(title, LIST), top = list.slice(0, TOP);
      const totalW = top.reduce((a, s) => a + m.share(title, s), 0);
      const haveW = top.filter(s => known.has(s)).reduce((a, s) => a + m.share(title, s), 0);
      const ready = totalW ? haveW / totalW * 100 : 0;
      const maxShare = Math.max(...list.map(s => m.share(title, s)), 0.01);
      box.innerHTML = `<ul class="ac-know">${list.map((s, i) => `<li><label class="ac-know__row${known.has(s) ? ' is-on' : ''}">
          <input type="checkbox" data-s="${s}"${known.has(s) ? ' checked' : ''}><i class="ac-know__box"></i>
          <span class="ac-know__name">${esc(D.skills[s])}${i < TOP ? '' : '<em class="ac-tag ac-tag--soft">қосымша</em>'}</span>
          <span class="ac-know__bar"><i style="width:${m.share(title, s) / maxShare * 100}%"></i></span>
          <b>${pct(m.share(title, s))}</b>${arrow(m.trend(title, s))}</label></li>`).join('')}</ul>
        <p class="ac-help">Пайыз — осы мамандық вакансияларының қаншасында дағды талап етілген. Дайындық алғашқы ${TOP} дағды бойынша, сұраныс үлесімен салмақталып есептеледі.</p>`;
      const learn = list.filter(s => !known.has(s)).slice(0, 6);
      side.innerHTML = `<div class="ac-card ac-ready">
          <p class="eyebrow eyebrow--dark">${esc(D.titles[title])}</p>
          ${ring(ready, 'дайындық')}
          <p class="ac-ready__note">${ready >= 75 ? 'Тамаша! Сіз вакансиялардың негізгі талаптарына сай келесіз.' : ready >= 40 ? 'Жақсы бастама. Төмендегі дағдылар дайындықты тез арттырады.' : 'Төмендегі дағдылардан бастаңыз — олар ең жиі сұралады.'}</p>
        </div>
        <div class="ac-card ac-card--soft">
          <header class="ac-card__head ac-card__head--sm"><h3>Үйренуге тұрарлық дағдылар</h3></header>
          ${learn.length ? `<ol class="ac-learn">${learn.map(s => `<li><a href="skill.html?id=${s}">${esc(D.skills[s])}</a><span>${pct(m.share(title, s))} вакансияда</span>${arrow(m.trend(title, s))}</li>`).join('')}</ol>`
            : '<p class="ac-empty-line">Барлық негізгі дағдыларды білесіз!</p>'}
          <div class="ac-links">
            <a class="btn btn--dark btn--sm" href="profession.html?id=${title}">Мамандық болжамы <span>→</span></a>
            <a class="ac-link" href="forecast.html?title=${title}">2030 жылғы дағдылар болжамы →</a>
          </div>
        </div>
        <div class="ac-note"><b>Деректеріңіз қайда сақталады?</b><p>Таңдауыңыз тек осы браузерде сақталады. Есеп ${num(D.meta.count)} вакансиядан алынған соңғы 12 айлық сұраныс бойынша жасалады.</p></div>`;
      setMyStats([
        { v: D.titles[title], l: 'таңдалған мамандық', s: D.sectors[D.titleSector[title]] },
        { v: `${Math.round(ready)}%`, l: 'мамандыққа дайындық', s: `${num(known.size)} дағды белгіленді` },
      ]);
    }

    $('stTitle').addEventListener('change', e => {
      title = e.target.value === '' ? null : +e.target.value;
      save(); render(); other.render();
    });
    $('stSkills').addEventListener('change', e => {
      const s = +e.target.dataset.s;
      if (Number.isNaN(s)) return;
      if (e.target.checked) known.add(s); else known.delete(s);
      save(); render(); other.render();
    });
    render();
  }
})();
