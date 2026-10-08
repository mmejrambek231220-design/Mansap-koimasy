// ===== Сауалнамаларды SQL Server-ге жазу және оқу =====
// server.js (API), seed-demo.js (демо жүктеу) және export-surveys.js (data/surveys.js) ортақ қолданады.
// Деректер алдын ала тексерілген деп есептеледі (тексеру server.js-те).
const { sql } = require('./db');
const { YEARS } = require('./surveys-agg');

// Көп жолды параметрленген INSERT
async function insertRows(tx, table, cols, types, rows) {
  if (!rows.length) return;
  const req = new sql.Request(tx);
  const values = rows.map((row, i) => '(' + row.map((v, j) => {
    req.input(`p${i}_${j}`, types[j], v);
    return `@p${i}_${j}`;
  }).join(', ') + ')');
  await req.query(`INSERT INTO ${table} (${cols.join(', ')}) VALUES ${values.join(', ')}`);
}

// Жаңа жазба (id жоқ) немесе ұйымға тиесілі жазбаны жаңарту. Табылмаса null қайтарады.
async function upsertParent(tx, { table, id, orgId, userId, fields }) {
  const req = new sql.Request(tx).input('org', sql.Int, orgId).input('user', sql.Int, userId);
  fields.forEach(([col, type, value]) => req.input(col, type, value));
  if (id) {
    req.input('id', sql.Int, id);
    const r = await req.query(`UPDATE ${table} SET ${fields.map(([c]) => `${c} = @${c}`).join(', ')},
      UserId = COALESCE(@user, UserId), UpdatedAt = SYSUTCDATETIME() WHERE Id = @id AND OrganizationId = @org`);
    return r.rowsAffected[0] ? id : null;
  }
  const cols = fields.map(([c]) => c);
  const r = await req.query(`INSERT INTO ${table} (OrganizationId, UserId, ${cols.join(', ')}) OUTPUT INSERTED.Id
    VALUES (@org, @user, ${cols.map(c => '@' + c).join(', ')})`);
  return Number(r.recordset[0].Id);
}

async function saveEmployerSurvey(tx, { id, orgId, userId = null }, s) {
  id = await upsertParent(tx, {
    table: 'dbo.EmployerSurveys', id, orgId, userId, fields: [
      ['Sector', sql.TinyInt, s.sector], ['Region', sql.TinyInt, s.region],
      ['Size', sql.VarChar(20), s.size], ['HorizonYears', sql.TinyInt, s.horizonYears],
    ],
  });
  if (!id) return null;
  for (const t of ['EmployerHires', 'EmployerSkillRatings', 'EmployerSalary'])
    await new sql.Request(tx).input('id', sql.Int, id).query(`DELETE FROM dbo.${t} WHERE SurveyId = @id`);
  await insertRows(tx, 'dbo.EmployerHires', ['SurveyId', 'TitleId', 'Count'], [sql.Int, sql.TinyInt, sql.Int],
    s.hires.map(h => [id, h.title, h.count]));
  await insertRows(tx, 'dbo.EmployerSkillRatings', ['SurveyId', 'SkillId', 'Trend', 'HardToFind'],
    [sql.Int, sql.TinyInt, sql.SmallInt, sql.Bit], s.skills.map(k => [id, k.skill, k.trend, k.hardToFind ? 1 : 0]));
  await insertRows(tx, 'dbo.EmployerSalary', ['SurveyId', 'TitleId', 'SalaryFrom', 'SalaryTo'],
    [sql.Int, sql.TinyInt, sql.Int, sql.Int], (s.salaries || []).map(x => [id, x.title, x.from, x.to]));
  return id;
}

async function saveProgram(tx, { id, orgId, userId = null }, p) {
  id = await upsertParent(tx, {
    table: 'dbo.EducationPrograms', id, orgId, userId, fields: [
      ['TitleId', sql.TinyInt, p.title], ['Name', sql.NVarChar(200), p.name],
      ['EmploymentRate', sql.TinyInt, p.employmentRate == null ? null : p.employmentRate],
    ],
  });
  if (!id) return null;
  for (const t of ['ProgramGraduates', 'ProgramSkills'])
    await new sql.Request(tx).input('id', sql.Int, id).query(`DELETE FROM dbo.${t} WHERE ProgramId = @id`);
  await insertRows(tx, 'dbo.ProgramGraduates', ['ProgramId', 'Year', 'Count'], [sql.Int, sql.SmallInt, sql.Int],
    YEARS.filter(y => p.graduates[y] != null).map(y => [id, y, p.graduates[y]]));
  await insertRows(tx, 'dbo.ProgramSkills', ['ProgramId', 'SkillId', 'Planned'], [sql.Int, sql.TinyInt, sql.Bit],
    [...p.skills.map(k => [id, k, 0]), ...p.plannedSkills.map(k => [id, k, 1])]);
  return id;
}

// Барлық сауалнамалар (orgId берілсе — тек сол ұйымдікі). Әр жазбада isDemo өрісі бар.
async function loadSurveys(db, orgId = null) {
  const q = text => db.request().input('org', sql.Int, orgId).query(text);
  const ORG = '(@org IS NULL OR p.OrganizationId = @org)';
  const [surveys, hires, ratings, salaries, programs, grads, skills] = await Promise.all([
    q(`SELECT p.*, o.IsDemo FROM dbo.EmployerSurveys p JOIN dbo.Organizations o ON o.Id = p.OrganizationId
       WHERE ${ORG} ORDER BY p.Id`),
    q(`SELECT c.* FROM dbo.EmployerHires c JOIN dbo.EmployerSurveys p ON p.Id = c.SurveyId WHERE ${ORG} ORDER BY c.TitleId`),
    q(`SELECT c.* FROM dbo.EmployerSkillRatings c JOIN dbo.EmployerSurveys p ON p.Id = c.SurveyId WHERE ${ORG} ORDER BY c.SkillId`),
    q(`SELECT c.* FROM dbo.EmployerSalary c JOIN dbo.EmployerSurveys p ON p.Id = c.SurveyId WHERE ${ORG} ORDER BY c.TitleId`),
    q(`SELECT p.*, o.IsDemo FROM dbo.EducationPrograms p JOIN dbo.Organizations o ON o.Id = p.OrganizationId
       WHERE ${ORG} ORDER BY p.Id`),
    q(`SELECT c.* FROM dbo.ProgramGraduates c JOIN dbo.EducationPrograms p ON p.Id = c.ProgramId WHERE ${ORG}`),
    q(`SELECT c.* FROM dbo.ProgramSkills c JOIN dbo.EducationPrograms p ON p.Id = c.ProgramId WHERE ${ORG} ORDER BY c.SkillId`),
  ]);
  const group = (rows, key) => {
    const m = new Map();
    for (const r of rows.recordset) { const id = Number(r[key]); if (!m.has(id)) m.set(id, []); m.get(id).push(r); }
    return m;
  };
  const H = group(hires, 'SurveyId'), R = group(ratings, 'SurveyId'), S = group(salaries, 'SurveyId');
  const G = group(grads, 'ProgramId'), K = group(skills, 'ProgramId');

  // msnodesqlv8 IDENTITY бағанын мәтін ретінде қайтаруы мүмкін — санға келтіреміз
  const employerSurveys = surveys.recordset.map(s => (s.Id = Number(s.Id), {
    id: s.Id, sector: s.Sector, region: s.Region, size: s.Size, horizonYears: s.HorizonYears,
    hires: (H.get(s.Id) || []).map(h => ({ title: h.TitleId, count: h.Count })),
    skills: (R.get(s.Id) || []).map(r => ({ skill: r.SkillId, trend: r.Trend, hardToFind: r.HardToFind })),
    salaries: (S.get(s.Id) || []).map(x => ({ title: x.TitleId, from: x.SalaryFrom, to: x.SalaryTo })),
    updatedAt: s.UpdatedAt, isDemo: s.IsDemo,
  }));
  const progs = programs.recordset.map(p => {
    p.Id = Number(p.Id);
    const g = G.get(p.Id) || [], ks = K.get(p.Id) || [];
    return {
      id: p.Id, title: p.TitleId, name: p.Name,
      graduates: Object.fromEntries(YEARS.map(y => [String(y), (g.find(r => r.Year === y) || { Count: 0 }).Count])),
      employmentRate: p.EmploymentRate,
      skills: ks.filter(r => !r.Planned).map(r => r.SkillId),
      plannedSkills: ks.filter(r => r.Planned).map(r => r.SkillId),
      updatedAt: p.UpdatedAt, isDemo: p.IsDemo,
    };
  });
  return { employerSurveys, programs: progs };
}

module.exports = { saveEmployerSurvey, saveProgram, loadSurveys };
