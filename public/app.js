/* =========================================================
   GROUP ACCOUNTS — browser client
   Talks to the server API; all data lives in Postgres.
   ========================================================= */
'use strict';

var S = { me: null, settings: {}, companies: [], expCats: [], incCats: [], methods: [], sources: [], txns: [], transfers: [], users: [], requests: [], cash: [], cashIn: [] };
var SLOT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];

/* ---------------------------------------------------------------- api */
async function api(path, method, body) {
  var r = await fetch(path, {
    method: method || 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    credentials: 'same-origin',
    body: body ? JSON.stringify(body) : undefined
  });
  if (r.status === 401) { location.href = '/login'; throw new Error('Signed out'); }
  var d = null;
  try { d = await r.json(); } catch (e) { d = {}; }
  if (!r.ok) throw new Error(d.error || 'Request failed.');
  return d;
}
async function refresh() {
  var d = await api('/api/data');
  S.me = d.me; S.settings = d.settings; S.companies = d.companies;
  S.expCats = d.expCats; S.incCats = d.incCats; S.methods = d.methods;
  S.txns = d.txns; S.transfers = d.transfers; S.users = d.users || [];
  S.requests = d.requests || []; S.cash = d.cash || []; S.cashIn = d.cashIn || []; S.sources = d.sources || [];
}

/* -------------------------------------------------------------- helpers */
function $(s, r) { return (r || document).querySelector(s); }
function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
function cur() { return S.settings.currency || 'INR'; }
function isINR() { return (S.settings.currency || '').toUpperCase() === 'INR'; }
function isAdmin() { return S.me && S.me.role === 'admin'; }
function isCashier() { return S.me && (S.me.role === 'admin' || S.me.role === 'accountant'); }
function roleLabel(r) { return r === 'admin' ? 'administrator' : r === 'accountant' ? 'accountant' : 'staff'; }
function money(n) {
  n = Number(n) || 0;
  return n.toLocaleString(isINR() ? 'en-IN' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function money0(n) {
  n = Number(n) || 0; var a = Math.abs(n);
  if (isINR()) {
    if (a >= 1e7) return (n / 1e7).toFixed(a >= 1e8 ? 1 : 2) + ' Cr';
    if (a >= 1e5) return (n / 1e5).toFixed(a >= 1e6 ? 1 : 2) + ' L';
    if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'K';
    return n.toFixed(0);
  }
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'K';
  return n.toFixed(0);
}
function todayISO() {
  var d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function co(id) {
  id = Number(id);
  for (var i = 0; i < S.companies.length; i++) if (Number(S.companies[i].id) === id) return S.companies[i];
  return { name: '—', code: '?', color: '#898781' };
}
function coChip(id) { var c = co(id); return '<span class="co-chip"><i class="dot" style="background:' + c.color + '"></i>' + esc(c.name) + '</span>'; }
function toast(msg) {
  var t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(function () { t.classList.remove('show'); }, 2400);
}
function fail(e) { alert(e.message || 'Something went wrong.'); }
function monthKey(d) { return String(d).slice(0, 7); }
function monthLabel(k) {
  var p = k.split('-'); var m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return m[Number(p[1]) - 1] + ' ' + p[0].slice(2);
}
function amt(t) { return Number(t.amount) || 0; }

/* ------------------------------------------------------------ filtering */
function inRange(d, from, to) { if (from && d < from) return false; if (to && d > to) return false; return true; }
function txnsFiltered(f) {
  return S.txns.filter(function (t) {
    if (f.co && Number(t.company_id) !== Number(f.co)) return false;
    if (f.type && t.type !== f.type) return false;
    if (f.cat && t.category !== f.cat) return false;
    if (f.status && t.status !== f.status) return false;
    if (!inRange(t.date, f.from, f.to)) return false;
    if (f.q) {
      var hay = (t.party + ' ' + t.invoice + ' ' + t.notes + ' ' + t.category + ' ' + t.method + ' ' + (t.by || '')).toLowerCase();
      if (hay.indexOf(f.q.toLowerCase()) === -1) return false;
    }
    return true;
  }).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id; });
}
function totals(list) {
  var o = { income: 0, expense: 0, ar: 0, ap: 0, count: list.length };
  list.forEach(function (t) {
    var a = amt(t);
    if (t.type === 'income') { o.income += a; if (t.status === 'unpaid') o.ar += a; }
    else { o.expense += a; if (t.status === 'unpaid') o.ap += a; }
  });
  o.net = o.income - o.expense;
  return o;
}

/* ----------------------------------------------------------------- tabs */
function showView(v) {
  $$('.view').forEach(function (s) { s.classList.toggle('active', s.id === 'view-' + v); });
  $$('.tab').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.view === v)); });
  if (v === 'dashboard') renderDash();
  if (v === 'pay') renderPay();
  if (v === 'cash') renderCash();
  if (v === 'txn') renderTxn();
  if (v === 'inter') renderInter();
  if (v === 'reports') renderReport();
  if (v === 'settings') renderSettings();
}

/* --------------------------------------------------------------- charts */
var TIP = null;
function tipShow(html, ev) {
  TIP = TIP || $('#tip');
  TIP.innerHTML = html; TIP.style.display = 'block';
  var x = ev.clientX + 14, y = ev.clientY + 14, r = TIP.getBoundingClientRect();
  if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 14;
  if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - 14;
  TIP.style.left = x + 'px'; TIP.style.top = y + 'px';
}
function tipHide() { TIP = TIP || $('#tip'); TIP.style.display = 'none'; }
function topRound(x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  if (h <= 0.5) return 'M' + x + ',' + (y + h) + 'h' + w + 'v-0.5h' + (-w) + 'z';
  return 'M' + x + ',' + (y + h) + 'V' + (y + r) + 'a' + r + ',' + r + ' 0 0 1 ' + r + ',' + (-r) +
    'h' + (w - 2 * r) + 'a' + r + ',' + r + ' 0 0 1 ' + r + ',' + r + 'V' + (y + h) + 'z';
}
function rightRound(x, y, w, h, r) {
  r = Math.min(r, w, h / 2);
  if (w <= 0.5) return 'M' + x + ',' + y + 'v' + h + 'h0.5v' + (-h) + 'z';
  return 'M' + x + ',' + y + 'h' + (w - r) + 'a' + r + ',' + r + ' 0 0 1 ' + r + ',' + r +
    'v' + (h - 2 * r) + 'a' + r + ',' + r + ' 0 0 1 ' + (-r) + ',' + r + 'H' + x + 'z';
}
function niceMax(v) {
  if (v <= 0) return 10;
  var e = Math.pow(10, Math.floor(Math.log10(v))), n = v / e;
  var m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return m * e;
}
function emptyBox(el, msg) { el.innerHTML = '<div class="empty">' + esc(msg) + '</div>'; }

function groupedBars(el, rows, names, colors) {
  if (!rows.length || rows.every(function (r) { return !r.a && !r.b; })) { emptyBox(el, 'No data for this period'); return; }
  var W = 640, H = 300, pad = { t: 22, r: 12, b: 46, l: 62 };
  var iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  var max = niceMax(Math.max.apply(null, rows.map(function (r) { return Math.max(r.a, r.b); })));
  var band = iw / rows.length, bw = Math.min(30, (band - 12) / 2 - 1);
  var s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
  for (var i = 0; i <= 4; i++) {
    var gy = pad.t + ih - ih * i / 4;
    s += '<line class="gridline" x1="' + pad.l + '" y1="' + gy + '" x2="' + (W - pad.r) + '" y2="' + gy + '"/>';
    s += '<text x="' + (pad.l - 9) + '" y="' + (gy + 4) + '" text-anchor="end">' + money0(max * i / 4) + '</text>';
  }
  rows.forEach(function (r, i) {
    var cx = pad.l + band * i + band / 2, xa = cx - bw - 1, xb = cx + 1;
    var ha = ih * (r.a / max), hb = ih * (r.b / max);
    s += '<path d="' + topRound(xa, pad.t + ih - ha, bw, ha, 4) + '" fill="' + colors[0] + '" data-i="' + i + '" class="hbar"/>';
    s += '<path d="' + topRound(xb, pad.t + ih - hb, bw, hb, 4) + '" fill="' + colors[1] + '" data-i="' + i + '" class="hbar"/>';
    var lab = r.label.length > 14 ? r.label.slice(0, 13) + '…' : r.label;
    s += '<text x="' + cx + '" y="' + (pad.t + ih + 17) + '" text-anchor="middle">' + esc(lab) + '</text>';
    s += '<text class="val" x="' + cx + '" y="' + (pad.t + ih + 32) + '" text-anchor="middle">' + money0(r.a - r.b) + '</text>';
  });
  s += '<line class="axisline" x1="' + pad.l + '" y1="' + (pad.t + ih) + '" x2="' + (W - pad.r) + '" y2="' + (pad.t + ih) + '"/></svg>';
  el.innerHTML = s;
  $$('.hbar', el).forEach(function (p) {
    p.style.cursor = 'pointer';
    p.addEventListener('mousemove', function (ev) {
      var r = rows[+p.dataset.i];
      tipShow('<b>' + esc(r.label) + '</b>' +
        '<div class="r"><span>' + names[0] + '</span><span>' + money(r.a) + '</span></div>' +
        '<div class="r"><span>' + names[1] + '</span><span>' + money(r.b) + '</span></div>' +
        '<div class="r"><span>Net</span><span>' + money(r.a - r.b) + '</span></div>', ev);
    });
    p.addEventListener('mouseleave', tipHide);
  });
}
function lines(el, rows, names, colors) {
  if (rows.length < 1) { emptyBox(el, 'No data for this period'); return; }
  var W = 640, H = 300, pad = { t: 22, r: 16, b: 40, l: 62 };
  var iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  var max = niceMax(Math.max(1, Math.max.apply(null, rows.map(function (r) { return Math.max(r.a, r.b); }))));
  var n = rows.length, step = n > 1 ? iw / (n - 1) : 0;
  function X(i) { return n > 1 ? pad.l + step * i : pad.l + iw / 2; }
  function Y(v) { return pad.t + ih - ih * (v / max); }
  var s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
  for (var i = 0; i <= 4; i++) {
    var gy = pad.t + ih - ih * i / 4;
    s += '<line class="gridline" x1="' + pad.l + '" y1="' + gy + '" x2="' + (W - pad.r) + '" y2="' + gy + '"/>';
    s += '<text x="' + (pad.l - 9) + '" y="' + (gy + 4) + '" text-anchor="end">' + money0(max * i / 4) + '</text>';
  }
  ['a', 'b'].forEach(function (k, si) {
    var d = rows.map(function (r, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(r[k]).toFixed(1); }).join('');
    s += '<path d="' + d + '" fill="none" stroke="' + colors[si] + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
    rows.forEach(function (r, i) {
      s += '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(r[k]).toFixed(1) + '" r="3.5" fill="' + colors[si] + '" stroke="var(--panel)" stroke-width="2"/>';
    });
  });
  var everyN = Math.ceil(n / 8);
  rows.forEach(function (r, i) {
    if (i % everyN === 0 || i === n - 1) s += '<text x="' + X(i) + '" y="' + (pad.t + ih + 18) + '" text-anchor="middle">' + esc(r.label) + '</text>';
    s += '<rect class="hzone" x="' + (X(i) - step / 2) + '" y="' + pad.t + '" width="' + (step || iw) + '" height="' + ih + '" fill="transparent" data-i="' + i + '"/>';
  });
  s += '<line class="axisline" x1="' + pad.l + '" y1="' + (pad.t + ih) + '" x2="' + (W - pad.r) + '" y2="' + (pad.t + ih) + '"/>';
  s += '<line id="cross" x1="0" y1="' + pad.t + '" x2="0" y2="' + (pad.t + ih) + '" stroke="var(--axis)" stroke-width="1" style="display:none"/></svg>';
  el.innerHTML = s;
  var cross = $('#cross', el);
  $$('.hzone', el).forEach(function (z) {
    z.addEventListener('mousemove', function (ev) {
      var i = +z.dataset.i, r = rows[i];
      cross.style.display = ''; cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i));
      tipShow('<b>' + esc(r.label) + '</b>' +
        '<div class="r"><span>' + names[0] + '</span><span>' + money(r.a) + '</span></div>' +
        '<div class="r"><span>' + names[1] + '</span><span>' + money(r.b) + '</span></div>' +
        '<div class="r"><span>Net</span><span>' + money(r.a - r.b) + '</span></div>', ev);
    });
    z.addEventListener('mouseleave', function () { cross.style.display = 'none'; tipHide(); });
  });
}
function hbars(el, rows, color) {
  if (!rows.length) { emptyBox(el, 'No expenses in this period'); return; }
  var rowH = 30, W = 640, pad = { t: 8, r: 76, l: 168, b: 8 };
  var H = pad.t + pad.b + rows.length * rowH;
  var max = Math.max.apply(null, rows.map(function (r) { return r.value; })) || 1;
  var iw = W - pad.l - pad.r;
  var s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
  rows.forEach(function (r, i) {
    var y = pad.t + i * rowH, bh = 16, w = iw * (r.value / max);
    var lab = r.label.length > 24 ? r.label.slice(0, 23) + '…' : r.label;
    s += '<text x="' + (pad.l - 10) + '" y="' + (y + bh / 2 + 4) + '" text-anchor="end">' + esc(lab) + '</text>';
    s += '<path d="' + rightRound(pad.l, y, Math.max(w, 1), bh, 4) + '" fill="' + color + '" class="hb" data-i="' + i + '"/>';
    s += '<text class="val" x="' + (pad.l + w + 8) + '" y="' + (y + bh / 2 + 4) + '">' + money0(r.value) + '</text>';
  });
  s += '</svg>';
  el.innerHTML = s;
  $$('.hb', el).forEach(function (p) {
    p.addEventListener('mousemove', function (ev) {
      var r = rows[+p.dataset.i];
      tipShow('<b>' + esc(r.label) + '</b><div class="r"><span>Spend</span><span>' + cur() + ' ' + money(r.value) + '</span></div>' +
        '<div class="r"><span>Share</span><span>' + r.pct.toFixed(1) + '%</span></div>', ev);
    });
    p.addEventListener('mouseleave', tipHide);
  });
}

/* ------------------------------------------------------------ dashboard */
function dashActionTile() {
  if (isAdmin()) {
    var p = S.requests.filter(function (r) { return r.status === 'pending'; });
    return [tile('Awaiting your approval', String(p.length),
      p.length ? cur() + ' ' + money(p.reduce(function (s, r) { return s + Number(r.requested_amount); }, 0)) + ' requested' : 'nothing pending',
      p.length ? 'neg' : '')];
  }
  if (isCashier()) {
    var a = S.requests.filter(function (r) { return r.status === 'approved'; });
    return [tile('Approved to release', String(a.length),
      a.length ? cur() + ' ' + money(a.reduce(function (s, r) { return s + Number(r.approved_amount); }, 0)) + ' cleared' : 'nothing to release',
      a.length ? 'neg' : '')];
  }
  var mine = S.requests.filter(function (r) { return r.status === 'pending'; });
  return [tile('Your requests waiting', String(mine.length), 'with the administrator for approval')];
}
function tile(label, value, foot, cls) {
  return '<div class="tile"><div class="label">' + esc(label) + '</div><div class="value ' + (cls || '') + '">' + value + '</div><div class="foot">' + esc(foot) + '</div></div>';
}
function legend(names, colors) {
  return names.map(function (n, i) { return '<span class="key"><i style="background:' + colors[i] + '"></i>' + esc(n) + '</span>'; }).join('');
}
function applyPeriod(p, fromEl, toEl) {
  var now = new Date(), y = now.getFullYear(), m = now.getMonth();
  function iso(d) { return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
  if (p === 'all') { fromEl.value = ''; toEl.value = ''; return; }
  if (p === 'ytd') {
    var fs = (parseInt(S.settings.fyStart, 10) || 1) - 1;
    var sy = (m >= fs) ? y : y - 1;
    fromEl.value = iso(new Date(sy, fs, 1)); toEl.value = todayISO(); return;
  }
  if (p === 'mtd') { fromEl.value = iso(new Date(y, m, 1)); toEl.value = todayISO(); return; }
  if (p === 'q') { var qs = Math.floor(m / 3) * 3; fromEl.value = iso(new Date(y, qs, 1)); toEl.value = todayISO(); return; }
  if (p === 'last12') { fromEl.value = iso(new Date(y, m - 11, 1)); toEl.value = todayISO(); return; }
}
function renderDash() {
  var f = { co: $('#dashCo').value, from: $('#dashFrom').value, to: $('#dashTo').value };
  var list = txnsFiltered(f), t = totals(list);
  $$('.cur').forEach(function (e) { e.textContent = cur(); });

  $('#dashTiles').innerHTML = [
    tile('Total income · ' + cur(), money(t.income), t.count + ' entries in scope'),
    tile('Total expense · ' + cur(), money(t.expense), 'inter-company transfers excluded'),
    tile('Net result · ' + cur(), money(t.net), t.net >= 0 ? 'profit' : 'loss', t.net >= 0 ? 'pos' : 'neg'),
    tile('Receivable · ' + cur(), money(t.ar), 'unpaid — customers owe the group'),
    tile('Payable · ' + cur(), money(t.ap), 'unpaid — group owes suppliers')
  ].concat(dashActionTile()).join('');

  var visible = myCompanies().filter(function (c) { return !f.co || Number(c.id) === Number(f.co); });
  var rows = visible.map(function (c) {
    var tt = totals(list.filter(function (x) { return Number(x.company_id) === Number(c.id); }));
    return { label: c.name, a: tt.income, b: tt.expense, id: c.id, net: tt.net, exp: tt.expense };
  });
  $('#legCo').innerHTML = legend(['Income', 'Expense'], ['var(--series-1)', 'var(--series-2)']);
  $('#legTrend').innerHTML = legend(['Income', 'Expense'], ['var(--series-1)', 'var(--series-2)']);
  var cs = getComputedStyle(document.documentElement);
  var c1 = cs.getPropertyValue('--series-1').trim(), c2 = cs.getPropertyValue('--series-2').trim();
  groupedBars($('#chartCompany'), rows, ['Income', 'Expense'], [c1, c2]);

  var byM = {};
  list.forEach(function (x) {
    var k = monthKey(x.date); byM[k] = byM[k] || { a: 0, b: 0 };
    if (x.type === 'income') byM[k].a += amt(x); else byM[k].b += amt(x);
  });
  var keys = Object.keys(byM).sort().slice(-18);
  lines($('#chartTrend'), keys.map(function (k) { return { label: monthLabel(k), a: byM[k].a, b: byM[k].b }; }), ['Income', 'Expense'], [c1, c2]);

  var byC = {}, totExp = 0;
  list.forEach(function (x) { if (x.type === 'expense') { byC[x.category] = (byC[x.category] || 0) + amt(x); totExp += amt(x); } });
  var cats = Object.keys(byC).map(function (k) { return { label: k, value: byC[k], pct: totExp ? byC[k] / totExp * 100 : 0 }; })
    .sort(function (a, b) { return b.value - a.value; }).slice(0, 8);
  hbars($('#chartCat'), cats, c1);

  var gExp = rows.reduce(function (s, r) { return s + r.exp; }, 0);
  var sn = '<thead><tr><th>Company</th><th class="num">Income</th><th class="num">Expense</th><th class="num">Net</th><th>Share of spend</th></tr></thead><tbody>';
  rows.forEach(function (r) {
    var pct = gExp ? r.exp / gExp * 100 : 0;
    sn += '<tr><td>' + coChip(r.id) + '</td><td class="num">' + money(r.a) + '</td><td class="num">' + money(r.b) + '</td>' +
      '<td class="num ' + (r.net >= 0 ? 'pos' : 'neg') + '">' + money(r.net) + '</td>' +
      '<td><div style="display:flex;align-items:center;gap:8px"><div class="bar-track" style="flex:1"><div class="bar-fill" style="width:' + pct.toFixed(1) + '%"></div></div>' +
      '<span style="font-variant-numeric:tabular-nums;color:var(--text-secondary)">' + pct.toFixed(0) + '%</span></div></td></tr>';
  });
  sn += '</tbody><tfoot><tr><td>' + (isAdmin() ? 'Group total' : 'Your total') + '</td><td class="num">' + money(t.income) +
    '</td><td class="num">' + money(t.expense) + '</td><td class="num">' + money(t.net) + '</td><td></td></tr></tfoot>';
  $('#tblSnapshot').innerHTML = sn;

  var rec = list.slice(0, 12);
  $('#tblRecent').innerHTML = rec.length ? txnTableHTML(rec, false) :
    '<tbody><tr><td class="empty">No entries yet — open <b>Transactions</b> and add the first one.</td></tr></tbody>';
}

/* --------------------------------------------------------- transactions */
function txnFilter() {
  return { co: $('#fCo').value, type: $('#fType').value, cat: $('#fCat').value, status: $('#fStatus').value, from: $('#fFrom').value, to: $('#fTo').value, q: $('#fSearch').value.trim() };
}
function txnTableHTML(list, actions) {
  var h = '<thead><tr><th>Date</th><th>Company</th><th>Type</th><th>Category</th><th>Party</th><th>Invoice</th>' +
    '<th class="num">Amount</th><th>Method</th><th>Status</th><th>Entered by</th>' + (actions ? '<th></th>' : '') + '</tr></thead><tbody>';
  list.forEach(function (t) {
    h += '<tr><td>' + esc(t.date) + '</td><td>' + coChip(t.company_id) + '</td>' +
      '<td><span class="pill ' + t.type + '">' + (t.type === 'income' ? 'Income' : 'Expense') + '</span></td>' +
      '<td>' + esc(t.category) + '</td><td>' + esc(t.party || '—') + '</td><td>' + esc(t.invoice || '—') + '</td>' +
      '<td class="num"><b>' + money(amt(t)) + '</b></td><td>' + esc(t.method || '—') + '</td>' +
      '<td><span class="pill ' + t.status + '">' + (t.status === 'paid' ? 'Paid' : 'Unpaid') + '</span></td>' +
      '<td style="color:var(--muted)">' + esc(t.by || '—') + '</td>' +
      (actions ? '<td style="white-space:nowrap"><button class="btn sm" data-edit="' + t.id + '">Edit</button>' +
        (isAdmin() ? ' <button class="btn sm danger" data-del="' + t.id + '">✕</button>' : '') + '</td>' : '') + '</tr>';
  });
  h += '</tbody>';
  if (list.length) {
    var tt = totals(list);
    h += '<tfoot><tr><td colspan="6">' + list.length + ' entries · income minus expense</td>' +
      '<td class="num">' + money(tt.net) + '</td><td colspan="' + (actions ? 3 : 2) + '"></td></tr></tfoot>';
  }
  return h;
}
function fillSelect(el, pairs, allLabel, forceValue) {
  var v = forceValue === undefined ? el.value : forceValue;
  el.innerHTML = (allLabel ? '<option value="">' + esc(allLabel) + '</option>' : '') +
    pairs.map(function (p) { return '<option value="' + esc(p[0]) + '">' + esc(p[1]) + '</option>'; }).join('');
  if (v) el.value = v;
}
function renderTxn() {
  fillSelect($('#fCo'), S.companies.map(function (c) { return [c.id, c.name]; }), 'All companies');
  fillSelect($('#fCat'), S.expCats.concat(S.incCats).map(function (c) { return [c, c]; }), 'All categories');
  var list = txnsFiltered(txnFilter()), t = totals(list);
  $('#txnSummary').innerHTML = [
    tile('Income · ' + cur(), money(t.income), list.length + ' entries shown'),
    tile('Expense · ' + cur(), money(t.expense), 'for the current filters'),
    tile('Net · ' + cur(), money(t.net), t.net >= 0 ? 'surplus' : 'deficit', t.net >= 0 ? 'pos' : 'neg'),
    tile('Unpaid · ' + cur(), money(t.ar + t.ap), 'receivable ' + money0(t.ar) + ' · payable ' + money0(t.ap))
  ].join('');
  $('#tblTxn').innerHTML = list.length ? txnTableHTML(list, true) :
    '<tbody><tr><td class="empty">Nothing matches these filters.</td></tr></tbody>';
  $$('#tblTxn [data-edit]').forEach(function (b) { b.onclick = function () { txnForm(Number(b.dataset.edit)); }; });
  $$('#tblTxn [data-del]').forEach(function (b) {
    b.onclick = async function () {
      if (!confirm('Delete this entry permanently? Everyone in the group will lose it.')) return;
      try { await api('/api/txns/' + b.dataset.del, 'DELETE'); await refresh(); renderTxn(); toast('Entry deleted'); }
      catch (e) { fail(e); }
    };
  });
}
function fld(label, inner) { return '<div class="field"><label>' + esc(label) + '</label>' + inner + '</div>'; }
function sel(id, pairs, v) {
  return '<select id="' + id + '">' + pairs.map(function (p) {
    return '<option value="' + esc(p[0]) + '"' + (String(p[0]) === String(v) ? ' selected' : '') + '>' + esc(p[1]) + '</option>';
  }).join('') + '</select>';
}
function myCompanies() {
  if (isAdmin()) return S.companies;
  var ids = (S.me.companyIds || []).map(Number);
  return S.companies.filter(function (c) { return ids.indexOf(Number(c.id)) >= 0; });
}
function txnForm(id) {
  var t = id ? S.txns.filter(function (x) { return Number(x.id) === id; })[0] : null;
  var isNew = !t;
  var cos = myCompanies();
  if (!cos.length) { alert('You have not been given access to any company yet. Ask your administrator.'); return; }
  t = t || { date: todayISO(), company_id: cos[0].id, type: 'expense', category: S.expCats[0], party: '', invoice: '', amount: '', method: S.methods[0], status: 'paid', notes: '' };
  var body = '<div class="form-grid">' +
    fld('Date', '<input type="date" id="tDate" value="' + esc(t.date) + '">') +
    fld('Company', sel('tCo', cos.map(function (c) { return [c.id, c.name]; }), t.company_id)) +
    fld('Type', sel('tType', [['expense', 'Expense (money out)'], ['income', 'Income (money in)']], t.type)) +
    fld('Category', '<select id="tCat"></select>') +
    fld('Party (supplier / customer)', '<input type="text" id="tParty" value="' + esc(t.party) + '" placeholder="e.g. Al Noor Traders">') +
    fld('Invoice / reference', '<input type="text" id="tInv" value="' + esc(t.invoice) + '" placeholder="INV-1042">') +
    fld('Amount (' + cur() + ')', '<input type="number" id="tAmt" step="0.01" min="0" value="' + esc(t.amount) + '">') +
    fld('Payment method', sel('tMethod', S.methods.map(function (m) { return [m, m]; }), t.method)) +
    fld('Status', sel('tStatus', [['paid', 'Paid / settled'], ['unpaid', 'Unpaid / outstanding']], t.status)) +
    '<div class="field full"><label for="tNotes">Notes</label><textarea id="tNotes">' + esc(t.notes) + '</textarea></div>' +
    '<div class="full" id="tPreview" style="background:var(--surface-1);border:1px solid var(--border);border-radius:8px;padding:11px 13px;font-variant-numeric:tabular-nums"></div>' +
    '</div>';
  openModal(isNew ? 'New entry' : 'Edit entry', body,
    '<button class="btn" data-close>Cancel</button><button class="btn primary" id="tSave">' + (isNew ? 'Add entry' : 'Save changes') + '</button>');

  function refreshCats() {
    var list = ($('#tType').value === 'income' ? S.incCats : S.expCats);
    fillSelect($('#tCat'), list.map(function (c) { return [c, c]; }), null, list.indexOf(t.category) >= 0 ? t.category : list[0]);
  }
  function preview() {
    var a = Number($('#tAmt').value) || 0, isInc = $('#tType').value === 'income';
    $('#tPreview').innerHTML = '<b>' + (isInc ? 'Money in' : 'Money out') + ' — ' + cur() + ' ' + money(a) + '</b>' +
      '<div class="hint" style="margin-top:4px">' + ($('#tStatus').value === 'unpaid'
        ? (isInc ? 'Marked unpaid, so it shows under receivables until settled.' : 'Marked unpaid, so it shows under payables until settled.')
        : 'Marked paid, so it counts as settled.') + '</div>';
  }
  $('#tType').onchange = function () { refreshCats(); preview(); };
  ['tAmt', 'tStatus'].forEach(function (i) { $('#' + i).oninput = preview; $('#' + i).onchange = preview; });
  refreshCats(); preview();

  $('#tSave').onclick = async function () {
    var val = parseFloat($('#tAmt').value);
    if (!$('#tDate').value) { alert('Please pick a date.'); return; }
    if (!(val > 0)) { alert('Please enter an amount greater than zero.'); return; }
    var rec = {
      date: $('#tDate').value, company_id: Number($('#tCo').value), type: $('#tType').value,
      category: $('#tCat').value, party: $('#tParty').value.trim(), invoice: $('#tInv').value.trim(),
      amount: val, method: $('#tMethod').value, status: $('#tStatus').value, notes: $('#tNotes').value.trim()
    };
    this.disabled = true;
    try {
      if (isNew) await api('/api/txns', 'POST', rec); else await api('/api/txns/' + id, 'PUT', rec);
      await refresh(); closeModal(); renderTxn(); toast(isNew ? 'Entry added' : 'Entry updated');
    } catch (e) { this.disabled = false; fail(e); }
  };
}

/* -------------------------------------------------------- inter-company */
function renderInter() {
  var tr = S.transfers.slice();
  var netp = {}; S.companies.forEach(function (c) { netp[c.id] = 0; });
  var mat = {};
  S.companies.forEach(function (a) { mat[a.id] = {}; S.companies.forEach(function (b) { mat[a.id][b.id] = 0; }); });
  var vol = 0;
  tr.forEach(function (x) {
    var a = Number(x.amount) || 0; vol += a;
    if (netp[x.from_id] === undefined || netp[x.to_id] === undefined) return;
    netp[x.from_id] += a; netp[x.to_id] -= a;
    mat[x.from_id][x.to_id] += a; mat[x.to_id][x.from_id] -= a;
  });
  var owed = 0; S.companies.forEach(function (c) { if (netp[c.id] > 0) owed += netp[c.id]; });
  $('#interTiles').innerHTML = [
    tile('Transfers recorded', String(tr.length), 'across the group'),
    tile('Total moved · ' + cur(), money(vol), 'gross value of transfers'),
    tile('Outstanding · ' + cur(), money(owed), 'sum of positive balances'),
    tile('Group check', money(S.companies.reduce(function (s, c) { return s + netp[c.id]; }, 0)), 'must always be 0.00')
  ].join('');

  var h = '<thead><tr><th>Company</th><th class="num">Due from others</th><th class="num">Due to others</th><th class="num">Net position</th></tr></thead><tbody>';
  S.companies.forEach(function (c) {
    var n = netp[c.id];
    h += '<tr><td>' + coChip(c.id) + '</td><td class="num">' + money(Math.max(n, 0)) + '</td><td class="num">' + money(Math.max(-n, 0)) + '</td>' +
      '<td class="num ' + (n >= 0 ? 'pos' : 'neg') + '"><b>' + money(n) + '</b></td></tr>';
  });
  $('#tblInterNet').innerHTML = h + '</tbody>';

  var m = '<thead><tr><th>Owed to ↓ / by →</th>' + S.companies.map(function (c) { return '<th class="num">' + esc(c.code || c.name) + '</th>'; }).join('') + '</tr></thead><tbody>';
  S.companies.forEach(function (a) {
    m += '<tr><td>' + esc(a.name) + '</td>' + S.companies.map(function (b) {
      if (a.id === b.id) return '<td class="num" style="color:var(--muted)">—</td>';
      var v = mat[a.id][b.id];
      return '<td class="num ' + (v > 0 ? 'pos' : v < 0 ? 'neg' : '') + '">' + (v ? money(v) : '·') + '</td>';
    }).join('') + '</tr>';
  });
  $('#tblMatrix').innerHTML = m + '</tbody>';

  var l = '<thead><tr><th>Date</th><th>From (paid)</th><th>To (received)</th><th class="num">Amount</th><th>Purpose</th><th>Reference</th><th>By</th>' +
    (isAdmin() ? '<th></th>' : '') + '</tr></thead><tbody>';
  tr.forEach(function (x) {
    l += '<tr><td>' + esc(x.date) + '</td><td>' + coChip(x.from_id) + '</td><td>' + coChip(x.to_id) + '</td>' +
      '<td class="num"><b>' + money(x.amount) + '</b></td><td>' + esc(x.purpose || '—') + '</td><td>' + esc(x.ref || '—') + '</td>' +
      '<td style="color:var(--muted)">' + esc(x.by || '—') + '</td>' +
      (isAdmin() ? '<td style="white-space:nowrap"><button class="btn sm" data-iedit="' + x.id + '">Edit</button> <button class="btn sm danger" data-idel="' + x.id + '">✕</button></td>' : '') + '</tr>';
  });
  $('#tblInter').innerHTML = tr.length ? l + '</tbody>' : '<tbody><tr><td class="empty">No transfers recorded yet.</td></tr></tbody>';
  $$('#tblInter [data-iedit]').forEach(function (b) { b.onclick = function () { interForm(Number(b.dataset.iedit)); }; });
  $$('#tblInter [data-idel]').forEach(function (b) {
    b.onclick = async function () {
      if (!confirm('Delete this transfer?')) return;
      try { await api('/api/transfers/' + b.dataset.idel, 'DELETE'); await refresh(); renderInter(); toast('Transfer deleted'); }
      catch (e) { fail(e); }
    };
  });
}
function interForm(id) {
  var t = id ? S.transfers.filter(function (x) { return Number(x.id) === id; })[0] : null;
  var isNew = !t;
  t = t || { date: todayISO(), from_id: S.companies[0] && S.companies[0].id, to_id: S.companies[1] && S.companies[1].id, amount: '', purpose: '', ref: '' };
  var pairs = S.companies.map(function (c) { return [c.id, c.name]; });
  openModal(isNew ? 'New inter-company transfer' : 'Edit transfer',
    '<div class="form-grid">' +
    fld('Date', '<input type="date" id="iDate" value="' + esc(t.date) + '">') +
    fld('Amount (' + cur() + ')', '<input type="number" id="iAmt" step="0.01" min="0" value="' + esc(t.amount) + '">') +
    fld('Paid by', sel('iFrom', pairs, t.from_id)) +
    fld('Received by', sel('iTo', pairs, t.to_id)) +
    fld('Purpose', '<input type="text" id="iPurpose" value="' + esc(t.purpose) + '" placeholder="e.g. salary funding, shared rent">') +
    fld('Reference', '<input type="text" id="iRef" value="' + esc(t.ref) + '" placeholder="bank ref / cheque no">') +
    '</div>',
    '<button class="btn" data-close>Cancel</button><button class="btn primary" id="iSave">' + (isNew ? 'Add transfer' : 'Save changes') + '</button>');
  $('#iSave').onclick = async function () {
    var a = parseFloat($('#iAmt').value);
    if ($('#iFrom').value === $('#iTo').value) { alert('Paying and receiving company must be different.'); return; }
    if (!(a > 0)) { alert('Enter an amount greater than zero.'); return; }
    var rec = { date: $('#iDate').value, from_id: Number($('#iFrom').value), to_id: Number($('#iTo').value), amount: a, purpose: $('#iPurpose').value.trim(), ref: $('#iRef').value.trim() };
    this.disabled = true;
    try {
      if (isNew) await api('/api/transfers', 'POST', rec); else await api('/api/transfers/' + id, 'PUT', rec);
      await refresh(); closeModal(); renderInter(); toast(isNew ? 'Transfer added' : 'Transfer updated');
    } catch (e) { this.disabled = false; fail(e); }
  };
}

/* -------------------------------------------------------------- reports */
var lastReportRows = [], lastReportName = 'report';
function renderReport() {
  var kind = $('#rReport').value, from = $('#rFrom').value, to = $('#rTo').value;
  $('#partyPick').style.display = kind === 'party' ? '' : 'none';
  var list = S.txns.filter(function (t) { return inRange(t.date, from, to); });
  var period = (from || to) ? ((from || 'start') + '  to  ' + (to || 'today')) : 'All dates';
  var head = '<div class="card" style="margin-bottom:16px"><h3>' + esc($('#rReport').selectedOptions[0].text) + '</h3>' +
    '<div class="card-sub">' + esc(S.settings.group) + ' · ' + esc(period) + ' · amounts in ' + cur() + '</div></div>';
  var out = $('#reportOut');
  if (kind === 'pl') out.innerHTML = head + reportPL(list);
  else if (kind === 'cat') out.innerHTML = head + reportCat(list);
  else if (kind === 'ar') out.innerHTML = head + reportOpen(list, 'income');
  else if (kind === 'ap') out.innerHTML = head + reportOpen(list, 'expense');
  else if (kind === 'party') out.innerHTML = head + reportParty(list);
}
function tbl(head, rows, foot) {
  return '<div class="table-wrap"><table><thead><tr>' + head.map(function (h, i) {
    return '<th' + (i ? ' class="num"' : '') + '>' + esc(h) + '</th>';
  }).join('') + '</tr></thead><tbody>' +
    (rows.length ? rows.map(function (r) {
      return '<tr>' + r.map(function (c, i) { return '<td' + (i ? ' class="num"' : '') + '>' + c + '</td>'; }).join('') + '</tr>';
    }).join('') : '<tr><td class="empty" colspan="' + head.length + '">Nothing to report for this period.</td></tr>') +
    '</tbody>' + (foot ? '<tfoot><tr>' + foot.map(function (c, i) { return '<td' + (i ? ' class="num"' : '') + '>' + c + '</td>'; }).join('') + '</tr></tfoot>' : '') + '</table></div>';
}
function reportPL(list) {
  var rows = [], csvRows = [['Company', 'Income', 'Expense', 'Net result', 'Margin %']], g = { i: 0, e: 0 };
  myCompanies().forEach(function (c) {
    var t = totals(list.filter(function (x) { return Number(x.company_id) === Number(c.id); }));
    g.i += t.income; g.e += t.expense;
    var mg = t.income ? (t.net / t.income * 100) : 0;
    rows.push([coChip(c.id), money(t.income), money(t.expense), '<b class="' + (t.net >= 0 ? 'pos' : 'neg') + '">' + money(t.net) + '</b>', mg.toFixed(1) + '%']);
    csvRows.push([c.name, t.income.toFixed(2), t.expense.toFixed(2), t.net.toFixed(2), mg.toFixed(1)]);
  });
  var gn = g.i - g.e;
  csvRows.push(['GROUP TOTAL', g.i.toFixed(2), g.e.toFixed(2), gn.toFixed(2), g.i ? (gn / g.i * 100).toFixed(1) : '0']);
  lastReportRows = csvRows; lastReportName = 'consolidated-pl';
  return tbl(['Company', 'Income', 'Expense', 'Net result', 'Margin %'], rows,
    ['<b>Group total</b>', '<b>' + money(g.i) + '</b>', '<b>' + money(g.e) + '</b>',
    '<b class="' + (gn >= 0 ? 'pos' : 'neg') + '">' + money(gn) + '</b>', (g.i ? (gn / g.i * 100).toFixed(1) : '0.0') + '%']);
}
function reportCat(list) {
  var cats = {}; list.forEach(function (t) { if (t.type === 'expense') cats[t.category] = true; });
  var names = Object.keys(cats).sort(), cos = myCompanies();
  var head = ['Expense category'].concat(cos.map(function (c) { return c.code || c.name; })).concat(['Total']);
  var csvRows = [head.slice()], colTot = cos.map(function () { return 0; }), grand = 0;
  var rows = names.map(function (n) {
    var vals = cos.map(function (c, i) {
      var v = list.filter(function (t) { return t.type === 'expense' && t.category === n && Number(t.company_id) === Number(c.id); })
        .reduce(function (s, t) { return s + amt(t); }, 0);
      colTot[i] += v; return v;
    });
    var rt = vals.reduce(function (a, b) { return a + b; }, 0); grand += rt;
    csvRows.push([n].concat(vals.map(function (v) { return v.toFixed(2); })).concat([rt.toFixed(2)]));
    return [esc(n)].concat(vals.map(function (v) { return v ? money(v) : '·'; })).concat(['<b>' + money(rt) + '</b>']);
  });
  csvRows.push(['TOTAL'].concat(colTot.map(function (v) { return v.toFixed(2); })).concat([grand.toFixed(2)]));
  lastReportRows = csvRows; lastReportName = 'category-breakdown';
  return tbl(head, rows, ['<b>Total</b>'].concat(colTot.map(function (v) { return '<b>' + money(v) + '</b>'; })).concat(['<b>' + money(grand) + '</b>']));
}
function reportOpen(list, type) {
  var open = list.filter(function (t) { return t.type === type && t.status === 'unpaid'; })
    .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  var csvRows = [['Date', 'Age (days)', 'Company', 'Party', 'Invoice', 'Amount']], sum = 0, now = new Date(todayISO());
  var rows = open.map(function (t) {
    var a = amt(t); sum += a;
    var age = Math.round((now - new Date(t.date)) / 86400000);
    csvRows.push([t.date, age, co(t.company_id).name, t.party, t.invoice, a.toFixed(2)]);
    return [esc(t.date), '<span class="' + (age > 90 ? 'neg' : '') + '">' + age + '</span>', coChip(t.company_id),
      esc(t.party || '—'), esc(t.invoice || '—'), '<b>' + money(a) + '</b>'];
  });
  csvRows.push(['TOTAL', '', '', '', '', sum.toFixed(2)]);
  lastReportRows = csvRows; lastReportName = type === 'income' ? 'receivables' : 'payables';
  return tbl(['Date', 'Age (days)', 'Company', 'Party', 'Invoice', 'Amount'], rows,
    ['<b>Total outstanding</b>', '', '', '', '', '<b>' + money(sum) + '</b>']);
}
function reportParty(list) {
  var names = {}; S.txns.forEach(function (t) { if (t.party) names[t.party] = true; });
  var opts = Object.keys(names).sort(), sel2 = $('#rParty'), keep = sel2.value;
  sel2.innerHTML = opts.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('');
  if (keep && opts.indexOf(keep) >= 0) sel2.value = keep;
  var who = sel2.value;
  if (!who) { lastReportRows = []; return '<div class="empty card">No parties recorded yet. Add a supplier or customer name on an entry first.</div>'; }
  var mine = list.filter(function (t) { return t.party === who; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  var csvRows = [['Date', 'Company', 'Type', 'Category', 'Invoice', 'Amount', 'Status']], inS = 0, outS = 0;
  var rows = mine.map(function (t) {
    var a = amt(t);
    if (t.type === 'income') inS += a; else outS += a;
    csvRows.push([t.date, co(t.company_id).name, t.type, t.category, t.invoice, a.toFixed(2), t.status]);
    return [esc(t.date), coChip(t.company_id), '<span class="pill ' + t.type + '">' + t.type + '</span>', esc(t.category),
      esc(t.invoice || '—'), '<b>' + money(a) + '</b>', '<span class="pill ' + t.status + '">' + t.status + '</span>'];
  });
  csvRows.push(['TOTALS', '', 'we billed ' + inS.toFixed(2), 'they billed ' + outS.toFixed(2), '', (inS - outS).toFixed(2), '']);
  lastReportRows = csvRows; lastReportName = 'statement-' + who.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  return tbl(['Date', 'Company', 'Type', 'Category', 'Invoice', 'Amount', 'Status'], rows,
    ['<b>' + esc(who) + '</b>', '', 'we billed ' + money(inS), 'they billed ' + money(outS), '', '<b>' + money(inS - outS) + '</b>', '']);
}

/* ------------------------------------------------------------- settings */
function renderSettings() {
  $$('.admin-only').forEach(function (e) { e.classList.toggle('hidden', !isAdmin()); });
  var s1 = $('#setGroup');
  if (s1) {
    s1.value = S.settings.group || '';
    $('#setCur').value = S.settings.currency || 'INR';
    $('#setFy').value = String(S.settings.fyStart || 4);
    $('#setExpCats').value = S.expCats.join('\n');
    $('#setIncCats').value = S.incCats.join('\n');
    $('#setMethods').value = S.methods.join('\n');
    $('#setSources').value = (S.sources || []).join('\n');
    $$('#view-settings .card').forEach(function (card) {
      var h = card.querySelector('h3');
      if (!h) return;
      var t = h.textContent;
      if ((t === 'Group & currency' || t === 'Companies' || t === 'Categories') && !isAdmin()) card.classList.add('hidden');
    });
  }
  if (!isAdmin()) return;

  var h = '<div class="table-wrap"><table><thead><tr><th>Name</th><th>Code</th><th>Colour</th><th></th></tr></thead><tbody>';
  S.companies.forEach(function (c) {
    h += '<tr><td><input type="text" data-cn="' + c.id + '" value="' + esc(c.name) + '" style="min-width:170px"></td>' +
      '<td><input type="text" data-cc="' + c.id + '" value="' + esc(c.code || '') + '" style="min-width:70px" maxlength="6"></td>' +
      '<td><span class="dot" style="width:16px;height:16px;background:' + c.color + '"></span></td>' +
      '<td><button class="btn sm danger" data-cdel="' + c.id + '">Remove</button></td></tr>';
  });
  $('#coList').innerHTML = h + '</tbody></table></div>';
  function saveCo(id) {
    var name = $('[data-cn="' + id + '"]').value, code = $('[data-cc="' + id + '"]').value;
    api('/api/companies/' + id, 'PUT', { name: name, code: code })
      .then(refresh).then(function () { toast('Company updated'); }).catch(fail);
  }
  $$('#coList [data-cn]').forEach(function (i) { i.onchange = function () { saveCo(i.dataset.cn); }; });
  $$('#coList [data-cc]').forEach(function (i) { i.onchange = function () { saveCo(i.dataset.cc); }; });
  $$('#coList [data-cdel]').forEach(function (b) {
    b.onclick = async function () {
      var id = Number(b.dataset.cdel);
      var n = S.txns.filter(function (t) { return Number(t.company_id) === id; }).length;
      if (!confirm('Remove ' + co(id).name + '?' + (n ? '\n\nThis will also delete ' + n + ' entries belonging to it.' : ''))) return;
      try { await api('/api/companies/' + id, 'DELETE'); await refresh(); renderSettings(); toast('Company removed'); }
      catch (e) { fail(e); }
    };
  });

  var u = '<div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Companies</th><th>Status</th><th></th></tr></thead><tbody>';
  S.users.forEach(function (x) {
    var cos = x.role === 'admin' ? 'All companies' :
      (x.company_ids || []).map(function (i) { return co(i).code || co(i).name; }).join(', ') || '<span style="color:var(--critical)">none yet</span>';
    u += '<tr><td>' + esc(x.name) + '</td><td>' + esc(x.email) + '</td>' +
      '<td><span class="role">' + esc(x.role) + '</span></td><td>' + cos + '</td>' +
      '<td><span class="pill ' + (x.active ? 'paid' : 'unpaid') + '">' + (x.active ? 'Active' : 'Disabled') + '</span></td>' +
      '<td style="white-space:nowrap"><button class="btn sm" data-uedit="' + x.id + '">Edit</button>' +
      (x.id === S.me.id ? '' : ' <button class="btn sm danger" data-udel="' + x.id + '">✕</button>') + '</td></tr>';
  });
  $('#userList').innerHTML = u + '</tbody></table></div>';
  $$('#userList [data-uedit]').forEach(function (b) { b.onclick = function () { userForm(Number(b.dataset.uedit)); }; });
  $$('#userList [data-udel]').forEach(function (b) {
    b.onclick = async function () {
      if (!confirm('Remove this person’s access? Their past entries stay in the books.')) return;
      try { await api('/api/users/' + b.dataset.udel, 'DELETE'); await refresh(); renderSettings(); toast('Access removed'); }
      catch (e) { fail(e); }
    };
  });

  api('/api/audit').then(function (rows) {
    var a = '<div class="table-wrap"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      a += '<tr><td style="white-space:nowrap">' + esc(r.at) + '</td><td>' + esc(r.user_name) + '</td><td>' + esc(r.action) + '</td><td style="color:var(--muted)">' + esc(r.detail) + '</td></tr>';
    });
    $('#auditList').innerHTML = rows.length ? a + '</tbody></table></div>' : '<div class="empty">Nothing recorded yet.</div>';
  }).catch(function () { });
}
function userForm(id) {
  var u = id ? S.users.filter(function (x) { return Number(x.id) === id; })[0] : null;
  var isNew = !u;
  u = u || { name: '', email: '', role: 'staff', active: true, company_ids: [] };
  var checks = S.companies.map(function (c) {
    var on = (u.company_ids || []).map(Number).indexOf(Number(c.id)) >= 0;
    return '<label class="chk"><input type="checkbox" class="ucheck" value="' + c.id + '"' + (on ? ' checked' : '') + '> ' + esc(c.name) + '</label>';
  }).join('');
  openModal(isNew ? 'Add person' : 'Edit ' + u.name,
    '<div class="form-grid">' +
    fld('Full name', '<input type="text" id="uName" value="' + esc(u.name) + '">') +
    fld('Email (used to sign in)', '<input type="email" id="uEmail" value="' + esc(u.email) + '"' + (isNew ? '' : ' disabled') + '>') +
    fld('Role', sel('uRole', [['staff', 'Staff — raises requests, own companies'],
      ['accountant', 'Accountant — releases payments, records cash'],
      ['admin', 'Administrator — approves, full access']], u.role)) +
    fld('Access', sel('uActive', [['1', 'Active'], ['0', 'Disabled']], u.active ? '1' : '0')) +
    fld(isNew ? 'Temporary password (min 8)' : 'Reset password (leave blank to keep)', '<input type="password" id="uPass" autocomplete="new-password">') +
    '<div class="field full"><label>Companies this person can see</label><div id="uCos">' + checks +
    '</div><p class="hint">Administrators always see every company, whatever is ticked here.</p></div>' +
    '</div>',
    '<button class="btn" data-close>Cancel</button><button class="btn primary" id="uSave">' + (isNew ? 'Create account' : 'Save changes') + '</button>');
  $('#uSave').onclick = async function () {
    var ids = $$('.ucheck').filter(function (c) { return c.checked; }).map(function (c) { return Number(c.value); });
    var body = {
      name: $('#uName').value.trim(), role: $('#uRole').value,
      active: $('#uActive').value === '1', companyIds: ids
    };
    if ($('#uPass').value) body.password = $('#uPass').value;
    this.disabled = true;
    try {
      if (isNew) {
        body.email = $('#uEmail').value.trim();
        if (!body.password) throw new Error('Set a temporary password for the new account.');
        await api('/api/users', 'POST', body);
      } else {
        await api('/api/users/' + id, 'PUT', body);
      }
      await refresh(); closeModal(); renderSettings();
      toast(isNew ? 'Account created' : 'Account updated');
    } catch (e) { this.disabled = false; fail(e); }
  };
}


/* ------------------------------------------------------- payment requests */
function reqAmount(r) { return r.status === 'pending' || r.status === 'rejected' ? Number(r.requested_amount) : Number(r.approved_amount); }
function statusPill(st) {
  var m = { pending: 'Waiting approval', approved: 'Approved', paid: 'Released', rejected: 'Rejected' };
  return '<span class="pill ' + st + '">' + (m[st] || st) + '</span>';
}
function payFiltered() {
  var st = $('#pStatus').value, c = $('#pCo').value, qs = $('#pSearch').value.trim().toLowerCase();
  return S.requests.filter(function (r) {
    if (st === 'open') { if (r.status !== 'pending' && r.status !== 'approved') return false; }
    else if (st && r.status !== st) return false;
    if (c && Number(r.company_id) !== Number(c)) return false;
    if (qs) {
      var hay = (r.work + ' ' + r.party + ' ' + r.invoice + ' ' + r.category + ' ' + (r.requested_by || '') + ' ' + r.notes).toLowerCase();
      if (hay.indexOf(qs) === -1) return false;
    }
    return true;
  });
}
function updateBadge() {
  var n = S.requests.filter(function (r) {
    return isAdmin() ? r.status === 'pending' : (isCashier() ? r.status === 'approved' : false);
  }).length;
  var b = $('#payBadge');
  if (!b) return;
  b.textContent = n; b.classList.toggle('on', n > 0);
}
function renderPay() {
  fillSelect($('#pCo'), myCompanies().map(function (c) { return [c.id, c.name]; }), 'All companies');
  var all = S.requests, list = payFiltered();
  var pend = all.filter(function (r) { return r.status === 'pending'; });
  var appr = all.filter(function (r) { return r.status === 'approved'; });
  var sum = function (a) { return a.reduce(function (s, r) { return s + reqAmount(r); }, 0); };
  $('#payTiles').innerHTML = [
    tile('Waiting for approval', String(pend.length), cur() + ' ' + money(sum(pend)) + ' requested'),
    tile('Approved to release', String(appr.length), cur() + ' ' + money(sum(appr)) + ' cleared for payment'),
    tile('Released · ' + cur(), money(sum(all.filter(function (r) { return r.status === 'paid'; }))), 'total paid out to date'),
    tile('Your next step', isAdmin() ? (pend.length ? pend.length + ' to approve' : 'nothing pending')
      : isCashier() ? (appr.length ? appr.length + ' to release' : 'nothing to release')
        : 'raise a request', isAdmin() ? 'you approve payments' : isCashier() ? 'you release payments' : 'the administrator approves it next')
  ].join('');

  var h = '<thead><tr><th>Raised</th><th>Company</th><th>Work / purpose</th><th>Party</th><th>Invoice</th>' +
    '<th class="num">Amount</th><th>Status</th><th>Raised by</th><th></th></tr></thead><tbody>';
  list.forEach(function (r) {
    var edited = r.status !== 'pending' && r.status !== 'rejected' &&
      Number(r.approved_amount) !== Number(r.requested_amount);
    var act = [];
    if (r.status === 'pending') {
      if (isAdmin()) act.push('<button class="btn sm primary" data-approve="' + r.id + '">Review</button>');
      if (isAdmin() || (r.requested_by === S.me.name)) act.push('<button class="btn sm" data-redit="' + r.id + '">Edit</button>');
    }
    if (r.status === 'approved' && isCashier()) act.push('<button class="btn sm primary" data-release="' + r.id + '">Release</button>');
    if (isAdmin() && r.status !== 'paid') act.push('<button class="btn sm danger" data-rdel="' + r.id + '">✕</button>');
    h += '<tr><td>' + esc(r.date) + (r.urgency === 'urgent' ? '<br><span class="pill urgent">Urgent</span>' : '') + '</td>' +
      '<td>' + coChip(r.company_id) + '</td>' +
      '<td class="work">' + esc(r.work || '—') + (r.notes ? '<div style="color:var(--muted);font-size:12px">' + esc(r.notes) + '</div>' : '') + '</td>' +
      '<td>' + esc(r.party || '—') + '</td><td>' + esc(r.invoice || '—') + '</td>' +
      '<td class="num"><b>' + money(reqAmount(r)) + '</b>' +
      (edited ? '<div class="was">' + money(r.requested_amount) + '</div>' : '') + '</td>' +
      '<td>' + statusPill(r.status) +
      (r.status === 'approved' ? '<div style="color:var(--muted);font-size:11.5px">by ' + esc(r.approved_by || '') + '</div>' : '') +
      (r.status === 'paid' ? '<div style="color:var(--muted);font-size:11.5px">' + esc(r.paid_method || '') + '</div>' : '') +
      (r.approval_note ? '<div style="color:var(--muted);font-size:11.5px">“' + esc(r.approval_note) + '”</div>' : '') + '</td>' +
      '<td style="color:var(--muted)">' + esc(r.requested_by || '—') + '</td>' +
      '<td style="white-space:nowrap">' + act.join(' ') + '</td></tr>';
  });
  h += '</tbody>';
  $('#tblPay').innerHTML = list.length ? h :
    '<tbody><tr><td class="empty">No payment requests match this filter.</td></tr></tbody>';
  $$('#tblPay [data-approve]').forEach(function (b) { b.onclick = function () { approveForm(Number(b.dataset.approve)); }; });
  $$('#tblPay [data-release]').forEach(function (b) { b.onclick = function () { releaseForm(Number(b.dataset.release)); }; });
  $$('#tblPay [data-redit]').forEach(function (b) { b.onclick = function () { reqForm(Number(b.dataset.redit)); }; });
  $$('#tblPay [data-rdel]').forEach(function (b) {
    b.onclick = async function () {
      if (!confirm('Delete this payment request?')) return;
      try { await api('/api/requests/' + b.dataset.rdel, 'DELETE'); await refresh(); renderPay(); updateBadge(); toast('Request deleted'); }
      catch (e) { fail(e); }
    };
  });
  updateBadge();
}
function reqForm(id) {
  var r = id ? S.requests.filter(function (x) { return Number(x.id) === id; })[0] : null;
  var isNew = !r;
  var cos = myCompanies();
  if (!cos.length) { alert('You have not been given access to any company yet. Ask your administrator.'); return; }
  r = r || { date: todayISO(), company_id: cos[0].id, work: '', party: '', invoice: '', invoice_date: '', category: S.expCats[0], requested_amount: '', urgency: 'normal', notes: '' };
  openModal(isNew ? 'Raise a payment request' : 'Edit request',
    '<div class="form-grid">' +
    fld('Request date', '<input type="date" id="qDate" value="' + esc(r.date) + '">') +
    fld('Company', sel('qCo', cos.map(function (c) { return [c.id, c.name]; }), r.company_id)) +
    '<div class="field full"><label for="qWork">Work / purpose of payment</label>' +
    '<input type="text" id="qWork" value="' + esc(r.work) + '" placeholder="e.g. Steel supply for 2nd floor slab"></div>' +
    fld('Pay to (party)', '<input type="text" id="qParty" value="' + esc(r.party) + '" placeholder="e.g. Sri Balaji Building Materials">') +
    fld('Invoice / bill no.', '<input type="text" id="qInv" value="' + esc(r.invoice) + '">') +
    fld('Invoice date', '<input type="date" id="qInvDate" value="' + esc(r.invoice_date || '') + '">') +
    fld('Expense category', '<select id="qCat"></select>') +
    fld('Amount required (' + cur() + ')', '<input type="number" id="qAmt" step="0.01" min="0" value="' + esc(r.requested_amount) + '">') +
    fld('Priority', sel('qUrg', [['normal', 'Normal'], ['urgent', 'Urgent']], r.urgency)) +
    '<div class="field full"><label for="qNotes">Notes for the approver</label><textarea id="qNotes">' + esc(r.notes) + '</textarea></div>' +
    '</div>',
    '<button class="btn" data-close>Cancel</button><button class="btn primary" id="qSave">' + (isNew ? 'Send for approval' : 'Save changes') + '</button>');
  fillSelect($('#qCat'), S.expCats.map(function (c) { return [c, c]; }), null, S.expCats.indexOf(r.category) >= 0 ? r.category : S.expCats[0]);
  $('#qSave').onclick = async function () {
    var val = parseFloat($('#qAmt').value);
    if (!(val > 0)) { alert('Enter the amount required.'); return; }
    if (!$('#qWork').value.trim() && !$('#qParty').value.trim()) { alert('Describe the work, or name the party being paid.'); return; }
    var body = {
      date: $('#qDate').value, company_id: Number($('#qCo').value), work: $('#qWork').value.trim(),
      party: $('#qParty').value.trim(), invoice: $('#qInv').value.trim(), invoice_date: $('#qInvDate').value || null,
      category: $('#qCat').value, requested_amount: val, urgency: $('#qUrg').value, notes: $('#qNotes').value.trim()
    };
    this.disabled = true;
    try {
      if (isNew) await api('/api/requests', 'POST', body); else await api('/api/requests/' + id, 'PUT', body);
      await refresh(); closeModal(); renderPay();
      toast(isNew ? 'Sent for approval' : 'Request updated');
    } catch (e) { this.disabled = false; fail(e); }
  };
}
function approveForm(id) {
  var r = S.requests.filter(function (x) { return Number(x.id) === id; })[0];
  if (!r) return;
  openModal('Review payment request',
    '<div style="background:var(--surface-1);border:1px solid var(--border);border-radius:8px;padding:14px 16px;margin-bottom:16px">' +
    '<div style="font-weight:650;margin-bottom:6px">' + esc(r.work || r.party || 'Payment request') + '</div>' +
    '<div class="hint">' + coChip(r.company_id) + ' &nbsp;·&nbsp; ' + esc(r.party || 'no party named') +
    (r.invoice ? ' &nbsp;·&nbsp; invoice ' + esc(r.invoice) : '') + (r.invoice_date ? ' dated ' + esc(r.invoice_date) : '') + '</div>' +
    '<div class="hint">Raised by ' + esc(r.requested_by || '—') + ' on ' + esc(r.date) + ' · category ' + esc(r.category || '—') +
    (r.urgency === 'urgent' ? ' · <b style="color:var(--critical)">urgent</b>' : '') + '</div>' +
    (r.notes ? '<div class="hint" style="margin-top:8px">“' + esc(r.notes) + '”</div>' : '') +
    '<div style="font-size:22px;font-weight:700;margin-top:12px">Requested ' + cur() + ' ' + money(r.requested_amount) + '</div>' +
    '</div>' +
    '<div class="form-grid">' +
    fld('Amount you approve (' + cur() + ')', '<input type="number" id="aAmt" step="0.01" min="0" value="' + esc(r.requested_amount) + '">') +
    '<div class="field full"><label for="aNote">Note (optional — the requester and accountant will see it)</label>' +
    '<textarea id="aNote" placeholder="e.g. rate renegotiated, pay after material delivery"></textarea></div>' +
    '<div class="full hint" id="aHint"></div></div>',
    '<button class="btn" data-close>Cancel</button>' +
    '<button class="btn danger" id="aReject">Reject</button>' +
    '<button class="btn primary" id="aApprove">Approve</button>');
  function hint() {
    var v = Number($('#aAmt').value) || 0, d = v - Number(r.requested_amount);
    $('#aHint').innerHTML = d === 0 ? 'Approving the full amount requested.' :
      d < 0 ? 'Reducing by <b>' + cur() + ' ' + money(-d) + '</b> from what was requested.'
        : 'Increasing by <b>' + cur() + ' ' + money(d) + '</b> over what was requested.';
  }
  $('#aAmt').oninput = hint; hint();
  $('#aApprove').onclick = async function () {
    var v = parseFloat($('#aAmt').value);
    if (!(v > 0)) { alert('The approved amount must be more than zero.'); return; }
    this.disabled = true;
    try {
      await api('/api/requests/' + id + '/decide', 'POST', { decision: 'approve', amount: v, note: $('#aNote').value.trim() });
      await refresh(); closeModal(); renderPay(); toast('Approved — the accountant can now release it');
    } catch (e) { this.disabled = false; fail(e); }
  };
  $('#aReject').onclick = async function () {
    if (!confirm('Reject this request?')) return;
    this.disabled = true;
    try {
      await api('/api/requests/' + id + '/decide', 'POST', { decision: 'reject', note: $('#aNote').value.trim() });
      await refresh(); closeModal(); renderPay(); toast('Request rejected');
    } catch (e) { this.disabled = false; fail(e); }
  };
}
function releaseForm(id) {
  var r = S.requests.filter(function (x) { return Number(x.id) === id; })[0];
  if (!r) return;
  openModal('Release payment',
    '<div style="background:var(--surface-1);border:1px solid var(--border);border-radius:8px;padding:14px 16px;margin-bottom:16px">' +
    '<div style="font-weight:650">' + esc(r.work || r.party || 'Payment') + '</div>' +
    '<div class="hint">' + coChip(r.company_id) + ' &nbsp;·&nbsp; pay to ' + esc(r.party || '—') +
    (r.invoice ? ' &nbsp;·&nbsp; invoice ' + esc(r.invoice) : '') + '</div>' +
    '<div class="hint">Approved by ' + esc(r.approved_by || '—') + ' on ' + esc(r.approved_at || '') + '</div>' +
    (r.approval_note ? '<div class="hint">“' + esc(r.approval_note) + '”</div>' : '') +
    '<div style="font-size:22px;font-weight:700;margin-top:12px">Release ' + cur() + ' ' + money(r.approved_amount) + '</div>' +
    (Number(r.approved_amount) !== Number(r.requested_amount)
      ? '<div class="hint">Requested was ' + cur() + ' ' + money(r.requested_amount) + '</div>' : '') +
    '</div>' +
    '<div class="form-grid">' +
    fld('Payment date', '<input type="date" id="rDate2" value="' + todayISO() + '">') +
    fld('Paid by', sel('rMethod', S.methods.map(function (m) { return [m, m]; }), S.methods[0])) +
    fld('Reference (cheque / UTR no.)', '<input type="text" id="rRef" placeholder="optional">') +
    '<div class="full hint">Releasing posts an expense entry of ' + cur() + ' ' + money(r.approved_amount) +
    ' against ' + esc(co(r.company_id).name) + ', marked paid. If you pay in cash it also reduces the cash in hand figure.</div>' +
    '</div>',
    '<button class="btn" data-close>Cancel</button><button class="btn primary" id="rGo">Release payment</button>');
  $('#rGo').onclick = async function () {
    this.disabled = true;
    try {
      await api('/api/requests/' + id + '/release', 'POST',
        { date: $('#rDate2').value, method: $('#rMethod').value, ref: $('#rRef').value.trim() });
      await refresh(); closeModal(); renderPay(); toast('Payment released and posted to the accounts');
    } catch (e) { this.disabled = false; fail(e); }
  };
}

/* ------------------------------------------------------------- cash book */
function isCashMethod(m) { return /cash/i.test(String(m || '')); }
function cashPosition(companyId) {
  var id = Number(companyId);
  var counts = S.cash.filter(function (c) { return Number(c.company_id) === id; })
    .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id; });
  var last = counts[0] || null;
  var after = function (d) { return !last || d > last.date; };
  var ins = S.cashIn.filter(function (c) { return Number(c.company_id) === id && after(c.date); });
  var outs = S.txns.filter(function (t) {
    return Number(t.company_id) === id && t.type === 'expense' && isCashMethod(t.method) && after(t.date);
  });
  var received = ins.reduce(function (s, c) { return s + Number(c.amount); }, 0);
  var paid = outs.reduce(function (s, t) { return s + amt(t); }, 0);
  return {
    last: last, received: received, paid: paid, ins: ins.length, outs: outs.length,
    expected: (last ? Number(last.amount) : 0) + received - paid
  };
}
// cash income typed straight into Transactions never reaches the cash register
function strayCashIncome() {
  var linked = {};
  S.cashIn.forEach(function (c) { if (c.txn_id) linked[c.txn_id] = true; });
  return S.txns.filter(function (t) {
    return t.type === 'income' && isCashMethod(t.method) && !linked[t.id];
  });
}
function cashInFiltered() {
  var c = $('#ciCo').value, f = $('#ciFrom').value, t = $('#ciTo').value, qs = $('#ciSearch').value.trim().toLowerCase();
  return S.cashIn.filter(function (r) {
    if (c && Number(r.company_id) !== Number(c)) return false;
    if (!inRange(r.date, f, t)) return false;
    if (qs && (r.source + ' ' + r.ref + ' ' + r.notes + ' ' + (r.by || '')).toLowerCase().indexOf(qs) === -1) return false;
    return true;
  });
}
function renderCash() {
  fillSelect($('#ciCo'), myCompanies().map(function (c) { return [c.id, c.name]; }), 'All companies');
  var cos = myCompanies();
  var pos = cos.map(function (c) { return { c: c, p: cashPosition(c.id) }; });
  var counted = pos.filter(function (x) { return x.p.last; });
  var totalNow = counted.reduce(function (s, x) { return s + x.p.expected; }, 0);
  var thisMonth = todayISO().slice(0, 7);
  var recvMonth = S.cashIn.filter(function (c) { return c.date.slice(0, 7) === thisMonth; })
    .reduce(function (s, c) { return s + Number(c.amount); }, 0);
  var paidMonth = S.txns.filter(function (t) { return t.type === 'expense' && isCashMethod(t.method) && t.date.slice(0, 7) === thisMonth; })
    .reduce(function (s, t) { return s + amt(t); }, 0);
  var latest = S.cash.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; })[0];

  var stray = strayCashIncome();
  $('#cashWarn').innerHTML = stray.length
    ? '<div class="warn-strip"><b>' + stray.length + ' cash income ' + (stray.length === 1 ? 'entry was' : 'entries were') +
    ' added under Transactions instead of here</b> — ' + cur() + ' ' +
    money(stray.reduce(function (s, t) { return s + amt(t); }, 0)) +
    '. Those are in the profit figures but not in the cash balance below. Record cash coming in on this page so both stay right.</div>'
    : '';

  $('#cashTiles').innerHTML = [
    tile('Cash in hand now · ' + cur(), money(totalNow),
      counted.length === pos.length ? 'across all ' + pos.length + ' companies'
        : counted.length + ' of ' + pos.length + ' companies — record a count for the rest'),
    tile('Received this month · ' + cur(), money(recvMonth), 'entered in the cash register'),
    tile('Paid out this month · ' + cur(), money(paidMonth), 'expenses settled in cash'),
    tile('Last cash count', latest ? latest.date : '—', latest ? co(latest.company_id).name + ' · by ' + (latest.by || '—') : 'no count recorded yet')
  ].join('');

  var h = '<thead><tr><th>Company</th><th>Counted on</th><th class="num">Counted</th><th class="num">Received since</th>' +
    '<th class="num">Paid out since</th><th class="num">Cash in hand now</th><th></th></tr></thead><tbody>';
  pos.forEach(function (x) {
    h += '<tr><td>' + coChip(x.c.id) + '</td>' +
      '<td>' + (x.p.last ? esc(x.p.last.date) + '<div style="color:var(--muted);font-size:11.5px">' + esc(x.p.last.by || '') + '</div>'
        : '<span style="color:var(--muted)">no count — running from the register</span>') + '</td>' +
      '<td class="num">' + (x.p.last ? money(x.p.last.amount) : '·') + '</td>' +
      '<td class="num pos">' + (x.p.ins ? money(x.p.received) + '<div style="color:var(--muted);font-size:11.5px">' + x.p.ins + ' entries</div>' : '·') + '</td>' +
      '<td class="num neg">' + (x.p.outs ? money(x.p.paid) + '<div style="color:var(--muted);font-size:11.5px">' + x.p.outs + ' entries</div>' : '·') + '</td>' +
      '<td class="num">' + (!x.p.last
        ? '<b style="color:var(--muted)">' + money(x.p.expected) + '</b><div style="color:var(--muted);font-size:11.5px">record a count to fix the opening figure</div>'
        : '<b class="' + (x.p.expected < 0 ? 'neg' : '') + '">' + money(x.p.expected) + '</b>' +
        (x.p.expected < 0 ? '<div style="color:var(--critical);font-size:11.5px">more paid out than the books hold</div>' : '')) + '</td>' +
      '<td style="white-space:nowrap">' + (isCashier()
        ? '<button class="btn sm" data-cashin="' + x.c.id + '">+ Cash in</button> <button class="btn sm" data-count="' + x.c.id + '">Count</button>'
        : '') + '</td></tr>';
  });
  h += '</tbody><tfoot><tr><td>Total<div style="font-weight:400;color:var(--muted);font-size:11.5px">counted companies only</div></td><td></td><td></td><td class="num">' + money(pos.reduce(function (s, x) { return s + x.p.received; }, 0)) +
    '</td><td class="num">' + money(pos.reduce(function (s, x) { return s + x.p.paid; }, 0)) +
    '</td><td class="num">' + money(totalNow) + '</td><td></td></tr></tfoot>';
  $('#tblCashNow').innerHTML = h;
  $$('#tblCashNow [data-count]').forEach(function (b) { b.onclick = function () { cashForm(Number(b.dataset.count)); }; });
  $$('#tblCashNow [data-cashin]').forEach(function (b) { b.onclick = function () { cashInForm(null, Number(b.dataset.cashin)); }; });

  var list = cashInFiltered();
  var r = '<thead><tr><th>Date</th><th>Company</th><th class="num">Amount</th><th>Source of money</th><th>Reference</th>' +
    '<th>Notes</th><th>Entered by</th>' + (isCashier() ? '<th></th>' : '') + '</tr></thead><tbody>';
  list.forEach(function (c) {
    r += '<tr><td>' + esc(c.date) + '</td><td>' + coChip(c.company_id) + '</td>' +
      '<td class="num"><b>' + money(c.amount) + '</b></td>' +
      '<td>' + esc(c.source || '—') + (c.txn_id ? '<div style="color:var(--muted);font-size:11.5px">also booked as income</div>' : '') + '</td>' +
      '<td>' + esc(c.ref || '—') + '</td><td>' + esc(c.notes || '—') + '</td>' +
      '<td style="color:var(--muted)">' + esc(c.by || '—') + '</td>' +
      (isCashier() ? '<td style="white-space:nowrap"><button class="btn sm" data-ciedit="' + c.id + '">Edit</button>' +
        (isAdmin() ? ' <button class="btn sm danger" data-cidel="' + c.id + '">✕</button>' : '') + '</td>' : '') + '</tr>';
  });
  r += '</tbody>';
  if (list.length) {
    r += '<tfoot><tr><td colspan="2">' + list.length + ' entries</td><td class="num">' +
      money(list.reduce(function (s, c) { return s + Number(c.amount); }, 0)) + '</td><td colspan="' + (isCashier() ? 5 : 4) + '"></td></tr></tfoot>';
  }
  $('#tblCashIn').innerHTML = list.length ? r :
    '<tbody><tr><td class="empty">No cash received recorded' + (S.cashIn.length ? ' for this filter' : ' yet') + '.</td></tr></tbody>';
  $$('#tblCashIn [data-ciedit]').forEach(function (b) { b.onclick = function () { cashInForm(Number(b.dataset.ciedit)); }; });
  $$('#tblCashIn [data-cidel]').forEach(function (b) {
    b.onclick = async function () {
      if (!confirm('Delete this cash receipt? Any income entry created with it is removed too.')) return;
      try { await api('/api/cashin/' + b.dataset.cidel, 'DELETE'); await refresh(); renderCash(); toast('Cash receipt deleted'); }
      catch (e) { fail(e); }
    };
  });

  var l = '<thead><tr><th>Date</th><th>Company</th><th class="num">Cash counted</th><th>Notes</th><th>Recorded by</th>' + (isAdmin() ? '<th></th>' : '') + '</tr></thead><tbody>';
  S.cash.forEach(function (c) {
    l += '<tr><td>' + esc(c.date) + '</td><td>' + coChip(c.company_id) + '</td>' +
      '<td class="num"><b>' + money(c.amount) + '</b></td><td>' + esc(c.notes || '—') + '</td>' +
      '<td style="color:var(--muted)">' + esc(c.by || '—') + '</td>' +
      (isAdmin() ? '<td><button class="btn sm danger" data-cashdel="' + c.id + '">✕</button></td>' : '') + '</tr>';
  });
  $('#tblCashLog').innerHTML = S.cash.length ? l + '</tbody>' :
    '<tbody><tr><td class="empty">No cash counts yet. A count sets the opening figure and resets the running balance.</td></tr></tbody>';
  $$('#tblCashLog [data-cashdel]').forEach(function (b) {
    b.onclick = async function () {
      if (!confirm('Delete this cash count?')) return;
      try { await api('/api/cash/' + b.dataset.cashdel, 'DELETE'); await refresh(); renderCash(); toast('Cash count deleted'); }
      catch (e) { fail(e); }
    };
  });
}
function cashInForm(id, presetCo) {
  var c = id ? S.cashIn.filter(function (x) { return Number(x.id) === id; })[0] : null;
  var isNew = !c;
  var cos = myCompanies();
  c = c || { date: todayISO(), company_id: presetCo || cos[0].id, amount: '', source: S.sources[0] || '', ref: '', notes: '' };
  openModal(isNew ? 'Cash received' : 'Edit cash received',
    '<div class="form-grid">' +
    fld('Date received', '<input type="date" id="nDate" value="' + esc(c.date) + '">') +
    fld('Company', sel('nCo', cos.map(function (x) { return [x.id, x.name]; }), c.company_id)) +
    fld('Amount (' + cur() + ')', '<input type="number" id="nAmt" step="0.01" min="0" value="' + esc(c.amount) + '">') +
    fld('Source of money', sel('nSrc', S.sources.map(function (x) { return [x, x]; }), c.source)) +
    fld('Reference (receipt / slip no.)', '<input type="text" id="nRef" value="' + esc(c.ref) + '">') +
    (isNew ? '<div class="field full"><label class="chk"><input type="checkbox" id="nInc"> Also record this as income for the company</label>' +
      '<p class="hint">Tick for money the business earned — counter sales, collections from customers. Leave unticked for cash that is not income: a bank withdrawal, your own money put in, a loan, or a transfer from another company.</p></div>' +
      '<div class="field" id="nIncWrap" style="display:none"><label for="nCat">Income category</label><select id="nCat"></select></div>' +
      '<div class="field" id="nPartyWrap" style="display:none"><label for="nParty">Received from</label><input type="text" id="nParty" placeholder="customer name"></div>'
      : '<div class="full hint">' + (c.txn_id ? 'This receipt is also booked as income; changing the date or amount updates both.' : 'This receipt affects cash only, not profit.') + '</div>') +
    '<div class="field full"><label for="nNotes">Notes</label><textarea id="nNotes">' + esc(c.notes) + '</textarea></div>' +
    '<div class="full hint" id="nHint"></div>' +
    '</div>',
    '<button class="btn" data-close>Cancel</button><button class="btn primary" id="nSave">' + (isNew ? 'Save receipt' : 'Save changes') + '</button>');
  if (isNew) {
    fillSelect($('#nCat'), S.incCats.map(function (x) { return [x, x]; }), null, S.incCats[0]);
    $('#nInc').onchange = function () {
      $('#nIncWrap').style.display = this.checked ? '' : 'none';
      $('#nPartyWrap').style.display = this.checked ? '' : 'none';
      hint();
    };
  }
  function hint() {
    var p = cashPosition(Number($('#nCo').value)), v = Number($('#nAmt').value) || 0;
    $('#nHint').innerHTML = 'Cash in hand for ' + esc(co($('#nCo').value).name) + ' is <b>' + cur() + ' ' + money(p.expected) +
      '</b>' + (v ? ' — this receipt takes it to <b>' + cur() + ' ' + money(p.expected + v) + '</b>' : '') + '.';
  }
  $('#nCo').onchange = hint; $('#nAmt').oninput = hint; hint();
  $('#nSave').onclick = async function () {
    var v = parseFloat($('#nAmt').value);
    if (!(v > 0)) { alert('Enter the amount received.'); return; }
    if (!$('#nSrc').value) { alert('Choose where the money came from.'); return; }
    var body = {
      date: $('#nDate').value, company_id: Number($('#nCo').value), amount: v,
      source: $('#nSrc').value, ref: $('#nRef').value.trim(), notes: $('#nNotes').value.trim()
    };
    if (isNew && $('#nInc').checked) {
      body.asIncome = true; body.incomeCategory = $('#nCat').value; body.party = $('#nParty').value.trim();
    }
    this.disabled = true;
    try {
      if (isNew) await api('/api/cashin', 'POST', body); else await api('/api/cashin/' + id, 'PUT', body);
      await refresh(); closeModal(); renderCash(); toast(isNew ? 'Cash receipt saved' : 'Receipt updated');
    } catch (e) { this.disabled = false; fail(e); }
  };
}
function cashForm(companyId) {
  var cos = myCompanies();
  openModal('Record cash count',
    '<div class="form-grid">' +
    fld('Date', '<input type="date" id="kDate" value="' + todayISO() + '">') +
    fld('Company', sel('kCo', cos.map(function (c) { return [c.id, c.name]; }), companyId || cos[0].id)) +
    fld('Cash actually counted (' + cur() + ')', '<input type="number" id="kAmt" step="0.01" min="0" placeholder="0.00">') +
    '<div class="field full"><label for="kNotes">Notes</label><textarea id="kNotes" placeholder="e.g. counted at closing, includes petty cash box"></textarea></div>' +
    '<div class="full hint" id="kHint"></div>' +
    '<div class="full hint">A count sets the opening figure for that company. Everything received and paid after this date is then added to it.</div>' +
    '</div>',
    '<button class="btn" data-close>Cancel</button><button class="btn primary" id="kSave">Save count</button>');
  function hint() {
    var id = Number($('#kCo').value), pp = cashPosition(id), v = Number($('#kAmt').value);
    var d = v - pp.expected;
    $('#kHint').innerHTML = 'Books expect <b>' + cur() + ' ' + money(pp.expected) + '</b>. ' +
      (!$('#kAmt').value ? '' : Math.abs(d) < 0.005 ? 'Counted cash matches exactly.' :
        'Counted is <b class="' + (d > 0 ? 'pos' : 'neg') + '">' + money(Math.abs(d)) + ' ' + (d > 0 ? 'more' : 'less') + '</b> than expected.');
  }
  $('#kCo').onchange = hint; $('#kAmt').oninput = hint; hint();
  $('#kSave').onclick = async function () {
    var v = parseFloat($('#kAmt').value);
    if (!(v >= 0)) { alert('Enter the cash counted.'); return; }
    this.disabled = true;
    try {
      await api('/api/cash', 'POST', { date: $('#kDate').value, company_id: Number($('#kCo').value), amount: v, notes: $('#kNotes').value.trim() });
      await refresh(); closeModal(); renderCash(); toast('Cash count recorded');
    } catch (e) { this.disabled = false; fail(e); }
  };
}

/* ----------------------------------------------------------------- modal */
function openModal(title, body, foot) {
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = body;
  $('#modalFoot').innerHTML = foot;
  $('#modalBack').classList.add('open');
  $$('#modalFoot [data-close]').forEach(function (b) { b.onclick = closeModal; });
}
function closeModal() { $('#modalBack').classList.remove('open'); }

/* ---------------------------------------------------------------- export */
function download(name, text, mime) {
  var b = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
  var u = URL.createObjectURL(b), a = document.createElement('a');
  a.href = u; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(u); a.remove(); }, 400);
}
function csv(rows) {
  return '﻿' + rows.map(function (r) {
    return r.map(function (c) {
      c = c == null ? '' : String(c);
      return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c;
    }).join(',');
  }).join('\r\n');
}
function txnRows(list) {
  var rows = [['Date', 'Company', 'Type', 'Category', 'Party', 'Invoice', 'Amount', 'Method', 'Status', 'Entered by', 'Notes']];
  list.forEach(function (t) {
    rows.push([t.date, co(t.company_id).name, t.type, t.category, t.party, t.invoice,
      amt(t).toFixed(2), t.method, t.status, t.by || '', t.notes]);
  });
  return rows;
}
function exportTxns() {
  var list = txnsFiltered(txnFilter());
  download('transactions-' + todayISO() + '.csv', csv(txnRows(list)), 'text/csv;charset=utf-8');
  toast(list.length + ' rows exported');
}
function exportInter() {
  var rows = [['Date', 'Paid by', 'Received by', 'Amount', 'Purpose', 'Reference', 'Entered by']];
  S.transfers.forEach(function (t) { rows.push([t.date, co(t.from_id).name, co(t.to_id).name, Number(t.amount).toFixed(2), t.purpose, t.ref, t.by || '']); });
  download('inter-company-' + todayISO() + '.csv', csv(rows), 'text/csv;charset=utf-8');
  toast('Transfers exported');
}
function exportAll() {
  download('group-accounts-' + todayISO() + '.json', JSON.stringify({
    exportedAt: new Date().toISOString(), settings: S.settings, companies: S.companies,
    expCats: S.expCats, incCats: S.incCats, methods: S.methods, txns: S.txns, transfers: S.transfers
  }, null, 2), 'application/json');
  toast('Export downloaded');
}

/* ------------------------------------------------------------------ boot */
function theme(t) {
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('ga-theme', t); } catch (e) { }
}
async function boot() {
  try { await refresh(); } catch (e) { return; }

  var saved = 'light';
  try { saved = localStorage.getItem('ga-theme') || 'light'; } catch (e) { }
  theme(saved);

  $('#groupTitle').textContent = S.settings.group;
  $('#groupSub').textContent = isAdmin() ? S.companies.length + ' companies · one consolidated view'
    : S.me.role === 'accountant' ? S.companies.length + ' companies · payments & cash'
      : myCompanies().length + ' of ' + S.companies.length + ' companies · your access';
  $('#userChip').innerHTML = '<b>' + esc(S.me.name) + '</b> · ' + esc(roleLabel(S.me.role));

  if (S.me.mustChange) {
    var b = document.createElement('div');
    b.className = 'banner';
    b.innerHTML = 'Your password was set by an administrator. Please change it in <b>Settings → My account</b>.';
    $('main').prepend(b);
  }

  $$('.tab').forEach(function (b) { b.onclick = function () { showView(b.dataset.view); }; });
  if (!isAdmin()) {
    // group-level money movement between companies stays with administrators
    var it = $('.tab[data-view="inter"]'); if (it) it.classList.add('hidden');
  }
  if (!isCashier()) {
    var ct = $('.tab[data-view="cash"]'); if (ct) ct.classList.add('hidden');
    $('#btnAddCashIn').classList.add('hidden');
    $('#btnAddCount').classList.add('hidden');
  }
  ['#ciCo', '#ciFrom', '#ciTo'].forEach(function (x) { $(x).onchange = renderCash; });
  $('#ciSearch').oninput = renderCash;

  // payment requests
  ['#pStatus', '#pCo'].forEach(function (x) { $(x).onchange = renderPay; });
  $('#pSearch').oninput = renderPay;
  $('#btnAddReq').onclick = function () { reqForm(null); };
  $('#btnExportPay').onclick = function () {
    var rows = [['Raised', 'Company', 'Work', 'Party', 'Invoice', 'Requested', 'Approved', 'Status',
      'Raised by', 'Approved by', 'Approved at', 'Released by', 'Released at', 'Paid by method', 'Reference', 'Note']];
    payFiltered().forEach(function (r) {
      rows.push([r.date, co(r.company_id).name, r.work, r.party, r.invoice,
        Number(r.requested_amount).toFixed(2), r.approved_amount == null ? '' : Number(r.approved_amount).toFixed(2),
        r.status, r.requested_by || '', r.approved_by || '', r.approved_at || '', r.paid_by || '', r.paid_at || '',
        r.paid_method || '', r.paid_ref || '', r.approval_note || '']);
    });
    download('payment-requests-' + todayISO() + '.csv', csv(rows), 'text/csv;charset=utf-8');
    toast('Payment requests exported');
  };

  // cash
  $('#btnAddCashIn').onclick = function () { cashInForm(null); };
  $('#btnAddCount').onclick = function () { cashForm(null); };
  $('#btnExportCash').onclick = function () {
    var rows = [['Date', 'Company', 'Amount received', 'Source of money', 'Reference', 'Notes', 'Entered by', 'Also booked as income']];
    cashInFiltered().forEach(function (c) {
      rows.push([c.date, co(c.company_id).name, Number(c.amount).toFixed(2), c.source, c.ref, c.notes, c.by || '', c.txn_id ? 'yes' : 'no']);
    });
    rows.push([]);
    rows.push(['CASH COUNTS']);
    rows.push(['Date', 'Company', 'Cash counted', 'Notes', 'Recorded by']);
    S.cash.forEach(function (c) { rows.push([c.date, co(c.company_id).name, Number(c.amount).toFixed(2), c.notes, c.by || '']); });
    download('cash-register-' + todayISO() + '.csv', csv(rows), 'text/csv;charset=utf-8');
    toast('Cash register exported');
  };
  updateBadge();

  fillSelect($('#dashCo'), myCompanies().map(function (c) { return [c.id, c.name]; }), 'All companies (group)');
  ['#dashCo', '#dashFrom', '#dashTo'].forEach(function (s) {
    $(s).onchange = function () { if (s !== '#dashCo') $('#dashPeriod').value = 'custom'; renderDash(); };
  });
  $('#dashPeriod').onchange = function () { applyPeriod(this.value, $('#dashFrom'), $('#dashTo')); renderDash(); };
  $('#dashReset').onclick = function () { $('#dashCo').value = ''; $('#dashPeriod').value = 'all'; $('#dashFrom').value = ''; $('#dashTo').value = ''; renderDash(); };

  ['#fCo', '#fType', '#fCat', '#fStatus', '#fFrom', '#fTo'].forEach(function (s) { $(s).onchange = renderTxn; });
  $('#fSearch').oninput = renderTxn;
  $('#fReset').onclick = function () { ['#fCo', '#fType', '#fCat', '#fStatus', '#fFrom', '#fTo', '#fSearch'].forEach(function (s) { $(s).value = ''; }); renderTxn(); };
  $('#btnAddTxn').onclick = function () { txnForm(null); };
  $('#btnExportTxn').onclick = exportTxns;

  $('#btnAddInter').onclick = function () { interForm(null); };
  $('#btnExportInter').onclick = exportInter;
  if (!isAdmin()) $('#btnAddInter').classList.add('hidden');

  ['#rFrom', '#rTo', '#rReport', '#rParty'].forEach(function (s) { $(s).onchange = renderReport; });
  $('#btnExportReport').onclick = function () {
    if (!lastReportRows.length) { toast('Nothing to export'); return; }
    download(lastReportName + '-' + todayISO() + '.csv', csv(lastReportRows), 'text/csv;charset=utf-8');
    toast('Report exported');
  };
  $('#btnPrintReport').onclick = function () { window.print(); };

  $('#btnSaveSettings').onclick = async function () {
    try {
      await api('/api/settings', 'PUT', { group: $('#setGroup').value, currency: $('#setCur').value, fyStart: $('#setFy').value });
      await refresh(); $('#groupTitle').textContent = S.settings.group; toast('Settings saved');
    } catch (e) { fail(e); }
  };
  $('#btnSaveLists').onclick = async function () {
    function ls(v) { return v.split('\n').map(function (s) { return s.trim(); }).filter(Boolean); }
    try {
      await api('/api/categories', 'PUT', {
        expCats: ls($('#setExpCats').value), incCats: ls($('#setIncCats').value),
        methods: ls($('#setMethods').value), sources: ls($('#setSources').value)
      });
      await refresh(); renderSettings(); toast('Lists saved');
    } catch (e) { fail(e); }
  };
  $('#btnAddCo').onclick = async function () {
    var n = prompt('Company name');
    if (!n) return;
    try { await api('/api/companies', 'POST', { name: n }); await refresh(); renderSettings(); toast('Company added'); }
    catch (e) { fail(e); }
  };
  $('#btnAddUser').onclick = function () { userForm(null); };
  $('#btnPw').onclick = async function () {
    try {
      await api('/api/password', 'POST', { current: $('#pwCur').value, next: $('#pwNew').value });
      $('#pwCur').value = ''; $('#pwNew').value = '';
      toast('Password changed');
    } catch (e) { fail(e); }
  };

  $('#btnBackup').onclick = exportAll;
  $('#btnBackup2').onclick = exportAll;
  $('#btnCsvAll').onclick = function () {
    download('all-entries-' + todayISO() + '.csv', csv(txnRows(S.txns)), 'text/csv;charset=utf-8');
    toast('All entries exported');
  };
  $('#btnPrint').onclick = function () { window.print(); };
  $('#btnTheme').onclick = function () {
    theme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    var v = $$('.view').filter(function (x) { return x.classList.contains('active'); })[0];
    if (v) showView(v.id.replace('view-', ''));
  };
  $('#btnLogout').onclick = async function () {
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
    location.href = '/login';
  };
  $('#modalX').onclick = closeModal;
  $('#modalBack').onclick = function (e) { if (e.target === $('#modalBack')) closeModal(); };
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

  showView('dashboard');
}
document.addEventListener('DOMContentLoaded', boot);
