# Сервер (`server/`): авторизация және сауалнамалар

Сайттың статикалық файлдарын береді, кіру/тіркелу және сауалнамалар API-ін ұсынады. Пайдаланушылар, ұйымдар мен сауалнамалар **SQL Server**-де сақталады.
Жұмыс берушілер мен оқу орындарының жауаптары болжам ансамбліне (вакансиялар моделі + сарапшылар сигналы) және сұраныс/ұсыныс тапшылығы индексіне түседі.

## Қажет
- Node.js 18+
- SQL Server (Express/Developer/Enterprise) және **ODBC Driver 18 for SQL Server**
- Windows аутентификациясы (пайдаланушы аты/құпиясөз қажет емес)

## Іске қосу

```bash
cd server
npm install
npm run db:init   # MansapKompasy дерекқорын және кестелерді жасайды
npm run db:seed   # демо сауалнамаларды жүктейді (data/surveys-demo.json)
npm start         # http://localhost:3000
```

| Скрипт | Не жасайды |
|---|---|
| `npm run db:init` | Дерекқор мен кестелерді жасайды (қайта іске қосуға болады) |
| `npm run generate:surveys` | `node ../tools/generate-surveys.js` — демо жауаптар: `data/surveys-demo.json` + `data/surveys.js` |
| `npm run db:seed` | `data/surveys-demo.json`-ды SQL-ге жүктейді (`IsDemo = 1`; бұрынғы демо ұйымдар алдымен өшіріледі) |
| `npm run export:surveys` | SQL-дегі барлық сауалнамалардан (демо + нақты) `data/surveys.js`-ті қайта жасайды — нақты тіркелгендердің жауаптары статикалық сайтқа түседі |

Сайтты кіру мүмкіндігімен ашу үшін оны осы сервер арқылы ашу керек: http://localhost:3000/login.html

## Баптаулар (орта айнымалылары)

| Айнымалы | Әдепкі мәні |
|---|---|
| `PORT` | `3000` |
| `DB_SERVER` | `localhost` (мыс. `localhost\SQLEXPRESS`) |
| `DB_NAME` | `MansapKompasy` |
| `DB_DRIVER` | `ODBC Driver 18 for SQL Server` |
| `GOOGLE_CLIENT_ID` | бос (Google арқылы кіру өшірулі) |

## Дерекқор схемасы (`schema.sql`)

**dbo.Users** — `Id`, `FullName`, `Phone`, `Email`, `GoogleId` (үшеуі де толтырылса бірегей — сүзгіленген индекстер), `PasswordHash` (bcrypt; Google пайдаланушысында NULL), `Role` (`student` / `employer` / `education`), `OrganizationId`, `CreatedAt`, `LastLoginAt`.

**dbo.Sessions** — `Token` (кездейсоқ 64 hex), `UserId` → Users, `CreatedAt`, `ExpiresAt`.

Индекстер (сала 0–7, өңір 0–7, мамандық 0–33, дағды 0–46) `data/dataset.js`-тегі `window.MK_DATA` массивтеріне сәйкес.

**dbo.Organizations** — `Id`, `Name`, `Type` (`employer` / `education`), `Sector`, `Region`, `Size` (`small` / `medium` / `large`), `IsDemo` (1 = ойдан шығарылған), `CreatedAt`. `dbo.Users.OrganizationId` → Organizations.

**dbo.EmployerSurveys** — `Id`, `OrganizationId` (өшсе — каскад), `UserId`, `Sector`, `Region`, `Size`, `HorizonYears` (1–3), `CreatedAt`, `UpdatedAt`. Бағынышты кестелер (каскадпен өшеді):
- **dbo.EmployerHires** — `SurveyId`, `TitleId`, `Count` — жоспарланған жұмысқа алу;
- **dbo.EmployerSkillRatings** — `SurveyId`, `SkillId`, `Trend` (−1 азаяды / 0 тұрақты / 1 өседі), `HardToFind`;
- **dbo.EmployerSalary** — `SurveyId`, `TitleId`, `SalaryFrom`, `SalaryTo` (мың ₸, міндетті емес).

**dbo.EducationPrograms** — `Id`, `OrganizationId`, `UserId`, `TitleId`, `Name`, `EmploymentRate` (0–100), `CreatedAt`, `UpdatedAt`. Бағынышты кестелер:
- **dbo.ProgramGraduates** — `ProgramId`, `Year` (2026–2030), `Count`;
- **dbo.ProgramSkills** — `ProgramId`, `SkillId`, `Planned` (0 — қазір оқытылады, 1 — жаңа курс жоспарланған).

## API

| Әдіс | Жол | Денесі | Жауабы |
|---|---|---|---|
| GET | `/api/auth/config` | — | `{ ok, googleClientId \| null }` |
| POST | `/api/auth/phone/check` | `{ phone }` | `{ ok, phone, exists }` — нөмір тіркелген бе |
| POST | `/api/auth/register` | `{ fullName, phone, password, role, orgName?, sector?, region? }` | `{ ok, user }` + cookie |
| POST | `/api/auth/login` | `{ phone, password, remember }` | `{ ok, user }` + cookie |
| POST | `/api/auth/google` | `{ credential }` (Google ID token) | `{ ok, user }` немесе `{ ok, needProfile, pending, fullName, email }` |
| POST | `/api/auth/google/complete` | `{ pending, fullName, role, orgName?, sector?, region? }` | `{ ok, user }` + cookie |
| POST | `/api/auth/logout` | — | `{ ok }` |
| GET | `/api/auth/me` | — | `{ ok, user \| null }` |

Кіру екі жолмен ғана: **телефон нөмірі** (+ құпиясөз) және **Google**. Нөмір `+77XXXXXXXXX` түріне келтіріледі (`8 701…`, `+7 701…`, `701…` қабылданады). Google арқылы алғаш кірген адам рөл мен ұйымды таңдайды (`google/complete`); бұрын поштамен тіркелген аккаунт сол Google поштасымен автоматты байланысады.

### Google арқылы кіруді қосу
1. https://console.cloud.google.com → жоба жасау → **APIs & Services → OAuth consent screen** (External, тест пайдаланушыларына өз поштаңызды қосыңыз).
2. **Credentials → Create credentials → OAuth client ID** → түрі *Web application* → **Authorized JavaScript origins**: `http://localhost:3000`.
3. Шыққан Client ID-ді серверге беріп іске қосыңыз (PowerShell):
   ```powershell
   $env:GOOGLE_CLIENT_ID="xxxx.apps.googleusercontent.com"; npm start
   ```
Client ID берілмесе, кіру бетіндегі Google батырмасы «бапталмаған» деген хабар көрсетеді, телефон арқылы кіру жұмыс істей береді.

`register`: `employer` / `education` рөлдері үшін `orgName` міндетті (2–200 таңба), `sector`, `region` — қосымша. `user` объектісінде `organization: { id, name, type, sector, region } | null`.

### Сауалнамалар

Төмендегілер кіруді (`401 Алдымен жүйеге кіріңіз.`) және тиісті рөлді (`403`) талап етеді. Ұйымы жоқ ескі аккаунтқа алғашқы сақтауда аты бойынша ұйым жасалады.

| Әдіс | Жол | Рөл | Денесі / Жауабы |
|---|---|---|---|
| POST | `/api/surveys/employer` | employer | `{ id?, sector, region, size, horizonYears, hires: [{title, count}], skills: [{skill, trend, hardToFind}], salaries: [{title, from, to}] }` → `{ ok, id }` (кемінде 3 дағды; `id` болса — өз ұйымының сауалнамасы жаңартылады) |
| DELETE | `/api/surveys/employer/:id` | employer | `{ ok }` (тек өз ұйымынікі, әйтпесе 404) |
| POST | `/api/programs` | education | `{ id?, title, name, graduates: {"2026": n, …, "2030": n}, employmentRate, skills: [k], plannedSkills: [k] }` → `{ ok, id }` (кемінде 3 оқытылатын дағды) |
| DELETE | `/api/programs/:id` | education | `{ ok }` |
| GET | `/api/surveys/mine` | екеуі де | `{ ok, organization, employerSurveys: [...], programs: [...] }` |
| GET | `/api/insights/employer?sector=S` | employer | Саладағы барлық сауалнамалардың анонимді жиынтығы: `{ ok, sector, n, skills: [{skill, up, same, down, hard}], hires: [{title, count}] }` |
| GET | `/api/insights/program/:id` | education | Бағдарламаның нарыққа сәйкестігі: `{ ok, title, fit, missing: [{skill, demandShare, trendScore, planned}], outdated: [{skill, trendScore}], covered: [k] }` |
| GET | `/api/surveys/stats` | ашық | `{ ok, employers, programs, real: { employers, programs } }` |

**Нарыққа сәйкестік** (`insights/program`): `demandShare` — соңғы 12 айда осы мамандық вакансияларының дағдыны талап ететін үлесі (`data/dataset.js`, сервер іске қосылғанда бір рет есептеледі); `trendScore` — жұмыс берушілер бағасы `(өседі − азаяды) / бағалар саны` (−1…1, салада 3-тен аз баға болса — барлық салалар). `fit` (0–100) — сұранысы ≥ 15% дағдылардың сұраныспен өлшенген қамту үлесі. `missing` — оқытылмайтын, сұранысы ≥ 15% немесе (≥ 5% және `trendScore` ≥ 0.5) дағдылар; `outdated` — оқытылатын, `trendScore` ≤ −0.3 дағдылар.

## `data/surveys.js` форматы

```js
window.MK_SURVEYS = {
  meta: { generated, demo, employers, programs, realEmployers, realPrograms },
  votes: [[up, same, down, hardToFind] × 47],     // барлық жұмыс берушілер
  votesBySector: [8 × [[u, s, d, h] × 47]],
  votesByRegion: [8 × [[u, s, d, h] × 47]],
  hires: [34],                                      // жоспарланған жұмысқа алу қосындысы
  supply: [34 × { programs, graduates: [2026…2030], employment: орташа % | null }],
  taught: [34 × [47]],                              // дағдыны оқытатын бағдарламалар үлесі (0..1)
  planned: [34 × [47]],                             // дағдыны жоспарлаған бағдарламалар үлесі
};
```

Ортақ модульдер: `market.js` (вакансиялардан сұраныс үлесі мен трендтер), `surveys-agg.js` (агрегаттау), `surveys-db.js` (SQL-ге жазу/оқу).

**Демо деректер** (`tools/generate-surveys.js`, seed-ті): ~150 ойдан шығарылған жұмыс беруші және 18 оқу орнының ~70 бағдарламасы. Жауаптар вакансиялар трендіне сай (мыс. «Машиналық оқыту» — көбіне «өседі», «Қолмен деректер енгізу» — «азаяды»), оқу орындары жаңа өсіп жатқан дағдыларды кешігіп оқытады.

## Қауіпсіздік
- Құпиясөз ашық күйде сақталмайды — тек bcrypt хэші (cost 10).
- Барлық SQL сұраныстары параметрленген (SQL injection жоқ); сауалнама деректері серверде тексеріледі (индекстер, ауқымдар).
- Сауалнаманы тек өз ұйымының пайдаланушысы өзгерте/өшіре алады; `insights/employer` тек анонимді қосындыларды береді.
- Сессия cookie-і `HttpOnly`, `SameSite=Lax`; «Мені есте сақта» — 30 күн, әйтпесе браузер жабылғанша.
- Бір IP-ден 15 минутта 10 сәтсіз кіру әрекетінен кейін уақытша бұғаттау.
- Пошта табылмаса да bcrypt салыстыруы орындалады — жауап уақыты арқылы тіркелген поштаны анықтау мүмкін емес.
