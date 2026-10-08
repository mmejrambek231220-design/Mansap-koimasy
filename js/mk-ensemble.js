// ===== Мансап Компасы — ансамбльдік болжам: Holt моделі + сауалнама =====
// Тәуелділіктер: data/dataset.js (MK_DATA), data/surveys.js (MK_SURVEYS — міндетті емес).
// Сауалнама файлы жоқ болса: has = false, blend() болжамды өзгертпейді (тек growthModel және т.б. өрістерді қосады).
//
// Әдіс (қорғауда түсіндіруге ыңғайлы, «модель + сарапшылар пікірі» ансамблі):
//   1) Жұмыс берушілер әр дағдыға «сұраныс өседі / өзгермейді / азаяды» деп дауыс береді.
//      n = өседі + өзгермейді + азаяды;   s = (өседі − азаяды) / n ∈ [−1; 1]  — дауыстар сальдосы.
//   2) Сауалнамадан шығатын өсу: gS = s · G · (жыл / 4), G = 0.6.
//      Мағынасы: барлық жұмыс беруші «өседі» десе (s = 1), 4 жылда сұраныс ≈ +60% өседі (жылына ≈ +12%).
//      Жыл = болжам көкжиегі (тоқсан) / 4 — соңғы 12 ай мен болжам жылының арасы. gS ∈ [−0.8; 1.5] шегінде.
//   3) Сауалнама салмағы: w = n / (n + K) · W_MAX, K = 20, W_MAX = 0.5; n < 5 болса w = 0 (сауалнама ескерілмейді).
//      Жауап көбейген сайын w → 0.5, яғни модель әрқашан кемінде жартылай шешім қабылдайды.
//   4) Ансамбль: g = (1 − w) · gModel + w · gS. Болжам мәні base · (1 + g)-ге жылжиды, 80% аралықтың ені сақталады.
//   Сүзгі: сала таңдалса (немесе мамандық — оның саласы) салалық дауыстар, әйтпесе өңір таңдалса өңірлік, әйтпесе барлығы.

const MKEnsemble = (() => {
  const D = window.MK_DATA, S = window.MK_SURVEYS;
  const G = 0.6, K = 20, W_MAX = 0.5, N_MIN = 5, G_MIN = -0.8, G_MAX = 1.5;
  const FIRST_YEAR = 2026;                       // supply.graduates[0] — 2026 жыл
  const has = Boolean(D && S && Array.isArray(S.votes) && S.votes.length === D.skills.length);
  const KEY = 'mk-fc-mode';

  let mode = 'ensemble';
  try { if (localStorage.getItem(KEY) === 'model') mode = 'model'; } catch (e) { /* сақтау қолжетімсіз */ }
  const on = () => has && mode === 'ensemble';
  function setMode(m) {
    mode = m === 'model' ? 'model' : 'ensemble';
    try { localStorage.setItem(KEY, mode); } catch (e) { /* елемейміз */ }
  }

  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const row = (arr, i, k) => (arr && arr[i] && arr[i][k]) || null;

  // Сүзгіге сай дауыстар: {v: [up, same, down, hard], scope: 'sector'|'region'|'all', idx}
  function votes(k, f = {}) {
    if (!has) return null;
    const sector = f.sector >= 0 ? f.sector : f.title >= 0 ? D.titleSector[f.title] : -1;
    let v = null, scope = 'all', idx = -1;
    if (sector >= 0 && (v = row(S.votesBySector, sector, k))) { scope = 'sector'; idx = sector; }
    else if (f.region >= 0 && (v = row(S.votesByRegion, f.region, k))) { scope = 'region'; idx = f.region; }
    else v = S.votes[k];
    return v ? { v, scope, idx } : null;
  }

  // Бір дауыстар жиынының көрсеткіштері
  function score(v, horizon = 16) {
    const [up = 0, same = 0, down = 0, hard = 0] = v || [];
    const n = up + same + down;
    const s = n ? (up - down) / n : 0;
    return {
      n, s, up, same, down, hard,
      hardShare: n ? hard / n : null,
      gS: n ? clamp(s * G * (horizon / 4) / 4, G_MIN, G_MAX) : null,
      w: n < N_MIN ? 0 : n / (n + K) * W_MAX,
    };
  }

  // r — болжам нәтижесі {base, target, lo, hi, growth, fc?}; k — дағды; f — сүзгі; horizon — тоқсан.
  // r-ді орнында толықтырады: growthModel, growthSurvey, surveyN, surveyW, hardShare, growth (ансамбль).
  function blend(r, k, f, horizon) {
    r.growthModel = r.growth;
    r.targetModel = r.target;
    const vs = votes(k, f);
    const sc = score(vs && vs.v, horizon);
    Object.assign(r, {
      growthSurvey: sc.gS, surveyN: sc.n, surveyW: sc.w, surveyScore: sc.s,
      hardShare: sc.hardShare, votes: vs ? vs.v : null, surveyScope: vs ? vs.scope : null, ensemble: false,
    });
    if (!on() || !sc.w || !r.base) return r;

    const g = (1 - sc.w) * r.growthModel + sc.w * sc.gS;
    const target = r.base * (1 + g), delta = target - r.target;
    if (r.fc && r.fc.mean.length) {
      // Болжам жолын біртіндеп жылжытамыз: соңғы 4 тоқсанда толық (сомасы дәл target болады)
      const h = r.fc.mean.length, full = Math.max(1, h - 3), R = r.target > 0 ? target / r.target : null;
      const mean = r.fc.mean.map((m, i) => {
        const a = Math.min(1, (i + 1) / full);
        return R !== null ? m * (1 + (R - 1) * a) : m + delta / 4 * a;
      });
      const d = mean.map((m, i) => m - r.fc.mean[i]);
      r.fcModel = r.fc;
      r.fc = { mean, lo: r.fc.lo.map((x, i) => Math.max(0, x + d[i])), hi: r.fc.hi.map((x, i) => x + d[i]) };
    }
    r.target = target;
    r.lo = Math.max(0, r.lo + delta);
    r.hi = Math.max(r.target, r.hi + delta);
    r.growth = g;
    r.ensemble = true;
    return r;
  }

  // --- Мамандық: түлектер (ұсыныс) және жұмыс берушілердің жоспары ---
  function supply(t) {
    if (!has || !S.supply || !S.supply[t]) return null;
    const s = S.supply[t];
    const grads = (s.graduates || []).map(Number);
    return {
      programs: s.programs || 0,
      employment: s.employment == null ? null : s.employment > 1 ? s.employment / 100 : s.employment,   // 0..1
      years: grads.map((_, i) => FIRST_YEAR + i), graduates: grads,
      at: y => { const i = y - FIRST_YEAR; return i >= 0 && i < grads.length ? grads[i] : null; },
      hires: S.hires ? S.hires[t] ?? null : null,
    };
  }
  // Сұраныс / түлектер қатынасы → мәртебе (0.8–1.25 аралығы — теңгерім)
  function balance(demand, grads) {
    if (!(grads > 0) || !(demand >= 0)) return null;
    const ratio = demand / grads;
    const st = ratio > 1.25 ? { id: 'short', name: 'Тапшылық', hint: 'вакансия түлектерден көп' }
      : ratio < 0.8 ? { id: 'surplus', name: 'Артық', hint: 'түлектер вакансиядан көп' }
        : { id: 'balance', name: 'Теңгерім', hint: 'сұраныс пен түлектер шамалас' };
    return { ratio, ...st };
  }

  // Дағды олқылығы: нарық сұрайды (болжам жылындағы үлес), оқу бағдарламалары аз оқытады.
  // skills: [{k, name, shareFut, growth}]
  function gap(t, skills) {
    if (!has || !S.taught || !S.taught[t]) return [];
    const taught = S.taught[t], planned = (S.planned && S.planned[t]) || [];
    return skills.map(s => {
      const dem = s.shareFut, tg = taught[s.k] || 0, pl = planned[s.k] || 0;
      const lowTaught = dem >= 0.25 && tg < 0.5 * dem;
      const growingLow = s.growth >= 0.2 && dem >= 0.1 && tg < 0.25;
      return { ...s, demand: dem, taught: tg, planned: pl, gapPP: dem - tg, flag: lowTaught || growingLow,
        reason: lowTaught ? 'share' : growingLow ? 'growth' : null };
    }).filter(x => x.flag).sort((a, b) => b.gapPP - a.gapPP);
  }

  // Карточкадағы ансамбль жолы (forecast, profession, skill беттері): модель, жұмыс берушілер, салмақ, «табу қиын»
  const pct = g => (g >= 0 ? '+' : '−') + Math.abs(g * 100).toFixed(0) + '%';
  const SCOPE = { sector: 'осы сала', region: 'осы өңір', all: 'барлық жұмыс берушілер' };
  function cardHtml(r) {
    if (!has || r.surveyN == null) return '';
    if (!r.surveyN) return '<div class="sc__ens"><p>Бұл дағды бойынша сауалнама жауаптары жоқ — тек модель.</p></div>';
    const note = !r.surveyW ? `<p class="sc__ens-note">Жауаптар аз (n &lt; ${N_MIN}) — сауалнама ескерілмейді.</p>`
      : !r.ensemble ? '<p class="sc__ens-note">«Модель» режимі: сауалнама болжамға қосылмаған.</p>' : '';
    return `<div class="sc__ens">
      <p>Модель: <b>${pct(r.growthModel)}</b> · Жұмыс берушілер: <b>${pct(r.growthSurvey)}</b> <small>(n=${r.surveyN}, ${SCOPE[r.surveyScope] || ''})</small> · Салмақ <b>w=${r.surveyW.toFixed(2)}</b></p>
      ${note}
      <p>Табу қиын: <b>${Math.round(r.hardShare * 100)}%</b> <small>— жұмыс берушілер осындай маманды табу қиын дейді</small></p>
    </div>`;
  }

  const meta = () => (has ? S.meta || {} : null);
  const sectorVotes = k => (has && S.votesBySector ? S.votesBySector.map((a, i) => ({ i, ...score(a[k]) })) : []);

  return { has, G, K, W_MAX, N_MIN, get mode() { return mode; }, setMode, on, votes, score, blend,
    supply, balance, gap, meta, sectorVotes, cardHtml };
})();
