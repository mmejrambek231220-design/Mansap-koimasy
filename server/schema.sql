-- Мансап Компасы — пайдаланушылар мен сессиялар кестелері (SQL Server)
-- init-db.js іске қосады; SSMS-те қолмен де орындауға болады (алдымен USE MansapKompasy).

IF OBJECT_ID('dbo.Users', 'U') IS NULL
CREATE TABLE dbo.Users (
  Id            INT IDENTITY(1,1) PRIMARY KEY,
  FullName      NVARCHAR(100)  NOT NULL,
  Email         NVARCHAR(254)  NOT NULL,
  PasswordHash  VARCHAR(100)   NOT NULL,          -- bcrypt хэші, құпиясөздің өзі сақталмайды
  Role          VARCHAR(20)    NOT NULL
    CONSTRAINT CK_Users_Role CHECK (Role IN ('student', 'employer', 'education')),
  CreatedAt     DATETIME2(0)   NOT NULL CONSTRAINT DF_Users_CreatedAt DEFAULT SYSUTCDATETIME(),
  LastLoginAt   DATETIME2(0)   NULL,
  CONSTRAINT UQ_Users_Email UNIQUE (Email)
);

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
