// ===== Сауалнамаларды агрегаттау → data/surveys.js (window.MK_SURVEYS) =====
// tools/generate-surveys.js (демо JSON) және server/export-surveys.js (SQL Server) бірдей қолданады.
//   employers: [{ sector, region, hires: [{title, count}], skills: [{skill, trend, hardToFind}] }]
//   programs:  [{ title, graduates: {"2026": n, ...}, employmentRate, skills: [k], plannedSkills: [k] }]
const YEARS = [2026, 2027, 2028, 2029, 2030];
const N_TITLES = 34, N_SKILLS = 47, N_SECTORS = 8, N_REGIONS = 8;

const votesTable = () => Array.from({ length: N_SKILLS }, () => [0, 0, 0, 0]);
const r3 = x => Math.round(x * 1000) / 1000;

function buildSurveys({ employers, programs, realEmployers = 0, realPrograms = 0, demo = true }) {
  const votes = votesTable();
  const votesBySector = Array.from({ length: N_SECTORS }, votesTable);
  const votesByRegion = Array.from({ length: N_REGIONS }, votesTable);
  const hires = Array(N_TITLES).fill(0);

  for (const e of employers) {
    for (const { skill, trend, hardToFind } of e.skills) {
      const col = trend > 0 ? 0 : trend < 0 ? 2 : 1;
      for (const tbl of [votes, votesBySector[e.sector], votesByRegion[e.region]]) {
        if (!tbl) continue;
        tbl[skill][col]++;
        if (hardToFind) tbl[skill][3]++;
      }
    }
    for (const h of e.hires) hires[h.title] += h.count;
  }

  const supply = [], taught = [], planned = [];
  for (let t = 0; t < N_TITLES; t++) {
    const list = programs.filter(p => p.title === t);
    const rates = list.map(p => p.employmentRate).filter(r => r != null);
    supply.push({
      programs: list.length,
      graduates: YEARS.map(y => list.reduce((a, p) => a + (Number(p.graduates[y]) || 0), 0)),
      employment: rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length * 10) / 10 : null,
    });
    const share = key => Array.from({ length: N_SKILLS }, (_, k) =>
      list.length ? r3(list.filter(p => p[key].includes(k)).length / list.length) : 0);
    taught.push(share('skills'));
    planned.push(share('plannedSkills'));
  }

  return {
    meta: {
      generated: new Date().toISOString(), demo,
      employers: employers.length, programs: programs.length, realEmployers, realPrograms,
    },
    votes, votesBySector, votesByRegion, hires, supply, taught, planned,
  };
}

const toJs = (obj, source) =>
  `// Автоматты жасалған файл: ${source}\n// Жұмыс берушілер мен оқу орындары сауалнамаларының жиынтығы\nwindow.MK_SURVEYS = ${JSON.stringify(obj)};\n`;

module.exports = { buildSurveys, toJs, YEARS };
