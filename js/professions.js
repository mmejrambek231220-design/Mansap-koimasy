// ===== Мансап Компасы — мамандық бойынша дағдылар болжамы =====
// MKProf.analyze(t) — бір мамандыққа арналған болжам (profession.html да қолданады).
// professions.html бетінде — мамандықтар каталогы.
//
// Негізгі идея: дағдының «болашақтағы маңызы» тек вакансия санының өсуімен емес,
// оның осы мамандық вакансияларындағы ҮЛЕСІНІҢ өзгерісімен өлшенеді:
//   қазіргі үлес  = дағды талап етілген вакансиялар (соңғы 12 ай) / мамандықтың барлық вакансиялары (соңғы 12 ай)
//   болашақ үлес  = дағдының болжамы (таңдалған жыл) / мамандықтың жалпы вакансия болжамы (сол жыл)
// Екі қатар да Holt damped trend моделімен жеке болжанады.

const MKProf = (() => {
  const D = MK.D;

  // Санаттар: үлестің салыстырмалы өзгерісі (rel) және абсолютті өзгерісі (delta, пайыздық тармақ) бойынша.
  // delta шегі — сирек дағдылардағы кездейсоқ ауытқуды «негізгі» деп белгілемеу үшін.
  const CATS = {
    key: { name: 'Болашақтың негізгі дағдысы', cls: 'cat--key' },
    up: { name: 'Өсіп келе жатқан', cls: 'cat--up' },
    flat: { name: 'Тұрақты', cls: 'cat--flat' },
    down: { name: 'Маңызы азаюда', cls: 'cat--down' },
  };
  function classify(rel, delta, growth) {
    if (rel >= 0.15 && delta >= 0.02 && growth > 0) return 'key';
    if (rel >= 0.04 && delta > 0) return 'up';
    if (rel >= -0.12 || delta > -0.01) return 'flat';
    return 'down';
  }

  // t — мамандық индексі; region — өңір (-1 = барлық); year — болжам жылы
  function analyze(t, { region = -1, year = 2030, minBase = region >= 0 ? 4 : 8, backtest = false } = {}) {
    if (!(t >= 0 && t < D.titles.length)) return null;
    const ids = MK.filter({ title: t, region });
    const { results, agg } = MK.forecastSkills({ title: t, region }, year, { minBase, backtest });
    const demand = MK.forecastSeries(agg.total, year);   // мамандықтың жалпы вакансия сериясының болжамы

    // Орташа жалақы (соңғы 12 ай)
    let salS = 0, salN = 0;
    for (const i of ids) {
      const q = Math.floor(D.v[i][0] / 3);
      if (q > MK.LASTQ - 4 && q <= MK.LASTQ) { salS += D.v[i][5]; salN++; }
    }

    const now = Math.max(1, agg.totalLast), fut = Math.max(1, demand.target);
    const core = D.titleSkills[t] || [];
    const skills = results.map(r => {
      const shareNow = r.base / now;
      const shareFut = Math.min(1, r.target / fut);
      const rel = shareNow ? shareFut / shareNow - 1 : 0;
      return { ...r, shareNow, shareFut, delta: shareFut - shareNow, rel, cat: classify(rel, shareFut - shareNow, r.growth), core: core.includes(r.k) };
    });
    const byShare = [...skills].sort((a, b) => b.delta - a.delta);   // үлестің абсолютті өсуі бойынша
    const bts = skills.filter(s => s.bt);
    const mape = bts.length ? bts.reduce((a, s) => a + s.bt.mape, 0) / bts.length : null;
    const naive = bts.length ? bts.reduce((a, s) => a + s.bt.naiveMape, 0) / bts.length : null;

    return {
      t, name: D.titles[t], sector: D.titleSector[t], sectorName: D.sectors[D.titleSector[t]],
      region, year, minBase, ids, agg, demand, skills, byShare,
      future: byShare.filter(s => s.delta > 0.005 && s.growth > 0).slice(0, 3),
      declining: byShare.filter(s => s.cat === 'down').reverse(),   // ең көп азаятыны бірінші
      salary: salN ? salS / salN * 1000 : 0, mape, naive,
    };
  }

  const pp = d => (d >= 0 ? '+' : '−') + Math.abs(d * 100).toFixed(1).replace('.', ',') + ' п.т.';   // пайыздық тармақ
  const share = s => (s * 100).toFixed(1).replace('.', ',') + '%';
  const badge = c => `<span class="cat ${CATS[c].cls}">${CATS[c].name}</span>`;

  return { CATS, classify, analyze, pp, share, badge };
})();

// ===== professions.html — каталог =====
(function catalogPage() {
  const grid = document.getElementById('profGroups');
  if (!grid) return;
  const D = MK.D, YEAR = 2030;
  const $ = id => document.getElementById(id);
  const fSector = $('fSector'), fSearch = $('fSearch');

  D.sectors.forEach((s, i) => fSector.add(new Option(s, i)));
  const ps = MK.param('sector');
  if (ps !== null && D.sectors[+ps]) fSector.value = ps;

  // Барлық мамандыққа бір рет есептейміз (34 мамандық × ~20 дағды модель)
  const all = D.titles.map((_, t) => MKProf.analyze(t, { year: YEAR }));

  // Жалпы KPI
  const totLast = all.reduce((a, p) => a + p.agg.totalLast, 0);
  const totFc = all.reduce((a, p) => a + p.demand.target, 0);
  $('kpiProf').textContent = all.length;
  $('kpiVac').textContent = MK.fmt(totLast);
  $('kpiGrowth').textContent = MK.pct(totFc / Math.max(1, totLast) - 1);
  const best = [...all].sort((a, b) => b.demand.growth - a.demand.growth)[0];
  $('kpiBest').innerHTML = `<a href="${MK.link.profession(best.t)}">${MK.esc(best.name)}</a>`;
  $('kpiBestG').textContent = MK.pct(best.demand.growth);

  function card(p) {
    const g = p.demand.growth, up = g >= 0;
    const tags = p.future.length
      ? p.future.map(s => `<li><a href="${MK.link.skill(s.k)}" title="Үлесі: ${MKProf.share(s.shareNow)} → ${MKProf.share(s.shareFut)}">${MK.esc(s.name)} <b>${MKProf.pp(s.delta)}</b></a></li>`).join('')
      : '<li class="pc__none">Үлесі айқын өсетін дағды жоқ</li>';
    return `<article class="pc">
      <a class="pc__main" href="${MK.link.profession(p.t)}">
        <h3 class="pc__name">${MK.esc(p.name)}</h3>
        <dl class="pc__stats">
          <div><dt>Вакансиялар (12 ай)</dt><dd>${MK.fmt(p.agg.totalLast)}</dd></div>
          <div><dt>Сұраныс, ${YEAR}</dt><dd class="${up ? 'is-up' : 'is-down'}">${up ? '▲' : '▼'} ${MK.pct(g)}</dd></div>
          <div><dt>Орташа жалақы</dt><dd>${MK.fmt(p.salary / 1000)} мың ₸</dd></div>
        </dl>
      </a>
      <p class="pc__sub">Болашақта маңызы артатын дағдылар</p>
      <ul class="pc__tags">${tags}</ul>
      <a class="pc__more" href="${MK.link.profession(p.t)}">Толық болжам <span>→</span></a>
    </article>`;
  }

  function render() {
    const sec = +fSector.value, q = fSearch.value.trim().toLowerCase();
    const list = all.filter(p => (sec < 0 || p.sector === sec) &&
      (!q || p.name.toLowerCase().includes(q) || p.skills.some(s => s.core && s.name.toLowerCase().includes(q))));
    $('profCount').textContent = list.length;
    if (!list.length) {
      grid.innerHTML = '<p class="empty">Сұрауыңыз бойынша мамандық табылмады. Басқа сала немесе сөз таңдап көріңіз.</p>';
      return;
    }
    grid.innerHTML = D.sectors.map((name, s) => {
      const items = list.filter(p => p.sector === s);
      if (!items.length) return '';
      return `<section class="pgroup">
        <div class="pgroup__head"><h2>${MK.esc(name)}</h2><span>${items.length} мамандық</span></div>
        <div class="pgroup__grid">${items.map(card).join('')}</div>
      </section>`;
    }).join('');
  }

  fSector.addEventListener('change', render);
  fSearch.addEventListener('input', render);
  render();
})();
