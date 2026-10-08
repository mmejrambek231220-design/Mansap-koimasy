// ===== Сүзгі панелі =====
// Беттегі <form class="filters"> оң жақтағы «Сүзгі» батырмасы ашатын шағын панельге көшіріледі.
// Түпнұсқа <select>/<input> элементтері DOM-да қалады (беттің өз JS-і солармен жұмыс істейді),
// тек олардың үстінен әдемі басқару элементтері салынады: аз нұсқа — чиптер, көп нұсқа — іздеуі бар тізім.

(() => {
  const form = document.querySelector('form.filters');
  if (!form) return;

  const CHIP_LIMIT = 10;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M7 12h10M10 18h4"/></svg>';

  // --- Батырма мен панель ---
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mf-toggle';
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = `${ICON}<span>Сүзгі</span><b class="mf-count" hidden></b>`;

  const panel = document.createElement('aside');
  panel.className = 'mf-panel';
  panel.setAttribute('aria-label', 'Сүзгілер');
  panel.hidden = true;
  panel.innerHTML = `
    <header class="mf-head">
      <h3>Сүзгілер</h3>
      <button type="button" class="mf-close" aria-label="Жабу">×</button>
    </header>
    <div class="mf-body"></div>
    <footer class="mf-foot">
      <button type="button" class="mf-reset">Тазалау</button>
      <button type="button" class="mf-apply">Дайын</button>
    </footer>`;
  const body = panel.querySelector('.mf-body');

  document.body.append(btn, panel);
  form.classList.add('mf-form');
  body.append(form);

  // --- Өрістер ---
  const fields = [...form.querySelectorAll('label')].map(label => {
    const control = label.querySelector('select, input');
    const title = label.querySelector('span');
    if (title) title.classList.add('mf-label');
    if (control && control.tagName === 'SELECT') {
      const ui = document.createElement('div');
      ui.className = 'mf-ui';
      control.after(ui);
      control.classList.add('mf-native');
      control.tabIndex = -1;
    }
    return { label, control, ui: label.querySelector('.mf-ui') };
  }).filter(f => f.control);

  // Нұсқа таңдалғанда — түпнұсқа select-ке жазып, беттің өз өңдеушісін іске қосамыз
  function choose(select, value) {
    if (select.value === value) return;
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function renderChips(f) {
    const s = f.control;
    f.ui.innerHTML = `<div class="mf-chips">${[...s.options].map(o =>
      `<button type="button" class="mf-chip${o.value === s.value ? ' is-on' : ''}" data-v="${esc(o.value)}">${esc(o.text)}</button>`).join('')}</div>`;
  }

  function renderDropdown(f) {
    const s = f.control;
    const cur = s.options[s.selectedIndex];
    f.ui.innerHTML = `
      <div class="mf-dd">
        <button type="button" class="mf-dd__btn"><span>${esc(cur ? cur.text : '—')}</span>
          <svg width="12" height="8" viewBox="0 0 12 8"><path d="M1 1l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></button>
        <div class="mf-dd__pop" hidden>
          <input type="search" class="mf-dd__q" placeholder="Іздеу…" autocomplete="off">
          <ul class="mf-dd__list">${[...s.options].map(o =>
            `<li><button type="button" class="mf-opt${o.value === s.value ? ' is-on' : ''}" data-v="${esc(o.value)}">${esc(o.text)}</button></li>`).join('')}</ul>
        </div>
      </div>`;
  }

  function render() {
    for (const f of fields) {
      if (!f.ui) continue;
      if (f.control.options.length <= CHIP_LIMIT) renderChips(f); else renderDropdown(f);
    }
    updateCount();
  }

  // Белсенді сүзгілер саны: «Барлығы» (-1) нұсқасынан өзгеше таңдау және бос емес іздеу
  function updateCount() {
    let n = 0;
    for (const { control: c } of fields) {
      if (c.tagName === 'INPUT') { if (c.value.trim()) n++; }
      else if ([...c.options].some(o => o.value === '-1') && c.value !== '-1') n++;
    }
    const badge = btn.querySelector('.mf-count');
    badge.textContent = n;
    badge.hidden = !n;
  }

  // --- Оқиғалар ---
  panel.addEventListener('click', e => {
    const chip = e.target.closest('.mf-chip, .mf-opt');
    if (chip) {
      const f = fields.find(x => x.ui && x.ui.contains(chip));
      choose(f.control, chip.dataset.v);
      render();
      return;
    }
    const ddBtn = e.target.closest('.mf-dd__btn');
    if (ddBtn) {
      const pop = ddBtn.nextElementSibling;
      const open = pop.hidden;
      panel.querySelectorAll('.mf-dd__pop').forEach(p => { p.hidden = true; });
      pop.hidden = !open;
      if (open) {
        const q = pop.querySelector('.mf-dd__q');
        q.focus();
        pop.querySelector('.is-on')?.scrollIntoView({ block: 'nearest' });
      }
      return;
    }
    if (!e.target.closest('.mf-dd')) panel.querySelectorAll('.mf-dd__pop').forEach(p => { p.hidden = true; });
  });

  panel.addEventListener('input', e => {
    if (!e.target.classList.contains('mf-dd__q')) { updateCount(); return; }
    const q = e.target.value.trim().toLowerCase();
    e.target.nextElementSibling.querySelectorAll('li').forEach(li => {
      li.hidden = q && !li.textContent.toLowerCase().includes(q);
    });
  });

  // Беттің JS-і select мәнін өзі өзгертсе де (мыс. графиктен дағды таңдағанда) панель сәйкес болуы үшін
  form.addEventListener('change', () => setTimeout(render));

  panel.querySelector('.mf-reset').addEventListener('click', () => {
    for (const { control: c } of fields) {
      if (c.tagName === 'INPUT') {
        if (c.value) { c.value = ''; c.dispatchEvent(new Event('input', { bubbles: true })); }
        continue;
      }
      const opts = [...c.options];
      const def = opts.find(o => o.value === '-1') || opts.find(o => o.defaultSelected);
      if (def) choose(c, def.value);
    }
    render();
  });

  const toggle = open => {
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    btn.classList.toggle('is-open', open);
    if (open) render();
  };
  btn.addEventListener('click', () => toggle(panel.hidden));
  panel.querySelector('.mf-close').addEventListener('click', () => toggle(false));
  panel.querySelector('.mf-apply').addEventListener('click', () => toggle(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) toggle(false); });
  document.addEventListener('mousedown', e => {
    if (!panel.hidden && !panel.contains(e.target) && !btn.contains(e.target)) toggle(false);
  });

  // Бет сүзгі формасын жасырса (мыс. мамандық табылмаса), батырма да көрінбейді
  const syncHidden = () => { btn.hidden = form.hidden || form.style.display === 'none'; };
  new MutationObserver(syncHidden).observe(form, { attributes: true, attributeFilter: ['hidden', 'style'] });
  syncHidden();

  render();
})();
