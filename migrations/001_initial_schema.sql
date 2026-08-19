-- Migration 001: Initial Database Schema for AKB Group Accounts

CREATE TABLE IF NOT EXISTS companies (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  name      VARCHAR(255) NOT NULL,
  code      VARCHAR(50) NOT NULL DEFAULT '',
  color     VARCHAR(50) NOT NULL DEFAULT '#2a78d6',
  sort      INT NOT NULL DEFAULT 0,
  active    BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  name          VARCHAR(255) NOT NULL,
  pass_hash     VARCHAR(255) NOT NULL,
  role          VARCHAR(50) NOT NULL DEFAULT 'staff',
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  must_change   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_companies (
  user_id    INT NOT NULL,
  company_id INT NOT NULL,
  PRIMARY KEY (user_id, company_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS settings (
  id         INT PRIMARY KEY DEFAULT 1,
  group_name VARCHAR(255) NOT NULL DEFAULT 'AKB Group',
  currency   VARCHAR(50) NOT NULL DEFAULT 'INR',
  fy_start   INT NOT NULL DEFAULT 4
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS categories (
  id    INT AUTO_INCREMENT PRIMARY KEY,
  kind  VARCHAR(50) NOT NULL,
  name  VARCHAR(255) NOT NULL,
  sort  INT NOT NULL DEFAULT 0,
  UNIQUE KEY kind_name_idx (kind, name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS projects (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  company_id  INT NOT NULL,
  name        VARCHAR(255) NOT NULL,
  code        VARCHAR(50) NOT NULL DEFAULT '',
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  sort        INT NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  INDEX projects_company_idx (company_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS txns (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  tdate       DATE NOT NULL,
  company_id  INT NOT NULL,
  project_id  INT DEFAULT NULL,
  type        VARCHAR(50) NOT NULL,
  category    VARCHAR(255) NOT NULL DEFAULT '',
  party       VARCHAR(255) NOT NULL DEFAULT '',
  invoice     VARCHAR(255) NOT NULL DEFAULT '',
  amount      DECIMAL(14,2) NOT NULL DEFAULT 0,
  method      VARCHAR(100) NOT NULL DEFAULT '',
  status      VARCHAR(50) NOT NULL DEFAULT 'paid',
  notes       TEXT,
  created_by  INT DEFAULT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX txns_date_idx (tdate DESC),
  INDEX txns_company_idx (company_id),
  INDEX txns_project_idx (project_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS transfers (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  tdate       DATE NOT NULL,
  from_id     INT NOT NULL,
  to_id       INT NOT NULL,
  amount      DECIMAL(14,2) NOT NULL DEFAULT 0,
  purpose     VARCHAR(255) NOT NULL DEFAULT '',
  ref         VARCHAR(255) NOT NULL DEFAULT '',
  created_by  INT DEFAULT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (from_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (to_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payment_requests (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  company_id       INT NOT NULL,
  project_id       INT DEFAULT NULL,
  rdate            DATE NOT NULL,
  work             TEXT,
  party            VARCHAR(255) NOT NULL DEFAULT '',
  invoice          VARCHAR(255) NOT NULL DEFAULT '',
  invoice_date     DATE DEFAULT NULL,
  category         VARCHAR(255) NOT NULL DEFAULT '',
  requested_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  approved_amount  DECIMAL(14,2) DEFAULT NULL,
  urgency          VARCHAR(50) NOT NULL DEFAULT 'normal',
  notes            TEXT,
  status           VARCHAR(50) NOT NULL DEFAULT 'pending',
  requested_by     INT DEFAULT NULL,
  approved_by      INT DEFAULT NULL,
  approved_at      DATETIME DEFAULT NULL,
  approval_note    TEXT,
  paid_by          INT DEFAULT NULL,
  paid_at          DATETIME DEFAULT NULL,
  paid_method      VARCHAR(100) NOT NULL DEFAULT '',
  paid_ref         VARCHAR(255) NOT NULL DEFAULT '',
  txn_id           INT DEFAULT NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (paid_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (txn_id) REFERENCES txns(id) ON DELETE SET NULL,
  INDEX pr_status_idx (status, rdate DESC)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS cash_counts (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  company_id  INT NOT NULL,
  cdate       DATE NOT NULL,
  amount      DECIMAL(14,2) NOT NULL DEFAULT 0,
  notes       TEXT,
  created_by  INT DEFAULT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX cash_company_idx (company_id, cdate DESC)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS cash_in (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  company_id  INT NOT NULL,
  project_id  INT DEFAULT NULL,
  cdate       DATE NOT NULL,
  amount      DECIMAL(14,2) NOT NULL DEFAULT 0,
  source      VARCHAR(255) NOT NULL DEFAULT '',
  ref         VARCHAR(255) NOT NULL DEFAULT '',
  notes       TEXT,
  txn_id      INT DEFAULT NULL,
  created_by  INT DEFAULT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY (txn_id) REFERENCES txns(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX cashin_company_idx (company_id, cdate DESC)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT DEFAULT NULL,
  user_name  VARCHAR(255) NOT NULL DEFAULT '',
  action     VARCHAR(255) NOT NULL,
  detail     TEXT,
  at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
