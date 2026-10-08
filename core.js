// Placement HQ core: pure helpers with no DOM or storage, shared by app.js, tools/publish.mjs and test.mjs.
// Dates are IST (YYYY-MM-DD, HH:MM); feed deadlines are ISO strings with +05:30.

/* ---------------------------------------------------------------- statuses, time */
export const STATUSES = ['not_applied', 'applied', 'shortlisted', 'test_scheduled', 'test_done', 'interview_scheduled',
  'interview_done', 'offer', 'rejected', 'withdrawn', 'not_eligible'];
export const CLOSED = ['rejected', 'withdrawn', 'not_eligible'];
export const MINE = STATUSES.slice(1, 8); // applied .. offer
export const TRACKS = ['HPC', 'AIML', 'SW', 'DS', 'HARDWARE', 'EMBEDDED', 'MECH', 'OTHER'];
export const IST = 330 * 60000, DAY = 86400000;

export const keyOf = (c, r) => c.slug + '::' + r.title;
export const istDate = ms => new Date(ms + IST).toISOString().slice(0, 10);
export const istTime = ms => new Date(ms + IST).toISOString().slice(11, 16);
export const istMs = (date, time) => Date.parse(`${date}T${time || '00:00'}:00+05:30`);
export const addDays = (date, n) => istDate(istMs(date) + n * DAY);
export const statusOf = (apps, c, r) => ((apps || {})[keyOf(c, r)] || {}).status || 'not_applied';

export function countdown(nowMs, iso) {
  const ms = iso ? Date.parse(iso) - nowMs : NaN;
  if (isNaN(ms)) return null;
  const t = Math.max(0, Math.floor(ms / 60000));
  const d = Math.floor(t / 1440), h = Math.floor(t % 1440 / 60), m = t % 60;
  const text = ms <= 0 ? 'closed' : d ? `${d} d ${h} h` : h ? `${h} h ${m} m` : `${m} m`;
  return { ms, d, h, m, text, past: ms <= 0, urgent: ms > 0 && ms < DAY };
}

export const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

// FNV-1a, base36: short content fingerprints (ICS SEQUENCE, "what changed" keys).
export const h32 = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193); return (h >>> 0).toString(36); };

/* ---------------------------------------------------------------- events, agenda, clashes */
const NOTIME = { start: '', end: '' };
// Deadlines (every company) plus tests and interviews: the feed's date, replaced per company + kind by pasted
// schedule rows, replaced per role by dates you entered. mine = one of your roles is applied..offer.
export function events(feed, apps = {}, sheet = {}) {
  const out = [], sched = sheet.sched || [], short = sheet.short || [];
  for (const c of feed.companies || []) {
    const my = c.roles.filter(r => MINE.includes(statusOf(apps, c, r)));
    const add = (kind, date, tm, x = {}) => {
      if (!/^\d{4}-\d\d-\d\d$/.test(date || '')) return;
      const sl = short.find(s => s.slug === c.slug && s.what === kind);
      out.push(Object.assign({ slug: c.slug, company: c.company, task: c.kind === 'task', mine: my.length > 0, kind, date,
        start: tm.start || '', end: tm.end || '', title: '', mode: '', tentative: false, src: 'feed', short: sl ? (sl.me ? 'yes' : 'no') : '' }, x));
    };
    const ms = Date.parse(c.deadline);
    if (!isNaN(ms)) add('deadline', istDate(ms), { start: istTime(ms) }, { iso: c.deadline });
    for (const kind of ['test', 'interview']) {
      const f = c[kind], own = my.filter(r => (apps[keyOf(c, r)] || {})[kind + '_date']), rows = sched.filter(x => x.slug === c.slug && x.kind === kind);
      if (own.length) for (const r of own) {
        const s = apps[keyOf(c, r)];
        add(kind, s[kind + '_date'], parseTimeRange(s[kind + '_time']) || NOTIME, { title: r.title, mode: f && f.mode || '', src: 'you' });
      }
      else if (rows.length) for (const x of rows) add(kind, x.date, x, { mode: x.mode || '', tentative: !!x.tentative, src: 'sheet' });
      else if (f) add(kind, f.date, parseTimeRange(f.time) || NOTIME, { mode: f.mode || '', tentative: !f.confirmed });
    }
  }
  const n = {};
  return out.map(e => {
    const id = `${e.slug}-${e.kind}${e.title ? '-' + e.title : ''}`.replace(/[^\w-]/g, '');
    n[id] = (n[id] || 0) + 1;
    return Object.assign(e, { uid: id + (n[id] > 1 ? '-' + n[id] : ''), when: istMs(e.date, e.start) });
  }).sort((a, b) => a.when - b.when || (a.company < b.company ? -1 : 1));
}

// Today (IST) plus the next `days` days.
export const agenda = (evs, nowMs, days = 7) => {
  const from = istMs(istDate(nowMs)), to = from + (days + 1) * DAY;
  return evs.filter(e => e.when >= from && e.when < to);
};

// Pairs of your upcoming tests/interviews (different companies) that overlap. No time = the whole day, no end = 1 h.
export function clashes(evs, nowMs) {
  const span = e => { const a = istMs(e.date, e.start); return [a, e.start ? (e.end > e.start ? istMs(e.date, e.end) : a + 3600000) : a + DAY]; };
  const xs = evs.filter(e => e.mine && e.kind !== 'deadline' && e.short !== 'no').map(e => [e, span(e)]).filter(x => x[1][1] > nowMs), out = [];
  for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) {
    const [a, p] = xs[i], [b, q] = xs[j];
    if (a.slug !== b.slug && p[0] < q[1] && q[0] < p[1]) out.push([a, b]);
  }
  return out;
}

/* ---------------------------------------------------------------- calendar export */
const icsEsc = s => String(s).replace(/[\\;,]/g, '\\$&').replace(/\r?\n/g, '\\n');
// ponytail: folds by characters, not octets; fine for ASCII titles, long non-ASCII lines may exceed 75 octets.
const icsFold = l => l.length > 74 ? l.match(/.{1,74}/g).join('\r\n ') : l;
const compact = ms => istDate(ms).replace(/-/g, '') + 'T' + istTime(ms).replace(':', '') + '00';
const endMs = x => x.end > x.time ? istMs(x.date, x.end) : istMs(x.date, x.time) + (x.dur || 60) * 60000;

// items: {uid, date, time, end, dur (minutes, when no end), summary, desc, seq}. Alarms 1 day and 1 hour before.
export function buildIcs(items, stampMs = Date.now()) {
  const stamp = new Date(stampMs).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//placement-hq//calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VTIMEZONE', 'TZID:Asia/Kolkata', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0530',
    'TZOFFSETTO:+0530', 'TZNAME:IST', 'END:STANDARD', 'END:VTIMEZONE'];
  for (const x of items) {
    L.push('BEGIN:VEVENT', `UID:${x.uid}@placement-hq`, 'DTSTAMP:' + stamp, 'SEQUENCE:' + (x.seq || 0));
    if (x.time) L.push('DTSTART;TZID=Asia/Kolkata:' + compact(istMs(x.date, x.time)), 'DTEND;TZID=Asia/Kolkata:' + compact(endMs(x)));
    else L.push('DTSTART;VALUE=DATE:' + x.date.replace(/-/g, ''), 'DTEND;VALUE=DATE:' + addDays(x.date, 1).replace(/-/g, ''));
    L.push('SUMMARY:' + icsEsc(x.summary));
    if (x.desc) L.push('DESCRIPTION:' + icsEsc(x.desc));
    for (const t of ['-P1D', '-PT1H']) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEsc(x.summary), 'TRIGGER:' + t, 'END:VALARM');
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(icsFold).join('\r\n') + '\r\n';
}

export const KIND = { deadline: 'Deadline', test: 'Test', interview: 'Interview' };
export const calItems = evs => evs.map(e => ({ uid: e.uid, date: e.date, time: e.start, end: e.end, dur: e.kind === 'deadline' ? 15 : 60,
  summary: `${KIND[e.kind]}: ${e.company}${e.title ? ' - ' + e.title : ''}${e.tentative ? ' (tentative)' : ''}`,
  desc: [e.kind === 'deadline' ? `Form closes ${e.start} IST` : '', e.mode, e.src === 'sheet' ? 'from the pasted OCCaP schedule' : e.src === 'you' ? 'date you entered' : '']
    .filter(Boolean).join(', ') }));

// SEQUENCE from the content hash: unchanged items keep their number, changed ones go up by one, so a
// re-import updates the event instead of duplicating it. prev/next: {uid: [hash, seq]}.
export function icsSeq(prev, items) {
  const seq = Object.assign({}, prev);
  const out = items.map(x => {
    const h = h32([x.date, x.time, x.end, x.summary, x.desc].join('|')), p = seq[x.uid];
    seq[x.uid] = p && p[0] === h ? p : [h, p ? p[1] + 1 : 0];
    return Object.assign({}, x, { seq: seq[x.uid][1] });
  });
  return { items: out, seq };
}

export function gcalUrl(x) {
  const d = x.date.replace(/-/g, '');
  const dates = x.time ? compact(istMs(x.date, x.time)) + '/' + compact(endMs(x)) : d + '/' + addDays(x.date, 1).replace(/-/g, '');
  return 'https://calendar.google.com/calendar/render?' + new URLSearchParams({ action: 'TEMPLATE', text: x.summary, dates, ctz: 'Asia/Kolkata', details: x.desc || '' });
}

export function toCsv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const cell = v => { v = v == null ? '' : String(v); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  return [cols, ...rows.map(r => cols.map(c => r[c]))].map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/* ---------------------------------------------------------------- pasted OCCaP sheet tabs */
const clean = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

// Quoted cells may hold the separator, "" and newlines. Tab-separated when the text has any tab, else CSV.
export function parseDelim(text) {
  const t = String(text || '').replace(/\r\n?/g, '\n'), sep = t.includes('\t') ? '\t' : ',';
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch !== '"') cell += ch; else if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; }
    else if (ch === '"' && !cell.trim()) { q = true; cell = ''; }
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// Header = first row with 2+ filled cells (title rows above it are dropped); empty rows and columns skipped.
export function parseSheet(text) {
  let rows = parseDelim(text).map(r => r.map(clean)).filter(r => r.some(Boolean));
  const h = rows.findIndex(r => r.filter(Boolean).length >= 2);
  rows = rows.slice(Math.max(0, h));
  if (!rows.length) return { headers: [], rows: [] };
  let head = rows.shift();
  // An unquoted two-line header pastes "Date" then a row of hints like "[MM/DD/YYYY]": merge them.
  if (rows[0] && rows[0].every(c => !c || /^\[.*\]$/.test(c))) { const h2 = rows.shift(); head = h2.map((c, i) => clean((head[i] || '') + ' ' + c)).concat(head.slice(h2.length)); }
  const w = Math.max(head.length, ...rows.map(r => r.length));
  const keep = [...Array(w).keys()].filter(i => head[i] || rows.some(r => r[i]));
  return { headers: keep.map(i => head[i] || 'Column ' + (i + 1)), rows: rows.map(r => keep.map(i => r[i] || '')) };
}

const COL_RE = { company: /company|organi[sz]ation|recruiter/i, name: /name|student/i, date: /date/i, time: /timing|time/i,
  mode: /mode/i, remarks: /remark|note|comment/i, sr: /\bsr\b|sr\s*no|srn/i };
export const colOf = (headers, kind) => headers.findIndex(x => COL_RE[kind].test(x) && !(kind === 'name' && /poc|company|coordinator/i.test(x)));

export function idMatcher(ids) {
  const xs = (ids || []).map(clean).filter(x => x.length >= 3);
  if (!xs.length) return () => false;
  const re = new RegExp('(^|[^a-z0-9])(' + xs.map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?![a-z0-9])', 'i');
  return cells => re.test(cells.join(' | '));
}

const CO_NOISE = /\b(research|labs?|technolog(y|ies)|india|pvt|private|ltd|limited|inc|corp(oration)?|services|solutions|semiconductor|the)\b/g;
const coNorm = s => String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(CO_NOISE, ' ').replace(/[^a-z0-9]/g, '');
// Feed companies a sheet name refers to: 'Inmobi' ~ 'InMobi', 'Fujitsu Research' ~ 'Fujitsu'. Exact after noise words, else prefix.
export function companyMatch(name, cos) {
  const n = coNorm(name);
  if (!n) return [];
  const exact = cos.filter(c => coNorm(c.company) === n);
  if (exact.length) return exact;
  return n.length < 3 ? [] : cos.filter(c => { const m = coNorm(c.company); return m.length >= 3 && (n.startsWith(m) || m.startsWith(n)); });
}

// '9/28/2026' (the sheet is MM/DD/YYYY) or '2026-09-28' -> '2026-09-28'; '' when unparsable (TBD etc.).
export function parseSheetDate(s) {
  const t = clean(s), iso = /^\d{4}-\d\d-\d\d/.exec(t), m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?!\d)/.exec(t);
  if (iso) return iso[0];
  if (!m || +m[1] > 12 || +m[2] > 31 || !+m[1] || !+m[2]) return '';
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}
// '07 00 AM - 08 00 AM', '4:00 PM to 6:00 PM', '14:00-16:00' -> {start: '07:00', end: '08:00'}; null without a time.
export function parseTimeRange(s) {
  const re = /(?<!\d)(\d{1,2})(?:(?:\s*[:.]\s*|\s)(\d{2}))?\s*([ap])\.?\s?m\b\.?|(?<!\d)(\d{1,2})[:.](\d{2})(?!\d)/gi, xs = [];
  let m;
  while (xs.length < 2 && (m = re.exec(String(s || '')))) {
    const h = +(m[1] || m[4]), mi = +(m[2] || m[5] || 0), ap = m[3] && m[3].toLowerCase();
    if (h > 23 || mi > 59) continue;
    xs.push({ h: ap ? h % 12 + (ap === 'p' ? 12 : 0) : h, mi, ap });
  }
  if (!xs.length) return null;
  const [a, b] = xs, f = x => String(x.h).padStart(2, '0') + ':' + String(x.mi).padStart(2, '0');
  if (b && !a.ap && b.ap === 'p' && a.h < 12 && a.h + 12 <= b.h) a.h += 12; // '4:00 - 6:00 PM'
  return { start: f(a), end: b ? f(b) : '' };
}

// {type: 'schedule'|'shortlist', what: 'test'|'interview'} from the tab name, else from the headers; null for other tabs.
export function sheetKind(name, headers) {
  const n = String(name || '').toLowerCase(), h = headers || [], has = k => colOf(h, k) >= 0;
  const type = /shortlist/.test(n) ? 'shortlist' : /schedule/.test(n) ? 'schedule'
    : has('company') && has('date') && has('time') ? 'schedule' : has('name') || has('sr') ? 'shortlist' : '';
  return type ? { type, what: /interview/.test(n) ? 'interview' : /test/.test(n) ? 'test' : /interview/i.test(h.join(' ')) ? 'interview' : 'test' } : null;
}
// A tab without a Company column names its company: "Qualcomm test shortlist".
const tabCompanies = (tab, cos) => companyMatch(String(tab).replace(/short-?list(ed)?|schedule|\bfor\b|tests?|interviews?|slot\s*\d*/gi, ' '), cos);
const TENT_RE = /tentative|\btbc\b|to be confirmed|subject to change/i;

// One pasted tab -> only what may be kept: schedule rows (company, date, time, mode; no student data), or for a
// shortlist the companies it covers (all) and those where one of your identifiers appears (me). Rows are dropped.
export function analyzeTab(tab, text, companies, ids) {
  const sh = parseSheet(text), kind = sheetKind(tab, sh.headers), cos = (companies || []).filter(c => c.kind !== 'task');
  const out = { kind, rows: sh.rows.length, sched: [], me: [], all: [] };
  if (!kind) return out;
  const cc = colOf(sh.headers, 'company'), byTab = cc < 0 ? tabCompanies(tab, cos) : null, g = (r, i) => i >= 0 ? r[i] || '' : '';
  if (kind.type === 'schedule') {
    const dc = colOf(sh.headers, 'date'), tc = colOf(sh.headers, 'time'), mc = colOf(sh.headers, 'mode'), rc = colOf(sh.headers, 'remarks');
    for (const r of sh.rows) {
      const date = parseSheetDate(g(r, dc)), tm = parseTimeRange(g(r, tc)) || NOTIME;
      if (date) for (const c of byTab || companyMatch(r[cc], cos))
        out.sched.push({ kind: kind.what, slug: c.slug, date, start: tm.start, end: tm.end, mode: g(r, mc), tentative: TENT_RE.test(g(r, rc)) });
    }
    out.sched.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  } else {
    const hit = idMatcher(ids), me = new Set(), all = new Set();
    for (const r of sh.rows) for (const c of byTab || companyMatch(r[cc], cos)) { all.add(c.slug); if (hit(r)) me.add(c.slug); }
    out.me = [...me]; out.all = [...all];
  }
  return out;
}

// What a shortlist proposes (forward only, nothing written here): roles you marked (else the company's only role)
// move to shortlisted / interview_scheduled, with the interview date from your schedule rows or the feed.
// none: on the list but several roles and none marked; absent: covered companies you applied to, without you.
export function autoChanges(apps, companies, res, sched = []) {
  const what = res.kind && res.kind.what, target = what === 'interview' ? 'interview_scheduled' : 'shortlisted', ti = STATUSES.indexOf(target);
  const out = { changes: [], none: [], absent: [] };
  if (!res.kind || res.kind.type !== 'shortlist') return out;
  for (const c of companies) {
    if (!res.me.includes(c.slug)) {
      if (res.all.includes(c.slug) && c.roles.some(r => MINE.includes(statusOf(apps, c, r)))) out.absent.push(c.company);
      continue;
    }
    const xs = c.roles.map(r => ({ r, s: apps[keyOf(c, r)] || {} })), st = x => x.s.status || 'not_applied';
    let pick = xs.filter(x => st(x) !== 'not_applied');
    if (!pick.length && xs.length === 1) pick = xs;
    if (!pick.length) { out.none.push(c.company); continue; }
    for (const { r, s } of pick.filter(x => !CLOSED.includes(st(x)) && STATUSES.indexOf(st(x)) < ti)) {
      const to = { status: target };
      if (target === 'interview_scheduled' && !s.interview_date) {
        const iv = sched.find(x => x.slug === c.slug && x.kind === 'interview') || c.interview;
        if (iv && iv.date) { to.interview_date = iv.date; if (iv.start && !s.interview_time) to.interview_time = iv.start; }
      }
      const from = {};
      for (const f of Object.keys(to)) from[f] = s[f] || (f === 'status' ? 'not_applied' : '');
      out.changes.push({ key: keyOf(c, r), label: c.company + ' - ' + r.title, from, to });
    }
  }
  return out;
}
// Patches that revert each field still holding the value a change set.
export const undoChanges = (apps, changes) => (changes || []).map(c => {
  const s = apps[c.key] || {}, patch = {};
  for (const f of Object.keys(c.to)) if ((s[f] || '') === c.to[f]) patch[f] = c.from[f];
  return { key: c.key, patch };
}).filter(x => Object.keys(x.patch).length);

/* ---------------------------------------------------------------- what changed in the feed */
const sigs = c => [c.slug, c.slug + '|d|' + (c.deadline || ''), c.slug + '|t|' + JSON.stringify(c.test || ''), c.slug + '|i|' + JSON.stringify(c.interview || '')];
export const feedKeys = feed => (feed.companies || []).flatMap(c => [...sigs(c), ...c.roles.map(r => keyOf(c, r))]).map(h32);
// Against the keys stored at your last visit: new entries, new roles, changed deadlines / tests / interviews.
export function feedChanges(keys, feed) {
  if (!keys || !keys.length) return [];
  const k = new Set(keys), has = s => k.has(h32(s)), out = [];
  for (const c of feed.companies || []) {
    const [n, d, t, i] = sigs(c), base = { slug: c.slug, company: c.company };
    if (!has(n)) { out.push(Object.assign({ what: 'new' }, base)); continue; }
    if (!has(d)) out.push(Object.assign({ what: 'deadline', to: c.deadline }, base));
    if (!has(t)) out.push(Object.assign({ what: 'test', to: c.test }, base));
    if (!has(i)) out.push(Object.assign({ what: 'interview', to: c.interview }, base));
    for (const r of c.roles) if (!has(keyOf(c, r))) out.push(Object.assign({ what: 'role', title: r.title }, base));
  }
  return out;
}

/* ---------------------------------------------------------------- personal state: records, merge */
// apps and dsa are maps of records; ids, cv, seen, sheet, ics are single records. Each record carries u (hybrid
// clock) and d (device id); tomb maps 'apps/<key>' or 'cv' to the u of its deletion.
export const MAPS = ['apps', 'dsa'], ONES = ['ids', 'cv', 'seen', 'sheet', 'ics'], TOMB_DAYS = 90;
export const emptyState = () => ({ apps: {}, dsa: {}, tomb: {} });
const newer = (x, y) => !y || !!x && (x.u > y.u || x.u === y.u && String(x.d) > String(y.d));
const recs = s => [...MAPS.flatMap(m => Object.values((s || {})[m] || {})), ...ONES.map(o => (s || {})[o]).filter(Boolean)];
export const maxU = s => Math.max(0, ...recs(s).map(r => r.u || 0), ...Object.values((s || {}).tomb || {}));
// Hybrid clock: wall time, but always past everything seen, so a device with a slow clock still wins once it has synced.
export const tick = (last, now = Date.now()) => Math.max(now, last + 1);

// Per-record last-writer-wins on u, device id breaks ties; a tombstone beats records not newer than it.
export function merge(a, b, now = Date.now()) {
  a = a || {}; b = b || {};
  const tomb = {}, cut = now - TOMB_DAYS * DAY;
  for (const t of [a.tomb, b.tomb]) for (const [k, u] of Object.entries(t || {})) if (u > cut && !(tomb[k] >= u)) tomb[k] = u;
  const pick = (k, x, y) => { const w = newer(x, y) ? x : y; return w && !(tomb[k] >= w.u) ? w : null; };
  const out = { tomb };
  for (const m of MAPS) {
    out[m] = {};
    for (const k of new Set([...Object.keys(a[m] || {}), ...Object.keys(b[m] || {})])) {
      const w = pick(m + '/' + k, (a[m] || {})[k], (b[m] || {})[k]);
      if (w) out[m][k] = w;
    }
  }
  for (const o of ONES) { const w = pick(o, a[o], b[o]); if (w) out[o] = w; }
  return out;
}

/* ---------------------------------------------------------------- DSA spaced repetition (1/3/7/21 days) */
// Reviews land 1, 3, 7 and 21 days after the solve when done on time; a late review pushes the rest back.
export const SRS = [1, 3, 7, 21];
export const srsDone = (it, today) => Object.assign({}, it, { status: 'done', done_on: today, rev_on: today, stage: 0, next_due: addDays(today, SRS[0]) });
export function srsReview(it, today, ok) {
  if (!ok) return Object.assign({}, it, { status: 'revisit', done_on: it.done_on || today, rev_on: today, stage: 0, next_due: addDays(today, SRS[0]) });
  const stage = (it.stage || 0) + 1;
  return Object.assign({}, it, { status: 'done', done_on: it.done_on || today, rev_on: today, stage,
    next_due: stage < SRS.length ? addDays(today, SRS[stage] - SRS[stage - 1]) : '' });
}
export const srsDue = (it, today) => !!(it && it.status && it.status !== 'todo' && it.next_due && it.next_due <= today);

// Consecutive active days ending today (or yesterday, so the streak survives until you log something today).
export function streak(activity, today) {
  const a = activity || {};
  let d = a[today] ? today : addDays(today, -1), n = 0;
  while (a[d]) { n++; d = addDays(d, -1); }
  return { n, today: !!a[today] };
}

/* ---------------------------------------------------------------- CV vs JD keyword match */
const STOP = new Set(('a an and are as at be been being but by can could do does for from has have having how if in into is it its ' +
  'may more most must no not of on or our out over per shall should so such than that the their them then there these they this ' +
  'those to under up us use used using via was we were what when where which while who will with within without would you your ' +
  'also able across etc well including include includes strong good great excellent solid deep ability skill skills experience ' +
  'experienced knowledge understanding familiarity proficiency proficient hands work working works team teams role roles ' +
  'candidate candidates required requirement requirements preferred plus year years least new other based related relevant key ' +
  'like one two three all any each both help looking join opportunity responsibilities responsible ensure various multiple ' +
  'e g ie eg per day days basic advanced nice engineer engineers project projects digital development develop build existing ' +
  'principles side site mode module senior manager designer product power collaborate solution solutions company business ' +
  'environment environments technology technologies features feature scripts').split(' ').map(w => stem(w)));
function stem(w) { return w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w; }
const meaningful = alt => alt.trim().split(' ').some(w => w && !STOP.has(w));
export const normText = s => ' ' + String(s || '').toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').trim().split(' ').map(stem).join(' ') + ' ';

// Known-skills dictionary: parentheticals dropped, "A / B" also matches A or B alone.
export function buildDict(terms) {
  const out = [], seen = new Set();
  for (const raw of terms || []) {
    const label = String(raw).replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim() || String(raw).trim();
    const whole = normText(label), words = whole.trim().split(' ').filter(Boolean);
    if (!words.length || words.length > 5 || !meaningful(whole)) continue;
    const alts = [whole];
    if (label.includes('/')) for (const p of label.split('/')) { const a = normText(p); if (meaningful(a) && !alts.includes(a)) alts.push(a); }
    const key = alts.join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, alts });
  }
  return out;
}

// JD keywords: dictionary hits (weight 2) plus frequent words the dictionary does not cover (weight 1).
export function atsKeywords(jd, dict, maxExtra = 12) {
  const t = normText(jd), out = [], used = new Set();
  for (const d of dict) {
    const a = d.alts.find(x => t.includes(x));
    if (!a || used.has(a)) continue;
    used.add(a);
    out.push({ term: d.label, alts: d.alts, w: 2 });
  }
  const covered = new Set([...used].flatMap(a => a.trim().split(' ')));
  const n = {};
  for (const w of t.trim().split(' ')) if (w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w) && !covered.has(w)) n[w] = (n[w] || 0) + 1;
  Object.keys(n).filter(w => n[w] >= 2).sort((a, b) => n[b] - n[a] || (a < b ? -1 : 1)).slice(0, maxExtra)
    .forEach(w => out.push({ term: w, alts: [' ' + w + ' '], w: 1 }));
  return out;
}

export function atsScore(kws, resumeText) {
  const t = normText(resumeText), hit = [], miss = [];
  let tot = 0, got = 0;
  for (const k of kws) {
    tot += k.w;
    if (k.alts.some(a => t.includes(a))) { got += k.w; hit.push(k); } else miss.push(k);
  }
  return { pct: tot ? Math.round(100 * got / tot) : 0, hit, miss };
}

// jds: [{id, label, kws}] -> best match first.
export const atsRank = (jds, text) => jds.map(j => Object.assign({ id: j.id, label: j.label }, atsScore(j.kws, text)))
  .sort((a, b) => b.pct - a.pct || b.hit.length - a.hit.length || (a.label < b.label ? -1 : 1));

/* ---------------------------------------------------------------- JD texts (feed.jd_docs: [{slug, company, file, text}]) */
// Docs of one company (or all) whose company, file name or text contain every word of q, in any case.
export function jdFilter(docs, q, slug) {
  const ws = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  return (docs || []).filter(d => (!slug || d.slug === slug) && (!ws.length || (h => ws.every(w => h.includes(w)))((d.company + ' ' + d.file + ' ' + d.text).toLowerCase())));
}
// [{slug, company, docs}], companies in order of first appearance.
export function jdGroups(docs) {
  const by = new Map();
  for (const d of docs || []) (by.get(d.slug) || by.set(d.slug, { slug: d.slug, company: d.company, docs: [] }).get(d.slug)).docs.push(d);
  return [...by.values()];
}
// Escaped text with http(s) URLs as links; trailing punctuation stays outside the link.
export const linkify = text => String(text || '').split(/(https?:\/\/[^\s<>"']+)/).map((s, i) => {
  if (!(i % 2)) return esc(s);
  const [, url, tail] = /^(.*?)([.,;:!?)\]]*)$/.exec(s);
  return `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>${esc(tail)}`;
}).join('');

/* ---------------------------------------------------------------- crypto (WebCrypto: browser and Node) */
const te = new TextEncoder(), td = new TextDecoder(), sub = () => globalThis.crypto.subtle;
export const rnd = n => globalThis.crypto.getRandomValues(new Uint8Array(n));
export const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
export function b64u(b) {
  b = new Uint8Array(b);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export const unb64u = s => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function b32(bytes) {
  let bits = 0, v = 0, s = '';
  for (const x of bytes) { v = v << 8 | x; bits += 8; while (bits >= 5) s += B32[v >>> (bits -= 5) & 31]; }
  return bits ? s + B32[v << (5 - bits) & 31] : s;
}
export function unb32(s) {
  let bits = 0, v = 0;
  const out = [];
  for (const ch of String(s).toUpperCase().replace(/[^A-Z2-7]/g, '')) { v = v << 5 | B32.indexOf(ch); bits += 5; if (bits >= 8) out.push(v >>> (bits -= 8) & 255); }
  return new Uint8Array(out);
}
export const groups = s => s.match(/.{1,4}/g).join('-');

const gz = (bytes, T) => new Response(new Blob([bytes]).stream().pipeThrough(new T('gzip'))).arrayBuffer().then(b => new Uint8Array(b));
export const hkdfKey = async (ikm, salt, info) => sub().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: te.encode(info) },
  await sub().importKey('raw', ikm, 'HKDF', false, ['deriveKey']), { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);

// JSON -> gzip -> AES-GCM-256 (12-byte random IV, optional associated data).
async function enc(key, obj, aad) {
  const iv = rnd(12), p = { name: 'AES-GCM', iv, additionalData: te.encode(aad ?? '') };
  return { iv, ct: new Uint8Array(await sub().encrypt(p, key,await gz(te.encode(JSON.stringify(obj)), CompressionStream))) };
}
async function dec(key, iv, ct, aad) {
  const p = { name: 'AES-GCM', iv, additionalData: te.encode(aad ?? '') };
  return JSON.parse(td.decode(await gz(new Uint8Array(await sub().decrypt(p, key, ct)), DecompressionStream)));
}

// Batch key: 16 random bytes, base64url, shared as #k=<key>. Feed file {v, salt, iv, ct, updated}; updated is bound as AAD.
export const newBatchKey = () => b64u(rnd(16));
const batchBytes = k => { let b; try { b = unb64u(k); } catch { b = []; } if (b.length !== 16) throw new Error('bad batch key'); return b; };
export async function sealFeed(batchKey, feed, updated = new Date().toISOString()) {
  const salt = rnd(16), { iv, ct } = await enc(await hkdfKey(batchBytes(batchKey), salt, 'hq-feed-v1'), feed, updated);
  return { v: 1, salt: b64u(salt), iv: b64u(iv), ct: b64u(ct), updated };
}
export async function openFeed(batchKey, f) {
  if (!f || f.v !== 1) throw new Error('unknown feed format');
  return dec(await hkdfKey(batchBytes(batchKey), unb64u(f.salt), 'hq-feed-v1'), unb64u(f.iv), unb64u(f.ct), f.updated);
}

// Sync code (16 random bytes) -> the AES-GCM key for the synced copy. GitHub never sees the code or the key.
export const syncKey = code => hkdfKey(code, new Uint8Array(0), 'hq-sync-key');
export async function seal(key, obj) {
  const { iv, ct } = await enc(key, obj), b = new Uint8Array(12 + ct.length);
  b.set(iv); b.set(ct, 12);
  return b64u(b);
}
export async function open(key, s) { const b = unb64u(s); return dec(key, b.subarray(0, 12), b.subarray(12)); }

// Backup file: passphrase -> PBKDF2-SHA256 (600k) -> AES-GCM.
const pbkdf = async (pass, salt, iter) => sub().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter },
  await sub().importKey('raw', te.encode(pass), 'PBKDF2', false, ['deriveKey']), { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
export async function wrapBackup(pass, obj, iter = 600000) {
  const salt = rnd(16), { iv, ct } = await enc(await pbkdf(pass, salt, iter), obj, 'hq-backup-v1');
  return { v: 1, app: 'placement-hq', kdf: 'PBKDF2-SHA256', iter, salt: b64u(salt), iv: b64u(iv), ct: b64u(ct) };
}
export async function unwrapBackup(pass, f) {
  if (!f || f.v !== 1 || f.app !== 'placement-hq') throw new Error('not a Placement HQ backup');
  return dec(await pbkdf(pass, unb64u(f.salt), f.iter), unb64u(f.iv), unb64u(f.ct), 'hq-backup-v1');
}

/* ---------------------------------------------------------------- sync: a secret gist in the student's own GitHub account */
// One file, hq.enc = seal(syncKey(code), state); neither its name nor the gist description says anything personal.
// The token is a classic personal access token with only the gist scope, kept on the device.
export const GIST_FILE = 'hq.enc';
const fail = (msg, x) => Object.assign(new Error(msg), x);

// A client for one token. Rate limited (403/429 with no requests left): every call fails until x-ratelimit-reset.
export function gistClient(token, fetch = globalThis.fetch, now = Date.now) {
  let hold = 0;
  async function call(path, method = 'GET', body, etag) {
    if (now() < hold) throw fail('GitHub rate limit reached', { status: 429, reset: hold });
    const headers = { accept: 'application/vnd.github+json', authorization: 'Bearer ' + token };
    if (body) headers['content-type'] = 'application/json';
    if (etag) headers['if-none-match'] = etag;
    const r = await fetch('https://api.github.com' + path, { method, headers, cache: 'no-store', body: body && JSON.stringify(body) });
    if (r.ok || r.status === 304) return r;
    if ((r.status === 403 || r.status === 429) && r.headers.get('x-ratelimit-remaining') === '0') hold = +r.headers.get('x-ratelimit-reset') * 1000;
    const reset = hold > now() ? hold : 0;
    throw fail(r.status === 401 ? 'GitHub did not accept the token' : r.status === 404 ? 'not found on GitHub' : reset ? 'GitHub rate limit reached' : 'GitHub answered ' + r.status, { status: r.status, reset });
  }
  const etagOf = r => r.headers.get('etag') || '';
  return {
    // Refuses a token that cannot write gists, or that can do more: a leaked broad token is worse.
    async check() {
      const sc = ((await call('/user')).headers.get('x-oauth-scopes') || '').split(',').map(s => s.trim()).filter(Boolean);
      if (!sc.includes('gist')) throw fail('this token cannot write gists: create a classic token with only the gist scope');
      const broad = sc.filter(s => /repo|admin|workflow|user/.test(s));
      if (broad.length) throw fail(`this token can also use ${broad.join(', ')}: create one with only the gist scope`);
    },
    async create(content) {
      const r = await call('/gists', 'POST', { public: false, description: 'Placement HQ sync (encrypted)', files: { [GIST_FILE]: { content } } });
      return { id: (await r.json()).id, etag: etagOf(r) };
    },
    // {content, etag}, or null when unchanged since etag (a 304 does not count against the rate limit).
    async get(id, etag) {
      const r = await call('/gists/' + id, 'GET', null, etag);
      if (r.status === 304) return null;
      const f = ((await r.json()).files || {})[GIST_FILE];
      if (!f) throw fail('this gist holds no Placement HQ data', { status: 404 });
      if (!f.truncated) return { content: f.content, etag: etagOf(r) };
      const raw = await fetch(f.raw_url); // over 1 MB; a secret gist's raw URL needs no token
      if (!raw.ok) throw fail('GitHub answered ' + raw.status, { status: raw.status });
      return { content: await raw.text(), etag: etagOf(r) };
    },
    patch: async (id, content) => etagOf(await call('/gists/' + id, 'PATCH', { files: { [GIST_FILE]: { content } } })),
    del: id => call('/gists/' + id, 'DELETE'),
  };
}

// Key order does not matter when comparing states.
const canon = x => JSON.stringify(x, (k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : 1)) : v);
// One round: pull (with the ETag), merge, and write back when the gist lacks something this device has (after a
// 304: when there are local changes). Gists have no compare-and-swap; merging on every pull makes devices converge.
export async function gistSync(gc, id, etag, key, state, dirty, now = Date.now()) {
  const got = await gc.get(id, etag);
  let remote = null;
  if (got) try { remote = await open(key, got.content); } catch { throw fail('the sync code does not open this gist'); }
  const merged = got ? merge(state, remote, now) : state, pulled = !!got;
  if (got ? canon(merged) === canon(remote) : !dirty) return { state: merged, etag: got ? got.etag : etag, pulled, pushed: false };
  return { state: merged, etag: await gc.patch(id, await seal(key, merged)), pulled, pushed: true };
}
