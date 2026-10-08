# Авторизация сервері (`server/`)

Сайттың статикалық файлдарын береді және кіру/тіркелу API-ін ұсынады. Пайдаланушылар **SQL Server**-де сақталады.

## Қажет
- Node.js 18+
- SQL Server (Express/Developer/Enterprise) және **ODBC Driver 18 for SQL Server**
- Windows аутентификациясы (пайдаланушы аты/құпиясөз қажет емес)

## Іске қосу

```bash
cd server
npm install
npm run db:init   # MansapKompasy дерекқорын және кестелерді жасайды
npm start         # http://localhost:3000
```

Сайтты кіру мүмкіндігімен ашу үшін оны осы сервер арқылы ашу керек: http://localhost:3000/login.html

## Баптаулар (орта айнымалылары)

| Айнымалы | Әдепкі мәні |
|---|---|
| `PORT` | `3000` |
| `DB_SERVER` | `localhost` (мыс. `localhost\SQLEXPRESS`) |
| `DB_NAME` | `MansapKompasy` |
| `DB_DRIVER` | `ODBC Driver 18 for SQL Server` |

## Дерекқор схемасы (`schema.sql`)

**dbo.Users** — `Id`, `FullName`, `Email` (бірегей), `PasswordHash` (bcrypt), `Role` (`student` / `employer` / `education`), `CreatedAt`, `LastLoginAt`.

**dbo.Sessions** — `Token` (кездейсоқ 64 hex), `UserId` → Users, `CreatedAt`, `ExpiresAt`.

## API

| Әдіс | Жол | Денесі | Жауабы |
|---|---|---|---|
| POST | `/api/auth/register` | `{ fullName, email, password, role }` | `{ ok, user }` + cookie |
| POST | `/api/auth/login` | `{ email, password, remember }` | `{ ok, user }` + cookie |
| POST | `/api/auth/logout` | — | `{ ok }` |
| GET | `/api/auth/me` | — | `{ ok, user \| null }` |

## Қауіпсіздік
- Құпиясөз ашық күйде сақталмайды — тек bcrypt хэші (cost 10).
- Барлық SQL сұраныстары параметрленген (SQL injection жоқ).
- Сессия cookie-і `HttpOnly`, `SameSite=Lax`; «Мені есте сақта» — 30 күн, әйтпесе браузер жабылғанша.
- Бір IP-ден 15 минутта 10 сәтсіз кіру әрекетінен кейін уақытша бұғаттау.
- Пошта табылмаса да bcrypt салыстыруы орындалады — жауап уақыты арқылы тіркелген поштаны анықтау мүмкін емес.
