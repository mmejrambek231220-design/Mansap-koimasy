// data/surveys-demo.json демо сауалнамаларын SQL Server-ге жүктейді (IsDemo = 1 ұйымдар).
// Қайта іске қосуға болады: алдымен бұрынғы демо ұйымдар (және олардың сауалнамалары) өшіріледі.
// Іске қосу: npm run db:seed   (алдымен: node ../tools/generate-surveys.js, npm run db:init)
const fs = require('fs');
const path = require('path');
const { sql, getPool, SERVER, DATABASE } = require('./db');
const { saveEmployerSurvey, saveProgram } = require('./surveys-db');

(async () => {
  const demo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'surveys-demo.json'), 'utf8'));
  if (!demo.demo) throw new Error('surveys-demo.json демо деп белгіленбеген');

  const db = await getPool();
  const tx = new sql.Transaction(db);
  await tx.begin();
  try {
    // Демо ұйымдарға пайдаланушы байланбайды, бірақ сақтық үшін сілтемені алып тастаймыз
    await new sql.Request(tx).query(`
      UPDATE dbo.Users SET OrganizationId = NULL WHERE OrganizationId IN (SELECT Id FROM dbo.Organizations WHERE IsDemo = 1);
      DELETE FROM dbo.Organizations WHERE IsDemo = 1;`);

    const addOrg = async (name, type, sector, region, size) => (await new sql.Request(tx)
      .input('name', sql.NVarChar(200), name).input('type', sql.VarChar(20), type)
      .input('sector', sql.TinyInt, sector).input('region', sql.TinyInt, region).input('size', sql.VarChar(20), size)
      .query(`INSERT INTO dbo.Organizations (Name, Type, Sector, Region, Size, IsDemo) OUTPUT INSERTED.Id
              VALUES (@name, @type, @sector, @region, @size, 1)`)).recordset[0].Id;

    for (const e of demo.employers) {
      const orgId = await addOrg(e.name, 'employer', e.sector, e.region, e.size);
      await saveEmployerSurvey(tx, { orgId }, e);
    }
    let programs = 0;
    for (const e of demo.education) {
      const orgId = await addOrg(e.name, 'education', null, e.region, null);
      for (const p of e.programs) { await saveProgram(tx, { orgId }, p); programs++; }
    }
    await tx.commit();
    console.log(`✓ ${SERVER} / ${DATABASE}: демо жұмыс берушілер ${demo.employers.length}, ` +
      `оқу орындары ${demo.education.length}, бағдарламалар ${programs}`);
  } catch (err) {
    await tx.rollback();
    throw err;
  }
  await db.close();
})().catch(err => {
  console.error('Демо деректерді жүктеу сәтсіз аяқталды:', err.message);
  process.exit(1);
});
