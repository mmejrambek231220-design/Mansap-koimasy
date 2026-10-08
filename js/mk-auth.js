// ===== Авторизация күйі =====
// server/server.js API-імен жұмыс істейді. Сайт статикалық серверде ашылса (API жоқ),
// тақырыптағы «Кіру» сілтемесі өзгеріссіз қалады.

const MKAuth = (() => {
  const ROLE_NAMES = { student: 'Студент', employer: 'Жұмыс беруші', education: 'Оқу орны' };
  const initials = name => name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  // Рөл белгішесі: студент — бітіруші қалпағы, жұмыс беруші — ғимарат, оқу орны — кітап
  const ROLE_ICONS = {
    student: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5M22 9v6"/>',
    employer: '<path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M2 21h20"/><path d="M8 8h3M8 12h3M8 16h3"/>',
    education: '<path d="M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2z"/><path d="M4 20a2 2 0 0 0 2 2h13v-4M9 7h6"/>',
  };
  const roleIcon = role => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ROLE_ICONS[role] || ROLE_ICONS.student}</svg>`;

  async function api(path, body) {
    const res = await fetch(`/api/auth/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({ ok: false, message: 'Сервер жауап бермеді.' }));
    if (!res.ok && data.ok !== false) data.ok = false;
    return data;
  }

  const me = () => api('me').then(d => d.user || null).catch(() => null);
  const logout = () => api('logout', {});

  // Тақырыптағы «Кіру» орнына пайдаланушы аты мен «Шығу»
  function renderHeader(user) {
    const slot = document.querySelector('.nav__signin');
    if (!slot || !user) return;
    const box = document.createElement('span');
    box.className = 'nav__account';
    box.innerHTML = `<a class="nav__user" href="account.html" title="Жеке кабинет · ${ROLE_NAMES[user.role] || ''}">
        <span class="nav__avatar">${roleIcon(user.role)}</span><span class="nav__name"></span></a>
      <button type="button" class="nav__logout">Шығу</button>`;
    box.querySelector('.nav__name').textContent = user.fullName.split(/\s+/)[0];
    box.querySelector('.nav__logout').addEventListener('click', async () => { await logout(); location.reload(); });
    slot.replaceWith(box);
  }

  const ready = me().then(user => { renderHeader(user); return user; });

  return { api, me, logout, ready, initials, roleIcon, ROLE_NAMES };
})();
