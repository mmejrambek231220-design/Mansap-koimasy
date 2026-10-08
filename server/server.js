// ===== Мансап Компасы — сервер =====
// Сайттың статикалық файлдарын береді, авторизация мен сауалнамалар API-ін ұсынады.
// Пайдаланушылар, ұйымдар мен сауалнамалар SQL Server-де сақталады (db.js, schema.sql).
//
//   POST   /api/auth/register  { fullName, email, password, role, orgName?, sector?, region? }
//   POST   /api/auth/login     { email, password, remember }
//   POST   /api/auth/logout
//   GET    /api/auth/me
//   POST   /api/surveys/employer        (жұмыс беруші) сауалнама жасау/жаңарту
//   DELETE /api/surveys/employer/:id
//   POST   /api/programs                (оқу орны) бағдарлама жасау/жаңарту
//   DELETE /api/programs/:id
//   GET    /api/surveys/mine            өз ұйымының сауалнамалары
//   GET    /api/insights/employer?sector=S   саладағы жұмыс берушілердің анонимді жиынтығы
//   GET    /api/insights/program/:id    бағдарламаның нарыққа сәйкестігі
//   GET    /api/surveys/stats           (ашық) сауалнамалар саны

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { sql, getPool, SERVER, DATABASE } = require('./db');
const { D, demand, nT, nK, nS } = require('./market');
const { saveEmployerSurvey, saveProgram, loadSurveys } = require('./surveys-db');
const { YEARS } = require('./surveys-agg');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.join(__dirname, '..');
const COOKIE = 'mk_session';
const DAY = 24 * 60 * 60 * 1000;
const ROLES = ['student', 'employer', 'education'];
const DUMMY_HASH = bcrypt.hashSync('mansap-kompasy', 10);
const SIZES = ['small', 'medium', 'large'];
const nR = D.regions.length;

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

// --- Көмекші функциялар ---
const parseCookies = header => Object.fromEntries((header || '').split(';')
  .map(s => s.trim().split('=')).filter(p => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));

function setSessionCookie(res, token, maxAge) {
  const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAge != null) parts.push(`Max-Age=${Math.floor(maxAge / 1000)}`);
  res.setHeader('Set-Cookie', parts.join('; '));
}

const publicUser = u => ({
  id: Number(u.Id), fullName: u.FullName, email: u.Email, role: u.Role, createdAt: u.CreatedAt,
  organization: u.OrganizationId == null ? null : {
    id: Number(u.OrganizationId), name: u.OrgName, type: u.OrgType, sector: u.OrgSector, region: u.OrgRegion,
  },
});
// Пайдаланушы + оның ұйымы
const USER_SQL = `SELECT u.*, o.Name AS OrgName, o.Type AS OrgType, o.Sector AS OrgSector, o.Region AS OrgRegion
  FROM dbo.Users u LEFT JOIN dbo.Organizations o ON o.Id = u.OrganizationId`;
const fail = (res, status, message) => res.status(status).json({ ok: false, message });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Сандарды тексеру (select мәндері жол болып келуі мүмкін)
const num = v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v);
const optNum = v => (v == null || v === '' ? null : num(v));
const isInt = (x, a, b) => Number.isInteger(x) && x >= a && x <= b;
const isIdx = (x, n) => isInt(x, 0, n - 1);
const unique = xs => new Set(xs).size === xs.length;
const range = n => Array.from({ length: n }, (_, i) => i);

async function inTx(db, fn) {
  const tx = new sql.Transaction(db);
  await tx.begin();
  try { const r = await fn(tx); await tx.commit(); return r; }
  catch (err) { await tx.rollback(); throw err; }
}

// Кіруді шектеу: бір IP-ден 15 минутта 10 сәтсіз әрекет
const attempts = new Map();
function tooManyAttempts(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter(t => now - t < 15 * 60 * 1000);
  attempts.set(ip, list);
  return list.length >= 10;
}
const recordFailure = ip => attempts.set(ip, [...(attempts.get(ip) || []), Date.now()]);

async function createSession(res, userId, remember) {
  const token = crypto.randomBytes(32).toString('hex');
  const ttl = remember ? 30 * DAY : DAY;
  const db = await getPool();
  await db.request()
    .input('token', sql.Char(64), token)
    .input('userId', sql.Int, userId)
    .input('expires', sql.DateTime2, new Date(Date.now() + ttl))
    .query('INSERT INTO dbo.Sessions (Token, UserId, ExpiresAt) VALUES (@token, @userId, @expires)');
  setSessionCookie(res, token, remember ? ttl : null);
}

async function currentUser(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const db = await getPool();
  const { recordset } = await db.request()
    .input('token', sql.Char(64), token)
    .query(`${USER_SQL} JOIN dbo.Sessions s ON s.UserId = u.Id
            WHERE s.Token = @token AND s.ExpiresAt > SYSUTCDATETIME()`);
  return recordset[0] || null;
}

// --- API ---
app.post('/api/auth/register', async (req, res, next) => {
  try {
    const fullName = String(req.body.fullName || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const role = String(req.body.role || '');

    if (fullName.length < 2 || fullName.length > 100) return fail(res, 400, 'Аты-жөніңізді толық жазыңыз.');
    if (!EMAIL_RE.test(email) || email.length > 254) return fail(res, 400, 'Электрондық пошта дұрыс емес.');
    if (password.length < 8 || !/\d/.test(password) || !/[a-zA-Zа-яА-ЯәіңғүұқөһӘІҢҒҮҰҚӨҺ]/.test(password))
      return fail(res, 400, 'Құпиясөз кемінде 8 таңбадан тұрып, әріп пен сан қамтуы керек.');
    if (!ROLES.includes(role)) return fail(res, 400, 'Кім екеніңізді таңдаңыз.');
    // Жұмыс беруші мен оқу орны үшін ұйым міндетті
    const hasOrg = role !== 'student';
    const orgName = String(req.body.orgName || '').trim();
    const sector = optNum(req.body.sector), region = optNum(req.body.region);
    if (hasOrg && (orgName.length < 2 || orgName.length > 200))
      return fail(res, 400, 'Ұйым атауын жазыңыз (2–200 таңба).');
    if (sector !== null && !isIdx(sector, nS)) return fail(res, 400, 'Сала дұрыс емес.');
    if (region !== null && !isIdx(region, nR)) return fail(res, 400, 'Өңір дұрыс емес.');

    const db = await getPool();
    const exists = await db.request().input('email', sql.NVarChar(254), email)
      .query('SELECT 1 FROM dbo.Users WHERE Email = @email');
    if (exists.recordset.length) return fail(res, 409, 'Бұл пошта бұрын тіркелген. Кіру бетін қолданыңыз.');

    const hash = await bcrypt.hash(password, 10);
    const userId = await inTx(db, async tx => {
      let orgId = null;
      if (hasOrg) {
        orgId = Number((await new sql.Request(tx)
          .input('name', sql.NVarChar(200), orgName).input('type', sql.VarChar(20), role)
          .input('sector', sql.TinyInt, sector).input('region', sql.TinyInt, region)
          .query(`INSERT INTO dbo.Organizations (Name, Type, Sector, Region) OUTPUT INSERTED.Id
                  VALUES (@name, @type, @sector, @region)`)).recordset[0].Id);
      }
      const { recordset } = await new sql.Request(tx)
        .input('fullName', sql.NVarChar(100), fullName)
        .input('email', sql.NVarChar(254), email)
        .input('hash', sql.VarChar(100), hash)
        .input('role', sql.VarChar(20), role)
        .input('org', sql.Int, orgId)
        .query(`INSERT INTO dbo.Users (FullName, Email, PasswordHash, Role, OrganizationId, LastLoginAt)
                OUTPUT INSERTED.Id VALUES (@fullName, @email, @hash, @role, @org, SYSUTCDATETIME())`);
      return Number(recordset[0].Id);
    });
    const { recordset } = await db.request().input('id', sql.Int, userId).query(`${USER_SQL} WHERE u.Id = @id`);
    await createSession(res, userId, true);
    res.status(201).json({ ok: true, user: publicUser(recordset[0]) });
  } catch (err) { next(err); }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    if (tooManyAttempts(req.ip)) return fail(res, 429, 'Әрекет тым көп. 15 минуттан кейін қайталаңыз.');
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    const db = await getPool();
    const { recordset } = await db.request().input('email', sql.NVarChar(254), email)
      .query(`${USER_SQL} WHERE u.Email = @email`);
    const user = recordset[0];
    // Пошта табылмаса да bcrypt жұмыс істейді — жауап уақыты бойынша пошта бар-жоғын білу мүмкін болмасын
    const ok = await bcrypt.compare(password, user ? user.PasswordHash : DUMMY_HASH);
    if (!user || !ok) {
      recordFailure(req.ip);
      return fail(res, 401, 'Пошта немесе құпиясөз қате.');
    }
    await db.request().input('id', sql.Int, user.Id)
      .query('UPDATE dbo.Users SET LastLoginAt = SYSUTCDATETIME() WHERE Id = @id');
    await createSession(res, user.Id, Boolean(req.body.remember));
    res.json({ ok: true, user: publicUser(user) });
  } catch (err) { next(err); }
});

app.post('/api/auth/logout', async (req, res, next) => {
  try {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token && /^[a-f0-9]{64}$/.test(token)) {
      const db = await getPool();
      await db.request().input('token', sql.Char(64), token).query('DELETE FROM dbo.Sessions WHERE Token = @token');
    }
    setSessionCookie(res, '', 0);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.get('/api/auth/me', async (req, res, next) => {
  try {
    const user = await currentUser(req);
    res.json({ ok: true, user: user ? publicUser(user) : null });
  } catch (err) { next(err); }
});

// ===== Сауалнамалар =====
// Кіру және рөл тексеру: req.user орнатылады
const requireRole = (...roles) => async (req, res, next) => {
  try {
    const user = await currentUser(req);
    if (!user) return fail(res, 401, 'Алдымен жүйеге кіріңіз.');
    if (!roles.includes(user.Role)) return fail(res, 403, roles.length > 1
      ? 'Бұл бөлім жұмыс берушілер мен оқу орындарына арналған.'
      : roles[0] === 'employer' ? 'Бұл бөлім тек жұмыс берушілерге арналған.' : 'Бұл бөлім тек оқу орындарына арналған.');
    req.user = user;
    next();
  } catch (err) { next(err); }
};

// Ұйымы жоқ ескі аккаунттарға аты бойынша ұйым жасалады
async function ensureOrg(db, user) {
  if (user.OrganizationId != null) return Number(user.OrganizationId);
  return inTx(db, async tx => {
    const id = Number((await new sql.Request(tx)
      .input('name', sql.NVarChar(200), user.FullName).input('type', sql.VarChar(20), user.Role)
      .query('INSERT INTO dbo.Organizations (Name, Type) OUTPUT INSERTED.Id VALUES (@name, @type)')).recordset[0].Id);
    await new sql.Request(tx).input('org', sql.Int, id).input('user', sql.Int, user.Id)
      .query('UPDATE dbo.Users SET OrganizationId = @org WHERE Id = @user');
    return id;
  });
}

const parseId = v => (v == null || v === '' ? null : isInt(num(v), 1, 2147483647) ? num(v) : NaN);

// Жұмыс беруші сауалнамасын тексеру: қате болса — мәтін, әйтпесе таза объект
function parseEmployerSurvey(b) {
  const sector = num(b.sector), region = num(b.region), horizonYears = num(b.horizonYears);
  if (!isIdx(sector, nS)) return 'Саланы таңдаңыз.';
  if (!isIdx(region, nR)) return 'Өңірді таңдаңыз.';
  if (!SIZES.includes(b.size)) return 'Ұйым көлемін таңдаңыз.';
  if (![1, 2, 3].includes(horizonYears)) return 'Жоспарлау мерзімі 1, 2 немесе 3 жыл болуы керек.';

  const hires = b.hires == null ? [] : b.hires, skills = b.skills, salaries = b.salaries == null ? [] : b.salaries;
  if (!Array.isArray(hires) || hires.length > nT) return 'Жұмысқа алу жоспары дұрыс емес.';
  const h = hires.map(x => ({ title: num(x && x.title), count: num(x && x.count) }));
  if (h.some(x => !isIdx(x.title, nT) || !isInt(x.count, 0, 100000)) || !unique(h.map(x => x.title)))
    return 'Жұмысқа алу жоспарында мамандық пен адам санын тексеріңіз.';

  if (!Array.isArray(skills) || skills.length < 3) return 'Кемінде 3 дағдыны бағалаңыз.';
  if (skills.length > nK) return 'Дағдылар тізімі дұрыс емес.';
  const k = skills.map(x => ({ skill: num(x && x.skill), trend: num(x && x.trend), hardToFind: Boolean(x && x.hardToFind) }));
  if (k.some(x => !isIdx(x.skill, nK) || ![-1, 0, 1].includes(x.trend)) || !unique(k.map(x => x.skill)))
    return 'Дағды бағаларын тексеріңіз.';

  if (!Array.isArray(salaries) || salaries.length > nT) return 'Жалақы ауқымы дұрыс емес.';
  const s = salaries.map(x => ({ title: num(x && x.title), from: num(x && x.from), to: num(x && x.to) }));
  if (s.some(x => !isIdx(x.title, nT) || !isInt(x.from, 1, 100000) || !isInt(x.to, x.from, 100000)) ||
      !unique(s.map(x => x.title)))
    return 'Жалақы ауқымын тексеріңіз (мың ₸, «дейін» ≥ «бастап»).';

  return { sector, region, size: b.size, horizonYears, hires: h.filter(x => x.count > 0), skills: k, salaries: s };
}

// Білім беру бағдарламасын тексеру
function parseProgram(b) {
  const title = num(b.title), name = String(b.name || '').trim();
  if (!isIdx(title, nT)) return 'Мамандықты таңдаңыз.';
  if (name.length < 2 || name.length > 200) return 'Бағдарлама атауын жазыңыз (2–200 таңба).';

  const g = b.graduates == null ? {} : b.graduates;
  if (typeof g !== 'object' || Array.isArray(g) || Object.keys(g).some(y => !YEARS.includes(Number(y))))
    return 'Түлектер саны 2026–2030 жылдар бойынша беріледі.';
  const graduates = {};
  for (const y of YEARS) {
    const v = optNum(g[y]);
    if (v === null) continue;
    if (!isInt(v, 0, 100000)) return `${y} жылғы түлектер санын тексеріңіз.`;
    graduates[y] = v;
  }

  const employmentRate = optNum(b.employmentRate);
  if (employmentRate !== null && !isInt(employmentRate, 0, 100)) return 'Жұмысқа орналасу үлесі 0–100% болуы керек.';

  const list = v => (Array.isArray(v) ? v.map(num) : null);
  const skills = list(b.skills), planned = list(b.plannedSkills == null ? [] : b.plannedSkills);
  if (!skills || skills.length < 3) return 'Кемінде 3 оқытылатын дағдыны таңдаңыз.';
  if (!planned || [...skills, ...planned].some(k => !isIdx(k, nK)) || !unique(skills) || !unique(planned))
    return 'Дағдылар тізімін тексеріңіз.';

  return { title, name, graduates, employmentRate, skills, plannedSkills: planned.filter(k => !skills.includes(k)) };
}

app.post('/api/surveys/employer', requireRole('employer'), async (req, res, next) => {
  try {
    const id = parseId(req.body.id);
    if (Number.isNaN(id)) return fail(res, 400, 'Сауалнама идентификаторы қате.');
    const data = parseEmployerSurvey(req.body);
    if (typeof data === 'string') return fail(res, 400, data);

    const db = await getPool();
    const orgId = await ensureOrg(db, req.user);
    const saved = await inTx(db, async tx => {
      const sid = await saveEmployerSurvey(tx, { id, orgId, userId: req.user.Id }, data);
      if (sid) await new sql.Request(tx).input('org', sql.Int, orgId).input('size', sql.VarChar(20), data.size)
        .input('sector', sql.TinyInt, data.sector).input('region', sql.TinyInt, data.region)
        .query(`UPDATE dbo.Organizations SET Size = @size, Sector = COALESCE(Sector, @sector),
                Region = COALESCE(Region, @region) WHERE Id = @org`);
      return sid;
    });
    if (!saved) return fail(res, 404, 'Сауалнама табылмады.');
    res.status(id ? 200 : 201).json({ ok: true, id: saved });
  } catch (err) { next(err); }
});

app.post('/api/programs', requireRole('education'), async (req, res, next) => {
  try {
    const id = parseId(req.body.id);
    if (Number.isNaN(id)) return fail(res, 400, 'Бағдарлама идентификаторы қате.');
    const data = parseProgram(req.body);
    if (typeof data === 'string') return fail(res, 400, data);

    const db = await getPool();
    const orgId = await ensureOrg(db, req.user);
    const saved = await inTx(db, tx => saveProgram(tx, { id, orgId, userId: req.user.Id }, data));
    if (!saved) return fail(res, 404, 'Бағдарлама табылмады.');
    res.status(id ? 200 : 201).json({ ok: true, id: saved });
  } catch (err) { next(err); }
});

// Тек өз ұйымының жазбасын өшіру
const deleteOwn = (role, table, notFound) => [requireRole(role), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id || req.user.OrganizationId == null) return fail(res, 404, notFound);
    const db = await getPool();
    const r = await db.request().input('id', sql.Int, id).input('org', sql.Int, req.user.OrganizationId)
      .query(`DELETE FROM ${table} WHERE Id = @id AND OrganizationId = @org`);
    if (!r.rowsAffected[0]) return fail(res, 404, notFound);
    res.json({ ok: true });
  } catch (err) { next(err); }
}];
app.delete('/api/surveys/employer/:id', ...deleteOwn('employer', 'dbo.EmployerSurveys', 'Сауалнама табылмады.'));
app.delete('/api/programs/:id', ...deleteOwn('education', 'dbo.EducationPrograms', 'Бағдарлама табылмады.'));

app.get('/api/surveys/mine', requireRole('employer', 'education'), async (req, res, next) => {
  try {
    const u = req.user;
    const empty = { employerSurveys: [], programs: [] };
    const db = await getPool();
    const data = u.OrganizationId == null ? empty : await loadSurveys(db, Number(u.OrganizationId));
    const strip = ({ isDemo, ...rest }) => rest;
    res.json({
      ok: true, organization: publicUser(u).organization,
      employerSurveys: data.employerSurveys.map(strip), programs: data.programs.map(strip),
    });
  } catch (err) { next(err); }
});

// Саладағы барлық жұмыс берушілердің (демо + нақты) анонимді жиынтығы
app.get('/api/insights/employer', requireRole('employer'), async (req, res, next) => {
  try {
    const sector = optNum(req.query.sector) ?? req.user.OrgSector;
    if (!isIdx(sector, nS)) return fail(res, 400, 'Саланы таңдаңыз.');
    const db = await getPool();
    const q = text => db.request().input('sector', sql.TinyInt, sector).query(text);
    const [n, skills, hires] = await Promise.all([
      q('SELECT COUNT(*) AS n FROM dbo.EmployerSurveys WHERE Sector = @sector'),
      q(`SELECT r.SkillId AS skill,
           SUM(CASE WHEN r.Trend = 1 THEN 1 ELSE 0 END) AS up,
           SUM(CASE WHEN r.Trend = 0 THEN 1 ELSE 0 END) AS same,
           SUM(CASE WHEN r.Trend = -1 THEN 1 ELSE 0 END) AS down,
           SUM(CAST(r.HardToFind AS INT)) AS hard
         FROM dbo.EmployerSkillRatings r JOIN dbo.EmployerSurveys s ON s.Id = r.SurveyId
         WHERE s.Sector = @sector GROUP BY r.SkillId ORDER BY r.SkillId`),
      q(`SELECT h.TitleId AS title, SUM(h.Count) AS count
         FROM dbo.EmployerHires h JOIN dbo.EmployerSurveys s ON s.Id = h.SurveyId
         WHERE s.Sector = @sector GROUP BY h.TitleId ORDER BY SUM(h.Count) DESC`),
    ]);
    res.json({ ok: true, sector, n: n.recordset[0].n, skills: skills.recordset, hires: hires.recordset });
  } catch (err) { next(err); }
});

// Бағдарламаның нарыққа сәйкестігі: оқытылатын дағдылар ↔ вакансиялар сұранысы + жұмыс берушілер бағасы
const DEMAND_MIN = 0.15;
app.get('/api/insights/program/:id', requireRole('education'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id || req.user.OrganizationId == null) return fail(res, 404, 'Бағдарлама табылмады.');
    const db = await getPool();
    const p = (await loadSurveys(db, Number(req.user.OrganizationId))).programs.find(x => x.id === id);
    if (!p) return fail(res, 404, 'Бағдарлама табылмады.');

    // Жұмыс берушілер бағасы: (өседі − азаяды) / бағалар саны, −1..1. Салада аз болса — барлық салалар.
    const sector = D.titleSector[p.title];
    const { recordset } = await db.request().input('sector', sql.TinyInt, sector).query(`
      SELECT r.SkillId, SUM(CASE WHEN s.Sector = @sector THEN r.Trend ELSE 0 END) AS secSum,
             SUM(CASE WHEN s.Sector = @sector THEN 1 ELSE 0 END) AS secN, SUM(r.Trend) AS allSum, COUNT(*) AS allN
      FROM dbo.EmployerSkillRatings r JOIN dbo.EmployerSurveys s ON s.Id = r.SurveyId GROUP BY r.SkillId`);
    const score = Array(nK).fill(null);
    recordset.forEach(r => {
      const [sum, n] = r.secN >= 3 ? [r.secSum, r.secN] : [r.allSum, r.allN];
      if (n) score[r.SkillId] = Math.round(sum / n * 100) / 100;
    });

    const dem = demand[p.title];
    const r2 = x => Math.round(x * 100) / 100;
    const taught = new Set(p.skills);
    const top = range(nK).filter(k => dem[k] >= DEMAND_MIN);
    const covered = top.filter(k => taught.has(k));
    const wsum = ks => ks.reduce((a, k) => a + dem[k], 0);
    const fit = top.length ? Math.round(100 * wsum(covered) / wsum(top)) : 100;
    // Жетіспейтіні: сұранысы жоғары немесе жұмыс берушілер «өседі» деп санайтын (≥ 0.5) дағдылар
    const missing = range(nK)
      .filter(k => !taught.has(k) && (dem[k] >= DEMAND_MIN || (dem[k] >= 0.05 && score[k] >= 0.5)))
      .map(k => ({ skill: k, demandShare: r2(dem[k]), trendScore: score[k], planned: p.plannedSkills.includes(k) }))
      .sort((a, b) => b.demandShare * (1 + Math.max(0, b.trendScore || 0)) - a.demandShare * (1 + Math.max(0, a.trendScore || 0)));
    // Ескіргені: жұмыс берушілер көбіне «азаяды» деп бағалаған оқытылатын дағдылар
    const outdated = p.skills.filter(k => score[k] != null && score[k] <= -0.3)
      .map(k => ({ skill: k, trendScore: score[k] })).sort((a, b) => a.trendScore - b.trendScore);

    res.json({ ok: true, title: p.title, fit, missing, outdated, covered });
  } catch (err) { next(err); }
});

// Ашық статистика: сауалнамалар саны (демо + нақты)
app.get('/api/surveys/stats', async (req, res, next) => {
  try {
    const db = await getPool();
    const { recordset: [r] } = await db.request().query(`
      SELECT (SELECT COUNT(*) FROM dbo.EmployerSurveys) AS employers,
             (SELECT COUNT(*) FROM dbo.EducationPrograms) AS programs,
             (SELECT COUNT(*) FROM dbo.EmployerSurveys s JOIN dbo.Organizations o ON o.Id = s.OrganizationId
               WHERE o.IsDemo = 0) AS realEmployers,
             (SELECT COUNT(*) FROM dbo.EducationPrograms p JOIN dbo.Organizations o ON o.Id = p.OrganizationId
               WHERE o.IsDemo = 0) AS realPrograms`);
    res.json({ ok: true, employers: r.employers, programs: r.programs,
      real: { employers: r.realEmployers, programs: r.realPrograms } });
  } catch (err) { next(err); }
});

app.use('/api', (req, res) => fail(res, 404, 'Мұндай API жоқ.'));

// --- Статикалық сайт (server/ және node_modules сыртқа берілмейді) ---
app.use((req, res, next) => (/^\/(server|collector|\.git)(\/|$)/.test(req.path) ? res.status(404).end() : next()));
app.use(express.static(ROOT, { extensions: ['html'] }));

app.use((err, req, res, next) => {
  console.error(err);
  fail(res, 500, 'Сервер қатесі. Дерекқор қосулы екенін тексеріңіз.');
});

app.listen(PORT, () => {
  console.log(`Мансап Компасы: http://localhost:${PORT}`);
  console.log(`Дерекқор: ${SERVER} / ${DATABASE}`);
});
