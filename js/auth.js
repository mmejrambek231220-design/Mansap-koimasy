// ===== Кіру / тіркелу беті =====
// Екі жол: телефон нөмірі (+ құпиясөз) немесе Google. Нөмір енгізілгенде жүйе өзі анықтайды:
// тіркелген болса — құпиясөз сұрайды, жоқ болса — тіркелу формасы ашылады.
(() => {
  const $ = id => document.getElementById(id);
  // data/dataset.js-тегі ретпен (бетке 3.5 МБ деректі жүктемеу үшін)
  const SECTORS = ['IT', 'Қаржы', 'Денсаулық сақтау', 'Білім', 'Өнеркәсіп', 'Сауда және логистика', 'Маркетинг', 'Энергетика'];
  const REGIONS = ['Алматы', 'Астана', 'Шымкент', 'Қарағанды', 'Атырау', 'Ақтөбе', 'Павлодар', 'Өскемен'];

  const steps = document.querySelectorAll('.auth__step');
  const forms = { phone: $('phoneForm'), login: $('loginForm'), register: $('registerForm') };
  const state = { phone: null, google: null };   // google: { pending, email }

  function show(step) {
    steps.forEach(s => { s.hidden = s.dataset.step !== step; });
    const first = document.querySelector(`.auth__step[data-step="${step}"] input:not([type=radio]):not([type=checkbox])`);
    if (first) setTimeout(() => first.focus(), 50);
  }
  document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => {
    state.google = null;
    show('phone');
  }));

  function message(el, text, ok = false) {
    el.textContent = text;
    el.classList.toggle('is-ok', ok);
    el.hidden = !text;
  }
  const formMsg = form => form.querySelector('.auth__msg');

  const done = () => { location.href = 'account.html'; };

  async function call(form, path, body) {
    const btn = form && form.querySelector('.auth__btn');
    if (btn) btn.disabled = true;
    if (form) message(formMsg(form), '');
    try {
      return await MKAuth.api(path, body);
    } catch {
      return { ok: false, message: 'Серверге қосылу мүмкін болмады. Сайтты server/ ішінде `npm start` арқылы ашыңыз.' };
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // --- Телефон нөмірі: 700 000 00 00 түрінде көрсетеміз ---
  const phoneInput = forms.phone.elements.phone;
  const digits = v => {
    let d = v.replace(/\D/g, '');
    if (d.length === 11 && (d[0] === '7' || d[0] === '8')) d = d.slice(1);
    return d.slice(0, 10);
  };
  const pretty = d => [d.slice(0, 3), d.slice(3, 6), d.slice(6, 8), d.slice(8, 10)].filter(Boolean).join(' ');
  phoneInput.addEventListener('input', () => {
    phoneInput.value = pretty(digits(phoneInput.value));
    phoneInput.classList.remove('is-invalid');
  });

  forms.phone.addEventListener('submit', async e => {
    e.preventDefault();
    const d = digits(phoneInput.value);
    if (d.length !== 10 || d[0] !== '7') {
      phoneInput.classList.add('is-invalid');
      phoneInput.focus();
      return message(formMsg(forms.phone), 'Нөмірді толық жазыңыз, мысалы: 701 234 56 78');
    }
    const res = await call(forms.phone, 'phone/check', { phone: `+7${d}` });
    if (!res.ok) return message(formMsg(forms.phone), res.message || 'Қате орын алды.');
    state.phone = res.phone;
    state.google = null;
    document.querySelectorAll('.auth__phone-label').forEach(el => { el.textContent = `+7 ${pretty(d)}`; });
    if (res.exists) {
      forms.login.reset();
      forms.login.elements.remember.checked = true;
      show('password');
    } else {
      openRegister({ title: `+7 ${pretty(d)} нөміріне жаңа аккаунт` });
    }
  });

  // --- Кіру ---
  forms.login.addEventListener('submit', async e => {
    e.preventDefault();
    const f = forms.login.elements;
    if (!f.password.value) { f.password.classList.add('is-invalid'); f.password.focus(); return; }
    const res = await call(forms.login, 'login', { phone: state.phone, password: f.password.value, remember: f.remember.checked });
    res.ok ? done() : message(formMsg(forms.login), res.message || 'Қате орын алды.');
  });

  // --- Тіркелу ---
  const R = forms.register.elements;
  SECTORS.forEach((s, i) => R.sector.add(new Option(s, i)));
  REGIONS.forEach((s, i) => R.region.add(new Option(s, i)));

  function syncRole() {
    const role = R.role.value;
    const org = forms.register.querySelector('.org');
    org.hidden = role === 'student';
    forms.register.querySelector('[data-only="employer"]').hidden = role !== 'employer';
    $('orgLabel').textContent = role === 'education' ? 'Оқу орнының атауы' : 'Компания атауы';
    R.orgName.placeholder = role === 'education' ? 'Мысалы: Алатау техникалық колледжі' : 'Мысалы: «Алатау Тех» ЖШС';
  }
  forms.register.querySelectorAll('input[name=role]').forEach(r => r.addEventListener('change', syncRole));

  function openRegister({ title, fullName = '' }) {
    forms.register.reset();
    R.fullName.value = fullName;
    forms.register.querySelector('[data-pw]').hidden = Boolean(state.google);
    forms.register.querySelector('.pw-meter').dataset.score = 0;
    $('regFor').textContent = title;
    syncRole();
    show('register');
  }

  R.password.addEventListener('input', () => {
    const v = R.password.value;
    const score = !v ? 0 : [v.length >= 8, /\d/.test(v) && /\D/.test(v), /[A-ZА-ЯӘІҢҒҮҰҚӨҺ]/.test(v), v.length >= 12 || /[^\w\s]/.test(v)]
      .filter(Boolean).length || 1;
    forms.register.querySelector('.pw-meter').dataset.score = score;
  });

  forms.register.addEventListener('submit', async e => {
    e.preventDefault();
    const msg = formMsg(forms.register);
    const role = R.role.value;
    const fail = (input, text) => { input.classList.add('is-invalid'); input.focus(); message(msg, text); };
    if (R.fullName.value.trim().length < 2) return fail(R.fullName, 'Аты-жөніңізді жазыңыз.');
    if (role !== 'student' && R.orgName.value.trim().length < 2) return fail(R.orgName, 'Ұйым атауын жазыңыз.');
    const profile = {
      fullName: R.fullName.value.trim(), role,
      orgName: role === 'student' ? '' : R.orgName.value.trim(),
      sector: role === 'employer' ? R.sector.value : '',
      region: role === 'student' ? '' : R.region.value,
    };
    let res;
    if (state.google) {
      res = await call(forms.register, 'google/complete', { pending: state.google.pending, ...profile });
    } else {
      const v = R.password.value;
      if (v.length < 8 || !/\d/.test(v) || !/\D/.test(v)) return fail(R.password, 'Құпиясөз кемінде 8 таңбадан тұрып, әріп пен сан қамтуы керек.');
      res = await call(forms.register, 'register', { phone: state.phone, password: v, ...profile });
    }
    res.ok ? done() : message(msg, res.message || 'Қате орын алды.');
  });

  document.querySelectorAll('.field input').forEach(i => i.addEventListener('input', () => i.classList.remove('is-invalid')));

  // --- Құпиясөзді көрсету ---
  document.querySelectorAll('.field__eye').forEach(btn => btn.addEventListener('click', () => {
    const input = btn.previousElementSibling;
    const showPw = input.type === 'password';
    input.type = showPw ? 'text' : 'password';
    btn.textContent = showPw ? 'Жасыру' : 'Көрсету';
  }));

  // --- Google (Google Identity Services) ---
  const googleMsg = $('googleMsg');
  async function onGoogle(resp) {
    message(googleMsg, '');
    const res = await call(null, 'google', { credential: resp.credential });
    if (!res.ok) return message(googleMsg, res.message || 'Google арқылы кіру сәтсіз аяқталды.');
    if (!res.needProfile) return done();
    state.google = { pending: res.pending, email: res.email };
    state.phone = null;
    openRegister({ title: `${res.email} — Google аккаунты`, fullName: res.fullName });
  }

  function initGoogle(clientId) {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => {
      google.accounts.id.initialize({ client_id: clientId, callback: onGoogle, ux_mode: 'popup' });
      const slot = $('googleSlot');
      slot.innerHTML = '';
      google.accounts.id.renderButton(slot, {
        theme: 'outline', size: 'large', shape: 'rectangular', text: 'continue_with',
        logo_alignment: 'center', width: Math.min(400, slot.clientWidth || 400), locale: 'kk',
      });
    };
    document.head.append(s);
  }

  $('googleFallback').addEventListener('click', () => message(googleMsg,
    'Google арқылы кіру әлі бапталмаған: серверге GOOGLE_CLIENT_ID орнату керек (server/README.md). Әзірге телефон нөмірін қолданыңыз.', true));

  MKAuth.api('config').then(c => { if (c.ok && c.googleClientId) initGoogle(c.googleClientId); }).catch(() => {});

  // Кірген пайдаланушы бұл бетте тұрмайды
  MKAuth.ready.then(user => { if (user) done(); });
  show('phone');
})();
