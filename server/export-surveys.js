// SQL Server-дегі барлық сауалнамалардан (демо + нақты) data/surveys.js файлын қайта жасайды,
// сонда нақты тіркелген ұйымдардың жауаптары статикалық сайтқа да түседі.
// Іске қосу: npm run export:surveys
const fs = require('fs');
const path = require('path');
const { getPool, SERVER, DATABASE } = require('./db');
const { loadSurveys } = require('./surveys-db');
const { buildSurveys, toJs } = require('./surveys-agg');

(async () => {
  const db = await getPool();
  const { employerSurveys, programs } = await loadSurveys(db);
  await db.close();

  const realEmployers = employerSurveys.filter(s => !s.isDemo).length;
  const realPrograms = programs.filter(p => !p.isDemo).length;
  const agg = buildSurveys({
    employers: employerSurveys, programs, realEmployers, realPrograms,
    demo: realEmployers < employerSurveys.length || realPrograms < programs.length,
  });
  const file = path.join(__dirname, '..', 'data', 'surveys.js');
  fs.writeFileSync(file, toJs(agg, `server/export-surveys.js (${SERVER} / ${DATABASE})`));
  console.log(`✓ data/surveys.js: жұмыс берушілер ${agg.meta.employers} (нақты ${realEmployers}), ` +
    `бағдарламалар ${agg.meta.programs} (нақты ${realPrograms})`);
})().catch(err => {
  console.error('Экспорт сәтсіз аяқталды:', err.message);
  process.exit(1);
});
