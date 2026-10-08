-- Мансап Компасы — пайдаланушылар, сессиялар, ұйымдар және сауалнамалар кестелері (SQL Server)
-- init-db.js іске қосады; SSMS-те қолмен де орындауға болады (алдымен USE MansapKompasy).

IF OBJECT_ID('dbo.Users', 'U') IS NULL
CREATE TABLE dbo.Users (
  Id            INT IDENTITY(1,1) PRIMARY KEY,
  FullName      NVARCHAR(100)  NOT NULL,
  Phone         VARCHAR(20)    NULL,              -- +77XXXXXXXXX (телефон арқылы тіркелгенде)
  Email         NVARCHAR(254)  NULL,              -- Google арқылы тіркелгенде
  GoogleId      VARCHAR(64)    NULL,              -- Google аккаунтының тұрақты ID-і (sub)
  PasswordHash  VARCHAR(100)   NULL,              -- bcrypt хэші; Google пайдаланушысында жоқ
  Role          VARCHAR(20)    NOT NULL
    CONSTRAINT CK_Users_Role CHECK (Role IN ('student', 'employer', 'education')),
  CreatedAt     DATETIME2(0)   NOT NULL CONSTRAINT DF_Users_CreatedAt DEFAULT SYSUTCDATETIME(),
  LastLoginAt   DATETIME2(0)   NULL
);

-- Ескі дерекқорды жаңарту: пошта міндетті емес, телефон мен Google ID қосылады
IF COL_LENGTH('dbo.Users', 'Phone') IS NULL ALTER TABLE dbo.Users ADD Phone VARCHAR(20) NULL;
IF COL_LENGTH('dbo.Users', 'GoogleId') IS NULL ALTER TABLE dbo.Users ADD GoogleId VARCHAR(64) NULL;
IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = 'UQ_Users_Email')
  ALTER TABLE dbo.Users DROP CONSTRAINT UQ_Users_Email;
IF COLUMNPROPERTY(OBJECT_ID('dbo.Users'), 'Email', 'AllowsNull') = 0
  ALTER TABLE dbo.Users ALTER COLUMN Email NVARCHAR(254) NULL;
IF COLUMNPROPERTY(OBJECT_ID('dbo.Users'), 'PasswordHash', 'AllowsNull') = 0
  ALTER TABLE dbo.Users ALTER COLUMN PasswordHash VARCHAR(100) NULL;

-- Бірегейлік тек толтырылған мәндерге (NULL бірнеше рет бола алады). EXEC — жаңа бағандар бір пакетте танылуы үшін.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Users_Phone')
  EXEC('CREATE UNIQUE INDEX UX_Users_Phone ON dbo.Users(Phone) WHERE Phone IS NOT NULL');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Users_Email')
  EXEC('CREATE UNIQUE INDEX UX_Users_Email ON dbo.Users(Email) WHERE Email IS NOT NULL');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Users_GoogleId')
  EXEC('CREATE UNIQUE INDEX UX_Users_GoogleId ON dbo.Users(GoogleId) WHERE GoogleId IS NOT NULL');

IF OBJECT_ID('dbo.Sessions', 'U') IS NULL
CREATE TABLE dbo.Sessions (
  Token      CHAR(64)      NOT NULL PRIMARY KEY,   -- кездейсоқ 32 байт (hex)
  UserId     INT           NOT NULL
    CONSTRAINT FK_Sessions_Users REFERENCES dbo.Users(Id) ON DELETE CASCADE,
  CreatedAt  DATETIME2(0)  NOT NULL CONSTRAINT DF_Sessions_CreatedAt DEFAULT SYSUTCDATETIME(),
  ExpiresAt  DATETIME2(0)  NOT NULL
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Sessions_UserId')
CREATE INDEX IX_Sessions_UserId ON dbo.Sessions(UserId);

-- ===== Ұйымдар мен сауалнамалар =====
-- Индекстер (сала, өңір, мамандық, дағды) data/dataset.js-тегі window.MK_DATA массивтеріне сәйкес.

IF OBJECT_ID('dbo.Organizations', 'U') IS NULL
CREATE TABLE dbo.Organizations (
  Id         INT IDENTITY(1,1) PRIMARY KEY,
  Name       NVARCHAR(200)  NOT NULL,
  Type       VARCHAR(20)    NOT NULL
    CONSTRAINT CK_Organizations_Type CHECK (Type IN ('employer', 'education')),
  Sector     TINYINT        NULL,
  Region     TINYINT        NULL,
  Size       VARCHAR(20)    NULL
    CONSTRAINT CK_Organizations_Size CHECK (Size IN ('small', 'medium', 'large')),
  IsDemo     BIT            NOT NULL CONSTRAINT DF_Organizations_IsDemo DEFAULT 0,   -- 1 = ойдан шығарылған демо ұйым
  CreatedAt  DATETIME2(0)   NOT NULL CONSTRAINT DF_Organizations_CreatedAt DEFAULT SYSUTCDATETIME()
);

IF COL_LENGTH('dbo.Users', 'OrganizationId') IS NULL
ALTER TABLE dbo.Users ADD OrganizationId INT NULL
  CONSTRAINT FK_Users_Organizations REFERENCES dbo.Organizations(Id);

-- Жұмыс беруші сауалнамасы
IF OBJECT_ID('dbo.EmployerSurveys', 'U') IS NULL
CREATE TABLE dbo.EmployerSurveys (
  Id              INT IDENTITY(1,1) PRIMARY KEY,
  OrganizationId  INT           NOT NULL
    CONSTRAINT FK_EmployerSurveys_Organizations REFERENCES dbo.Organizations(Id) ON DELETE CASCADE,
  UserId          INT           NULL
    CONSTRAINT FK_EmployerSurveys_Users REFERENCES dbo.Users(Id) ON DELETE SET NULL,
  Sector          TINYINT       NOT NULL,
  Region          TINYINT       NOT NULL,
  Size            VARCHAR(20)   NOT NULL
    CONSTRAINT CK_EmployerSurveys_Size CHECK (Size IN ('small', 'medium', 'large')),
  HorizonYears    TINYINT       NOT NULL
    CONSTRAINT CK_EmployerSurveys_Horizon CHECK (HorizonYears BETWEEN 1 AND 3),
  CreatedAt       DATETIME2(0)  NOT NULL CONSTRAINT DF_EmployerSurveys_CreatedAt DEFAULT SYSUTCDATETIME(),
  UpdatedAt       DATETIME2(0)  NOT NULL CONSTRAINT DF_EmployerSurveys_UpdatedAt DEFAULT SYSUTCDATETIME()
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_EmployerSurveys_Org')
CREATE INDEX IX_EmployerSurveys_Org ON dbo.EmployerSurveys(OrganizationId);

-- Жоспарланған жұмысқа алу (мамандық → адам саны)
IF OBJECT_ID('dbo.EmployerHires', 'U') IS NULL
CREATE TABLE dbo.EmployerHires (
  SurveyId  INT      NOT NULL
    CONSTRAINT FK_EmployerHires_Surveys REFERENCES dbo.EmployerSurveys(Id) ON DELETE CASCADE,
  TitleId   TINYINT  NOT NULL,
  Count     INT      NOT NULL CONSTRAINT CK_EmployerHires_Count CHECK (Count >= 0),
  CONSTRAINT PK_EmployerHires PRIMARY KEY (SurveyId, TitleId)
);

-- Дағды бағасы: Trend −1 азаяды / 0 тұрақты / 1 өседі, HardToFind — маманды табу қиын
IF OBJECT_ID('dbo.EmployerSkillRatings', 'U') IS NULL
CREATE TABLE dbo.EmployerSkillRatings (
  SurveyId    INT       NOT NULL
    CONSTRAINT FK_EmployerSkillRatings_Surveys REFERENCES dbo.EmployerSurveys(Id) ON DELETE CASCADE,
  SkillId     TINYINT   NOT NULL,
  Trend       SMALLINT  NOT NULL CONSTRAINT CK_EmployerSkillRatings_Trend CHECK (Trend IN (-1, 0, 1)),
  HardToFind  BIT       NOT NULL CONSTRAINT DF_EmployerSkillRatings_Hard DEFAULT 0,
  CONSTRAINT PK_EmployerSkillRatings PRIMARY KEY (SurveyId, SkillId)
);

-- Ұсынылатын жалақы ауқымы (мың ₸), міндетті емес
IF OBJECT_ID('dbo.EmployerSalary', 'U') IS NULL
CREATE TABLE dbo.EmployerSalary (
  SurveyId    INT      NOT NULL
    CONSTRAINT FK_EmployerSalary_Surveys REFERENCES dbo.EmployerSurveys(Id) ON DELETE CASCADE,
  TitleId     TINYINT  NOT NULL,
  SalaryFrom  INT      NOT NULL,
  SalaryTo    INT      NOT NULL,
  CONSTRAINT PK_EmployerSalary PRIMARY KEY (SurveyId, TitleId),
  CONSTRAINT CK_EmployerSalary_Range CHECK (SalaryFrom > 0 AND SalaryTo >= SalaryFrom)
);

-- Оқу орнының білім беру бағдарламасы
IF OBJECT_ID('dbo.EducationPrograms', 'U') IS NULL
CREATE TABLE dbo.EducationPrograms (
  Id              INT IDENTITY(1,1) PRIMARY KEY,
  OrganizationId  INT            NOT NULL
    CONSTRAINT FK_EducationPrograms_Organizations REFERENCES dbo.Organizations(Id) ON DELETE CASCADE,
  UserId          INT            NULL
    CONSTRAINT FK_EducationPrograms_Users REFERENCES dbo.Users(Id) ON DELETE SET NULL,
  TitleId         TINYINT        NOT NULL,
  Name            NVARCHAR(200)  NOT NULL,
  EmploymentRate  TINYINT        NULL
    CONSTRAINT CK_EducationPrograms_Employment CHECK (EmploymentRate BETWEEN 0 AND 100),
  CreatedAt       DATETIME2(0)   NOT NULL CONSTRAINT DF_EducationPrograms_CreatedAt DEFAULT SYSUTCDATETIME(),
  UpdatedAt       DATETIME2(0)   NOT NULL CONSTRAINT DF_EducationPrograms_UpdatedAt DEFAULT SYSUTCDATETIME()
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_EducationPrograms_Org')
CREATE INDEX IX_EducationPrograms_Org ON dbo.EducationPrograms(OrganizationId);

-- Жыл бойынша түлектер саны (2026–2030)
IF OBJECT_ID('dbo.ProgramGraduates', 'U') IS NULL
CREATE TABLE dbo.ProgramGraduates (
  ProgramId  INT       NOT NULL
    CONSTRAINT FK_ProgramGraduates_Programs REFERENCES dbo.EducationPrograms(Id) ON DELETE CASCADE,
  Year       SMALLINT  NOT NULL CONSTRAINT CK_ProgramGraduates_Year CHECK (Year BETWEEN 2026 AND 2030),
  Count      INT       NOT NULL CONSTRAINT CK_ProgramGraduates_Count CHECK (Count >= 0),
  CONSTRAINT PK_ProgramGraduates PRIMARY KEY (ProgramId, Year)
);

-- Бағдарлама дағдылары: Planned 0 — қазір оқытылады, 1 — жаңа курс жоспарланған
IF OBJECT_ID('dbo.ProgramSkills', 'U') IS NULL
CREATE TABLE dbo.ProgramSkills (
  ProgramId  INT      NOT NULL
    CONSTRAINT FK_ProgramSkills_Programs REFERENCES dbo.EducationPrograms(Id) ON DELETE CASCADE,
  SkillId    TINYINT  NOT NULL,
  Planned    BIT      NOT NULL CONSTRAINT DF_ProgramSkills_Planned DEFAULT 0,
  CONSTRAINT PK_ProgramSkills PRIMARY KEY (ProgramId, SkillId)
);
