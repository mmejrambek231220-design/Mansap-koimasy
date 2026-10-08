// ===== Авторизация күйі =====
// server/server.js API-імен жұмыс істейді. Сайт статикалық серверде ашылса (API жоқ),
// тақырыптағы «Кіру» сілтемесі өзгеріссіз қалады.

const MKAuth = (() => {
  const ROLE_NAMES = { student: 'Студент', employer: 'Жұмыс беруші', education: 'Оқу орны' };
  const initials = name => name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();

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
        <span class="nav__avatar">${initials(user.fullName)}</span><span class="nav__name"></span></a>
      <button type="button" class="nav__logout">Шығу</button>`;
    box.querySelector('.nav__name').textContent = user.fullName.split(/\s+/)[0];
    box.querySelector('.nav__logout').addEventListener('click', async () => { await logout(); location.reload(); });
    slot.replaceWith(box);
  }

  const ready = me().then(user => { renderHeader(user); return user; });

  return { api, me, logout, ready, initials, ROLE_NAMES };
})();
