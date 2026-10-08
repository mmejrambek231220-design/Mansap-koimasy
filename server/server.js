// ===== Мансап Компасы — сервер =====
// Сайттың статикалық файлдарын береді және авторизация API-ін ұсынады.
// Пайдаланушылар мен сессиялар SQL Server-де сақталады (db.js, schema.sql).
//
//   POST /api/auth/register  { fullName, email, password, role }
//   POST /api/auth/login     { email, password, remember }
//   POST /api/auth/logout
//   GET  /api/auth/me

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { sql, getPool, SERVER, DATABASE } = require('./db');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.join(__dirname, '..');
const COOKIE = 'mk_session';
const DAY = 24 * 60 * 60 * 1000;
const ROLES = ['student', 'employer', 'education'];
const DUMMY_HASH = bcrypt.hashSync('mansap-kompasy', 10);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));

// --- Көмекші функциялар ---
const parseCookies = header => Object.fromEntries((header || '').split(';')
  .map(s => s.trim().split('=')).filter(p => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));

function setSessionCookie(res, token, maxAge) {
  const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAge != null) parts.push(`Max-Age=${Math.floor(maxAge / 1000)}`);
  res.setHeader('Set-Cookie', parts.join('; '));
}

const publicUser = u => ({ id: u.Id, fullName: u.FullName, email: u.Email, role: u.Role, createdAt: u.CreatedAt });
const fail = (res, status, message) => res.status(status).json({ ok: false, message });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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
    .query(`SELECT u.* FROM dbo.Sessions s JOIN dbo.Users u ON u.Id = s.UserId
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

    const db = await getPool();
    const exists = await db.request().input('email', sql.NVarChar(254), email)
      .query('SELECT 1 FROM dbo.Users WHERE Email = @email');
    if (exists.recordset.length) return fail(res, 409, 'Бұл пошта бұрын тіркелген. Кіру бетін қолданыңыз.');

    const hash = await bcrypt.hash(password, 10);
    const { recordset } = await db.request()
      .input('fullName', sql.NVarChar(100), fullName)
      .input('email', sql.NVarChar(254), email)
      .input('hash', sql.VarChar(100), hash)
      .input('role', sql.VarChar(20), role)
      .query(`INSERT INTO dbo.Users (FullName, Email, PasswordHash, Role, LastLoginAt)
              OUTPUT INSERTED.* VALUES (@fullName, @email, @hash, @role, SYSUTCDATETIME())`);
    await createSession(res, recordset[0].Id, true);
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
      .query('SELECT * FROM dbo.Users WHERE Email = @email');
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
