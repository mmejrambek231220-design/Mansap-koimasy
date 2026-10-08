// ===== Мансап Компасы — басты бет интерактивтілігі =====
document.documentElement.classList.remove('no-js');

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// --- Hero: ауыспалы сөз (тергіш эффекті) ---
(function typing() {
  const el = document.getElementById('typed');
  if (!el || reduceMotion) return;
  const words = ['студенттер үшін', 'жұмыс берушілер үшін', 'оқу орындары үшін'];
  let w = 0, i = words[0].length, deleting = true;

  function tick() {
    const word = words[w];
    el.textContent = word.slice(0, i);
    let delay = deleting ? 45 : 85;
    if (deleting) {
      i--;
      if (i < 0) { deleting = false; w = (w + 1) % words.length; i = 0; delay = 300; }
    } else {
      i++;
      if (i > words[w].length) { deleting = true; i = words[w].length; delay = 2200; }
    }
    setTimeout(tick, delay);
  }
  setTimeout(tick, 2200);
})();

// --- Мобильді мәзір ---
(function mobileMenu() {
  const burger = document.getElementById('burger');
  const menu = document.getElementById('menu');
  if (!burger || !menu) return;

  burger.addEventListener('click', () => {
    const open = burger.getAttribute('aria-expanded') === 'true';
    burger.setAttribute('aria-expanded', String(!open));
    burger.setAttribute('aria-label', open ? 'Мәзірді ашу' : 'Мәзірді жабу');
    menu.classList.toggle('is-open', !open);
    document.body.style.overflow = open ? '' : 'hidden';
  });

  // Мобильде ішкі тізімдерді басу арқылы ашу
  menu.querySelectorAll('.menu__link').forEach(btn => {
    btn.addEventListener('click', () => {
      if (window.innerWidth > 1024) return;
      btn.parentElement.classList.toggle('is-open');
    });
  });

  // Сілтемені басқанда мәзірді жабу
  menu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
    if (!menu.classList.contains('is-open')) return;
    burger.click();
  }));
})();

// --- Сандарды санау анимациясы ---
(function counters() {
  const els = document.querySelectorAll('[data-count]');
  const run = el => {
    const target = +el.dataset.count;
    const suffix = el.dataset.suffix || '';
    if (reduceMotion) { el.textContent = target + suffix; return; }
    const start = performance.now(), dur = 1400;
    const step = now => {
      const p = Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased) + (p === 1 ? suffix : '');
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { run(e.target); io.unobserve(e.target); } });
  }, { threshold: 0.6 });
  els.forEach(el => io.observe(el));
})();

// --- Айналдырғанда пайда болу ---
(function reveal() {
  const els = document.querySelectorAll('.reveal');
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target); } });
  }, { threshold: 0.15 });
  els.forEach((el, i) => { el.style.transitionDelay = (i % 3) * 80 + 'ms'; io.observe(el); });
})();

// --- Зерттеулер слайдері (автоматты ауысу + прогресс жолағы) ---
(function slider() {
  const root = document.getElementById('slider');
  if (!root) return;
  const slides = [...root.querySelectorAll('.slide')];
  const dotsWrap = document.getElementById('sliderDots');
  const bar = document.getElementById('sliderBar');
  const nav = root.parentElement.querySelector('.slider__nav');
  let index = 0;

  const dots = slides.map((_, i) => {
    const b = document.createElement('button');
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-label', `${i + 1}-слайд`);
    b.addEventListener('click', () => go(i));
    dotsWrap.appendChild(b);
    return b;
  });

  function restartBar() {
    if (reduceMotion) return;
    bar.classList.remove('run');
    void bar.offsetWidth; // анимацияны қайта бастау
    bar.classList.add('run');
  }

  function go(n) {
    index = (n + slides.length) % slides.length;
    slides.forEach((s, i) => {
      const active = i === index;
      s.classList.toggle('is-active', active);
      s.inert = !active;
      s.setAttribute('aria-hidden', String(!active));
    });
    dots.forEach((d, i) => d.setAttribute('aria-selected', String(i === index)));
    restartBar();
  }

  // Прогресс толғанда келесі слайдқа өту
  bar.addEventListener('animationend', () => go(index + 1));

  document.getElementById('sliderPrev').addEventListener('click', () => go(index - 1));
  document.getElementById('sliderNext').addEventListener('click', () => go(index + 1));

  // Тінтуір үстінде тұрғанда тоқтату
  const pause = on => nav.classList.toggle('is-paused', on);
  [root, nav].forEach(el => {
    el.addEventListener('mouseenter', () => pause(true));
    el.addEventListener('mouseleave', () => pause(false));
  });
  // Экраннан тыс болғанда тоқтату
  new IntersectionObserver(([e]) => pause(!e.isIntersecting), { threshold: 0.3 }).observe(root);

  // Пернетақта
  root.parentElement.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') go(index - 1);
    if (e.key === 'ArrowRight') go(index + 1);
  });

  // Телефонда саусақпен сырғыту
  let startX = null;
  root.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive: true });
  root.addEventListener('touchend', e => {
    if (startX === null) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 50) go(index + (dx < 0 ? 1 : -1));
    startX = null;
  });

  go(0);
})();
