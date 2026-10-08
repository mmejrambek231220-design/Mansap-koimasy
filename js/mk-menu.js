// ===== Үлкен ашылмалы мәзір (mega menu) =====
// Әр мәзір бөлімінің өз панелі бар: сол жақта санаттар, оң жақта мазмұн, төменде шолу жолағы.
// Курсор санатқа барғанда оң жақтағы мазмұн ауысады. Мобильде ескі қарапайым тізім қалады.

(() => {
  const menu = document.getElementById('menu');
  if (!menu) return;

  const onHome = /(^|\/)(index\.html)?$/.test(location.pathname);
  const home = hash => (onHome ? '' : 'index.html') + hash;
  const REPO = 'https://github.com/mmejrambek231220-design/Mansap-koimasy';
  const ARROW = '<svg class="mg-ext" width="12" height="12" viewBox="0 0 12 12"><path d="M3 9l6-6M4 3h5v5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
  const CHEV = '<svg class="mg-chev" width="8" height="12" viewBox="0 0 8 12"><path d="M1.5 1l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';

  // Санат белгішелері
  const ICONS = {
    data: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><path d="M14 6.5h5v4M10 17.5H5v-4"/></svg>',
    db: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>',
    doc: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
    chart: '<svg viewBox="0 0 24 24"><path d="M3 20h18M6 16l4-5 3 3 5-7"/><circle cx="18" cy="7" r="1.5"/></svg>',
    model: '<svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8 7.5l3 8M16 7.5l-3 8M8.5 6h7"/></svg>',
    spark: '<svg viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18 16l.8 2.2L21 19l-2.2.8L18 22l-.8-2.2L15 19l2.2-.8z"/></svg>',
    apps: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M17.5 14v7M14 17.5h7"/></svg>',
    book: '<svg viewBox="0 0 24 24"><path d="M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2zM4 20a2 2 0 0 0 2 2h13v-4"/></svg>',
    info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>',
  };

  // --- Мазмұн түрлері ---
  const link = l => `<a href="${l.href}"${l.ext ? ' target="_blank" rel="noopener"' : ''}${l.soon ? ' class="is-soon"' : ''}>
      <span>${l.text}</span>${l.ext ? ARROW : ''}${l.soon ? '<em>жақында</em>' : ''}</a>`;
  const cols = list => `<div class="mg-cols">${list.map(c =>
    `<div class="mg-col"><h4>${c.title}</h4>${c.links.map(link).join('')}</div>`).join('')}</div>`;
  const people = list => `<div class="mg-people">${list.map(p => `
      <a class="mg-person" href="${p.href}">
        <h4>${p.title} ${ARROW}</h4>
        <p>${p.text}</p>
        <img src="${p.img}" alt="" loading="lazy">
      </a>`).join('')}</div>`;
  const cards = list => `<div class="mg-cards">${list.map(c => `
      <a class="mg-card" href="${c.href}">
        <img src="${c.img}" alt="" loading="lazy">
        <span class="mg-card__tag">${c.tag}</span>
        <h4>${c.title}</h4>
      </a>`).join('')}</div>`;
  const stats = list => `<div class="mg-stats">${list.map(s =>
    `<div><b>${s.value}</b><span>${s.label}</span></div>`).join('')}</div>`;

  // Төменгі жолақтағы безендіру (немесе сурет жолы: art: 'assets/img/...')
  const ART = {
    stripes: `<svg viewBox="0 0 600 200" preserveAspectRatio="none">${[0, 1, 2, 3, 4, 5, 6, 7].map(i => {
      const w = [420, 360, 300, 470, 240, 390, 150, 330][i];
      return `<rect x="0" y="${i * 25 + 4}" width="600" height="19" fill="#2B0C1F"/><rect x="${w}" y="${i * 25 + 4}" width="${600 - w}" height="3" fill="#F7EEF4"/>`;
    }).join('')}</svg>`,
    steps: `<svg viewBox="0 0 600 200" preserveAspectRatio="xMaxYMax slice">${(() => {
      let s = '';
      for (let c = 0; c < 15; c++) {
        const h = Math.min(5, Math.floor(c / 3) + 1);
        for (let r = 0; r < h; r++) s += `<rect x="${c * 40}" y="${200 - (r + 1) * 40}" width="40" height="40" fill="none" stroke="#2B0C1F" stroke-opacity=".35"/>`;
      }
      return s;
    })()}</svg>`,
    line: `<svg viewBox="0 0 600 200" preserveAspectRatio="none">
      <path d="M0 170 C80 160 120 150 180 140 S300 120 340 95" fill="none" stroke="#2B0C1F" stroke-width="3"/>
      <path d="M340 95 C400 70 470 50 600 20" fill="none" stroke="#E8506A" stroke-width="3" stroke-dasharray="9 7"/>
      <path d="M340 95 C400 60 470 25 600 0 L600 50 C470 80 400 85 340 95z" fill="#E8506A" fill-opacity=".14"/>
      <line x1="340" y1="0" x2="340" y2="200" stroke="#2B0C1F" stroke-opacity=".25" stroke-dasharray="3 4"/></svg>`,
    dots: `<svg viewBox="0 0 600 200" preserveAspectRatio="xMaxYMid slice">${(() => {
      let s = '';
      for (let x = 0; x < 30; x++) for (let y = 0; y < 10; y++) {
        const r = Math.max(0, Math.sin(x / 4) * 3 + y / 3 - 1);
        if (r > .4) s += `<circle cx="${x * 20 + 10}" cy="${y * 20 + 10}" r="${Math.min(r, 6)}" fill="#2B0C1F" fill-opacity=".6"/>`;
      }
      return s;
    })()}</svg>`,
  };

  // --- Мәзір бөлімдері (HTML-дегі ретпен) ---
  const MENUS = [
    { // Деректер
      tabs: [
        { icon: 'data', title: 'Деректер базасы', text: 'Вакансиялар, дағдылар мен мамандықтар бойынша барлық деректерді қараңыз',
          body: cols([
            { title: 'Деректер', links: [{ text: 'Вакансиялар', href: 'vacancies.html' }, { text: 'Дағдылар', href: 'skills.html' }, { text: 'Мамандықтар', href: 'professions.html' }] },
            { title: 'Талдау', links: [{ text: 'Жалақы', href: '#', soon: true }, { text: 'Өңірлер', href: '#', soon: true }] },
            { title: 'Дереккөздер', links: [{ text: 'hh.kz', href: 'https://hh.kz', ext: true }, { text: 'LinkedIn', href: 'https://www.linkedin.com/jobs', ext: true }, { text: 'Enbek.kz', href: 'https://www.enbek.kz', ext: true }] },
          ]) },
        { icon: 'db', title: 'Жіктемелер', text: 'Салалар, мамандықтар мен дағдылардың бірыңғай жүйесі',
          body: cols([
            { title: 'Салалар', links: ['IT', 'Қаржы', 'Денсаулық сақтау', 'Білім'].map((t, i) => ({ text: t, href: `skills.html?sector=${i}` })) },
            { title: ' ', links: ['Өнеркәсіп', 'Сауда және логистика', 'Маркетинг', 'Энергетика'].map((t, i) => ({ text: t, href: `skills.html?sector=${i + 4}` })) },
            { title: 'Анықтамалықтар', links: [{ text: '47 дағды', href: 'skills.html' }, { text: '34 мамандық', href: 'professions.html' }, { text: '8 өңір', href: 'vacancies.html' }] },
          ]) },
        { icon: 'doc', title: 'Техникалық құжаттама', ext: true, text: 'Деректер қалай жиналады: hh API, LinkedIn, Enbek.kz коллекторлары',
          body: cols([
            { title: 'Деректер жинау', links: [{ text: 'Collector модулі', href: `${REPO}/tree/main/collector`, ext: true }, { text: 'hh.kz коллекторы', href: `${REPO}/blob/main/collector/hh_collector.py`, ext: true }, { text: 'LinkedIn коллекторы', href: `${REPO}/blob/main/collector/linkedin_collector.py`, ext: true }, { text: 'Enbek.kz коллекторы', href: `${REPO}/blob/main/collector/enbek_collector.py`, ext: true }] },
            { title: 'Құрылым', links: [{ text: 'Деректер форматы', href: `${REPO}/blob/main/tools/README.md`, ext: true }, { text: 'SQLite схемасы', href: `${REPO}/blob/main/collector/common/db.py`, ext: true }, { text: 'Дағдыларды анықтау', href: `${REPO}/blob/main/collector/common/skills.py`, ext: true }] },
          ]) },
      ],
      foot: { icon: 'data', eyebrow: 'Деректерге шолу', text: '2020–2026 жылдардағы 100 000-нан астам вакансия: болжам моделі осы деректерде үйренеді',
        link: { text: 'Деректер базасын ашу', href: 'vacancies.html' }, art: 'assets/img/menu-laptop.png' },
    },
    { // Болжамдар
      tabs: [
        { icon: 'chart', title: 'Болжам құралдары', text: '2030 жылға дейін қай дағдыларға сұраныс өсетінін біліңіз',
          body: cols([
            { title: 'Болжамдар', links: [{ text: 'Дағдылар болжамы', href: 'forecast.html' }, { text: 'Мамандық бойынша болжам', href: 'professions.html' }, { text: 'Олқылық талдауы', href: '#', soon: true }, { text: 'Мансап кеңесшісі', href: '#', soon: true }] },
            { title: 'Танымал мамандықтар', links: [[0, 'Python әзірлеуші'], [11, 'Бухгалтер'], [19, 'Мектеп мұғалімі'], [29, 'Маркетолог']].map(([id, t]) => ({ text: t, href: `profession.html?id=${id}` })) },
            { title: 'Өсіп келе жатқан дағдылар', links: [[6, 'Машиналық оқыту'], [12, 'Жасанды интеллект құралдары'], [8, 'Киберқауіпсіздік'], [40, 'Жаңартылатын энергетика']].map(([id, t]) => ({ text: t, href: `skill.html?id=${id}` })) },
          ]) },
        { icon: 'model', title: 'Болжам моделі', text: 'Машиналық оқыту әдісі, сапасын тексеру және дәлдігі',
          body: stats([
            { value: 'Holt', label: 'сөндірілген трендпен экспоненциалды тегістеу' },
            { value: '≈8%', label: 'орташа қателік (MAPE), соңғы 4 тоқсанда тексерілді' },
            { value: '80%', label: 'болжамның сенім аралығы' },
          ]) + `<a class="mg-more" href="forecast.html#model">Модель қалай жұмыс істейді <span>→</span></a>` },
      ],
      foot: { icon: 'chart', eyebrow: 'Болжам 2030', text: 'Әр дағды мен мамандық үшін модель тоқсан сайын жаңа деректермен қайта үйренеді',
        link: { text: 'Болжамды ашу', href: 'forecast.html' }, art: 'assets/img/menu-team.png' },
    },
    { // Кімге арналған
      tabs: [
        { icon: 'spark', title: 'Негізгі аудитория', text: 'Студенттер, жұмыс берушілер мен оқу орындары Мансап Компасын қалай қолданады',
          body: people([
            { title: 'Студенттер', href: home('#students'), img: 'assets/img/menu-student.webp', text: 'Өзіңе сай мамандықты тап, болашақта қажет дағдыларды біл және мансап жолыңды жоспарла.' },
            { title: 'Жұмыс берушілер', href: home('#employers'), img: 'assets/img/menu-employer.webp', text: 'Нарықтағы дағдылар трендін бақылап, болашақ қызметкерлерге қойылатын талаптарды алдын ала анықта.' },
            { title: 'Оқу орындары', href: home('#universities'), img: 'assets/img/menu-college.webp', text: 'ЖОО мен колледж бағдарламаларын еңбек нарығының нақты сұранысына сәйкестендір.' },
          ]) },
        { icon: 'apps', title: 'Қолдану жолдары', text: 'Деректерге негізделген шешім қабылдауға арналған дайын құралдар',
          body: cols([
            { title: 'Студенттерге', links: [{ text: 'Мамандықтарды салыстыру', href: 'professions.html' }, { text: 'Болашақ дағдылар', href: 'forecast.html' }, { text: 'Тәжірибесіз вакансиялар', href: 'vacancies.html' }] },
            { title: 'Жұмыс берушілерге', links: [{ text: 'Дағдылар тренді', href: 'skills.html' }, { text: 'Нарықтағы вакансиялар', href: 'vacancies.html' }, { text: 'Жалақы деңгейі', href: '#', soon: true }] },
            { title: 'Оқу орындарына', links: [{ text: 'Мамандық бойынша болжам', href: 'professions.html' }, { text: 'Олқылық талдауы', href: '#', soon: true }] },
          ]) },
      ],
      foot: { icon: 'apps', eyebrow: 'Қолдану жағдайлары', text: 'Мансап Компасының деректері мен болжамдары кімге және қалай көмектеседі',
        link: { text: 'Барлығын қарау', href: home('#students') }, art: 'dots' },
    },
    { // Ресурстар
      tabs: [
        { icon: 'book', title: 'Зерттеулер', text: 'Қазақстан еңбек нарығы туралы талдаулар мен есептер',
          body: cards([
            { tag: 'Есеп', title: '2030 жылға дейін сұранысқа ие болатын 20 дағды', img: 'assets/img/trends-2030.jpg', href: home('#research') },
            { tag: 'Талдау', title: 'Жасанды интеллект дағдыларға сұранысты қалай өзгертуде', img: 'assets/img/ai-skills.jpg', href: home('#research') },
            { tag: 'Шолу', title: 'Өңірлердегі еңбек нарығы: Алматыдан Ақтөбеге дейін', img: 'assets/img/globe.jpg', href: home('#research') },
          ]) },
        { icon: 'doc', title: 'Әдістеме', text: 'Деректер қалай жиналады, өңделеді және болжанады',
          body: cols([
            { title: 'Әдістеме', links: [{ text: 'Болжам моделі', href: 'forecast.html#model' }, { text: 'Деректер жинау', href: `${REPO}/tree/main/collector`, ext: true }, { text: 'Дағдыларды анықтау', href: `${REPO}/blob/main/collector/common/skills.py`, ext: true }] },
            { title: 'Бастапқы код', links: [{ text: 'GitHub репозиторийі', href: REPO, ext: true }, { text: 'README', href: `${REPO}#readme`, ext: true }] },
          ]) },
      ],
      foot: { icon: 'book', eyebrow: 'Ресурстар', text: 'Еңбек нарығы мен болашақ дағдылар туралы барлық материалдар бір жерде',
        link: { text: 'Зерттеулерді оқу', href: home('#research') }, art: 'dots' },
    },
    { // Жоба туралы
      tabs: [
        { icon: 'info', title: 'Жоба туралы', text: 'Курстық жұмыстың мақсаты, міндеттері және нәтижелері',
          body: `<div class="mg-about">
              <p class="mg-about__topic">«Машиналық оқыту әдістерін қолдана отырып, еңбек нарығында кәсіби дағдыларға сұранысты болжау»</p>
              ${stats([{ value: '100k+', label: 'талданған вакансия' }, { value: '47', label: 'болжанған дағды' }, { value: '34', label: 'мамандық' }])}
            </div>` },
        { icon: 'spark', title: 'Байланыс', text: 'Жоба коды мен авторымен байланыс',
          body: cols([
            { title: 'Жоба', links: [{ text: 'GitHub репозиторийі', href: REPO, ext: true }, { text: 'Жоба сипаттамасы', href: `${REPO}#readme`, ext: true }] },
            { title: 'Байланыс', links: [{ text: 'Хабарласу', href: '#', soon: true }] },
          ]) },
      ],
      foot: { icon: 'info', eyebrow: 'Мансап Компасы', text: 'Еңбек нарығындағы дағдыларға сұранысты болжау платформасы',
        link: { text: 'GitHub-та қарау', href: REPO, ext: true }, art: 'stripes' },
    },
  ];

  // --- Құрастыру ---
  const items = menu.querySelectorAll(':scope > .menu__item');
  MENUS.forEach((m, i) => {
    const item = items[i];
    if (!item) return;
    const mega = document.createElement('div');
    mega.className = 'mega';
    mega.innerHTML = `
      <div class="mega__main">
        <ul class="mega__tabs">${m.tabs.map((t, k) => `
          <li><button type="button" class="mega__tab${k ? '' : ' is-active'}" data-k="${k}">
            <span class="mega__tab-title"><i class="mg-ico">${ICONS[t.icon]}</i>${t.title}${t.ext ? ARROW : ''}${CHEV}</span>
            <span class="mega__tab-text">${t.text}</span>
          </button></li>`).join('')}
        </ul>
        <div class="mega__panes">${m.tabs.map((t, k) => `<div class="mega__pane"${k ? ' hidden' : ''}>${t.body}</div>`).join('')}</div>
      </div>
      <div class="mega__foot">
        <div class="mega__foot-text">
          <p class="mega__eyebrow"><i class="mg-ico">${ICONS[m.foot.icon]}</i>${m.foot.eyebrow}</p>
          <p>${m.foot.text}</p>
          ${link({ ...m.foot.link, text: m.foot.link.text })}
        </div>
        <div class="mega__art">${ART[m.foot.art] || `<img src="${m.foot.art}" alt="" loading="lazy">`}</div>
      </div>`;
    item.classList.add('has-mega');
    item.append(mega);

    const tabs = mega.querySelectorAll('.mega__tab');
    const panes = mega.querySelectorAll('.mega__pane');
    const show = k => {
      tabs.forEach((t, j) => t.classList.toggle('is-active', j === k));
      panes.forEach((p, j) => { p.hidden = j !== k; });
    };
    tabs.forEach((t, k) => {
      t.addEventListener('mouseenter', () => show(k));
      t.addEventListener('focus', () => show(k));
    });
    // Мәзір жабылғанда бірінші санатқа қайтамыз
    item.addEventListener('mouseleave', () => setTimeout(() => { if (!item.matches(':hover')) show(0); }, 250));
  });
})();
