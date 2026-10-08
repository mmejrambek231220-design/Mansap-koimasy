// ===== Нарық көрсеткіштері (data/dataset.js негізінде) =====
// Бір рет есептеледі және сервер мен генераторларда қолданылады:
//   demand[t][k] — соңғы 12 айда t мамандығы вакансияларының k дағдысын талап ететін үлесі (0..1)
//   trend(sec, k) — дағдының жылдық логарифмдік өсуі: (соңғы 4 тоқсан / алдыңғы 4 тоқсан) және
//                    (соңғы 4 тоқсан / 3 жыл бұрынғы 4 тоқсан)^(1/3) орташасы.
//                    Сала ішінде есептеліп, жалпы нарықпен 60/40 араластырылады (дерек аз болса — тек жалпы).
const path = require('path');

global.window = global.window || {};
require(path.join(__dirname, '..', 'data', 'dataset.js'));
const D = global.window.MK_DATA;

const M = D.meta.months;
const nT = D.titles.length, nK = D.skills.length, nS = D.sectors.length;
const zeros = n => Array(n).fill(0);

const titleN = zeros(nT);
const titleSkill = Array.from({ length: nT }, () => zeros(nK));
const cur = Array.from({ length: nS + 1 }, () => zeros(nK)); // соңғы индекс — барлық салалар
const prev = Array.from({ length: nS + 1 }, () => zeros(nK));
const old = Array.from({ length: nS + 1 }, () => zeros(nK)); // 3 жыл бұрынғы 12 ай

for (const [m, , sec, t, , , ks] of D.v) {
  if (m >= M - 12) {
    titleN[t]++;
    for (const k of ks) { titleSkill[t][k]++; cur[sec][k]++; cur[nS][k]++; }
  } else if (m >= M - 24) {
    for (const k of ks) { prev[sec][k]++; prev[nS][k]++; }
  } else if (m >= M - 48 && m < M - 36) {
    for (const k of ks) { old[sec][k]++; old[nS][k]++; }
  }
}

const demand = titleSkill.map((row, t) => row.map(c => titleN[t] ? c / titleN[t] : 0));

const growth = (s, k) => 0.5 * Math.log((cur[s][k] + 5) / (prev[s][k] + 5)) +
  0.5 * Math.log((cur[s][k] + 5) / (old[s][k] + 5)) / 3;
const trendTable = cur.map((row, s) => row.map((c, k) => s === nS || c + prev[s][k] < 150
  ? growth(nS, k) : 0.6 * growth(s, k) + 0.4 * growth(nS, k)));
const trend = (sec, k) => trendTable[sec == null || sec < 0 ? nS : sec][k];

module.exports = { D, demand, trend, nT, nK, nS };
