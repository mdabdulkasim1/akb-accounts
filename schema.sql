-- ====================================================
-- AKB Group Accounts - Full MySQL Schema & Initial Data
-- ====================================================

CREATE DATABASE IF NOT EXISTS `akb-accounts` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `akb-accounts`;

-- 1. Companies
CREATE TABLE IF NOT EXISTS `companies` (
  `id`        INT AUTO_INCREMENT PRIMARY KEY,
  `name`      VARCHAR(255) NOT NULL,
  `code`      VARCHAR(50) NOT NULL DEFAULT '',
  `color`     VARCHAR(50) NOT NULL DEFAULT '#2a78d6',
  `sort`      INT NOT NULL DEFAULT 0,
  `active`    TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB;

-- 2. Users
CREATE TABLE IF NOT EXISTS `users` (
  `id`            INT AUTO_INCREMENT PRIMARY KEY,
  `email`         VARCHAR(255) NOT NULL UNIQUE,
  `name`          VARCHAR(255) NOT NULL,
  `pass_hash`     VARCHAR(255) NOT NULL,
  `role`          VARCHAR(50) NOT NULL DEFAULT 'staff',
  `active`        TINYINT(1) NOT NULL DEFAULT 1,
  `must_change`   TINYINT(1) NOT NULL DEFAULT 0,
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 3. User Companies Mapping
CREATE TABLE IF NOT EXISTS `user_companies` (
  `user_id`    INT NOT NULL,
  `company_id` INT NOT NULL,
  PRIMARY KEY (`user_id`, `company_id`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 4. Settings
CREATE TABLE IF NOT EXISTS `settings` (
  `id`         INT PRIMARY KEY DEFAULT 1,
  `group_name` VARCHAR(255) NOT NULL DEFAULT 'AKB Group',
  `currency`   VARCHAR(50) NOT NULL DEFAULT 'INR',
  `fy_start`   INT NOT NULL DEFAULT 4
) ENGINE=InnoDB;

-- 5. Categories
CREATE TABLE IF NOT EXISTS `categories` (
  `id`    INT AUTO_INCREMENT PRIMARY KEY,
  `kind`  VARCHAR(50) NOT NULL,
  `name`  VARCHAR(255) NOT NULL,
  `sort`  INT NOT NULL DEFAULT 0,
  UNIQUE KEY `kind_name_idx` (`kind`, `name`)
) ENGINE=InnoDB;

-- 6. Projects / Locations
CREATE TABLE IF NOT EXISTS `projects` (
  `id`          INT AUTO_INCREMENT PRIMARY KEY,
  `company_id`  INT NOT NULL,
  `name`        VARCHAR(255) NOT NULL,
  `code`        VARCHAR(50) NOT NULL DEFAULT '',
  `active`      TINYINT(1) NOT NULL DEFAULT 1,
  `sort`        INT NOT NULL DEFAULT 0,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE CASCADE,
  INDEX `projects_company_idx` (`company_id`)
) ENGINE=InnoDB;

-- 7. Transactions
CREATE TABLE IF NOT EXISTS `txns` (
  `id`          INT AUTO_INCREMENT PRIMARY KEY,
  `tdate`       DATE NOT NULL,
  `company_id`  INT NOT NULL,
  `project_id`  INT DEFAULT NULL,
  `type`        VARCHAR(50) NOT NULL,
  `category`    VARCHAR(255) NOT NULL DEFAULT '',
  `party`       VARCHAR(255) NOT NULL DEFAULT '',
  `invoice`     VARCHAR(255) NOT NULL DEFAULT '',
  `amount`      DECIMAL(14,2) NOT NULL DEFAULT 0,
  `method`      VARCHAR(100) NOT NULL DEFAULT '',
  `status`      VARCHAR(50) NOT NULL DEFAULT 'paid',
  `notes`       TEXT,
  `created_by`  INT DEFAULT NULL,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  INDEX `txns_date_idx` (`tdate` DESC),
  INDEX `txns_company_idx` (`company_id`),
  INDEX `txns_project_idx` (`project_id`)
) ENGINE=InnoDB;

-- 8. Transfers
CREATE TABLE IF NOT EXISTS `transfers` (
  `id`          INT AUTO_INCREMENT PRIMARY KEY,
  `tdate`       DATE NOT NULL,
  `from_id`     INT NOT NULL,
  `to_id`       INT NOT NULL,
  `amount`      DECIMAL(14,2) NOT NULL DEFAULT 0,
  `purpose`     VARCHAR(255) NOT NULL DEFAULT '',
  `ref`         VARCHAR(255) NOT NULL DEFAULT '',
  `created_by`  INT DEFAULT NULL,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`from_id`) REFERENCES `companies`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`to_id`) REFERENCES `companies`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

-- 9. Payment Requests
CREATE TABLE IF NOT EXISTS `payment_requests` (
  `id`               INT AUTO_INCREMENT PRIMARY KEY,
  `company_id`       INT NOT NULL,
  `project_id`       INT DEFAULT NULL,
  `rdate`            DATE NOT NULL,
  `work`             TEXT,
  `party`            VARCHAR(255) NOT NULL DEFAULT '',
  `invoice`          VARCHAR(255) NOT NULL DEFAULT '',
  `invoice_date`     DATE DEFAULT NULL,
  `category`         VARCHAR(255) NOT NULL DEFAULT '',
  `requested_amount` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `approved_amount`  DECIMAL(14,2) DEFAULT NULL,
  `urgency`          VARCHAR(50) NOT NULL DEFAULT 'normal',
  `notes`            TEXT,
  `status`           VARCHAR(50) NOT NULL DEFAULT 'pending',
  `requested_by`     INT DEFAULT NULL,
  `approved_by`      INT DEFAULT NULL,
  `approved_at`      DATETIME DEFAULT NULL,
  `approval_note`    TEXT,
  `paid_by`          INT DEFAULT NULL,
  `paid_at`          DATETIME DEFAULT NULL,
  `paid_method`      VARCHAR(100) NOT NULL DEFAULT '',
  `paid_ref`         VARCHAR(255) NOT NULL DEFAULT '',
  `txn_id`           INT DEFAULT NULL,
  `created_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`paid_by`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`txn_id`) REFERENCES `txns`(`id`) ON DELETE SET NULL,
  INDEX `pr_status_idx` (`status`, `rdate` DESC)
) ENGINE=InnoDB;

-- 10. Cash Counts
CREATE TABLE IF NOT EXISTS `cash_counts` (
  `id`          INT AUTO_INCREMENT PRIMARY KEY,
  `company_id`  INT NOT NULL,
  `cdate`       DATE NOT NULL,
  `amount`      DECIMAL(14,2) NOT NULL DEFAULT 0,
  `notes`       TEXT,
  `created_by`  INT DEFAULT NULL,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  INDEX `cash_company_idx` (`company_id`, `cdate` DESC)
) ENGINE=InnoDB;

-- 11. Cash In
CREATE TABLE IF NOT EXISTS `cash_in` (
  `id`          INT AUTO_INCREMENT PRIMARY KEY,
  `company_id`  INT NOT NULL,
  `project_id`  INT DEFAULT NULL,
  `cdate`       DATE NOT NULL,
  `amount`      DECIMAL(14,2) NOT NULL DEFAULT 0,
  `source`      VARCHAR(255) NOT NULL DEFAULT '',
  `ref`         VARCHAR(255) NOT NULL DEFAULT '',
  `notes`       TEXT,
  `txn_id`      INT DEFAULT NULL,
  `created_by`  INT DEFAULT NULL,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`txn_id`) REFERENCES `txns`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  INDEX `cashin_company_idx` (`company_id`, `cdate` DESC)
) ENGINE=InnoDB;

-- 12. Audit Log
CREATE TABLE IF NOT EXISTS `audit` (
  `id`         INT AUTO_INCREMENT PRIMARY KEY,
  `user_id`    INT DEFAULT NULL,
  `user_name`  VARCHAR(255) NOT NULL DEFAULT '',
  `action`     VARCHAR(255) NOT NULL,
  `detail`     TEXT,
  `at`         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ====================================================
-- Initial Seed Data
-- ====================================================
INSERT IGNORE INTO `settings` (`id`, `group_name`, `currency`, `fy_start`) VALUES (1, 'AKB Group', 'INR', 4);

INSERT IGNORE INTO `companies` (`id`, `name`, `code`, `color`, `sort`) VALUES
(1, 'AKB Construction', 'AKBC', '#2a78d6', 0),
(2, 'Samiha Polyclinic and Diagnostics', 'SPD', '#eb6834', 1),
(3, 'Samiha Pharmacy', 'SPH', '#1baf7a', 2),
(4, 'Royal Dryfruits', 'RDF', '#eda100', 3),
(5, 'AKB Rental', 'AKBR', '#e87ba4', 4);

INSERT IGNORE INTO `categories` (`kind`, `name`, `sort`) VALUES
('expense', 'Salaries & Wages', 0),
('expense', 'Staff Benefits', 1),
('expense', 'Rent', 2),
('expense', 'Electricity & Water', 3),
('expense', 'Telephone & Internet', 4),
('expense', 'Office Supplies', 5),
('expense', 'Construction Materials', 6),
('expense', 'Subcontractors', 7),
('expense', 'Equipment & Machinery Hire', 8),
('expense', 'Site Expenses', 9),
('expense', 'Medical Consumables & Lab Supplies', 10),
('expense', 'Pharmacy Stock Purchases', 11),
('expense', 'Retail Stock Purchases', 12),
('expense', 'Purchases / Cost of Sales', 13),
('expense', 'Property Maintenance', 14),
('expense', 'Vehicle & Fuel', 15),
('expense', 'Travel & Accommodation', 16),
('expense', 'Marketing & Advertising', 17),
('expense', 'Professional & Legal Fees', 18),
('expense', 'Government & Licence Fees', 19),
('expense', 'Insurance', 20),
('expense', 'Repairs & Maintenance', 21),
('expense', 'Bank Charges', 22),
('expense', 'Depreciation', 23),
('expense', 'Miscellaneous', 24),
('income', 'Construction Contract Income', 0),
('income', 'Consultation & Diagnostics Income', 1),
('income', 'Pharmacy Sales', 2),
('income', 'Retail Sales', 3),
('income', 'Rental Income', 4),
('income', 'Service Income', 5),
('income', 'Commission', 6),
('income', 'Interest Income', 7),
('income', 'Other Income', 8),
('method', 'Cash', 0),
('method', 'UPI', 1),
('method', 'Bank Transfer (NEFT / RTGS)', 2),
('method', 'Cheque', 3),
('method', 'Credit Card', 4),
('method', 'Debit Card', 5),
('method', 'Petty Cash', 6),
('source', 'Cash sales / counter collection', 0),
('source', 'Collection from customer', 1),
('source', 'Cash withdrawn from bank', 2),
('source', 'Capital introduced by owner', 3),
('source', 'Loan received', 4),
('source', 'Transfer from another group company', 5),
('source', 'Refund received', 6),
('source', 'Sale of scrap / asset', 7),
('source', 'Other', 8);

-- Default Admin User (Password: ChangeMe123!)
INSERT IGNORE INTO `users` (`id`, `email`, `name`, `pass_hash`, `role`, `must_change`) VALUES
(1, 'admin@akbgroups.com', 'Administrator', '$2a$10$wK1RkZ17L/.b00H1q7zQleJcQk1w7mN6vA15A.L/A/g1K.g5u1K', 'admin', 0);
