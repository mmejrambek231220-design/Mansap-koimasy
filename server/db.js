// SQL Server-ге қосылу. Әдепкіде Windows аутентификациясы (Trusted_Connection) қолданылады.
// Баптауларды орта айнымалыларымен өзгертуге болады: DB_SERVER, DB_NAME, DB_DRIVER.
const sql = require('mssql/msnodesqlv8');

const SERVER = process.env.DB_SERVER || 'localhost';
const DATABASE = process.env.DB_NAME || 'MansapKompasy';
const DRIVER = process.env.DB_DRIVER || 'ODBC Driver 18 for SQL Server';

const connectionString = db =>
  `Driver={${DRIVER}};Server=${SERVER};Database=${db};Trusted_Connection=yes;TrustServerCertificate=yes;`;

let pool;
async function getPool() {
  if (!pool) pool = await new sql.ConnectionPool({ connectionString: connectionString(DATABASE) }).connect();
  return pool;
}

module.exports = { sql, getPool, connectionString, SERVER, DATABASE };
