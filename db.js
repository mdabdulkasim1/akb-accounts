'use strict';
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const host = process.env.DB_HOST || 'localhost';
const port = parseInt(process.env.DB_PORT, 10) || 3306;
const user = process.env.DB_USER || 'root';
const password = process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : '';
const database = process.env.DB_NAME || 'akb-accounts';

let pool;

async function initPool() {
  if (user === 'root') {
    try {
      const tempConn = await mysql.createConnection({ host, port, user, password });
      await tempConn.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      await tempConn.end();
    } catch (e) {
      /* ignore root database creation error if database exists */
    }
  }

  pool = mysql.createPool({
    host,
    port,
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    decimalNumbers: true,
    multipleStatements: true
  });
}

function processSql(text) {
  let cleanText = text.replace(/\$\d+(?:::int\[\])?/g, '?');
  cleanText = cleanText.replace(/\s+RETURNING\s+\w+/gi, '');
  return { cleanText };
}

async function q(text, params = []) {
  if (!pool) await initPool();
  const { cleanText } = processSql(text);
  const [result] = await pool.query(cleanText, params);

  if (Array.isArray(result)) {
    return { rows: result };
  }

  if (result && typeof result === 'object') {
    if (result.insertId !== undefined) {
      return { rows: [{ id: result.insertId }], insertId: result.insertId, affectedRows: result.affectedRows };
    }
    return { rows: [], affectedRows: result.affectedRows };
  }

  return { rows: [] };
}

const poolWrapper = {
  connect: async () => {
    if (!pool) await initPool();
    const conn = await pool.getConnection();
    return {
      query: async (text, params = []) => {
        if (text.trim().toUpperCase() === 'BEGIN') {
          await conn.beginTransaction();
          return { rows: [] };
        }
        if (text.trim().toUpperCase() === 'COMMIT') {
          await conn.commit();
          return { rows: [] };
        }
        if (text.trim().toUpperCase() === 'ROLLBACK') {
          await conn.rollback();
          return { rows: [] };
        }
        const { cleanText } = processSql(text);
        const [result] = await conn.query(cleanText, params);
        if (Array.isArray(result)) {
          return { rows: result };
        }
        if (result && typeof result === 'object' && result.insertId !== undefined) {
          return { rows: [{ id: result.insertId }], insertId: result.insertId };
        }
        return { rows: [] };
      },
      release: () => conn.release()
    };
  }
};

async function runVersionedMigrations(verbose = false) {
  if (!pool) await initPool();
  const log = (msg) => { if (verbose) console.log(`[MIGRATE] ${msg}`); };

  log('Checking migration tracking table...');
  await q(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     VARCHAR(50) PRIMARY KEY,
      name        VARCHAR(255) NOT NULL,
      applied_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);

  const { rows: applied } = await q('SELECT version FROM schema_migrations');
  const appliedVersions = new Set(applied.map(r => String(r.version)));

  const migrationsDir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    fs.mkdirSync(migrationsDir, { recursive: true });
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  let count = 0;
  for (const file of files) {
    const version = file.split('_')[0];
    if (appliedVersions.has(version)) {
      continue;
    }

    log(`Applying migration ${file}...`);
    const filePath = path.join(migrationsDir, file);
    const sqlContent = fs.readFileSync(filePath, 'utf8');

    await pool.query(sqlContent);
    await q('INSERT INTO schema_migrations (version, name) VALUES (?, ?)', [version, file]);
    log(`Successfully applied migration ${file}`);
    count++;
  }

  if (count === 0) {
    log('Database schema is up to date (0 pending migrations).');
  } else {
    log(`Applied ${count} new migration(s).`);
  }
}

const SEED_COMPANIES = [
  ['AKB Construction', 'AKBC', '#2a78d6'],
  ['Samiha Polyclinic and Diagnostics', 'SPD', '#eb6834'],
  ['Samiha Pharmacy', 'SPH', '#1baf7a'],
  ['Royal Dryfruits', 'RDF', '#eda100'],
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

async function seed(verbose = false) {
  const bcrypt = require('bcryptjs');
  const log = (msg) => { if (verbose) console.log(`[SEED] ${msg}`); };

  log('Starting database seeding...');

  await q(`INSERT IGNORE INTO settings (id) VALUES (1)`);
  log('Settings row initialized.');

  const { rows: cc } = await q('SELECT COUNT(*) AS n FROM companies');
  if (cc[0].n === 0) {
    for (let i = 0; i < SEED_COMPANIES.length; i++) {
      const c = SEED_COMPANIES[i];
      await q('INSERT INTO companies (name, code, color, sort) VALUES (?,?,?,?)', [c[0], c[1], c[2], i]);
    }
    log(`Seeded ${SEED_COMPANIES.length} default companies.`);
  } else {
    log(`Companies already present (${cc[0].n} records).`);
  }

  const { rows: kc } = await q('SELECT COUNT(*) AS n FROM categories');
  if (kc[0].n === 0) {
    const add = async (kind, list) => {
      for (let i = 0; i < list.length; i++) {
        await q('INSERT IGNORE INTO categories (kind, name, sort) VALUES (?,?,?)', [kind, list[i], i]);
      }
    };
    await add('expense', SEED_EXPENSE);
    await add('income', SEED_INCOME);
    await add('method', SEED_METHOD);
    await add('source', SEED_SOURCE);
    log('Seeded default categories (expense, income, payment methods, cash sources).');
  } else {
    log(`Categories already present (${kc[0].n} records).`);
  }

  const { rows: sc } = await q(`SELECT COUNT(*) AS n FROM categories WHERE kind = 'source'`);
  if (sc[0].n === 0) {
    for (let i = 0; i < SEED_SOURCE.length; i++) {
      await q('INSERT IGNORE INTO categories (kind, name, sort) VALUES (?,?,?)', ['source', SEED_SOURCE[i], i]);
    }
    log('Seeded cash source categories.');
  }

  const { rows: uc } = await q('SELECT COUNT(*) AS n FROM users');
  if (uc[0].n === 0) {
    const email = (process.env.ADMIN_EMAIL || 'admin@akbgroups.com').toLowerCase().trim();
    const pass = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
    const hash = bcrypt.hashSync(pass, 10);
    await q('INSERT INTO users (email, name, pass_hash, role, must_change) VALUES (?,?,?,?,?)',
      [email, process.env.ADMIN_NAME || 'Administrator', hash, 'admin', !process.env.ADMIN_PASSWORD]);
    log(`Created initial administrator account: ${email}`);
    if (!process.env.ADMIN_PASSWORD) log('Temporary password: ChangeMe123! — change it after first login');
  } else {
    log(`Users already present (${uc[0].n} records).`);
  }
  log('Database seeding completed.');
}

module.exports = { q, pool: poolWrapper, migrate: runVersionedMigrations, seed };
