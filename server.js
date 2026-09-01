'use strict';
require('dotenv').config();
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { q, pool, migrate, seed } = require('./db');

const app = express();
const argPort = (process.argv.find(a => a.startsWith('--port=')) || '').split('=')[1];
const PORT = parseInt(argPort || process.env.PORT || 3000, 10);
const SECRET = process.env.SESSION_SECRET || 'dev-only-secret-change-me';
const PROD = process.env.NODE_ENV === 'production';
const COOKIE = 'akb_session';

app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

/* ------------------------------------------------------------------ auth */
function sign(u) {
  return jwt.sign({ id: u.id, email: u.email, name: u.name, role: u.role }, SECRET, { expiresIn: '30d' });
}
function setCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: 30 * 24 * 3600 * 1000, path: '/'
  });
}
async function loadUser(req, res, next) {
  const t = req.cookies[COOKIE];
  if (!t) return next();
  try {
    const p = jwt.verify(t, SECRET);
    const { rows } = await q(
      `SELECT u.id, u.email, u.name, u.role, u.active, u.must_change,
              GROUP_CONCAT(uc.company_id) AS company_ids_str
         FROM users u LEFT JOIN user_companies uc ON uc.user_id = u.id
        WHERE u.id = $1 GROUP BY u.id`, [p.id]);
    if (rows[0] && rows[0].active) {
      const u = rows[0];
      u.company_ids = u.company_ids_str ? u.company_ids_str.split(',').filter(Boolean).map(Number) : [];
      req.user = u;
    }
  } catch (e) { /* invalid or expired token */ }
  next();
}
app.use(loadUser);

const need = (req, res) => { if (!req.user) { res.status(401).json({ error: 'Please sign in.' }); return false; } return true; };
const needAdmin = (req, res) => {
  if (!need(req, res)) return false;
  if (req.user.role !== 'admin') { res.status(403).json({ error: 'Administrator access is required for this action.' }); return false; }
  return true;
};
// accountant or admin — releasing money and recording cash
const needCashier = (req, res) => {
  if (!need(req, res)) return false;
  if (req.user.role !== 'admin' && req.user.role !== 'accountant') {
    res.status(403).json({ error: 'Only the accountant or an administrator can do this.' }); return false;
  }
  return true;
};
// companies this user may touch (admin and accountant = all)
async function allowedCompanies(user) {
  if (user.role === 'admin' || user.role === 'accountant') {
    const { rows } = await q('SELECT id FROM companies ORDER BY id');
    return rows.map(r => r.id);
  }
  return (user.company_ids || []).map(Number);
}
const wrap = fn => (req, res) => fn(req, res).catch(e => {
  console.error(req.method, req.path, e.message);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

/* ------------------------------------------------------------------ login */
const loginLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });

app.post('/api/login', loginLimit, wrap(async (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  const pass = String(req.body.password || '');
  const { rows } = await q('SELECT * FROM users WHERE email = $1', [email]);
  const u = rows[0];
  if (!u || !u.active || !bcrypt.compareSync(pass, u.pass_hash)) {
    return res.status(401).json({ error: 'Email or password is not correct.' });
  }
  setCookie(res, sign(u));
  await q('INSERT INTO audit (user_id, user_name, action) VALUES ($1,$2,$3)', [u.id, u.name, 'signed in']);
  res.json({ ok: true, mustChange: u.must_change });
}));

app.post('/api/logout', (req, res) => { res.clearCookie(COOKIE, { path: '/' }); res.json({ ok: true }); });

app.post('/api/password', wrap(async (req, res) => {
  if (!need(req, res)) return;
  const cur = String(req.body.current || ''), next = String(req.body.next || '');
  if (next.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  const { rows } = await q('SELECT pass_hash FROM users WHERE id = $1', [req.user.id]);
  if (!bcrypt.compareSync(cur, rows[0].pass_hash)) return res.status(400).json({ error: 'Current password is not correct.' });
  await q('UPDATE users SET pass_hash = $1, must_change = FALSE WHERE id = $2', [bcrypt.hashSync(next, 10), req.user.id]);
  res.json({ ok: true });
}));

/* ------------------------------------------------------------------ data */
app.get('/api/data', wrap(async (req, res) => {
  if (!need(req, res)) return;
  const mine = await allowedCompanies(req.user);
  const mineIds = mine.length ? mine : [0];
  const [st, cos, cats, projs, tx, tr] = await Promise.all([
    q('SELECT * FROM settings WHERE id = 1'),
    q('SELECT id, name, code, color FROM companies WHERE active ORDER BY sort, id'),
    q('SELECT kind, name FROM categories ORDER BY kind, sort, name'),
    q(`SELECT id, company_id, name, code, active FROM projects
        WHERE company_id IN (?) ORDER BY sort, id`, [mineIds]),
    q(`SELECT t.id, DATE_FORMAT(t.tdate,'%Y-%m-%d') AS date, t.company_id, t.project_id, t.type, t.category, t.party,
              t.invoice, t.amount AS amount, t.method, t.status, t.notes, u.name AS \`by\`
         FROM txns t LEFT JOIN users u ON u.id = t.created_by
        WHERE t.company_id IN (?) ORDER BY t.tdate DESC, t.id DESC`, [mineIds]),
    // inter-company movement is group-level information: administrators only
    req.user.role === 'admin'
      ? q(`SELECT r.id, DATE_FORMAT(r.tdate,'%Y-%m-%d') AS date, r.from_id, r.to_id, r.amount AS amount,
                  r.purpose, r.ref, u.name AS \`by\`
             FROM transfers r LEFT JOIN users u ON u.id = r.created_by
            ORDER BY r.tdate DESC, r.id DESC`)
      : Promise.resolve({ rows: [] })
  ]);
  const [pr, cash, cashIn] = await Promise.all([
    q(`SELECT p.id, DATE_FORMAT(p.rdate,'%Y-%m-%d') AS date, p.company_id, p.project_id, p.work, p.party, p.invoice,
              DATE_FORMAT(p.invoice_date,'%Y-%m-%d') AS invoice_date, p.category,
              p.requested_amount AS requested_amount, p.approved_amount AS approved_amount,
              p.urgency, p.notes, p.status, p.approval_note, p.paid_method, p.paid_ref, p.txn_id,
              DATE_FORMAT(p.approved_at,'%Y-%m-%d %H:%i') AS approved_at,
              DATE_FORMAT(p.paid_at,'%Y-%m-%d %H:%i') AS paid_at,
              ru.name AS requested_by, au.name AS approved_by, pu.name AS paid_by
         FROM payment_requests p
         LEFT JOIN users ru ON ru.id = p.requested_by
         LEFT JOIN users au ON au.id = p.approved_by
         LEFT JOIN users pu ON pu.id = p.paid_by
        WHERE p.company_id IN (?)
        ORDER BY CASE p.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, p.rdate DESC, p.id DESC`, [mineIds]),
    q(`SELECT c.id, DATE_FORMAT(c.cdate,'%Y-%m-%d') AS date, c.company_id, c.amount AS amount,
              c.notes, u.name AS \`by\`
         FROM cash_counts c LEFT JOIN users u ON u.id = c.created_by
        WHERE c.company_id IN (?)
        ORDER BY c.cdate DESC, c.id DESC`, [mineIds]),
    q(`SELECT c.id, DATE_FORMAT(c.cdate,'%Y-%m-%d') AS date, c.company_id, c.project_id, c.amount AS amount,
              c.source, c.ref, c.notes, c.txn_id, u.name AS \`by\`
         FROM cash_in c LEFT JOIN users u ON u.id = c.created_by
        WHERE c.company_id IN (?)
        ORDER BY c.cdate DESC, c.id DESC`, [mineIds])
  ]);
  let users = [];
  if (req.user.role === 'admin') {
    const r = await q(`SELECT u.id, u.email, u.name, u.role, u.active,
              GROUP_CONCAT(uc.company_id) AS company_ids_str
         FROM users u LEFT JOIN user_companies uc ON uc.user_id = u.id
        GROUP BY u.id ORDER BY u.id`);
    users = r.rows.map(u => ({
      ...u,
      company_ids: u.company_ids_str ? u.company_ids_str.split(',').filter(Boolean).map(Number) : []
    }));
  }
  const s = st.rows[0] || {};
  res.json({
    me: { id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role, companyIds: mine, mustChange: req.user.must_change },
    settings: { group: s.group_name, currency: s.currency, fyStart: s.fy_start },
    companies: cos.rows,
    projects: projs.rows,
    expCats: cats.rows.filter(c => c.kind === 'expense').map(c => c.name),
    incCats: cats.rows.filter(c => c.kind === 'income').map(c => c.name),
    methods: cats.rows.filter(c => c.kind === 'method').map(c => c.name),
    sources: cats.rows.filter(c => c.kind === 'source').map(c => c.name),
    txns: tx.rows, transfers: tr.rows, users,
    requests: pr.rows, cash: cash.rows, cashIn: cashIn.rows
  });
}));

/* ----------------------------------------------------- payment requests */
function cleanReq(b) {
  return {
    date: String(b.date || '').slice(0, 10),
    company_id: parseInt(b.company_id, 10),
    project_id: b.project_id,
    work: String(b.work || '').slice(0, 400),
    party: String(b.party || '').slice(0, 160),
    invoice: String(b.invoice || '').slice(0, 60),
    invoice_date: String(b.invoice_date || '').slice(0, 10) || null,
    category: String(b.category || '').slice(0, 120),
    requested_amount: Math.round((Number(b.requested_amount) || 0) * 100) / 100,
    urgency: ['normal', 'urgent'].includes(b.urgency) ? b.urgency : 'normal',
    notes: String(b.notes || '').slice(0, 2000)
  };
}

app.post('/api/requests', wrap(async (req, res) => {
  if (!need(req, res)) return;
  const r = cleanReq(req.body);
  if (!r.date || !r.company_id || !(r.requested_amount > 0)) return res.status(400).json({ error: 'Date, company and a positive amount are required.' });
  if (!r.work && !r.party) return res.status(400).json({ error: 'Describe the work or name the party being paid.' });
  if (!await assertCompany(req, res, r.company_id)) return;
  const pr = await resolveProjectId(r.project_id, r.company_id);
  if (!pr.ok) return res.status(400).json({ error: 'That project / location does not belong to the selected company.' });
  const { rows } = await q(
    `INSERT INTO payment_requests (rdate, company_id, project_id, work, party, invoice, invoice_date, category,
       requested_amount, urgency, notes, requested_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [r.date, r.company_id, pr.id, r.work, r.party, r.invoice, r.invoice_date, r.category,
    r.requested_amount, r.urgency, r.notes, req.user.id]);
  await q('INSERT INTO audit (user_id, user_name, action, detail) VALUES ($1,$2,$3,$4)',
    [req.user.id, req.user.name, 'raised payment request', `#${rows[0].id} ${r.requested_amount}`]);
  res.json({ ok: true, id: rows[0].id });
}));

app.put('/api/requests/:id', wrap(async (req, res) => {
  if (!need(req, res)) return;
  const id = parseInt(req.params.id, 10);
  const { rows: ex } = await q('SELECT status, requested_by, company_id FROM payment_requests WHERE id = $1', [id]);
  if (!ex[0]) return res.status(404).json({ error: 'That request no longer exists.' });
  if (ex[0].status !== 'pending') return res.status(400).json({ error: 'Only a request still waiting for approval can be edited.' });
  if (req.user.role !== 'admin' && ex[0].requested_by !== req.user.id) {
    return res.status(403).json({ error: 'You can only edit requests you raised yourself.' });
  }
  const r = cleanReq(req.body);
  if (!r.date || !r.company_id || !(r.requested_amount > 0)) return res.status(400).json({ error: 'Date, company and a positive amount are required.' });
  if (!await assertCompany(req, res, r.company_id)) return;
  const pr = await resolveProjectId(r.project_id, r.company_id);
  if (!pr.ok) return res.status(400).json({ error: 'That project / location does not belong to the selected company.' });
  await q(`UPDATE payment_requests SET rdate=$1, company_id=$2, project_id=$3, work=$4, party=$5, invoice=$6, invoice_date=$7,
           category=$8, requested_amount=$9, urgency=$10, notes=$11 WHERE id=$12`,
    [r.date, r.company_id, pr.id, r.work, r.party, r.invoice, r.invoice_date, r.category, r.requested_amount, r.urgency, r.notes, id]);
  res.json({ ok: true });
}));

// the approval step — only you
app.post('/api/requests/:id/decide', wrap(async (req, res) => {
  if (!needAdmin(req, res)) return;
  const id = parseInt(req.params.id, 10);
  const approve = req.body.decision === 'approve';
  const note = String(req.body.note || '').slice(0, 1000);
  const { rows: ex } = await q('SELECT status, requested_amount AS requested_amount FROM payment_requests WHERE id = $1', [id]);
  if (!ex[0]) return res.status(404).json({ error: 'That request no longer exists.' });
  if (ex[0].status !== 'pending') return res.status(400).json({ error: 'This request has already been decided.' });
  if (!approve) {
    await q(`UPDATE payment_requests SET status='rejected', approved_by=$1, approved_at=now(), approval_note=$2 WHERE id=$3`,
      [req.user.id, note, id]);
    await q('INSERT INTO audit (user_id, user_name, action, detail) VALUES ($1,$2,$3,$4)',
      [req.user.id, req.user.name, 'rejected payment request', `#${id}`]);
    return res.json({ ok: true });
  }
  // approving: the amount may be revised down or up before it is released
  let amount = req.body.amount === undefined || req.body.amount === null || req.body.amount === ''
    ? ex[0].requested_amount : Math.round((Number(req.body.amount) || 0) * 100) / 100;
  if (!(amount > 0)) return res.status(400).json({ error: 'The approved amount must be greater than zero.' });
  await q(`UPDATE payment_requests SET status='approved', approved_amount=$1, approved_by=$2, approved_at=now(), approval_note=$3 WHERE id=$4`,
    [amount, req.user.id, note, id]);
  await q('INSERT INTO audit (user_id, user_name, action, detail) VALUES ($1,$2,$3,$4)',
    [req.user.id, req.user.name, 'approved payment request',
    `#${id} approved ${amount}${amount !== ex[0].requested_amount ? ' (requested ' + ex[0].requested_amount + ')' : ''}`]);
  res.json({ ok: true });
}));

// the release step — accountant pays it out and it becomes a real expense entry
app.post('/api/requests/:id/release', wrap(async (req, res) => {
  if (!needCashier(req, res)) return;
  const id = parseInt(req.params.id, 10);
  const method = String(req.body.method || '').slice(0, 60);
  const ref = String(req.body.ref || '').slice(0, 80);
  const payDate = String(req.body.date || '').slice(0, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: ex } = await client.query('SELECT * FROM payment_requests WHERE id = $1 FOR UPDATE', [id]);
    if (!ex[0]) throw new Error('That request no longer exists.');
    if (ex[0].status !== 'approved') throw new Error('Only an approved request can be released.');
    const amount = Number(ex[0].approved_amount);
    const { rows: t } = await client.query(
      `INSERT INTO txns (tdate, company_id, project_id, type, category, party, invoice, amount, method, status, notes, created_by)
       VALUES ($1,$2,$3,'expense',$4,$5,$6,$7,$8,'paid',$9,$10) RETURNING id`,
      [payDate || new Date().toISOString().slice(0, 10), ex[0].company_id, ex[0].project_id, ex[0].category || 'Miscellaneous',
      ex[0].party, ex[0].invoice, amount, method,
      ('Released against payment request #' + id + (ex[0].work ? ' — ' + ex[0].work : '')).slice(0, 2000), req.user.id]);
    await client.query(
      `UPDATE payment_requests SET status='paid', paid_by=$1, paid_at=now(), paid_method=$2, paid_ref=$3, txn_id=$4 WHERE id=$5`,
      [req.user.id, method, ref, t[0].id, id]);
    await client.query('INSERT INTO audit (user_id, user_name, action, detail) VALUES ($1,$2,$3,$4)',
      [req.user.id, req.user.name, 'released payment', `#${id} ${amount} via ${method}`]);
    await client.query('COMMIT');
    res.json({ ok: true, txnId: t[0].id });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
}));

app.delete('/api/requests/:id', wrap(async (req, res) => {
  if (!needAdmin(req, res)) return;
  const id = parseInt(req.params.id, 10);
  const { rows } = await q('SELECT status FROM payment_requests WHERE id = $1', [id]);
  if (rows[0] && rows[0].status === 'paid') {
    return res.status(400).json({ error: 'A released payment cannot be deleted. Delete the expense entry instead if it was wrong.' });
  }
  await q('DELETE FROM payment_requests WHERE id = $1', [id]);
  await q('INSERT INTO audit (user_id, user_name, action, detail) VALUES ($1,$2,$3,$4)',
    [req.user.id, req.user.name, 'deleted payment request', `#${id}`]);
  res.json({ ok: true });
}));

/* ------------------------------------------------------------ cash book */
app.post('/api/cash', wrap(async (req, res) => {
  if (!needCashier(req, res)) return;
  const company_id = parseInt(req.body.company_id, 10);
  const amount = Math.round((Number(req.body.amount) || 0) * 100) / 100;
  const date = String(req.body.date || '').slice(0, 10);
  if (!company_id || !date || amount < 0) return res.status(400).json({ error: 'Company, date and a cash amount are required.' });
  if (!await assertCompany(req, res, company_id)) return;
  const { rows } = await q('INSERT INTO cash_counts (company_id, cdate, amount, notes, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [company_id, date, amount, String(req.body.notes || '').slice(0, 500), req.user.id]);
  await q('INSERT INTO audit (user_id, user_name, action, detail) VALUES ($1,$2,$3,$4)',
    [req.user.id, req.user.name, 'recorded cash in hand', `${amount}`]);
  res.json({ ok: true, id: rows[0].id });
}));

/* ------------------------------------------------- cash received (cash in) */
app.post('/api/cashin', wrap(async (req, res) => {
  if (!needCashier(req, res)) return;
  const company_id = parseInt(req.body.company_id, 10);
  const amount = Math.round((Number(req.body.amount) || 0) * 100) / 100;
  const date = String(req.body.date || '').slice(0, 10);
  const source = String(req.body.source || '').slice(0, 120);
  const ref = String(req.body.ref || '').slice(0, 80);
  const notes = String(req.body.notes || '').slice(0, 1000);
  if (!company_id || !date || !(amount > 0)) return res.status(400).json({ error: 'Company, date and a positive amount are required.' });
  if (!source) return res.status(400).json({ error: 'Please choose where the money came from.' });
  if (!await assertCompany(req, res, company_id)) return;
  const proj = await resolveProjectId(req.body.project_id, company_id);
  if (!proj.ok) return res.status(400).json({ error: 'That project / location does not belong to the selected company.' });

  // when the cash is business income it also becomes an income entry, so the
  // books and the cash box are updated from a single entry and never twice
  const asIncome = req.body.asIncome === true;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let txnId = null;
    if (asIncome) {
      const cat = String(req.body.incomeCategory || '').slice(0, 120) || 'Other Income';
      const { rows: t } = await client.query(
        `INSERT INTO txns (tdate, company_id, project_id, type, category, party, invoice, amount, method, status, notes, created_by)
         VALUES ($1,$2,$3,'income',$4,$5,$6,$7,'Cash','paid',$8,$9) RETURNING id`,
        [date, company_id, proj.id, cat, String(req.body.party || '').slice(0, 160), ref, amount,
          ('Cash received — ' + source + (notes ? ' — ' + notes : '')).slice(0, 2000), req.user.id]);
      txnId = t[0].id;
    }
    const { rows } = await client.query(
      `INSERT INTO cash_in (company_id, project_id, cdate, amount, source, ref, notes, txn_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [company_id, proj.id, date, amount, source, ref, notes, txnId, req.user.id]);
    await client.query('INSERT INTO audit (user_id, user_name, action, detail) VALUES ($1,$2,$3,$4)',
      [req.user.id, req.user.name, 'recorded cash received', `${amount} — ${source}`]);
    await client.query('COMMIT');
    res.json({ ok: true, id: rows[0].id, txnId });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally { client.release(); }
}));

app.put('/api/cashin/:id', wrap(async (req, res) => {
  if (!needCashier(req, res)) return;
  const id = parseInt(req.params.id, 10);
  const amount = Math.round((Number(req.body.amount) || 0) * 100) / 100;
  const date = String(req.body.date || '').slice(0, 10);
  const source = String(req.body.source || '').slice(0, 120);
  if (!date || !(amount > 0) || !source) return res.status(400).json({ error: 'Date, amount and source are required.' });
  const { rows: ex } = await q('SELECT company_id, txn_id FROM cash_in WHERE id = $1', [id]);
  if (!ex[0]) return res.status(404).json({ error: 'That entry no longer exists.' });
  if (!await assertCompany(req, res, ex[0].company_id)) return;
  const proj = await resolveProjectId(req.body.project_id, ex[0].company_id);
  if (!proj.ok) return res.status(400).json({ error: 'That project / location does not belong to the selected company.' });
  await q('UPDATE cash_in SET cdate=$1, amount=$2, source=$3, ref=$4, notes=$5, project_id=$6 WHERE id=$7',
    [date, amount, source, String(req.body.ref || ''), String(req.body.notes || ''), proj.id, id]);
  // keep the linked income entry in step
  if (ex[0].txn_id) await q('UPDATE txns SET tdate=$1, amount=$2, project_id=$3, updated_at=now() WHERE id=$4', [date, amount, proj.id, ex[0].txn_id]);
  res.json({ ok: true });
}));

app.delete('/api/cashin/:id', wrap(async (req, res) => {
  if (!needAdmin(req, res)) return;
  const id = parseInt(req.params.id, 10);
  const { rows } = await q('SELECT txn_id FROM cash_in WHERE id = $1', [id]);
  await q('DELETE FROM cash_in WHERE id = $1', [id]);
  if (rows[0] && rows[0].txn_id) await q('DELETE FROM txns WHERE id = $1', [rows[0].txn_id]);
  await q('INSERT INTO audit (user_id, user_name, action, detail) VALUES ($1,$2,$3,$4)',
    [req.user.id, req.user.name, 'deleted cash received', `#${id}`]);
  res.json({ ok: true });
}));

app.delete('/api/cash/:id', wrap(async (req, res) => {
  if (!needAdmin(req, res)) return;
  await q('DELETE FROM cash_counts WHERE id = $1', [parseInt(req.params.id, 10)]);
  res.json({ ok: true });
}));

/* ---------------------------------------------------------- transactions */
function cleanTxn(b) {
  return {
    date: String(b.date || '').slice(0, 10),
    company_id: parseInt(b.company_id, 10),
    project_id: b.project_id,
    type: b.type === 'income' ? 'income' : 'expense',
    category: String(b.category || '').slice(0, 120),
    party: String(b.party || '').slice(0, 160),
    invoice: String(b.invoice || '').slice(0, 60),
    amount: Math.round((Number(b.amount) || 0) * 100) / 100,
    method: String(b.method || '').slice(0, 60),
    status: b.status === 'unpaid' ? 'unpaid' : 'paid',
    notes: String(b.notes || '').slice(0, 2000)
  };
}
async function assertCompany(req, res, companyId) {
  const mine = await allowedCompanies(req.user);
  if (!mine.includes(companyId)) { res.status(403).json({ error: 'You do not have access to that company.' }); return false; }
  return true;
}
// a project / location is optional; when given it must belong to the company
// the entry is booked against. Returns { ok, id } — id is null when none.
async function resolveProjectId(rawProjectId, companyId) {
  const pid = parseInt(rawProjectId, 10);
  if (!pid) return { ok: true, id: null };
  const { rows } = await q('SELECT 1 FROM projects WHERE id = $1 AND company_id = $2', [pid, companyId]);
  if (!rows.length) return { ok: false };
  return { ok: true, id: pid };
}

app.post('/api/txns', wrap(async (req, res) => {
  if (!need(req, res)) return;
  const t = cleanTxn(req.body);
  if (!t.date || !t.company_id || !(t.amount > 0)) return res.status(400).json({ error: 'Date, company and a positive amount are required.' });
  if (!await assertCompany(req, res, t.company_id)) return;
  const pr = await resolveProjectId(t.project_id, t.company_id);
  if (!pr.ok) return res.status(400).json({ error: 'That project / location does not belong to the selected company.' });
  const { rows } = await q(
    `INSERT INTO txns (tdate, company_id, project_id, type, category, party, invoice, amount, method, status, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [t.date, t.company_id, pr.id, t.type, t.category, t.party, t.invoice, t.amount, t.method, t.status, t.notes, req.user.id]);
  await q('INSERT INTO audit (user_id, user_name, action, detail) VALUES ($1,$2,$3,$4)',
    [req.user.id, req.user.name, 'added entry', `#${rows[0].id} ${t.type} ${t.amount}`]);
  res.json({ ok: true, id: rows[0].id });
}));

app.put('/api/txns/:id', wrap(async (req, res) => {
  if (!need(req, res)) return;
  const id = parseInt(req.params.id, 10);
  const { rows: ex } = await q('SELECT company_id FROM txns WHERE id = $1', [id]);
  if (!ex[0]) return res.status(404).json({ error: 'That entry no longer exists.' });
  if (!await assertCompany(req, res, ex[0].company_id)) return;
  const t = cleanTxn(req.body);
  if (!t.date || !t.company_id || !(t.amount > 0)) return res.status(400).json({ error: 'Date, company and a positive amount are required.' });
  if (!await assertCompany(req, res, t.company_id)) return;
  const pr = await resolveProjectId(t.project_id, t.company_id);
  if (!pr.ok) return res.status(400).json({ error: 'That project / location does not belong to the selected company.' });
  await q(`UPDATE txns SET tdate=$1, company_id=$2, project_id=$3, type=$4, category=$5, party=$6, invoice=$7,
           amount=$8, method=$9, status=$10, notes=$11, updated_at=now() WHERE id=$12`,
    [t.date, t.company_id, pr.id, t.type, t.category, t.party, t.invoice, t.amount, t.method, t.status, t.notes, id]);
  await q('INSERT INTO audit (user_id, user_name, action, detail) VALUES ($1,$2,$3,$4)',
    [req.user.id, req.user.name, 'edited entry', `#${id}`]);
  res.json({ ok: true });
}));

app.delete('/api/txns/:id', wrap(async (req, res) => {
  if (!needAdmin(req, res)) return;
  const id = parseInt(req.params.id, 10);
  await q('DELETE FROM txns WHERE id = $1', [id]);
  await q('INSERT INTO audit (user_id, user_name, action, detail) VALUES ($1,$2,$3,$4)',
    [req.user.id, req.user.name, 'deleted entry', `#${id}`]);
  res.json({ ok: true });
}));

/* ------------------------------------------------------------- transfers */
app.post('/api/transfers', wrap(async (req, res) => {
  if (!needAdmin(req, res)) return;
  const b = req.body, from = parseInt(b.from_id, 10), to = parseInt(b.to_id, 10);
  const amount = Math.round((Number(b.amount) || 0) * 100) / 100;
  if (!from || !to || from === to || !(amount > 0)) return res.status(400).json({ error: 'Pick two different companies and a positive amount.' });
  const { rows } = await q(
    `INSERT INTO transfers (tdate, from_id, to_id, amount, purpose, ref, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [String(b.date || '').slice(0, 10), from, to, amount, String(b.purpose || '').slice(0, 200), String(b.ref || '').slice(0, 80), req.user.id]);
  res.json({ ok: true, id: rows[0].id });
}));

app.put('/api/transfers/:id', wrap(async (req, res) => {
  if (!needAdmin(req, res)) return;
  const b = req.body, from = parseInt(b.from_id, 10), to = parseInt(b.to_id, 10);
  const amount = Math.round((Number(b.amount) || 0) * 100) / 100;
  if (!from || !to || from === to || !(amount > 0)) return res.status(400).json({ error: 'Pick two different companies and a positive amount.' });
  await q('UPDATE transfers SET tdate=$1, from_id=$2, to_id=$3, amount=$4, purpose=$5, ref=$6 WHERE id=$7',
    [String(b.date || '').slice(0, 10), from, to, amount, String(b.purpose || ''), String(b.ref || ''), parseInt(req.params.id, 10)]);
  res.json({ ok: true });
}));

app.delete('/api/transfers/:id', wrap(async (req, res) => {
  if (!needAdmin(req, res)) return;
  await q('DELETE FROM transfers WHERE id = $1', [parseInt(req.params.id, 10)]);
  res.json({ ok: true });
}));

/* -------------------------------------------------------------- settings */
app.put('/api/settings', wrap(async (req, res) => {
  if (!needAdmin(req, res)) return;
  const b = req.body;
  await q('UPDATE settings SET group_name=$1, currency=$2, fy_start=$3 WHERE id=1',
    [String(b.group || 'AKB Group').slice(0, 80), String(b.currency || 'INR').toUpperCase().slice(0, 5), parseInt(b.fyStart, 10) || 4]);
  res.json({ ok: true });
}));

app.post('/api/companies', wrap(async (req, res) => {
  if (!needAdmin(req, res)) return;
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Company name is required.' });
  const SLOT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
  const { rows: n } = await q('SELECT COUNT(*) AS n FROM companies');
  const { rows } = await q('INSERT INTO companies (name, code, color, sort) VALUES ($1,$2,$3,$4) RETURNING id',
    [name, String(req.body.code || name.slice(0, 4)).toUpperCase(), SLOT[n[0].n % SLOT.length], n[0].n]);
  res.json({ ok: true, id: rows[0].id });
}));

app.put('/api/companies/:id', wrap(async (req, res) => {
  if (!needAdmin(req, res)) return;
  await q('UPDATE companies SET name=$1, code=$2 WHERE id=$3',
    [String(req.body.name || '').trim() || 'Unnamed', String(req.body.code || '').toUpperCase().slice(0, 6), parseInt(req.params.id, 10)]);
  res.json({ ok: true });
}));

app.delete('/api/companies/:id', wrap(async (req, res) => {
  if (!needAdmin(req, res)) return;
  await q('DELETE FROM companies WHERE id = $1', [parseInt(req.params.id, 10)]);
  res.json({ ok: true });
}));

/* --------------------------------------------------- projects / locations */
app.post('/api/projects', wrap(async (req, res) => {
  if (!needAdmin(req, res)) return;
  const company_id = parseInt(req.body.company_id, 10);
  const name = String(req.body.name || '').trim();
  if (!company_id) return res.status(400).json({ error: 'Choose the company this project / location belongs to.' });
  if (!name) return res.status(400).json({ error: 'A name is required.' });
  const { rows: co } = await q('SELECT 1 FROM companies WHERE id = $1', [company_id]);
  if (!co.length) return res.status(400).json({ error: 'That company no longer exists.' });
  const { rows: n } = await q('SELECT COUNT(*) AS n FROM projects WHERE company_id = $1', [company_id]);
  const { rows } = await q('INSERT INTO projects (company_id, name, code, sort) VALUES ($1,$2,$3,$4) RETURNING id',
    [company_id, name.slice(0, 120), String(req.body.code || '').toUpperCase().slice(0, 12), n[0].n]);
  await q('INSERT INTO audit (user_id, user_name, action, detail) VALUES ($1,$2,$3,$4)',
    [req.user.id, req.user.name, 'added project / location', name]);
  res.json({ ok: true, id: rows[0].id });
}));

app.put('/api/projects/:id', wrap(async (req, res) => {
  if (!needAdmin(req, res)) return;
  const id = parseInt(req.params.id, 10);
  const b = req.body;
  await q(`UPDATE projects SET name = COALESCE($1, name), code = COALESCE($2, code), active = COALESCE($3, active) WHERE id = $4`,
    [b.name !== undefined ? String(b.name).trim().slice(0, 120) || 'Unnamed' : null,
    b.code !== undefined ? String(b.code).toUpperCase().slice(0, 12) : null,
    typeof b.active === 'boolean' ? b.active : null, id]);
  res.json({ ok: true });
}));

app.delete('/api/projects/:id', wrap(async (req, res) => {
  if (!needAdmin(req, res)) return;
  const id = parseInt(req.params.id, 10);
  // entries keep their history — project_id is set to NULL by the FK rule
  await q('DELETE FROM projects WHERE id = $1', [id]);
  await q('INSERT INTO audit (user_id, user_name, action, detail) VALUES ($1,$2,$3,$4)',
    [req.user.id, req.user.name, 'removed project / location', `#${id}`]);
  res.json({ ok: true });
}));

app.put('/api/categories', wrap(async (req, res) => {
  if (!needAdmin(req, res)) return;
  const kinds = { expense: req.body.expCats, income: req.body.incCats, method: req.body.methods, source: req.body.sources };
  for (const kind of Object.keys(kinds)) {
    const list = (kinds[kind] || []).map(s => String(s).trim()).filter(Boolean).slice(0, 200);
    if (!list.length) continue;
    await q('DELETE FROM categories WHERE kind = $1', [kind]);
    for (let i = 0; i < list.length; i++) {
      await q('INSERT IGNORE INTO categories (kind, name, sort) VALUES ($1,$2,$3)', [kind, list[i], i]);
    }
  }
  res.json({ ok: true });
}));

/* ----------------------------------------------------------------- users */
app.post('/api/users', wrap(async (req, res) => {
  if (!needAdmin(req, res)) return;
  const email = String(req.body.email || '').toLowerCase().trim();
  const name = String(req.body.name || '').trim();
  const pass = String(req.body.password || '');
  const role = ['admin', 'accountant', 'staff'].includes(req.body.role) ? req.body.role : 'staff';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  if (pass.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  const dup = await q('SELECT 1 FROM users WHERE email = $1', [email]);
  if (dup.rows.length) return res.status(400).json({ error: 'That email already has an account.' });
  const { rows } = await q('INSERT INTO users (email, name, pass_hash, role, must_change) VALUES ($1,$2,$3,$4,TRUE) RETURNING id',
    [email, name, bcrypt.hashSync(pass, 10), role]);
  const ids = (req.body.companyIds || []).map(Number).filter(Boolean);
  for (const c of ids) await q('INSERT IGNORE INTO user_companies (user_id, company_id) VALUES ($1,$2)', [rows[0].id, c]);
  res.json({ ok: true, id: rows[0].id });
}));

app.put('/api/users/:id', wrap(async (req, res) => {
  if (!needAdmin(req, res)) return;
  const id = parseInt(req.params.id, 10);
  const b = req.body;
  if (b.name !== undefined || b.role !== undefined || b.active !== undefined) {
    if (id === req.user.id && ((b.role && b.role !== 'admin') || b.active === false)) {
      return res.status(400).json({ error: 'You cannot remove your own administrator access.' });
    }
    await q('UPDATE users SET name = COALESCE($1, name), role = COALESCE($2, role), active = COALESCE($3, active) WHERE id = $4',
      [b.name ? String(b.name).trim() : null, ['admin', 'accountant', 'staff'].includes(b.role) ? b.role : null,
      typeof b.active === 'boolean' ? b.active : null, id]);
  }
  if (b.password) {
    if (String(b.password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    await q('UPDATE users SET pass_hash = $1, must_change = TRUE WHERE id = $2', [bcrypt.hashSync(String(b.password), 10), id]);
  }
  if (Array.isArray(b.companyIds)) {
    await q('DELETE FROM user_companies WHERE user_id = $1', [id]);
    for (const c of b.companyIds.map(Number).filter(Boolean)) {
      await q('INSERT IGNORE INTO user_companies (user_id, company_id) VALUES ($1,$2)', [id, c]);
    }
  }
  res.json({ ok: true });
}));

app.delete('/api/users/:id', wrap(async (req, res) => {
  if (!needAdmin(req, res)) return;
  const id = parseInt(req.params.id, 10);
  if (id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account.' });
  await q('DELETE FROM users WHERE id = $1', [id]);
  res.json({ ok: true });
}));

app.get('/api/audit', wrap(async (req, res) => {
  if (!needAdmin(req, res)) return;
  const { rows } = await q(`SELECT user_name, action, detail, DATE_FORMAT(at, '%Y-%m-%d %H:%i') AS at
                              FROM audit ORDER BY id DESC LIMIT 100`);
  res.json(rows);
}));

/* ---------------------------------------------------------------- static */
app.get('/healthz', (req, res) => res.type('text').send('ok'));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', req.user ? 'index.html' : 'login.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.use(express.static(path.join(__dirname, 'public'), { index: false, maxAge: PROD ? '1h' : 0 }));
app.use((req, res) => res.status(404).type('text').send('Not found'));

/* ------------------------------------------------------------------ boot */
app.listen(PORT, '0.0.0.0', () => {
  console.log('AKB Group Accounts server running on port ' + PORT);
  (async () => {
    try {
      await migrate();
      await seed();
      console.log('Database migration & seeding completed successfully.');
    } catch (e) {
      console.error('Database setup notice during boot:', e.message);
    }
  })();
});
