// ===== Кіру / тіркелу беті =====
(() => {
  const $ = id => document.getElementById(id);
  const tabsBox = document.querySelector('.auth__tabs');
  const tabs = document.querySelectorAll('.auth__tab');
  const forms = { login: $('loginForm'), register: $('registerForm') };
  const TEXT = {
    login: ['Қош келдіңіз', 'Болжамдарды сақтау және жеке ұсыныстар алу үшін аккаунтыңызға кіріңіз.'],
    register: ['Аккаунт ашу', 'Тіркеліп, өз мамандығыңыз бойынша болашақ дағдылар болжамын алыңыз.'],
  };

  // --- Кіру / Тіркелу ауыстыру ---
  function setMode(mode) {
    tabsBox.dataset.mode = mode;
    tabs.forEach(t => {
      const on = t.dataset.mode === mode;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
    });
    Object.entries(forms).forEach(([m, f]) => { f.hidden = m !== mode; });
    $('authHeading').textContent = TEXT[mode][0];
    $('authLead').textContent = TEXT[mode][1];
    history.replaceState(null, '', mode === 'register' ? '#register' : location.pathname);
  }
  tabs.forEach(t => t.addEventListener('click', () => setMode(t.dataset.mode)));
  if (location.hash === '#register') setMode('register');

  // --- Құпиясөзді көрсету ---
  document.querySelectorAll('.field__eye').forEach(btn => btn.addEventListener('click', () => {
    const input = btn.previousElementSibling;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.textContent = show ? 'Жасыру' : 'Көрсету';
  }));

  // --- Құпиясөз күші ---
  const pw = forms.register.elements.password;
  const meter = forms.register.querySelector('.pw-meter');
  pw.addEventListener('input', () => {
    const v = pw.value;
    const score = !v ? 0 : [v.length >= 8, /\d/.test(v) && /\D/.test(v), /[A-ZА-ЯӘІҢҒҮҰҚӨҺ]/.test(v), v.length >= 12 || /[^\w\s]/.test(v)]
      .filter(Boolean).length || 1;
    meter.dataset.score = score;
  });

  // --- Хабарлама ---
  function message(form, text, ok = false) {
    const el = form.querySelector('.auth__msg');
    el.textContent = text;
    el.classList.toggle('is-ok', ok);
    el.hidden = !text;
  }

  function validate(form) {
    let first = null;
    form.querySelectorAll('input[required]').forEach(input => {
      const bad = !input.value.trim() || (input.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(input.value.trim()));
      input.classList.toggle('is-invalid', bad);
      if (bad && !first) first = input;
    });
    if (first) { first.focus(); message(form, 'Барлық өрісті дұрыс толтырыңыз.'); }
    return !first;
  }
  document.querySelectorAll('.field input').forEach(i => i.addEventListener('input', () => i.classList.remove('is-invalid')));

  async function submit(form, path, body) {
    if (!validate(form)) return;
    const btn = form.querySelector('.auth__submit');
    btn.disabled = true;
    message(form, '');
    try {
      const res = await MKAuth.api(path, body);
      if (!res.ok) { message(form, res.message || 'Қате орын алды.'); return; }
      showDone(res.user, path === 'register');
    } catch {
      message(form, 'Серверге қосылу мүмкін болмады. Сайтты `npm start` (server/) арқылы ашыңыз.');
    } finally {
      btn.disabled = false;
    }
  }

  forms.login.addEventListener('submit', e => {
    e.preventDefault();
    const f = forms.login.elements;
    submit(forms.login, 'login', { email: f.email.value, password: f.password.value, remember: f.remember.checked });
  });
  forms.register.addEventListener('submit', e => {
    e.preventDefault();
    const f = forms.register.elements;
    submit(forms.register, 'register', { fullName: f.fullName.value, email: f.email.value, password: f.password.value, role: f.role.value });
  });

  $('forgotLink').addEventListener('click', e => {
    e.preventDefault();
    message(forms.login, 'Құпиясөзді қалпына келтіру әзірге жоқ — жаңа аккаунт ашыңыз немесе әкімшіге хабарласыңыз.', true);
  });

  // --- Кірген пайдаланушы ---
  function showDone(user, isNew) {
    tabsBox.hidden = true;
    Object.values(forms).forEach(f => { f.hidden = true; });
    $('authHeading').textContent = isNew ? 'Аккаунт ашылды' : 'Сіз жүйедесіз';
    $('authLead').textContent = 'Енді болжамдар мен ұсыныстар сіздің аккаунтыңызға байланысты.';
    $('doneAvatar').textContent = MKAuth.initials(user.fullName);
    $('doneName').textContent = user.fullName;
    $('doneMeta').textContent = `${user.email} · ${MKAuth.ROLE_NAMES[user.role] || ''}`;
    $('authDone').hidden = false;
  }

  $('logoutBtn').addEventListener('click', async () => { await MKAuth.logout(); location.reload(); });

  MKAuth.ready.then(user => { if (user) showDone(user, false); });
})();
