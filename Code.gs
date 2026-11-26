/* ===== CYP FIN: the rules of the shared database =====
   The same text runs in three places: inside the Google script (Code.gs), inside the app
   (to show a change at once and to work on one phone without a database), and in the tests.
   It never talks to Google directly: everything it needs comes through "store". */
var FIN_STATUSES = ['Review', 'Waiting', 'To revise', 'Approved', 'Next week', 'Not approved', 'Paid', 'Cancelled'];
var FIN_ROLES = ['head', 'director', 'accountant', 'viewer'];
var FIN_TZ_MINUTES = 120; /* Zambia, UTC+2 */
/* departments that ask but are not a section of the budget. The part says who reviews: S social (the Administrator), C commercial */
var FIN_DEPTS = [['TRA', 'Transport', 'S'], ['MEW', 'Mechanics workshop', 'S'], ['MNT', 'Maintenance', 'S'], ['HRS', 'Human Resources', 'S'], ['MCP', 'Mary Christine', 'S'], ['HFH', 'Holy Family', 'S'], ['GIG', 'Gigi Bonta', 'C'], ['FRM', 'Farms', 'C'], ['ELE', 'Electrical works', 'C'], ['CPP', 'Carpentry production', 'C']];
function finPart(code) { for (var i = 0; i < FIN_DEPTS.length; i++) if (FIN_DEPTS[i][0] === code) return FIN_DEPTS[i][2]; return 'S'; }
/* a request is reviewed before the Director sees it: the reviewer gives it its budget lines */
function finReviewOn(s) { return !s || s.review !== false; }
function finRevParts(u) { var p = (u.reviews || []).slice(); if (u.role === 'accountant' && !p.length) p.push('C'); return p; }
/* the education departments (centres, skills, sport, family, school): the Head of Department (part E) reviews them first,
   then the social reviewer, then the Director (Mauro, 25/11) */
var FIN_EDU = ['LUI', 'NKW', 'CSC', 'MIN', 'UCC', 'FAM', 'SCH', 'MEC', 'COM', 'CAR', 'AGR', 'TEN', 'FOO', 'BAS', 'GOL'];
function finEdu(code) { return FIN_EDU.indexOf(String(code)) >= 0; }
/* the reviewer who sends the department's requests to the Director */
function finFinal(u, code) { return finRevParts(u).indexOf(finPart(code)) >= 0; }
/* reviews the department at one of the two steps */
function finReviews(u, code) { return finFinal(u, code) || (finRevParts(u).indexOf('E') >= 0 && finEdu(code)); }
/* can review this request now: the stage names the part whose reviewer has it (E education, S social, C commercial);
   requests saved before the stages go to the reviewer of the department's part */
function finCanRev(u, r) { if (r.by === u.id) return false; if (r.stage) return finRevParts(u).indexOf(r.stage) >= 0; return finFinal(u, r.section); }
/* who reviews a new request (Mauro, 25/11). Nobody reviews his own request: Mulenga's requests go to Chiwele, Chiwele's to
   Mulenga, the education reviewer's to the social reviewer. A requester goes to the reviewer set on him (Social, Commercial,
   Education), or else by department: education departments to the education reviewer, the others to their part.
   Education is reviewed in two steps: the education reviewer, then the social reviewer. '' = nobody: the old rule */
function finRoute(users, u, code) {
  var p = finRevParts(u), has = function (part) { for (var i = 0; i < users.length; i++) { var x = users[i]; if (x.active !== false && x.id !== u.id && finRevParts(x).indexOf(part) >= 0) return true; } return false; };
  var s = p.indexOf('S') >= 0, c = p.indexOf('C') >= 0;
  if (s && c) return '';
  if (s || c) return has(s ? 'C' : 'S') ? (s ? 'C' : 'S') : '';
  if (p.indexOf('E') >= 0) return has('S') ? 'S' : '';
  var w = ['S', 'C', 'E'].indexOf(u.revBy) >= 0 ? u.revBy : finEdu(code) ? 'E' : finPart(code);
  if (w === 'E' && !has('E')) w = 'S';
  return has(w) ? w : '';
}
function finOpenLines(items) { for (var i = 0; i < (items || []).length; i++) if (!items[i].line) return true; return false; }

function finNewDb() {
  return { v: 1, rev: 0, seq: 0, users: [], requests: [], deadlines: [], comments: [],
    settings: { rev: 0, noticeDays: 5, approvalDay: 1, dayV2: true, countFrom: '2026-12-01', weeks: {}, weeksExp: {}, weeksDate: {}, plan: {}, monthly: ['SCH', 'FAM'] }, opIds: [] };
}

/* ---- dates: plain yyyy-mm-dd strings, no time zones inside ---- */
function finIsDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z')); }
function finDayNum(s) { return Math.round(Date.parse(s + 'T00:00:00Z') / 86400000); }
function finDayStr(n) { return new Date(n * 86400000).toISOString().slice(0, 10); }
function finAddDays(s, n) { return finDayStr(finDayNum(s) + n); }
function finWeekday(s) { return new Date(Date.parse(s + 'T00:00:00Z')).getUTCDay(); } /* 0 Sunday */
function finToday(nowIso) { return new Date(Date.parse(nowIso) + FIN_TZ_MINUTES * 60000).toISOString().slice(0, 10); }
/* working days after "from", up to and including "to" */
function finWorkDays(from, to) {
  var a = finDayNum(from), b = finDayNum(to), n = 0;
  if (b - a > 800) b = a + 800;
  for (var d = a + 1; d <= b; d++) { var w = (((d + 4) % 7) + 7) % 7; if (w !== 0 && w !== 6) n++; }
  return n;
}
/* the last day on which asking still gives "days" working days of notice */
function finAskBy(needed, days) {
  var d = finDayNum(needed), left = days, guard = 0;
  while (left > 0 && guard < 90) { var w = (((d + 4) % 7) + 7) % 7; if (w !== 0 && w !== 6) left--; d--; guard++; }
  return finDayStr(d);
}
/* the Monday of the week of a day: the name of that week */
function finWeekKey(s) { var w = finWeekday(s); return finAddDays(s, -((w + 6) % 7)); }
function finAddMonth(s) {
  var y = Number(s.slice(0, 4)), m = Number(s.slice(5, 7)), d = Number(s.slice(8, 10));
  m++; if (m > 12) { m = 1; y++; }
  var last = new Date(Date.UTC(y, m, 0)).getUTCDate(); if (d > last) d = last;
  return y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
}

/* ---- people ---- */
/* the money of the project (funding, tranches, cash) goes only to who sees everything (24/11) */
var FIN_MONEY_KEYS = ['weeks', 'weeksDate', 'weeksExp', 'monthExp', 'monthEur', 'monthLog', 'tranche', 'cash'];
function finPubSettings(s, all) {
  if (all) return s;
  var o = {}; for (var k in s) if (s.hasOwnProperty(k)) o[k] = s[k];
  for (var i = 0; i < FIN_MONEY_KEYS.length; i++) o[FIN_MONEY_KEYS[i]] = FIN_MONEY_KEYS[i] === 'cash' ? [] : {};
  return o;
}
/* a request approved for less than asked keeps what was asked; the parts in which it is needed follow the new amount */
function finRestore(r) {
  if (r.asked == null) return;
  r.amount = r.asked; if (r.parts0) r.parts = r.parts0;
  delete r.asked; delete r.parts0;
}
function finLower(r, a) {
  var orig = r.amount; if (!(a < orig - 0.004)) return;
  r.asked = orig;
  if (r.parts && r.parts.length) {
    r.parts0 = r.parts; var acc = 0, k = a / orig;
    r.parts = r.parts.map(function (p, i, l) { var x = i < l.length - 1 ? Math.round(p.amount * k * 100) / 100 : Math.round((a - acc) * 100) / 100; acc += x; return { date: p.date, amount: x }; });
  }
  r.amount = a;
}
function finPublicUser(u) {
  return { id: u.id, name: u.name, title: u.title || '', role: u.role, sections: u.sections || [], reviews: u.reviews || [], revBy: u.revBy || '', deleted: !!u.deleted, admin: !!u.admin, active: u.active !== false, salt: u.salt, rev: u.rev || 0 };
}
function finFind(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
function finHasSection(u, code) { return (u.sections || []).indexOf(code) >= 0; }
function finSeesAll(u) { return u.role === 'director' || u.role === 'accountant' || u.role === 'viewer' || !!u.admin; }
function finSeesRequest(u, r) { return finSeesAll(u) || finHasSection(u, r.section) || r.by === u.id || r.behalfId === u.id || finReviews(u, r.section); }
/* a Section head with no department set on the person asks for any department and says which one on the request */
function finCanAskFor(u, code) { return finHasSection(u, code) || u.role === 'accountant' || (u.role === 'head' && !(u.sections || []).length); }
/* the dates of the agenda are kept by the Accountant, the Director and the administrator; a section head sees them and asks */
function finCanDeadline(u, code) { return u.role === 'director' || u.role === 'accountant' || !!u.admin; }
/* The comments a version answered. Each line: what to write on the comment, who wrote it ('' = anyone), its first words ('' = any),
   written after this time, written before this time ('' = no limit). The times are those of the database (UTC).
   At every sync the database closes the open comments that match. A comment the administrator opens again stays open. */
var FIN_ANSWERED = [
  ['test comment', 'Claude (test)', 'Test comment from the demo', '', ''],
  ['answered in alpha 0.5', '', '', '2026-11-16T08:30:00.000Z', '2026-11-16T13:00:00.000Z'],
  ['answered in alpha 0.9', '', '', '2026-11-16T13:00:00.000Z', '2026-11-17T09:00:00.000Z'],
  ['answered in alpha 0.12', '', '', '2026-11-17T09:00:00.000Z', '2026-11-17T13:00:00.000Z'],
  ['answered in alpha 0.14', '', '', '2026-11-17T13:00:00.000Z', '2026-11-17T13:20:00.000Z'],
  ['answered in alpha 0.23', 'Ana', 'I want only 4 roles', '2026-11-23T00:00:00.000Z', '2026-11-24T00:00:00.000Z'],
  ['answered in alpha 0.23', 'Ana', 'Instead of accountant', '2026-11-23T00:00:00.000Z', '2026-11-24T00:00:00.000Z'],
  ['answered in alpha 0.24', 'Ana', 'I don', '2026-11-23T11:30:00.000Z', '2026-11-23T13:30:00.000Z'],
  ['answered in alpha 0.24', 'Ana', 'there is an issue, of when i create a user', '2026-11-23T11:30:00.000Z', '2026-11-23T13:30:00.000Z'],
  ['answered in alpha 0.24', 'Ana', 'administrator should be able to see all', '2026-11-23T11:30:00.000Z', '2026-11-23T13:30:00.000Z'],
  ['answered in beta 1.3', 'Ana', 'take out the :', '2026-11-24T06:00:00.000Z', '2026-11-24T08:00:00.000Z'],
  ['answered in beta 1.3', 'Mr. Chiwele', 'When clicking on back', '2026-11-24T06:00:00.000Z', '2026-11-24T08:00:00.000Z'],
  ['answered in beta 1.3', 'Mr. Chiwele', 'Expected in euros', '2026-11-24T06:00:00.000Z', '2026-11-24T08:00:00.000Z'],
  ['answered in beta 1.3', 'Mr. Chiwele', 'This zone has too many text', '2026-11-24T06:00:00.000Z', '2026-11-24T08:00:00.000Z'],
  ['answered in beta 1.6', 'Madame Chisha', 'When I click on the different priorities', '2026-11-24T07:00:00.000Z', '2026-11-24T13:00:00.000Z'],
  ['answered in beta 1.6', 'Christoph', 'There should a choice', '2026-11-24T07:00:00.000Z', '2026-11-24T13:00:00.000Z'],
  ['answered in beta 1.6', 'Christoph', 'I think the prirority', '2026-11-24T07:00:00.000Z', '2026-11-24T13:00:00.000Z'],
  ['answered in beta 1.6', 'Christoph', 'The department should be here', '2026-11-24T07:00:00.000Z', '2026-11-24T13:00:00.000Z'],
  ['answered in beta 1.6', 'Ana', 'Here the roles should be', '2026-11-24T07:00:00.000Z', '2026-11-24T13:00:00.000Z'],
  ['answered in beta 1.6', 'Ana', 'Pay and other should be added after', '2026-11-24T07:00:00.000Z', '2026-11-24T13:00:00.000Z'],
  ['answered in beta 1.6', 'Madame Chisha', 'Say: Uplaod', '2026-11-24T07:00:00.000Z', '2026-11-24T13:00:00.000Z'],
  ['answered in beta 1.10', 'Mauro Bifulco', 'In the reviwers there are three roles', '2026-11-24T00:00:00.000Z', '2026-11-26T00:00:00.000Z'],
  ['answered in beta 1.10', 'Mauro Bifulco', 'In the administration of users', '2026-11-24T00:00:00.000Z', '2026-11-26T00:00:00.000Z'],
  ['answered in beta 1.10', 'Mauro Bifulco', 'take out the option', '2026-11-24T00:00:00.000Z', '2026-11-26T00:00:00.000Z'],
  ['answered in beta 1.10', 'Mauro Bifulco', 'For each user can plus', '2026-11-24T00:00:00.000Z', '2026-11-26T00:00:00.000Z'],
  ['answered in beta 1.10', 'Mulenga', 'the sending to the director', '2026-11-24T00:00:00.000Z', '2026-11-26T00:00:00.000Z'],
  ['answered in beta 1.10', 'Mulenga', 'Add the option of', '2026-11-24T00:00:00.000Z', '2026-11-26T00:00:00.000Z'],
  ['answered in beta 1.10', 'Mulenga', 'this is asked directly by mulenga', '2026-11-24T00:00:00.000Z', '2026-11-26T00:00:00.000Z'],
  ['answered in beta 1.10', 'Mulenga', 'Add a category: nature', '2026-11-24T00:00:00.000Z', '2026-11-26T00:00:00.000Z'],
  ['answered in beta 1.10', 'Stefano Maradini', 'Sould be expected in euros', '2026-11-24T00:00:00.000Z', '2026-11-26T00:00:00.000Z'],
  ['answered in beta 1.10', 'Christoph', 'It’s quite slow', '2026-11-24T00:00:00.000Z', '2026-11-26T00:00:00.000Z'],
  ['answered in beta 1.10', 'Christoph', 'There is a bug. I have to click', '2026-11-24T00:00:00.000Z', '2026-11-26T00:00:00.000Z'],
  ['answered in beta 1.10', 'Christoph', 'In all the screens make an option', '2026-11-24T00:00:00.000Z', '2026-11-26T00:00:00.000Z'],
  ['answered in beta 1.10', 'Christoph', 'The box to enter the date', '2026-11-24T00:00:00.000Z', '2026-11-26T00:00:00.000Z'],
  ['answered in beta 1.10', 'Christoph', 'Take out the budget breakdown', '2026-11-24T00:00:00.000Z', '2026-11-26T00:00:00.000Z'],
  ['answered in beta 1.10', 'Ana', 'Can you put the', '2026-11-24T00:00:00.000Z', '2026-11-26T00:00:00.000Z']
];
function finAnswer(db, nowIso) {
  var out = [], cs = db.comments || [], i, j;
  function low(x) { return String(x || '').replace(/\s+/g, ' ').replace(/^ | $/g, '').toLowerCase(); }
  for (i = 0; i < cs.length; i++) {
    var c = cs[i]; if (c.done || c.ans) continue;
    for (j = 0; j < FIN_ANSWERED.length; j++) {
      var a = FIN_ANSWERED[j];
      if (!a[1] && !a[2] && !a[3] && !a[4]) continue;
      if (a[1] && low(c.byName) !== low(a[1])) continue;
      if (a[2] && low(c.text).indexOf(low(a[2])) !== 0) continue;
      if (a[3] && !(String(c.time) >= a[3])) continue;
      if (a[4] && !(String(c.time) < a[4])) continue;
      c.done = true; c.doneBy = 'CYP FIN: ' + a[0]; c.doneAt = nowIso; c.ans = a[0]; out.push(c); break;
    }
  }
  return out;
}
/* a comment on the app itself: which screen, which word, what the person says */
function finCommentRec(d, nowIso, by, byName, demo) {
  return { id: String(d.id), time: nowIso, by: by, byName: byName, demo: !!demo, page: finText(d.page, 40), target: finText(d.target, 160), text: finText(d.text, 600),
    version: finText(d.version, 20), phone: !!d.phone, done: false, doneBy: '', doneAt: '' };
}
/* the lines of a monthly request: budget line, name, amount */
/* the quantities and unit costs the reviewer recommends, one for each item of the request; the request keeps its own */
function finRecItems(list, items) {
  if (!list || !items || list.length !== items.length) return null;
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var q = Math.round(Number(list[i].qty) * 1000) / 1000, p = Math.round(Number(list[i].price) * 100) / 100;
    if (!(q >= 0) || !(p >= 0) || q > 1000000 || p > 100000000 || isNaN(q) || isNaN(p)) return null;
    out.push({ qty: q, price: p, amount: Math.round(q * p * 100) / 100 });
  }
  return out;
}
function finItems(list, rich, open) {
  if (!list || !list.length || list.length > (rich ? 12 : 80)) return null;
  var out = [], sum = 0;
  for (var i = 0; i < list.length; i++) {
    var x = list[i], a = Number(x.amount), it;
    if (!x.line && !(open && rich)) return null;
    it = { line: String(x.line || ''), lineName: x.line ? finText(x.lineName, 120) : '', amount: 0 };
    if (rich) {
      /* an item of a request, as a row of the paper form: what, how many, the cost of one. The amount is quantity x unit cost */
      var w = finText(x.what, 120), q = x.qty === '' || x.qty == null ? 1 : Math.round(Number(x.qty) * 100) / 100, p = Math.round(Number(x.price) * 100) / 100;
      if (!w || !(q > 0 && q <= 1000000) || !(p > 0 && p <= 100000000)) return null;
      a = q * p; it.what = w; it.qty = q; it.price = p;
      if (finText(x.unit, 12)) it.unit = finText(x.unit, 12);
      if (x.stock !== '' && x.stock != null) { var st = Number(x.stock); if (!(st >= 0 && st <= 1000000)) return null; it.stock = Math.round(st * 100) / 100; }
    }
    if (!(a > 0) || a > 100000000) return null;
    a = Math.round(a * 100) / 100; sum += a; it.amount = a;
    out.push(it);
  }
  return { items: out, sum: Math.round(sum * 100) / 100 };
}
/* a request with items: the one budget line they share, or how many lines they touch */
function finItemLine(b, d) {
  var seen = {}, n = 0;
  for (var i = 0; i < b.items.length; i++) if (!seen[b.items[i].line]) { seen[b.items[i].line] = 1; n++; }
  d.line = n === 1 ? b.items[0].line : 'several'; d.lineName = n === 1 ? b.items[0].lineName : n + ' budget lines';
}
function finPeople(x) { if (x === '' || x == null) return 0; var p = Math.round(Number(x)); return p >= 1 && p <= 100000 ? p : -1; }
/* a food request: for how many people, how much, at which price, and what is still in the store */
function finFood(x) {
  if (!x) return null;
  var p = Math.round(Number(x.people)), q = Number(x.qty), pr = Number(x.price), st = x.stock === '' || x.stock == null ? -1 : Number(x.stock);
  if (!(p >= 1 && p <= 100000) || !(q > 0 && q <= 1000000) || !(pr > 0 && pr <= 100000000) || !(st >= 0 && st <= 1000000)) return false;
  return { people: p, qty: Math.round(q * 100) / 100, unit: finText(x.unit, 12) || 'kg', price: Math.round(pr * 100) / 100, stock: Math.round(st * 100) / 100 };
}
/* the parts of a request: on which day each part of the money is needed */
function finParts(list, amount) {
  if (!list || !list.length || list.length < 2 || list.length > 12) return null;
  var out = [], sum = 0;
  for (var i = 0; i < list.length; i++) {
    var a = Math.round(Number(list[i].amount) * 100) / 100;
    if (!finIsDate(list[i].date) || !(a > 0)) return null;
    sum += a; out.push({ date: String(list[i].date), amount: a });
  }
  if (Math.abs(sum - amount) > 0.05) return null;
  out.sort(function (x, y) { return x.date < y.date ? -1 : x.date > y.date ? 1 : 0; });
  return out;
}
/* how much of a request is paid so far */
function finPaid(r) {
  if (!r.pays) return r.status === 'Paid' ? r.amount : 0;
  var s = 0; for (var i = 0; i < r.pays.length; i++) s += r.pays[i].amount;
  return Math.round(s * 100) / 100;
}
function finMonthlySecs(s) { return s.monthly || ['SCH', 'FAM']; }
function finPlanned(x) { return ['yes', 'no', 'unsure'].indexOf(String(x)) >= 0 ? String(x) : ''; }
function finText(x, max) { return String(x == null ? '' : x).replace(/\s+/g, ' ').trim().slice(0, max || 200); }

/* ---- one change. Returns {ok:true} or {ok:false, error:'...'}; "info" collects what the store must write ---- */
function finApply(db, u, op, nowIso, store, info) {
  var d = op.d || {}, t = op.t, today = finToday(nowIso), s = db.settings, r, x;
  function bump(rec) { db.rev++; rec.rev = db.rev; }
  function fail(e) { return { ok: false, error: e }; }
  function touched(rec, what, detail, quiet) {
    bump(rec);
    if (!quiet) { if (!rec.trail) rec.trail = []; rec.trail.push({ at: nowIso, by: u.name, what: what, detail: finText(detail, 200) }); if (rec.trail.length > 80) rec.trail.splice(0, rec.trail.length - 80); }
    if (info) { if (info.requests.indexOf(rec) < 0) info.requests.push(rec); info.audit.push({ time: nowIso, user: u.name, action: what, no: rec.no || '', detail: detail || '' }); }
  }
  function audit(what, detail) { if (info) info.audit.push({ time: nowIso, user: u.name, action: what, no: '', detail: detail || '' }); }
  function saveFile(photo, name) {
    if (!photo || !photo.b64) return '';
    if (String(photo.b64).length > 1500000) return '';
    return store && store.saveFile ? store.saveFile(name, photo.mime || 'image/jpeg', photo.b64) : 'pending';
  }

  if (t === 'req_new') {
    /* why the money is needed and whether it was planned: asked on the form of 24/11 (beta 1.5); both optional here */
    if (!finCanAskFor(u, d.section)) return fail('section');
    if (!d.id || finFind(db.requests, d.id)) return fail('id');
    var what = finText(d.what, 160), amount = Number(d.amount), bundle = null, month = '', ppl = 0, toRev = false;
    if (d.items && !d.month) {
      /* several items in one request, each on its budget line; without the lines the request goes to the reviewer */
      bundle = finItems(d.items, true, finReviewOn(s)); if (!bundle) return fail('items');
      toRev = finOpenLines(bundle.items);
      if (toRev && finFinal(u, d.section) && !finRoute(db.users, u, d.section)) return fail('line');
      amount = bundle.sum; if (toRev) { d.line = ''; d.lineName = ''; } else finItemLine(bundle, d);
      ppl = finPeople(d.people); if (ppl < 0) return fail('food');
    } else if (d.items) {
      /* one request for the whole month of a section */
      month = String(d.month || '');
      if (!/^\d{4}-\d{2}$/.test(month) || finMonthlySecs(s).indexOf(String(d.section)) < 0) return fail('section');
      for (var mi = 0; mi < db.requests.length; mi++) if (db.requests[mi].month === month && db.requests[mi].section === String(d.section) && db.requests[mi].status !== 'Cancelled' && db.requests[mi].status !== 'Not approved') return fail('again');
      bundle = finItems(d.items); if (!bundle) return fail('amount');
      amount = bundle.sum; d.line = 'monthly'; d.lineName = bundle.items.length + (bundle.items.length === 1 ? ' budget line' : ' budget lines');
    }
    var food = bundle ? null : finFood(d.food);
    if (food === false) return fail('food');
    if (food) amount = Math.round(food.qty * food.price * 100) / 100;
    if (!what) return fail('what');
    if (!(amount > 0) || amount > 100000000) return fail('amount');
    if (!d.line && !toRev) return fail('line');
    /* a request that goes to the review may come without a priority: the reviewer sets it (beta 1.6) */
    if (['P1', 'P2', 'P3'].indexOf(d.prio) < 0 && !(toRev && !d.prio)) return fail('prio');
    if (!finIsDate(d.needed)) return fail('date');
    var created = finIsDate(d.created) && d.created <= today && finDayNum(today) - finDayNum(d.created) <= 30 ? d.created : today;
    var notice = finWorkDays(created, d.needed), emergency = notice < s.noticeDays;
    /* a planned expense sent by the management is known from the plan: it is not an Emergency */
    var planKey = finText(d.plan, 60);
    if (planKey && (u.role === 'accountant' || u.role === 'director')) emergency = false;
    if (emergency && (!finText(d.reason) || !finText(d.why))) return fail('reason');
    db.seq++;
    r = { id: String(d.id), no: 'R' + ('000' + db.seq).slice(-4), section: String(d.section), what: what, amount: Math.round(amount * 100) / 100,
      line: String(d.line || ''), lineName: finText(d.lineName, 120), prio: d.prio || '', needed: d.needed, pay: d.pay === 'cash' ? 'cash' : 'bank',
      created: created, received: nowIso, notice: notice, emergency: emergency, reason: emergency ? finText(d.reason, 60) : '', why: emergency ? finText(d.why, 200) : '', purpose: finText(d.purpose, 300), planned: finPlanned(d.planned),
      by: u.id, byName: u.name, byRole: u.role, status: toRev ? 'Review' : 'Waiting', selfRev: !toRev && finReviewOn(s) && finFinal(u, d.section) && !planKey, decidedBy: '', decidedAt: '', note: '', week: '', paidBy: '', paidAt: '',
      receipt: false, receiptBy: '', receiptAt: '', quoteFile: saveFile(d.photo, 'quotation-' + d.id), receiptFile: '', deadline: d.deadline ? String(d.deadline) : '', plan: planKey, month: month, people: ppl, items: bundle ? bundle.items : null, food: food || null, parts: bundle ? null : finParts(d.parts, Math.round(amount * 100) / 100) };
    if (toRev) { var st0 = finRoute(db.users, u, r.section); if (st0) r.stage = st0; }
    /* a reviewer asks on behalf of a section head (Mulenga, 25/11): the head sees it as his; the review follows who typed it */
    if (d.behalf && u.role === 'accountant') { var bh = finFind(db.users, String(d.behalf)); if (bh && bh.role === 'head' && bh.active !== false) { r.behalf = bh.name; r.behalfId = bh.id; } }
    db.requests.push(r);
    touched(r, toRev ? 'New request, to review' : 'New request', what + ' K' + r.amount + (emergency ? ' EMERGENCY' : ''));
    if (r.deadline) {
      x = finFind(db.deadlines, r.deadline);
      if (x && !x.deleted) { if (x.repeat === 'monthly') x.date = finAddMonth(x.date); else x.asked = r.id; bump(x); }
    }
    return { ok: true };
  }

  if (t === 'dl_save') {
    if (!finCanDeadline(u, d.section)) return fail('section');
    var w2 = finText(d.what, 160), am2 = Number(d.amount);
    if (!d.id || !w2 || !(am2 > 0) || !finIsDate(d.date)) return fail('fields');
    x = finFind(db.deadlines, d.id);
    if (x && !finCanDeadline(u, x.section)) return fail('section');
    if (!x) { x = { id: String(d.id), asked: '' }; db.deadlines.push(x); }
    x.section = String(d.section); x.what = w2; x.amount = am2; x.line = String(d.line || ''); x.lineName = finText(d.lineName, 120);
    x.date = d.date; x.repeat = d.repeat === 'monthly' ? 'monthly' : ''; x.pay = d.pay === 'cash' ? 'cash' : 'bank'; x.deleted = false;
    if (x.asked && d.reopen) x.asked = '';
    bump(x); audit('Deadline saved', w2 + ' ' + d.date);
    return { ok: true };
  }
  if (t === 'dl_del') {
    x = finFind(db.deadlines, d.id);
    if (!x) return fail('id');
    if (!finCanDeadline(u, x.section)) return fail('section');
    x.deleted = true; bump(x); audit('Deadline removed', x.what);
    return { ok: true };
  }

  if (t === 'set') {
    if (u.role !== 'director' && !u.admin) return fail('role');
    if (d.noticeDays != null) { var nd = Math.round(Number(d.noticeDays)); if (!(nd >= 0 && nd <= 30)) return fail('fields'); s.noticeDays = nd; }
    if (d.approvalDay != null) { var ad = Math.round(Number(d.approvalDay)); if (!(ad >= 1 && ad <= 5)) return fail('fields'); s.approvalDay = ad; }
    if (d.countFrom != null) { if (!finIsDate(d.countFrom)) return fail('fields'); s.countFrom = d.countFrom; }
    if (d.review != null) s.review = d.review === true || d.review === 'yes';
    if (d.depts != null) s.depts = d.depts === true || d.depts === 'yes';
    bump(s); audit('Rules changed', JSON.stringify({ noticeDays: s.noticeDays, approvalDay: s.approvalDay, countFrom: s.countFrom, review: finReviewOn(s) }));
    return { ok: true };
  }
  /* the spending plan comes from the budget; here the management changes the rule of one line, or says which sections send a monthly request */
  if (t === 'plan_set') {
    if (u.role !== 'accountant' && u.role !== 'director' && !u.admin) return fail('role');
    if (!s.plan) s.plan = {};
    if (d.monthly) {
      if (!d.monthly.length && d.monthly.length !== 0 || d.monthly.length > 40) return fail('fields');
      s.monthly = d.monthly.map(String); bump(s); audit('Monthly request', s.monthly.join(', ') || 'no section');
      return { ok: true };
    }
    var ln = finText(d.line, 20); if (!ln) return fail('fields');
    /* the Accountant prepares the plan, the Director confirms it: a change by the Accountant waits in planDraft */
    var prop = u.role === 'accountant' && !u.admin;
    if (!s.planDraft) s.planDraft = {};
    if (d.rule === null) {
      if (prop) { s.planDraft[ln] = { reset: true, by: u.name, at: nowIso }; bump(s); audit('Spending plan', ln + ': proposed, back to the budget rule'); return { ok: true }; }
      delete s.plan[ln]; delete s.planDraft[ln]; bump(s); audit('Spending plan', ln + ' back to the budget rule'); return { ok: true };
    }
    var q = d.rule || {}, ms = [], k;
    for (k = 0; k < (q.months || []).length; k++) { var mo = Math.round(Number(q.months[k])); if (!(mo >= 1 && mo <= 12)) return fail('fields'); if (ms.indexOf(mo) < 0) ms.push(mo); }
    var tm = Math.round(Number(q.times)), am = Number(q.amount);
    if (['w1', 'w2', 'w3', 'w4', 'spread'].indexOf(q.when) < 0 || !(tm >= 1 && tm <= 8) || !(am >= 0) || am > 100000000 || ['P1', 'P2', 'P3'].indexOf(q.prio) < 0) return fail('fields');
    var nr = { months: ms.sort(function (a, b) { return a - b; }), when: q.when, times: tm, amount: Math.round(am * 100) / 100, prio: q.prio };
    /* fixed: paid by the management, the section does not ask for it */
    if (q.fixed != null) nr.fixed = !!q.fixed;
    /* food: the request says people, quantity, price and what is left in the store */
    if (q.food != null) nr.food = !!q.food;
    if (prop) { nr.by = u.name; nr.at = nowIso; s.planDraft[ln] = nr; bump(s); audit('Spending plan', ln + ': proposed, ' + ms.length + ' months, ' + q.when + ', ' + tm + ' x K' + nr.amount); return { ok: true }; }
    s.plan[ln] = nr; delete s.planDraft[ln];
    bump(s); audit('Spending plan', ln + ': ' + ms.length + ' months, ' + q.when + ', ' + tm + ' x K' + s.plan[ln].amount);
    return { ok: true };
  }
  /* the Director confirms or refuses a change proposed by the Accountant; the Accountant can take a proposal back */
  if (t === 'plan_decide') {
    var yes = !!d.ok;
    if (yes ? (u.role !== 'director' && !u.admin) : (u.role !== 'director' && u.role !== 'accountant' && !u.admin)) return fail('role');
    var pl = finText(d.line, 20), dr = s.planDraft && s.planDraft[pl];
    if (!dr) return { ok: true };
    if (!s.plan) s.plan = {};
    if (yes) {
      if (dr.reset) delete s.plan[pl];
      else { s.plan[pl] = { months: dr.months, when: dr.when, times: dr.times, amount: dr.amount, prio: dr.prio }; if (dr.fixed != null) s.plan[pl].fixed = !!dr.fixed; if (dr.food != null) s.plan[pl].food = !!dr.food; }
    }
    delete s.planDraft[pl]; bump(s); audit('Spending plan', pl + ': change ' + (yes ? 'confirmed' : 'not confirmed'));
    return { ok: true };
  }
  if (t === 'week_money') {
    if (u.role !== 'accountant' && u.role !== 'director' && !u.admin) return fail('role');
    /* two numbers for each week: the money expected, and the money received with its date */
    /* the money comes in the first, the second and the last week of the month: an indicative amount for each */
    if (d.kind === 'indicative') {
      if (['w1', 'w2', 'last'].indexOf(d.slot) < 0) return fail('fields');
      if (!s.tranche) s.tranche = {};
      if (d.amount === null || d.amount === '') delete s.tranche[d.slot];
      else { var ia = Number(d.amount); if (!(ia >= 0) || ia > 1000000000) return fail('fields'); s.tranche[d.slot] = ia; }
      bump(s); audit('Indicative money', d.slot + ' ' + (s.tranche[d.slot] != null ? 'K' + s.tranche[d.slot] : 'removed'));
      return { ok: true };
    }
    /* one number for each month: the money expected in the month */
    if (d.kind === 'month') {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(d.month))) return fail('fields');
      if (!s.monthExp) s.monthExp = {};
      if (!s.monthEur) s.monthEur = {};
      /* the money comes in euros: the euros and the exchange rate are kept, the Kwacha are euros x rate */
      var me = d.eur === null || d.eur === '' || d.eur == null ? null : Number(d.eur), mr = d.rate === null || d.rate === '' || d.rate == null ? null : Number(d.rate);
      if (me !== null && !(me >= 0 && me <= 100000000)) return fail('fields');
      if (mr !== null && !(mr > 0 && mr <= 10000)) return fail('fields');
      if (d.amount === null || d.amount === '') { delete s.monthExp[d.month]; delete s.monthEur[d.month]; }
      else {
        var ma = me !== null && mr !== null ? Math.round(me * mr * 100) / 100 : Number(d.amount);
        if (!(ma >= 0) || ma > 1000000000) return fail('fields');
        s.monthExp[d.month] = ma;
        if (me !== null && mr !== null) s.monthEur[d.month] = { eur: me, rate: mr }; else delete s.monthEur[d.month];
      }
      /* every change of the money expected in a month is kept: the first figure and its revisions */
      if (!s.monthLog) s.monthLog = {};
      var ml = s.monthLog[d.month] || (s.monthLog[d.month] = []);
      ml.push({ amount: s.monthExp[d.month] != null ? s.monthExp[d.month] : null, at: nowIso, by: u.name }); if (ml.length > 30) ml.splice(0, ml.length - 30);
      bump(s); audit('Money for the month', d.month + ' ' + (s.monthExp[d.month] != null ? 'expected K' + s.monthExp[d.month] + (s.monthEur[d.month] ? ' (EUR ' + s.monthEur[d.month].eur + ' x ' + s.monthEur[d.month].rate + ')' : '') : 'removed'));
      return { ok: true };
    }
    /* the cash counted in the bank and in the box: from that moment the cash is counted from this figure */
    if (d.kind === 'cash') {
      if (!s.cash) s.cash = [];
      if (d.amount === null || d.amount === '') { if (!s.cash.length) return fail('fields'); s.cash.pop(); bump(s); audit('Cash counted', 'last count removed'); return { ok: true }; }
      var ca = Math.round(Number(d.amount) * 100) / 100;
      if (!(ca >= -1000000000 && ca <= 1000000000) || isNaN(ca)) return fail('fields');
      s.cash.push({ amount: ca, at: nowIso, day: today, by: u.name }); if (s.cash.length > 60) s.cash.splice(0, s.cash.length - 60);
      bump(s); audit('Cash counted', 'K' + ca);
      return { ok: true };
    }
    if (!finIsDate(d.week)) return fail('fields');
    var wk = finWeekKey(d.week), kind = d.kind === 'expected' ? 'expected' : 'received';
    if (!s.weeksExp) s.weeksExp = {};
    if (!s.weeksDate) s.weeksDate = {};
    if (d.amount === null || d.amount === '') {
      if (kind === 'expected') delete s.weeksExp[wk]; else { delete s.weeks[wk]; delete s.weeksDate[wk]; }
      bump(s); audit('Money for the week', wk + ' ' + kind + ' removed');
      return { ok: true };
    }
    var wm = Number(d.amount);
    if (!(wm >= 0)) return fail('fields');
    if (kind === 'expected') { s.weeksExp[wk] = wm; audit('Money for the week', wk + ' expected K' + wm); }
    else {
      var got = finIsDate(d.date) && d.date <= finAddDays(today, 1) ? d.date : today;
      s.weeks[wk] = wm; s.weeksDate[wk] = got; audit('Money for the week', wk + ' received K' + wm + ' on ' + got);
    }
    bump(s);
    return { ok: true };
  }

  if (t === 'user_save') {
    if (!u.admin) return fail('role');
    var nm = finText(d.name, 60);
    if (!d.id || !nm || FIN_ROLES.indexOf(d.role) < 0) return fail('fields');
    x = finFind(db.users, d.id);
    if (!x) { if (!d.salt || !d.cred) return fail('pin'); x = { id: String(d.id), fails: 0, lockUntil: '' }; db.users.push(x); }
    if (d.deleted && x.id === u.id) return fail('self');
    var wasAdmin = !!x.admin && x.active !== false, willAdmin = !!d.admin && d.active !== false && !d.deleted;
    if (wasAdmin && !willAdmin) {
      var others = 0; for (var i = 0; i < db.users.length; i++) if (db.users[i] !== x && db.users[i].admin && db.users[i].active !== false) others++;
      if (!others) return fail('last_admin');
    }
    x.name = nm; x.title = finText(d.title, 40); x.role = d.role; x.sections = (d.sections || []).map(String); x.reviews = (d.reviews || []).map(String).filter(function (p) { return p === 'S' || p === 'C' || p === 'E'; }); x.admin = !!d.admin; x.revBy = x.role === 'head' && ['S', 'C', 'E'].indexOf(d.revBy) >= 0 ? d.revBy : ''; x.active = d.active !== false && !d.deleted; if (d.deleted) x.deleted = true; else delete x.deleted;
    if (d.salt && d.cred) { x.salt = String(d.salt); x.cred = String(d.cred); x.fails = 0; x.lockUntil = ''; }
    bump(x); audit(d.deleted ? 'Person deleted' : 'Person saved', nm + ' (' + x.role + ')');
    return { ok: true };
  }
  if (t === 'pin') {
    if (!d.salt || !d.cred) return fail('fields');
    u.salt = String(d.salt); u.cred = String(d.cred); bump(u); audit('PIN changed', '');
    return { ok: true };
  }

  if (t === 'comment_new') {
    if (!db.comments) db.comments = [];
    if (!d.id || finFind(db.comments, d.id)) return fail('id');
    if (!finText(d.text)) return fail('comment');
    if (db.comments.length >= 3000) return fail('full');
    x = finCommentRec(d, nowIso, u.id, u.name, false);
    db.comments.push(x); bump(x);
    if (info) { info.comments.push(x); }
    audit('Comment on the app', x.page + ': ' + x.text.slice(0, 80));
    return { ok: true };
  }
  if (t === 'comment_done') {
    if (!u.admin) return fail('role');
    x = finFind(db.comments || [], d.id);
    if (!x) return fail('id');
    x.done = d.done !== false; x.doneBy = x.done ? u.name : ''; x.doneAt = x.done ? nowIso : '';
    if (!x.done && !x.ans) x.ans = 'opened again';
    bump(x); if (info) info.comments.push(x);
    return { ok: true };
  }

  if (t === 'req_wipe') {
    if (!u.admin) return fail('role');
    if (d.confirm !== 'DELETE') return fail('fields');
    var gone = db.requests; db.requests = []; db.seq = 0;
    for (var wi = 0; wi < db.deadlines.length; wi++) if (db.deadlines[wi].asked) { db.deadlines[wi].asked = ''; bump(db.deadlines[wi]); }
    bump(s); s.wipeRev = db.rev;
    if (info) info.wipe = gone;
    audit('All requests deleted', gone.length + (gone.length === 1 ? ' request' : ' requests'));
    return { ok: true };
  }

  /* everything below changes one request */
  /* the reviewer groups requests that are one need: each request keeps its record and amounts */
  if (t === 'req_group') {
    var gl = (d.ids || []).map(function (id) { return finFind(db.requests, id); });
    if (!gl.length || gl.some(function (x) { return !x; })) return fail('fields');
    if (gl.some(function (x) { return !(x.stage ? finRevParts(u).indexOf(x.stage) >= 0 : finReviews(u, x.section)) || ['Review', 'Waiting', 'Next week'].indexOf(x.status) < 0; })) return fail('role');
    var gn = d.name == null ? '' : finText(d.name, 60);
    if (d.name != null && (!gn || gl.length < 2)) return fail('fields');
    var gid = gn ? 'g' + gl[0].id : '';
    gl.forEach(function (x) { if (gn) x.grp = { id: gid, name: gn }; else delete x.grp; touched(x, gn ? 'Grouped as one need' : 'Taken out of the group', gn); });
    return { ok: true };
  }
  r = finFind(db.requests, d.id);
  if (!r) return fail('id');
  if (t === 'req_cancel') {
    if (r.by !== u.id && !finHasSection(u, r.section)) return fail('role');
    if (r.status !== 'Waiting' && r.status !== 'Next week' && r.status !== 'To revise' && r.status !== 'Review') return fail('status');
    r.status = 'Cancelled'; touched(r, 'Cancelled', '');
    if (r.deadline) { x = finFind(db.deadlines, r.deadline); if (x && x.asked === r.id) { x.asked = ''; bump(x); } }
    return { ok: true };
  }
  /* the reviewer checks a request, gives each item its budget line (or says it is not in the budget) and sends it to the Director; or sends it back */
  if (t === 'req_review') {
    if (r.by === u.id || (!finReviews(u, r.section) && !(r.stage && finRevParts(u).indexOf(r.stage) >= 0))) return fail('role');
    /* a request already with the Director comes back to the review, before the Director decides: only the reviewer who sent it there */
    if (d.reopen) {
      if (r.stage ? finRevParts(u).indexOf(r.stage) < 0 : !finFinal(u, r.section)) return fail('role');
      if ((r.status !== 'Waiting' && r.status !== 'Next week') || !r.items || !r.revAt) return fail('status');
      r.rvDraft = { lines: r.items.map(function (it) { return it.line || ''; }), prio: r.prio || '', nature: r.nature || '', recommend: r.revRec || '', just: r.revJust || '', note: r.revNote || '', items: r.rvItems || null };
      r.status = 'Review'; r.note = ''; r.noteBy = ''; r.decidedBy = ''; r.decidedAt = ''; r.week = ''; delete r.revLater;
      touched(r, 'Taken back by the reviewer', finText(d.note, 200));
      return { ok: true };
    }
    if (r.status !== 'Review' || !r.items) return fail('status');
    if (!finCanRev(u, r)) return fail('role');
    if (d.draft) {
      var dr0 = d.draft;
      r.rvDraft = { lines: (dr0.lines || []).slice(0, r.items.length).map(function (x) { return finText(x, 20); }), prio: ['P1', 'P2', 'P3'].indexOf(dr0.prio) >= 0 ? dr0.prio : '', nature: dr0.nature === 'Exceptional' || dr0.nature === 'Normal' ? dr0.nature : '', recommend: dr0.recommend === 'no' || dr0.recommend === 'yes' ? dr0.recommend : '', just: finText(dr0.just, 300), note: finText(dr0.note, 200), items: finRecItems(dr0.items, r.items) || null, by: u.name, at: nowIso };
      touched(r, 'Review draft', '', true);
      return { ok: true };
    }
    if (d.later) {
      if (!finIsDate(d.later) || d.later <= today) return fail('date');
      r.revLater = d.later; r.revLaterNote = finText(d.note, 200); r.revLaterBy = u.name;
      touched(r, 'Postponed by the reviewer', 'to ' + d.later + (r.revLaterNote ? ': ' + r.revLaterNote : ''));
      return { ok: true };
    }
    if (d.now) { if (!r.revLater) return fail('status'); delete r.revLater; touched(r, 'Back to the review', ''); return { ok: true }; }
    if (d.back) {
      if (!finText(d.note)) return fail('note');
      r.status = 'To revise'; r.note = finText(d.note, 200); r.noteBy = 'review'; r.decidedBy = u.name; r.decidedAt = nowIso; delete r.revLater;
      touched(r, 'Sent back by the reviewer', r.note);
      return { ok: true };
    }
    var ls = d.lines || [], rec = d.rec === '' || d.rec == null ? null : Math.round(Number(d.rec) * 100) / 100;
    var rvi = d.items ? finRecItems(d.items, r.items) : null;
    if (d.items && !rvi) return fail('rec');
    if (rvi) { rec = Math.round(rvi.reduce(function (n, x) { return n + x.amount; }, 0) * 100) / 100; if (Math.abs(rec - r.amount) < 0.005) { rvi = null; rec = null; } }
    if (rec !== null && !(rec > 0 && rec <= r.amount)) return fail('rec');
    var nat = d.nature === 'Exceptional' || d.nature === 'Normal' ? d.nature : '', recm = d.recommend === 'no' ? 'no' : 'yes', just = finText(d.just, 300);
    /* a justification for: exceptional, not recommended, amount lowered, outside the budget or over a budget line */
    var extra = false; for (var lx = 0; lx < ls.length; lx++) if (ls[lx] && ls[lx].line === 'none') extra = true;
    if (!just && (nat === 'Exceptional' || recm === 'no' || (rec !== null && rec < r.amount - 0.004) || extra || d.over)) return fail('just');
    if (['P1', 'P2', 'P3'].indexOf(d.prio) < 0 && !r.prio) return fail('prio');
    if (ls.length !== r.items.length) return fail('line');
    for (var li = 0; li < ls.length; li++) if (!ls[li] || !ls[li].line) return fail('line');
    for (li = 0; li < ls.length; li++) { r.items[li].line = String(ls[li].line); r.items[li].lineName = finText(ls[li].lineName, 120); }
    var rl = {}; finItemLine({ items: r.items }, rl); r.line = rl.line; r.lineName = rl.lineName;
    if (['P1', 'P2', 'P3'].indexOf(d.prio) >= 0) r.prio = d.prio;
    if (rec !== null && rec < r.amount - 0.004) r.rec = rec; else delete r.rec;
    if (rvi && r.rec != null) r.rvItems = rvi; else delete r.rvItems;
    if (nat) r.nature = nat; r.revRec = recm; r.revJust = just; delete r.rvDraft; delete r.revLater;
    if (r.stage === 'E') {
      /* the education review is done: the request stays in the review, for the social reviewer, who starts from it */
      var n1 = finText(d.note, 200);
      r.rev1 = { by: u.name, at: nowIso, rec: r.rec != null ? r.rec : null, recommend: recm, nature: nat, just: just, note: n1 };
      r.rvDraft = { lines: r.items.map(function (it) { return it.line || ''; }), prio: r.prio || '', nature: nat, recommend: recm, just: just, note: n1, items: r.rvItems || null, by: u.name, at: nowIso, first: true };
      r.stage = 'S'; delete r.rec; delete r.rvItems; delete r.revRec; delete r.revJust; delete r.nature;
      touched(r, 'Reviewed by the education office', r.lineName + (r.rvDraft.items ? ', recommended K' + rec : '') + (recm === 'no' ? ', not recommended' : '') + (nat ? ', ' + nat : '') + (just ? '. Why: ' + just : '') + (n1 ? '. ' + n1 : ''));
      return { ok: true };
    }
    r.revBy = u.name; r.revAt = nowIso; r.revNote = finText(d.note, 200);
    r.status = 'Waiting'; r.note = ''; r.noteBy = ''; r.decidedBy = ''; r.decidedAt = '';
    touched(r, 'Reviewed', r.lineName + (r.rec != null ? ', recommended K' + r.rec : '') + (recm === 'no' ? ', not recommended' : '') + (nat ? ', ' + nat : '') + (just ? '. Why: ' + just : '') + (r.revNote ? '. ' + r.revNote : ''));
    return { ok: true };
  }
  if (t === 'decide') {
    if (u.role !== 'director') return fail('role');
    if (r.status === 'Review') return fail('status');
    if (['Approved', 'Next week', 'Not approved', 'Waiting', 'To revise', 'Review'].indexOf(d.status) < 0) return fail('fields');
    if (r.status === 'Paid' || r.status === 'Cancelled') return fail('status');
    if (r.pays && r.pays.length) return fail('status');      /* a part is already paid: the decision stays */
    if ((d.status === 'To revise' || d.status === 'Review') && !finText(d.note)) return fail('note');
    /* back to the reviewer: only a request that a reviewer saw, still to decide */
    if (d.status === 'Review' && (!r.items || !r.revAt || (r.status !== 'Waiting' && r.status !== 'Next week'))) return fail('status');
    var orig = r.asked != null ? r.asked : r.amount, appr = null;
    if (d.status === 'Approved' && d.amount != null && d.amount !== '') {
      appr = Math.round(Number(d.amount) * 100) / 100;
      if (!(appr > 0 && appr <= orig)) return fail('amount');
    }
    finRestore(r);
    if (appr !== null) finLower(r, appr);
    r.status = d.status; r.note = finText(d.note, 200); r.noteBy = d.status === 'Review' ? 'director' : '';
    if (d.status !== 'Approved') r.payOn = '';
    r.decidedBy = d.status === 'Waiting' ? '' : u.name; r.decidedAt = d.status === 'Waiting' ? '' : nowIso;
    r.week = d.status === 'Approved' ? finWeekKey(today) : '';
    touched(r, d.status === 'Waiting' ? 'Decision undone' : d.status === 'Review' ? 'Sent back to the reviewer' : d.status, (r.asked != null ? 'K' + r.amount + ' of K' + r.asked + (r.note ? '. ' : '') : '') + r.note);
    return { ok: true };
  }
  /* the section changes a request the Director sent back, and it goes to the Director again */
  if (t === 'req_edit') {
    if (r.by !== u.id && !finCanAskFor(u, r.section)) return fail('role');
    if (r.status !== 'To revise') return fail('status');
    var what2 = finText(d.what, 160), amount2 = Number(d.amount), bundle2 = null, ppl2 = 0, toRev2 = false;
    if (r.month) { bundle2 = finItems(d.items); if (!bundle2) return fail('amount'); amount2 = bundle2.sum; d.line = 'monthly'; d.lineName = bundle2.items.length + (bundle2.items.length === 1 ? ' budget line' : ' budget lines'); }
    else if (d.items) { bundle2 = finItems(d.items, true, finReviewOn(s)); if (!bundle2) return fail('items'); amount2 = bundle2.sum; toRev2 = finOpenLines(bundle2.items); if (toRev2) { d.line = ''; d.lineName = ''; } else finItemLine(bundle2, d); ppl2 = finPeople(d.people); if (ppl2 < 0) return fail('food'); }
    var food2 = bundle2 ? null : finFood(d.food);
    if (food2 === false) return fail('food');
    if (food2) amount2 = Math.round(food2.qty * food2.price * 100) / 100;
    if (!what2) return fail('what');
    if (!(amount2 > 0) || amount2 > 100000000) return fail('amount');
    if (!d.line && !toRev2) return fail('line');
    if (['P1', 'P2', 'P3'].indexOf(d.prio) < 0 && !(toRev2 && !d.prio)) return fail('prio');
    if (!finIsDate(d.needed)) return fail('date');
    var notice2 = finWorkDays(r.created, d.needed), em2 = notice2 < s.noticeDays;
    var reason2 = finText(d.reason, 60) || r.reason, why2 = finText(d.why, 200) || r.why;
    if (em2 && (!reason2 || !why2)) return fail('reason');
    if (!r.versions) r.versions = [];
    r.versions.push({ at: r.revisedAt || r.created, what: r.what, amount: r.amount, items: r.items ? JSON.parse(JSON.stringify(r.items)) : null, purpose: r.purpose || '', needed: r.needed, quoteFile: r.quoteFile || '' }); if (r.versions.length > 10) r.versions.splice(0, r.versions.length - 10);
    r.items = bundle2 ? bundle2.items : null; r.people = ppl2;
    r.food = food2 || null; r.parts = bundle2 ? null : finParts(d.parts, Math.round(amount2 * 100) / 100);
    r.what = what2; r.amount = Math.round(amount2 * 100) / 100; r.line = String(d.line || ''); r.lineName = finText(d.lineName, 120); r.prio = d.prio || ''; r.needed = d.needed;
    r.pay = d.pay === 'cash' ? 'cash' : 'bank'; r.notice = notice2; r.emergency = em2; r.reason = em2 ? reason2 : ''; r.why = em2 ? why2 : '';
    if (d.purpose != null) r.purpose = finText(d.purpose, 300);
    if (d.planned != null) r.planned = finPlanned(d.planned);
    var q2 = saveFile(d.photo, 'quotation-' + r.id + '-' + ((r.revised || 0) + 1)); if (q2) r.quoteFile = q2;
    r.status = toRev2 ? 'Review' : 'Waiting'; r.revised = (r.revised || 0) + 1; r.revisedAt = nowIso; r.askedNote = r.note; r.askedBy = r.noteBy === 'review' ? r.decidedBy : ''; r.decidedBy = ''; r.decidedAt = ''; r.week = '';
    if (toRev2) { r.revBy = ''; r.revAt = ''; r.revNote = ''; delete r.rec; delete r.rvItems; delete r.revRec; delete r.revJust; delete r.rev1; delete r.rvDraft; var st2 = finRoute(db.users, u, r.section); if (st2) r.stage = st2; else delete r.stage; }
    touched(r, 'Sent again after revision', what2 + ' K' + r.amount);
    return { ok: true };
  }
  /* the Accountant says on which day an approved request will be paid */
  if (t === 'pay_date') {
    if (u.role !== 'accountant') return fail('role');
    if (r.status !== 'Approved') return fail('status');
    if (d.date && !finIsDate(d.date)) return fail('date');
    r.payOn = d.date ? String(d.date) : '';
    touched(r, 'Pay date', r.payOn || 'removed');
    return { ok: true };
  }
  /* a request is paid in one go or in parts, according to the need */
  if (t === 'pay') {
    if (u.role !== 'accountant') return fail('role');
    if (r.status !== 'Approved') return fail('status');
    var rest = Math.round((r.amount - finPaid(r)) * 100) / 100, close = !!d.close;
    var pa = d.amount == null || d.amount === '' ? (close ? 0 : rest) : Math.round(Number(d.amount) * 100) / 100;
    if (!(pa >= 0) || (!(pa > 0) && !close)) return fail('amount');
    if (pa > rest + 0.005) return fail('over');
    if (!r.pays) r.pays = [];
    if (pa > 0) r.pays.push({ at: nowIso, date: finIsDate(d.date) && d.date <= finAddDays(today, 1) ? d.date : today, amount: pa, by: u.name, pay: d.pay === 'cash' ? 'cash' : d.pay === 'bank' ? 'bank' : r.pay });
    var all = finPaid(r) >= r.amount - 0.005;
    if (all || close) { r.status = 'Paid'; r.paidBy = u.name; r.paidAt = nowIso; r.closed = !all; if (!r.week) r.week = finWeekKey(today); }
    touched(r, all ? 'Paid' : close ? 'Closed, not all paid' : 'Part paid', 'K' + pa + ' of K' + r.amount + ' ' + r.pay);
    return { ok: true };
  }
  /* takes back the last payment, or opens again a request that was closed */
  if (t === 'unpay') {
    if (u.role !== 'accountant') return fail('role');
    var np = r.pays ? r.pays.length : 0;
    if (r.status !== 'Paid' && !(r.status === 'Approved' && np)) return fail('status');
    if (!r.pays) r.pays = []; else if (!r.closed && np) r.pays.pop();
    r.status = 'Approved'; r.closed = false; r.paidBy = ''; r.paidAt = ''; r.receipt = false; r.receiptBy = ''; r.receiptAt = ''; r.spent = null;
    touched(r, 'Payment undone', '');
    return { ok: true };
  }
  if (t === 'receipt') {
    if (u.role !== 'accountant' && r.by !== u.id && !finHasSection(u, r.section)) return fail('role');
    if (r.status !== 'Paid') return fail('status');
    /* how much of the money was really spent: what is not spent comes back */
    var sp = d.spent === '' || d.spent == null ? null : Number(d.spent);
    if (sp !== null && (!(sp >= 0) || sp > 100000000)) return fail('amount');
    r.receipt = true; r.receiptBy = u.name; r.receiptAt = nowIso; r.spent = sp === null ? null : Math.round(sp * 100) / 100;
    x = saveFile(d.photo, 'receipt-' + r.id); if (x) r.receiptFile = x;
    touched(r, 'Receipt added', r.spent != null ? 'spent K' + r.spent : '');
    return { ok: true };
  }
  if (t === 'quote_add') {
    if (u.role !== 'accountant' && r.by !== u.id && !finHasSection(u, r.section)) return fail('role');
    x = saveFile(d.photo, 'quotation-' + r.id); if (!x) return fail('photo');
    r.quoteFile = x; touched(r, 'Quotation added', '');
    return { ok: true };
  }
  return fail('action');
}

/* ---- one call from a phone ---- */
function finHandle(req, store) {
  if (!req || !store.key() || req.key !== store.key()) return { ok: false, error: 'key' };
  var db = store.load() || finNewDb(), now = store.now(), a = req.action, i;
  function pub() { var out = []; for (var k = 0; k < db.users.length; k++) out.push(finPublicUser(db.users[k])); return out; }

  if (a === 'hello') return { ok: true, empty: db.users.length === 0, users: pub(), settings: finPubSettings(db.settings, false), rev: db.rev, now: now };
  if (a === 'first_admin') {
    if (db.users.length) return { ok: false, error: 'not_empty' };
    var nm = finText(req.name, 60);
    if (!req.id || !nm || !req.salt || !req.cred || FIN_ROLES.indexOf(req.role) < 0) return { ok: false, error: 'fields' };
    db.rev++;
    db.users.push({ id: String(req.id), name: nm, role: req.role, sections: [], admin: true, active: true, salt: String(req.salt), cred: String(req.cred), fails: 0, lockUntil: '', rev: db.rev });
    store.save(db, { requests: [], audit: [{ time: now, user: nm, action: 'First administrator', no: '', detail: '' }] });
    return { ok: true, users: pub() };
  }

  if (!db.comments) db.comments = [];
  /* a comment from the demo: the link is enough, the person writes a name */
  if (a === 'comment') {
    var who = finText(req.name, 60);
    if (!req.id || !who || !finText(req.text)) return { ok: false, error: 'fields' };
    if (finFind(db.comments, req.id)) return { ok: true, again: true };
    if (db.comments.length >= 3000) return { ok: false, error: 'full' };
    var cm = finCommentRec(req, now, '', who, !req.signin);      /* from the demo, or from the first screen before signing in */
    db.rev++; cm.rev = db.rev; db.comments.push(cm);
    store.save(db, { requests: [], comments: [cm], audit: [{ time: now, user: who + (req.signin ? ' (not signed in)' : ' (demo)'), action: 'Comment on the app', no: '', detail: cm.page + ': ' + cm.text.slice(0, 80) }] });
    return { ok: true };
  }

  /* after the stream the person writes the PIN: the app asks which of the people of that stream have it */
  if (a === 'who') {
    var wh = db.who || (db.who = { fails: 0, lock: '' }), cands = req.cands || [], hits = [];
    if (wh.lock && now < wh.lock) return { ok: false, error: 'locked', until: wh.lock };
    if (!cands.length || cands.length > 80) return { ok: false, error: 'fields' };
    for (i = 0; i < cands.length; i++) { var cu = cands[i] ? finFind(db.users, cands[i].id) : null; if (cu && cu.active !== false && cands[i].cred && cu.cred === cands[i].cred && !(cu.lockUntil && now < cu.lockUntil)) hits.push(cu.id); }
    if (!hits.length) {
      wh.fails = (wh.fails || 0) + 1;
      if (wh.fails >= 5) { wh.fails = 0; wh.lock = new Date(Date.parse(now) + 60000).toISOString(); }
      store.save(db, { requests: [], audit: [] });
      return { ok: false, error: 'pin' };
    }
    if (wh.fails || wh.lock) { wh.fails = 0; wh.lock = ''; store.save(db, { requests: [], audit: [] }); }
    return { ok: true, ids: hits };
  }

  var u = finFind(db.users, req.user);
  if (!u || u.active === false) return { ok: false, error: 'user' };
  if (u.lockUntil && now < u.lockUntil) return { ok: false, error: 'locked', until: u.lockUntil };
  if (!req.cred || u.cred !== req.cred) {
    u.fails = (u.fails || 0) + 1;
    if (u.fails >= 5) { u.fails = 0; u.lockUntil = new Date(Date.parse(now) + 60000).toISOString(); }
    store.save(db, { requests: [], audit: [] });
    return { ok: false, error: 'pin' };
  }
  var dirty = false;
  if (u.fails || u.lockUntil) { u.fails = 0; u.lockUntil = ''; dirty = true; }

  if (a === 'login') { if (dirty) store.save(db, { requests: [], audit: [] }); return { ok: true, me: finPublicUser(u), now: now }; }
  if (a === 'file_get') {
    var owner = null;
    for (i = 0; i < db.requests.length; i++) if (db.requests[i].quoteFile === req.id || db.requests[i].receiptFile === req.id) owner = db.requests[i];
    if (!owner || !finSeesRequest(u, owner)) return { ok: false, error: 'id' };
    var f = store.getFile(req.id);
    return f ? { ok: true, mime: f.mime, b64: f.b64 } : { ok: false, error: 'id' };
  }
  if (a !== 'sync') return { ok: false, error: 'action' };

  var results = [], info = { requests: [], audit: [], comments: [] }, ops = req.ops || [];
  /* once: the day of the decisions moves from Thursday, the first default, to Monday, as asked on 16 November 2026 */
  if (!db.settings.dayV2) {
    var wasThu = db.settings.approvalDay === 4;
    if (wasThu) db.settings.approvalDay = 1;
    db.settings.dayV2 = true; db.rev++; db.settings.rev = db.rev; dirty = true;
    if (wasThu) info.audit.push({ time: now, user: 'CYP FIN', action: 'Rules changed', no: '', detail: 'Day of the decisions: Monday' });
  }
  var ans = finAnswer(db, now);
  for (i = 0; i < ans.length; i++) {
    db.rev++; ans[i].rev = db.rev; info.comments.push(ans[i]); dirty = true;
    info.audit.push({ time: now, user: 'CYP FIN', action: 'Comment closed', no: '', detail: ans[i].ans + ': ' + ans[i].text.slice(0, 80) });
  }
  for (i = 0; i < ops.length; i++) {
    var op = ops[i];
    if (!op || !op.id) { results.push({ id: '', ok: false, error: 'op' }); continue; }
    if (db.opIds.indexOf(op.id) >= 0) { results.push({ id: op.id, ok: true, again: true }); continue; }
    var res;
    try { res = finApply(db, u, op, now, store, info); } catch (err) { res = { ok: false, error: 'server', detail: String(err) }; }
    res.id = op.id; results.push(res);
    db.opIds.push(op.id); if (db.opIds.length > 3000) db.opIds.splice(0, db.opIds.length - 3000);
    dirty = true;
    if (u.active === false) break;
  }
  if (dirty) store.save(db, info);

  var since = Number(req.since) || 0, full = since === 0 || (u.rev || 0) > since || (db.settings.wipeRev || 0) > since, out = { ok: true, results: results, rev: db.rev, full: full, now: now, me: finPublicUser(u) };
  if (full) since = 0;
  out.users = []; out.requests = []; out.deadlines = []; out.comments = [];
  for (i = 0; i < db.users.length; i++) if ((db.users[i].rev || 0) > since) out.users.push(finPublicUser(db.users[i]));
  for (i = 0; i < db.requests.length; i++) if (db.requests[i].rev > since && finSeesRequest(u, db.requests[i])) out.requests.push(db.requests[i]);
  for (i = 0; i < db.deadlines.length; i++) if (db.deadlines[i].rev > since && (finSeesAll(u) || finHasSection(u, db.deadlines[i].section))) out.deadlines.push(db.deadlines[i]);
  /* the administrator reads all the comments; the others get back their own */
  for (i = 0; i < db.comments.length; i++) if (db.comments[i].rev > since && (u.admin || db.comments[i].by === u.id)) out.comments.push(db.comments[i]);
  if ((db.settings.rev || 0) > since || full) out.settings = finPubSettings(db.settings, finSeesAll(u) || finRevParts(u).indexOf('S') >= 0 || finRevParts(u).indexOf('E') >= 0);
  return out;
}


/* ===== Google side: a Google Sheet shows the requests and the log; Drive holds the database file and the photos =====
   How to install: open the Google Sheet "CYP FIN database" > Extensions > Apps Script > paste this whole file > Save.
   Run "setup" once. Then Deploy > New deployment > Web app > Execute as: Me > Who has access: Anyone.
   Write the web app URL in WEB_APP_URL (near the end of this file) and run "link": the link for the staff appears in the sheet "link". */
var SHEET_ID = ''; /* leave empty when the script is opened from inside the Sheet */
var DB_FILE = 'cyp-fin-database.json';
var REQ_HEAD = ['No', 'Sent', 'Section', 'What', 'Amount (K)', 'Budget line', 'Line name', 'Priority', 'Needed', 'Notice (working days)', 'Emergency', 'Reason', 'Pay by', 'Status', 'Asked by', 'Decided by', 'Decided at', 'Note', 'Paid by', 'Paid at', 'Receipt', 'Quotation photo', 'Receipt photo', 'Id', 'Will be paid on', 'Sent again', 'People', 'Quantity', 'Price per unit (K)', 'Left in the store', 'Spent (K)', 'Paid so far (K)', 'Why needed', 'Planned', 'Asked (K)', 'Recommended (K)'];
var LOG_HEAD = ['Time', 'Who', 'Action', 'Request', 'Detail'];
var COM_HEAD = ['Time', 'Who', 'From the demo', 'Screen', 'Word or place', 'Comment', 'Version', 'Phone', 'Done', 'Done by', 'Id'];
var BOOK_ = null;
function props_() { return PropertiesService.getScriptProperties(); }
function book_() { if (!BOOK_) BOOK_ = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet(); return BOOK_; }
function sheet_(name, head) {
  var sh = book_().getSheetByName(name);
  if (!sh) { sh = book_().insertSheet(name); sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold'); sh.setFrozenRows(1); }
  return sh;
}
function folder_() { var it = DriveApp.getFileById(book_().getId()).getParents(); return it.hasNext() ? it.next() : DriveApp.getRootFolder(); }
function photos_() {
  var P = props_(), id = P.getProperty('photosId');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var f = folder_().createFolder('CYP FIN photos'); P.setProperty('photosId', f.getId()); return f;
}
function fileLink_(id) { return id && id !== 'pending' ? 'https://drive.google.com/file/d/' + id + '/view' : ''; }
function when_(iso) { return iso ? Utilities.formatDate(new Date(iso), 'Africa/Lusaka', 'yyyy-MM-dd HH:mm') : ''; }
function mirror_(list) {
  if (!list.length) return;
  var sh = sheet_('requests', REQ_HEAD), idCol = REQ_HEAD.indexOf('Id') + 1;
  /* a sheet made by an older version has fewer titles: the old ones keep their place, the new ones go at the end */
  if (sh.getLastColumn() < REQ_HEAD.length) sh.getRange(1, 1, 1, REQ_HEAD.length).setValues([REQ_HEAD]).setFontWeight('bold');
  for (var i = 0; i < list.length; i++) {
    var r = list[i], row = 0, last = sh.getLastRow();
    if (last > 1) { var hit = sh.getRange(2, idCol, last - 1, 1).createTextFinder(r.id).matchEntireCell(true).findNext(); if (hit) row = hit.getRow(); }
    if (!row) row = last + 1;
    sh.getRange(row, 1, 1, REQ_HEAD.length).setValues([[r.no, r.created, r.section, r.what, r.amount, r.line, r.lineName, r.prio, r.needed, r.notice, r.emergency ? 'EMERGENCY' : '', r.emergency ? r.reason + ': ' + r.why : '', r.pay === 'cash' ? 'Cash' : 'Bank or mobile money', r.status, r.byName, r.decidedBy, when_(r.decidedAt), r.note, r.paidBy, when_(r.paidAt), r.receipt ? 'Yes' : (r.status === 'Paid' ? 'MISSING' : ''), fileLink_(r.quoteFile), fileLink_(r.receiptFile), r.id, r.payOn || '', r.revised ? r.revised + (r.revised === 1 ? ' time' : ' times') : '', r.food ? r.food.people : '', r.food ? r.food.qty + ' ' + r.food.unit : '', r.food ? r.food.price : '', r.food ? r.food.stock + ' ' + r.food.unit : '', r.spent != null ? r.spent : '', finPaid(r), r.purpose || '', r.planned === 'yes' ? 'Yes' : r.planned === 'no' ? 'No' : r.planned === 'unsure' ? 'Unsure' : '', r.asked != null ? r.asked : r.amount, r.rec != null ? r.rec : '']]);
  }
}
function comments_(list) {
  if (!list.length) return;
  var sh = sheet_('comments', COM_HEAD), idCol = COM_HEAD.length;
  for (var i = 0; i < list.length; i++) {
    var c = list[i], row = 0, last = sh.getLastRow();
    if (last > 1) { var hit = sh.getRange(2, idCol, last - 1, 1).createTextFinder(c.id).matchEntireCell(true).findNext(); if (hit) row = hit.getRow(); }
    if (!row) row = last + 1;
    /* a text that starts with = + - @ would be read as a formula: keep it as text */
    var safe = function (t) { t = String(t || ''); return /^[=+\-@]/.test(t) ? "'" + t : t; };
    sh.getRange(row, 1, 1, COM_HEAD.length).setValues([[when_(c.time), safe(c.byName), c.demo ? 'Demo' : '', safe(c.page), safe(c.target), safe(c.text), safe(c.version), c.phone ? 'Phone' : 'Computer', c.done ? 'Done' : '', safe(c.doneBy), c.id]]);
  }
}
function audit_(list) {
  if (!list.length) return;
  var sh = sheet_('log', LOG_HEAD), rows = [];
  for (var i = 0; i < list.length; i++) rows.push([when_(list[i].time), list[i].user, list[i].action, list[i].no, list[i].detail]);
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, LOG_HEAD.length).setValues(rows);
}
function store_() {
  var P = props_();
  return {
    key: function () { return P.getProperty('key') || ''; },
    now: function () { return new Date().toISOString(); },
    load: function () { var id = P.getProperty('dbId'); return id ? JSON.parse(DriveApp.getFileById(id).getBlob().getDataAsString('UTF-8')) : null; },
    save: function (db, info) {
      var text = JSON.stringify(db), id = P.getProperty('dbId'), f = folder_();
      if (id) DriveApp.getFileById(id).setContent(text); else P.setProperty('dbId', f.createFile(DB_FILE, text, 'application/json').getId());
      var day = new Date().toISOString().slice(0, 10);
      if (P.getProperty('backupDay') !== day) { f.createFile('cyp-fin-backup-' + day + '.json', text, 'application/json'); P.setProperty('backupDay', day); }
      if (info && info.wipe) {
        /* the administrator deleted all the requests: a copy stays on Drive and the sheet is emptied */
        f.createFile('cyp-fin-requests-deleted-' + Utilities.formatDate(new Date(), 'Africa/Lusaka', 'yyyy-MM-dd-HHmm') + '.json', JSON.stringify(info.wipe), 'application/json');
        var rs = sheet_('requests', REQ_HEAD); if (rs.getLastRow() > 1) rs.getRange(2, 1, rs.getLastRow() - 1, rs.getMaxColumns()).clearContent();
      }
      if (info) { mirror_(info.requests || []); audit_(info.audit || []); comments_(info.comments || []); }
    },
    saveFile: function (name, mime, b64) { return photos_().createFile(Utilities.newBlob(Utilities.base64Decode(b64), mime, name + (mime === 'application/pdf' ? '.pdf' : '.jpg'))).getId(); },
    getFile: function (id) { var b = DriveApp.getFileById(id).getBlob(); return { mime: b.getContentType(), b64: Utilities.base64Encode(b.getBytes()) }; }
  };
}
function reply_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function doPost(e) {
  var lock = null;
  try {
    var req = JSON.parse(e.postData.contents);
    /* one phone at a time, so two changes never overwrite each other */
    if (req.action !== 'hello' && req.action !== 'file_get') { lock = LockService.getScriptLock(); lock.waitLock(25000); }
    return reply_(finHandle(req, store_()));
  } catch (err) { return reply_({ ok: false, error: 'server', detail: String(err) }); }
  finally { if (lock) { try { lock.releaseLock(); } catch (x) {} } }
}
function doGet(e) { return ContentService.createTextOutput('CYP FIN shared database'); }
/* Night backup. A trigger of this script runs it every night (Triggers > backupNight > Time-driven > Day timer).
   It copies the database into the folder "CYP FIN night backups", next to the spreadsheet: one file for each night, none is deleted.
   The photos are not copied: they are files of their own in "CYP FIN photos". */
function backupNight() {
  var P = props_(), id = P.getProperty('dbId');
  if (!id) return 'No database yet.';
  var lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    var dir = null, did = P.getProperty('nightId');
    if (did) { try { dir = DriveApp.getFolderById(did); if (dir.isTrashed()) dir = null; } catch (e) { dir = null; } }
    if (!dir) { dir = folder_().createFolder('CYP FIN night backups'); P.setProperty('nightId', dir.getId()); }
    var name = 'cyp-fin-night-' + Utilities.formatDate(new Date(), 'Africa/Lusaka', 'yyyy-MM-dd') + '.json';
    if (dir.getFilesByName(name).hasNext()) return 'Already there: ' + name;
    var text = DriveApp.getFileById(id).getBlob().getDataAsString('UTF-8');
    JSON.parse(text);                                   /* a copy that cannot be read is not a backup: stop with an error */
    dir.createFile(name, text, 'application/json');
    audit_([{ time: new Date().toISOString(), user: 'CYP FIN', action: 'Night backup', no: '', detail: name + ', ' + Math.round(text.length / 1024) + ' KB' }]);
    return 'Saved: ' + name;
  } finally { try { lock.releaseLock(); } catch (x) {} }
}
/* Run once from the editor: prepares the sheets, the photo folder and the key. */
function setup() {
  sheet_('requests', REQ_HEAD); sheet_('log', LOG_HEAD); sheet_('comments', COM_HEAD); photos_();
  if (!props_().getProperty('key')) props_().setProperty('key', (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''));
  Logger.log('Ready. Now: Deploy > New deployment > Web app > Execute as: Me > Who has access: Anyone. Then write the web app URL in WEB_APP_URL and run the function "link".');
}
/* Run after the deployment: writes the link for the staff in the sheet "link".
   First write here the web app URL (Deploy > Manage deployments, it ends with /exec) and the address of the app. */
var WEB_APP_URL = '';
var APP_URL = 'https://maurobif-blip.github.io/cyp-fin/';
function link() {
  if (!WEB_APP_URL) { Logger.log('Write the web app URL (it ends with /exec) in WEB_APP_URL, then run "link" again.'); return; }
  var code = Utilities.base64EncodeWebSafe(WEB_APP_URL + '|' + props_().getProperty('key')).replace(/=+$/, '');
  var sh = sheet_('link', ['CYP FIN: link for the staff. Keep it inside the team. Each person still needs a personal PIN.']);
  sh.getRange(2, 1).setValue(APP_URL + '?db=' + code);
  sh.setColumnWidth(1, 900);
  Logger.log('Done. The link for the staff is in the sheet "link", cell A2.');
}
