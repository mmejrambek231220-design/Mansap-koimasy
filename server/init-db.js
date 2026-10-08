// Дерекқорды жасайды (егер жоқ болса) және schema.sql кестелерін құрады.
// Іске қосу: npm run db:init
const fs = require('fs');
const path = require('path');
const { sql, connectionString, SERVER, DATABASE } = require('./db');

(async () => {
  const master = await new sql.ConnectionPool({ connectionString: connectionString('master') }).connect();
  await master.request()
    .input('name', sql.NVarChar, DATABASE)
    .query(`IF DB_ID(@name) IS NULL EXEC('CREATE DATABASE [' + @name + ']')`);
  await master.close();

  const db = await new sql.ConnectionPool({ connectionString: connectionString(DATABASE) }).connect();
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await db.request().batch(schema);
  const { recordset } = await db.request().query(`
    SELECT t.name, SUM(p.rows) AS rows
    FROM sys.tables t JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
    GROUP BY t.name ORDER BY t.name`);
  await db.close();

  console.log(`✓ ${SERVER} / ${DATABASE} дайын`);
  recordset.forEach(t => console.log(`  ${t.name}: ${t.rows} жол`));
})().catch(err => {
  console.error('Дерекқорды дайындау сәтсіз аяқталды:', err.message);
  process.exit(1);
});
