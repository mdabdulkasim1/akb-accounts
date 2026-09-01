'use strict';
const { Pool } = require('pg');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('\n  DATABASE_URL is not set.\n  On Railway: add a Postgres database, then reference it as ${{Postgres.DATABASE_URL}}\n');
  process.exit(1);
}

// Railway's private network (*.railway.internal) does not use TLS.
// Public proxy hosts and most other providers do.
const internal = /railway\.internal/.test(url) || /localhost|127\.0\.0\.1/.test(url);
const pool = new Pool({
  connectionString: url,
  ssl: internal ? false : { rejectUnauthorized: false },
  max: 8,
  idleTimeoutMillis: 30000
});

pool.on('error', (e) => console.error('pg pool error:', e.message));

const q = (text, params) => pool.query(text, params);

async function migrate() {
  await q(`
    CREATE TABLE IF NOT EXISTS companies (
      id        SERIAL PRIMARY KEY,
      name      TEXT NOT NULL,
      code      TEXT NOT NULL DEFAULT '',
      color     TEXT NOT NULL DEFAULT '#2a78d6',
      sort      INT  NOT NULL DEFAULT 0,
      active    BOOLEAN NOT NULL DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL,
      pass_hash     TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'staff',
      active        BOOLEAN NOT NULL DEFAULT TRUE,
      must_change   BOOLEAN NOT NULL DEFAULT FALSE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS user_companies (
      user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, company_id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      id         INT PRIMARY KEY DEFAULT 1,
      group_name TEXT NOT NULL DEFAULT 'AKB Group',
      currency   TEXT NOT NULL DEFAULT 'INR',
      fy_start   INT  NOT NULL DEFAULT 4,
      CONSTRAINT settings_single CHECK (id = 1)
    );

    CREATE TABLE IF NOT EXISTS categories (
      id    SERIAL PRIMARY KEY,
      kind  TEXT NOT NULL,
      name  TEXT NOT NULL,
      sort  INT  NOT NULL DEFAULT 0,
      UNIQUE (kind, name)
    );

    -- projects / locations / branches belonging to a company. Every cost and
    -- payment can be tagged to one so the books can be read project-wise.
    CREATE TABLE IF NOT EXISTS projects (
      id          SERIAL PRIMARY KEY,
      company_id  INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      code        TEXT NOT NULL DEFAULT '',
      active      BOOLEAN NOT NULL DEFAULT TRUE,
      sort        INT  NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS projects_company_idx ON projects (company_id);

    CREATE TABLE IF NOT EXISTS txns (
      id          SERIAL PRIMARY KEY,
      tdate       DATE NOT NULL,
      company_id  INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      type        TEXT NOT NULL,
      category    TEXT NOT NULL DEFAULT '',
      party       TEXT NOT NULL DEFAULT '',
      invoice     TEXT NOT NULL DEFAULT '',
      amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
      method      TEXT NOT NULL DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'paid',
      notes       TEXT NOT NULL DEFAULT '',
      created_by  INT REFERENCES users(id) ON DELETE SET NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS txns_date_idx    ON txns (tdate DESC);
    CREATE INDEX IF NOT EXISTS txns_company_idx ON txns (company_id);

    CREATE TABLE IF NOT EXISTS transfers (
      id          SERIAL PRIMARY KEY,
      tdate       DATE NOT NULL,
      from_id     INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      to_id       INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
      purpose     TEXT NOT NULL DEFAULT '',
      ref         TEXT NOT NULL DEFAULT '',
      created_by  INT REFERENCES users(id) ON DELETE SET NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS payment_requests (
      id               SERIAL PRIMARY KEY,
      company_id       INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      rdate            DATE NOT NULL,
      work             TEXT NOT NULL DEFAULT '',
      party            TEXT NOT NULL DEFAULT '',
      invoice          TEXT NOT NULL DEFAULT '',
      invoice_date     DATE,
      category         TEXT NOT NULL DEFAULT '',
      requested_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      approved_amount  NUMERIC(14,2),
      urgency          TEXT NOT NULL DEFAULT 'normal',
      notes            TEXT NOT NULL DEFAULT '',
      status           TEXT NOT NULL DEFAULT 'pending',
      requested_by     INT REFERENCES users(id) ON DELETE SET NULL,
      approved_by      INT REFERENCES users(id) ON DELETE SET NULL,
      approved_at      TIMESTAMPTZ,
      approval_note    TEXT NOT NULL DEFAULT '',
      paid_by          INT REFERENCES users(id) ON DELETE SET NULL,
      paid_at          TIMESTAMPTZ,
      paid_method      TEXT NOT NULL DEFAULT '',
      paid_ref         TEXT NOT NULL DEFAULT '',
      txn_id           INT REFERENCES txns(id) ON DELETE SET NULL,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS pr_status_idx ON payment_requests (status, rdate DESC);

    CREATE TABLE IF NOT EXISTS cash_counts (
      id          SERIAL PRIMARY KEY,
      company_id  INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      cdate       DATE NOT NULL,
      amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
      notes       TEXT NOT NULL DEFAULT '',
      created_by  INT REFERENCES users(id) ON DELETE SET NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS cash_company_idx ON cash_counts (company_id, cdate DESC);

    CREATE TABLE IF NOT EXISTS cash_in (
      id          SERIAL PRIMARY KEY,
      company_id  INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      cdate       DATE NOT NULL,
      amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
      source      TEXT NOT NULL DEFAULT '',
      ref         TEXT NOT NULL DEFAULT '',
      notes       TEXT NOT NULL DEFAULT '',
      txn_id      INT REFERENCES txns(id) ON DELETE SET NULL,
      created_by  INT REFERENCES users(id) ON DELETE SET NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS cashin_company_idx ON cash_in (company_id, cdate DESC);

    CREATE TABLE IF NOT EXISTS audit (
      id         SERIAL PRIMARY KEY,
      user_id    INT,
      user_name  TEXT NOT NULL DEFAULT '',
      action     TEXT NOT NULL,
      detail     TEXT NOT NULL DEFAULT '',
      at         TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- tag entries to a project / location (nullable — companies without
    -- projects simply leave it blank). Cleared, not deleted, when the
    -- project goes away, so the entry itself is never lost.
    ALTER TABLE txns             ADD COLUMN IF NOT EXISTS project_id INT REFERENCES projects(id) ON DELETE SET NULL;
    ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS project_id INT REFERENCES projects(id) ON DELETE SET NULL;
    ALTER TABLE cash_in          ADD COLUMN IF NOT EXISTS project_id INT REFERENCES projects(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS txns_project_idx ON txns (project_id);
  `);

  // Royal Dryfruits firm was dropped from the group — remove it (and its
  // entries, which cascade) from any existing database. Idempotent: a no-op
  // once the company is gone.
  await q(`DELETE FROM companies WHERE name = 'Royal Dryfruits'`);
}

const SEED_COMPANIES = [
  ['AKB Construction', 'AKBC', '#2a78d6'],
  ['Samiha Polyclinic and Diagnostics', 'SPD', '#eb6834'],
  ['Samiha Pharmacy', 'SPH', '#1baf7a'],
  ['AKB Rental', 'AKBR', '#e87ba4']
];
const SEED_EXPENSE = ['Salaries & Wages', 'Staff Benefits', 'Rent', 'Electricity & Water', 'Telephone & Internet',
  'Office Supplies', 'Construction Materials', 'Subcontractors', 'Equipment & Machinery Hire', 'Site Expenses',
  'Medical Consumables & Lab Supplies', 'Pharmacy Stock Purchases', 'Retail Stock Purchases',
  'Purchases / Cost of Sales', 'Property Maintenance', 'Vehicle & Fuel', 'Travel & Accommodation',
  'Marketing & Advertising', 'Professional & Legal Fees', 'Government & Licence Fees', 'Insurance',
  'Repairs & Maintenance', 'Bank Charges', 'Depreciation', 'Miscellaneous'];
const SEED_INCOME = ['Construction Contract Income', 'Consultation & Diagnostics Income', 'Pharmacy Sales',
  'Retail Sales', 'Rental Income', 'Service Income', 'Commission', 'Interest Income', 'Other Income'];
const SEED_METHOD = ['Cash', 'UPI', 'Bank Transfer (NEFT / RTGS)', 'Cheque', 'Credit Card', 'Debit Card', 'Petty Cash'];
const SEED_SOURCE = ['Cash sales / counter collection', 'Collection from customer', 'Cash withdrawn from bank',
  'Capital introduced by owner', 'Loan received', 'Transfer from another group company',
  'Refund received', 'Sale of scrap / asset', 'Other'];

async function seed() {
  const bcrypt = require('bcryptjs');

  await q(`INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);

  const { rows: cc } = await q('SELECT count(*)::int AS n FROM companies');
  if (cc[0].n === 0) {
    for (let i = 0; i < SEED_COMPANIES.length; i++) {
      const c = SEED_COMPANIES[i];
      await q('INSERT INTO companies (name, code, color, sort) VALUES ($1,$2,$3,$4)', [c[0], c[1], c[2], i]);
    }
    console.log('seeded 5 companies');
  }

  const { rows: kc } = await q('SELECT count(*)::int AS n FROM categories');
  if (kc[0].n === 0) {
    const add = async (kind, list) => {
      for (let i = 0; i < list.length; i++) {
        await q('INSERT INTO categories (kind, name, sort) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [kind, list[i], i]);
      }
    };
    await add('expense', SEED_EXPENSE);
    await add('income', SEED_INCOME);
    await add('method', SEED_METHOD);
    await add('source', SEED_SOURCE);
    console.log('seeded categories');
  }

  // existing installations upgrading to the cash register get the source list
  const { rows: sc } = await q(`SELECT count(*)::int AS n FROM categories WHERE kind = 'source'`);
  if (sc[0].n === 0) {
    for (let i = 0; i < SEED_SOURCE.length; i++) {
      await q('INSERT INTO categories (kind, name, sort) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', ['source', SEED_SOURCE[i], i]);
    }
    console.log('seeded cash sources');
  }

  const { rows: uc } = await q('SELECT count(*)::int AS n FROM users');
  if (uc[0].n === 0) {
    const email = (process.env.ADMIN_EMAIL || 'admin@akbgroup.local').toLowerCase().trim();
    const pass = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
    const hash = bcrypt.hashSync(pass, 10);
    await q('INSERT INTO users (email, name, pass_hash, role, must_change) VALUES ($1,$2,$3,$4,$5)',
      [email, process.env.ADMIN_NAME || 'Administrator', hash, 'admin', !process.env.ADMIN_PASSWORD]);
    console.log('created first admin:', email);
    if (!process.env.ADMIN_PASSWORD) console.log('temporary password: ChangeMe123!  — change it after first login');
  }
}

module.exports = { q, pool, migrate, seed };
