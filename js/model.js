// ===== Мансап Компасы — болжам моделі =====
// Әдіс: Холттың демпферленген тренді бар экспоненциалды тегістеу (Holt damped trend, Gardner & McKenzie).
// Модель log(1 + y) шкаласында үйретіледі: өсу пайыздық түрде болады және болжам теріс мәнге түспейді.
// α, β, φ параметрлері торлы іздеумен (grid search) таңдалады: бір қадамдық және 4 тоқсан алға
// болжау қателерінің квадраттар қосындысы азайтылады.

const MKModel = (() => {
  const ALPHAS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
  const BETAS = [0.02, 0.05, 0.1, 0.2, 0.3];
  const PHIS = [0.8, 0.85, 0.9, 0.95, 0.98];
  const Z80 = 1.2816; // 80% сенімділік аралығы

  // sse — бір қадамдық қате (σ үшін), loss — бір қадамдық + 4 тоқсан алға қате (параметр таңдау үшін)
  function run(y, a, b, p) {
    let l = y[0], tr = (y[Math.min(3, y.length - 1)] - y[0]) / Math.min(3, y.length - 1) || 0, sse = 0, sse4 = 0;
    const d4 = p + p * p + p ** 3 + p ** 4;
    for (let t = 1; t < y.length; t++) {
      const f = l + p * tr;
      const e = y[t] - f;
      sse += e * e;
      const nl = a * y[t] + (1 - a) * f;
      tr = b * (nl - l) + (1 - b) * p * tr;
      l = nl;
      if (t + 4 < y.length) { const e4 = y[t + 4] - (l + d4 * tr); sse4 += e4 * e4; }
    }
    return { l, tr, sse, loss: sse + sse4 };
  }

  // series: сандар массиві (тоқсандық вакансия саны)
  function fit(series) {
    const y = series.map(v => Math.log1p(v));
    let best = null;
    for (const a of ALPHAS) for (const b of BETAS) for (const p of PHIS) {
      const r = run(y, a, b, p);
      if (!best || r.loss < best.loss) best = { ...r, alpha: a, beta: b, phi: p };
    }
    best.sigma = Math.sqrt(best.sse / Math.max(1, y.length - 4));
    best.n = y.length;
    return best;
  }

  // h қадам алға болжам: {mean, lo, hi} массивтері (бастапқы шкалада)
  function forecast(m, h) {
    const mean = [], lo = [], hi = [];
    let damp = 0;
    for (let i = 1; i <= h; i++) {
      damp += Math.pow(m.phi, i);
      const z = m.l + damp * m.tr;
      const s = m.sigma * Math.sqrt(1 + (i - 1) * m.alpha * m.alpha * (1 + m.beta) ** 2);
      mean.push(Math.max(0, Math.expm1(z)));
      lo.push(Math.max(0, Math.expm1(z - Z80 * s)));
      hi.push(Math.max(0, Math.expm1(z + Z80 * s)));
    }
    return { mean, lo, hi };
  }

  // Тарихи тексеру (backtest): соңғы `test` тоқсанды жасырып, болжаммен салыстырамыз
  function backtest(series, test = 4) {
    const train = series.slice(0, -test), actual = series.slice(-test);
    const pred = forecast(fit(train), test).mean;
    const naive = train[train.length - 1];
    let e = 0, en = 0;
    actual.forEach((a, i) => {
      const d = Math.max(a, 1);
      e += Math.abs(pred[i] - a) / d;
      en += Math.abs(naive - a) / d;
    });
    return { mape: e / test, naiveMape: en / test };
  }

  return { fit, forecast, backtest };
})();
