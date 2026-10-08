// node test.mjs  (no deps, fixed timestamps). HQ_FEED=<feed.json> adds checks against a real feed, which is never committed.
// node test.mjs --fix rewrites the CSP and SRI hashes in index.html after editing its CSS, app.js, core.js or vendor/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as A from './core.js';

const ROOT = dirname(fileURLToPath(import.meta.url)), rd = f => readFileSync(join(ROOT, f)), require = createRequire(import.meta.url);
const NOW = Date.parse('2026-09-23T09:00:00+05:30');
const sha = (alg, s) => alg + '-' + createHash(alg).update(s).digest('base64');
const STYLE = /<style>([\s\S]*?)<\/style>/, MAP = /<script type="importmap">([\s\S]*?)<\/script>/, CSP = /http-equiv="Content-Security-Policy" content="([^"]+)"/;
// The Azure copy of the site sends the same policy as a header, plus frame-ancestors (which a meta tag cannot set).
const swaCsp = csp => csp + "; frame-ancestors 'none'";
if (process.argv.includes('--fix')) {
  let html = rd('index.html').toString();
  html = html.replace(MAP, (_, m) => { const j = JSON.parse(m); for (const u of Object.keys(j.integrity)) j.integrity[u] = sha('sha384', rd(u)); return `<script type="importmap">${JSON.stringify(j)}</script>`; });
  html = html.replace(/(src="app\.js" integrity=")[^"]*/, '$1' + sha('sha384', rd('app.js')));
  html = html.replace(/script-src [^;]*/, `script-src 'self' '${sha('sha256', MAP.exec(html)[1])}'`).replace(/style-src [^;]*/, `style-src '${sha('sha256', STYLE.exec(html)[1])}'`);
  writeFileSync(join(ROOT, 'index.html'), html);
  const cfg = rd('staticwebapp.config.json').toString();
  writeFileSync(join(ROOT, 'staticwebapp.config.json'), cfg.replace(/("content-security-policy": )"[^"]*"/, (_, k) => k + JSON.stringify(swaCsp(CSP.exec(html)[1]))));
}

const FEED = { companies: [
  { slug: 'acme', company: 'Acme', kind: 'company', deadline: '2026-09-24T13:00:00+05:30', test: { date: '2026-09-28', time: '18:00-20:00', mode: 'Virtual', confirmed: true },
    interview: { date: '2026-10-05', mode: 'In person', confirmed: true }, roles: [{ title: 'HPC Eng', track: 'HPC' }, { title: 'Analog', track: 'HARDWARE' }] },
  { slug: 'late', company: 'Late Co', kind: 'company', deadline: null, test: { date: '2026-10-20', time: '', mode: '', confirmed: false }, interview: null, roles: [{ title: 'DS', track: 'DS' }] },
  { slug: 'qc', company: 'Qualcomm', kind: 'company', deadline: null, test: { date: '2026-09-28', time: '18:00-20:00', mode: 'Virtual', confirmed: true },
    interview: { date: '2026-10-05', mode: 'In Person', confirmed: true }, roles: [{ title: 'GPU', track: 'HPC' }, { title: 'RF', track: 'HARDWARE' }] },
  { slug: 'nv', company: 'NVIDIA', kind: 'company', deadline: null, test: { date: '2026-10-01', time: '14:00-16:00', mode: 'In-Person', confirmed: false },
    interview: { date: '2026-10-06', mode: '', confirmed: false }, roles: [{ title: 'SSE', track: 'HPC' }] },
  { slug: 'ti', company: 'Texas Instruments', kind: 'company', deadline: null, test: null, interview: null, roles: [{ title: 'Embedded', track: 'EMBEDDED' }, { title: 'DSP', track: 'EMBEDDED' }] },
  { slug: 'occap-form', company: 'OCCaP: fill the Qualcomm form', kind: 'task', deadline: '2026-09-23T18:00:00+05:30', test: null, interview: null, roles: [{ title: 'Submit', track: 'OTHER' }] },
] };
const clone = x => JSON.parse(JSON.stringify(x));

test('countdown', () => {
  let cd = A.countdown(NOW, '2026-09-24T13:00:00+05:30');
  assert.equal(cd.text, '1 d 4 h'); assert.equal(cd.urgent, false);
  cd = A.countdown(NOW, '2026-09-23T13:25:00+05:30');
  assert.equal(cd.text, '4 h 25 m'); assert.equal(cd.urgent, true);
  assert.equal(A.countdown(NOW, '2026-09-23T09:07:30+05:30').text, '7 m');
  cd = A.countdown(NOW, '2026-09-22T13:00:00+05:30');
  assert.equal(cd.text, 'closed'); assert.equal(cd.past, true); assert.equal(cd.urgent, false);
  assert.equal(A.countdown(NOW, null), null);
  assert.equal(A.countdown(NOW, 'garbage'), null);
});

test('addDays across month and year ends (IST)', () => {
  assert.equal(A.addDays('2026-09-30', 1), '2026-10-01');
  assert.equal(A.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(A.addDays('2026-10-01', -1), '2026-09-30');
});

test('events: feed dates, schedule rows per company, own dates per role; stable uids', () => {
  let evs = A.events(FEED, {});
  assert.deepEqual(A.agenda(evs, NOW).map(e => [e.kind, e.slug, e.date, e.start, e.end]), [
    ['deadline', 'occap-form', '2026-09-23', '18:00', ''], ['deadline', 'acme', '2026-09-24', '13:00', ''],
    ['test', 'acme', '2026-09-28', '18:00', '20:00'], ['test', 'qc', '2026-09-28', '18:00', '20:00']], 'today + 7 days');
  assert.ok(evs.every(e => !e.mine), 'nothing is mine yet');
  assert.equal(evs.find(e => e.slug === 'late').tentative, true, 'unconfirmed feed test is tentative');
  assert.equal(evs.find(e => e.slug === 'occap-form').task, true);
  assert.equal(new Set(evs.map(e => e.uid)).size, evs.length, 'unique uids');
  const apps = { 'acme::HPC Eng': { status: 'applied', test_date: '2026-09-29', test_time: '10:00 - 11:00' }, 'qc::GPU': { status: 'shortlisted' } };
  const sheet = { sched: [{ kind: 'test', slug: 'qc', date: '2026-09-29', start: '07:00', end: '08:00', mode: 'Online', tentative: true }], short: [{ what: 'test', slug: 'qc', me: true }] };
  evs = A.events(FEED, apps, sheet);
  const acme = evs.filter(e => e.slug === 'acme' && e.kind === 'test'), qc = evs.filter(e => e.slug === 'qc' && e.kind === 'test');
  assert.deepEqual(acme.map(e => [e.date, e.start, e.end, e.title, e.src, e.mine]), [['2026-09-29', '10:00', '11:00', 'HPC Eng', 'you', true]], 'your date replaces the feed date');
  assert.deepEqual(qc.map(e => [e.date, e.start, e.src, e.tentative, e.short]), [['2026-09-29', '07:00', 'sheet', true, 'yes']], 'pasted schedule replaces the feed per company + kind');
  assert.equal(A.events(FEED, {}).find(e => e.slug === 'acme' && e.kind === 'test').uid, acme[0].uid.replace('-HPCEng', ''), 'uid has no date in it');
  assert.equal(A.events(FEED, { 'acme::Analog': { status: 'rejected' } }).find(e => e.slug === 'acme').mine, false, 'closed roles are not mine');
});

test('clashes: overlapping tests/interviews of yours at different companies', () => {
  const apps = { 'acme::HPC Eng': { status: 'applied', test_date: '2026-09-29', test_time: '10:00 - 11:00' }, 'qc::GPU': { status: 'applied' }, 'nv::SSE': { status: 'withdrawn' } };
  const sheet = { sched: [{ kind: 'test', slug: 'qc', date: '2026-09-29', start: '10:30', end: '12:00', mode: '' }] };
  const evs = A.events(FEED, apps, sheet), cl = A.clashes(evs, NOW);
  assert.deepEqual(cl.map(([a, b]) => [a.slug, b.slug, a.kind, b.kind, a.date]), [['acme', 'qc', 'test', 'test', '2026-09-29'], ['acme', 'qc', 'interview', 'interview', '2026-10-05']],
    'timed overlap, and two all-day interviews on one day; withdrawn NVIDIA and deadlines ignored');
  assert.deepEqual(A.clashes(evs, Date.parse('2026-10-01T00:00:00+05:30')).length, 1, 'past items drop out');
  sheet.sched[0].start = '11:00';
  assert.equal(A.clashes(A.events(FEED, apps, sheet), NOW).filter(([a]) => a.kind === 'test').length, 0, 'back-to-back is not a clash');
  assert.equal(A.clashes(A.events(FEED, apps, { short: [{ what: 'interview', slug: 'qc', me: false }] }), NOW).length, 0, 'not shortlisted: no clash');
});

test('ICS: alarms, stable UID, SEQUENCE from content, folding, escaping', () => {
  const evs = A.events(FEED, {});
  const { items, seq } = A.icsSeq({}, A.calItems(evs));
  const ics = A.buildIcs(items, Date.parse('2026-09-23T03:30:00Z'));
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(ics.includes('TZID:Asia/Kolkata\r\n'));
  assert.ok(ics.includes('DTSTART;TZID=Asia/Kolkata:20260924T130000\r\nDTEND;TZID=Asia/Kolkata:20260924T131500\r\n'), 'deadline: 15 minutes');
  assert.ok(ics.includes('DTSTART;TZID=Asia/Kolkata:20260928T180000\r\nDTEND;TZID=Asia/Kolkata:20260928T200000\r\n'));
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20261005\r\nDTEND;VALUE=DATE:20261006\r\n'), 'all-day interview');
  assert.ok(ics.includes('DTSTAMP:20260923T033000Z\r\n'));
  const n = ics.split('BEGIN:VEVENT').length - 1;
  assert.equal(n, evs.length); assert.equal(ics.split('END:VEVENT').length - 1, n);
  assert.equal(ics.split('TRIGGER:-P1D\r\n').length - 1, n); assert.equal(ics.split('TRIGGER:-PT1H\r\n').length - 1, n);
  assert.equal(ics.split('SEQUENCE:0\r\n').length - 1, n, 'first export: SEQUENCE 0');
  assert.ok(ics.includes('UID:acme-test@placement-hq\r\n'));
  assert.ok(ics.split('\r\n').every(l => l.length <= 75), 'lines folded');
  assert.ok(A.buildIcs([{ uid: 'u', date: '2026-09-24', time: '', summary: 'a,b;c\nd' }], 0).includes('SUMMARY:a\\,b\\;c\\nd'));
  // re-export: unchanged items keep their SEQUENCE; a moved test gets SEQUENCE 1 under the same UID
  const again = A.icsSeq(seq, A.calItems(evs));
  assert.deepEqual(again.seq, seq);
  const moved = clone(FEED); moved.companies[0].test.date = '2026-09-30';
  const m = A.icsSeq(seq, A.calItems(A.events(moved, {})));
  assert.deepEqual(m.items.filter(x => x.seq).map(x => [x.uid, x.seq, x.date]), [['acme-test', 1, '2026-09-30']]);
  assert.equal(A.icsSeq(m.seq, A.calItems(A.events(moved, {}))).items.find(x => x.uid === 'acme-test').seq, 1, 'stable after the bump');
});

test('Google Calendar template links', () => {
  const it = A.calItems(A.events(FEED, {}));
  const q = uid => new URL(A.gcalUrl(it.find(x => x.uid === uid))).searchParams;
  assert.equal(q('acme-test').get('dates'), '20260928T180000/20260928T200000');
  assert.equal(q('acme-test').get('ctz'), 'Asia/Kolkata');
  assert.equal(q('acme-test').get('action'), 'TEMPLATE');
  assert.equal(q('acme-test').get('text'), 'Test: Acme');
  assert.equal(q('acme-interview').get('dates'), '20261005/20261006');
  assert.equal(q('acme-deadline').get('dates'), '20260924T130000/20260924T131500');
  assert.equal(new URL(A.gcalUrl({ date: '2026-09-28', time: '23:30', end: '', summary: 'x' })).searchParams.get('dates'), '20260928T233000/20260929T003000', 'crosses midnight');
});

test('CSV', () => {
  assert.equal(A.toCsv([{ a: 'x', b: 'he said "hi", ok' }, { a: null, b: 'l1\nl2' }]), 'a,b\r\nx,"he said ""hi"", ok"\r\n,"l1\nl2"\r\n');
  assert.equal(A.toCsv([]), '');
});

const CSV = 'S No,Student Name,Department,Company\r\n1,Asha Rao,Computational and Data Sciences,Fujitsu Research\r\n2,X Y,CDS,Fujitsu Research\r\n3,Z W,EE,Fujitsu Research\r\n';
test('sheet parsing: TSV/CSV, header detection, columns, identifiers, company names', () => {
  const tsv = 'Class 2027 updates\t\t\n\t\t\t\nSNo\tOCCaP Primary POC\t\tCompany\t"Date \n[MM/DD/YYYY]"\tTimings\tRemarks\n1\tA B\t\t Qualcomm \t10/01/2026\t10:00 - 11:00\t"say ""hi""\tthere"\n\n2\tC D\t\tInmobi\t10/02/2026\t14:00\t\n';
  assert.deepEqual(A.parseDelim('a,"b,c"\n"x\ny",2').map(r => r.length), [2, 2]);
  assert.equal(A.parseDelim('a,"x\ny"')[0][1], 'x\ny');
  const sh = A.parseSheet(tsv);
  assert.deepEqual(sh.headers, ['SNo', 'OCCaP Primary POC', 'Company', 'Date [MM/DD/YYYY]', 'Timings', 'Remarks'], 'title row, empty row and column dropped; multiline header merged');
  assert.equal(sh.rows.length, 2);
  assert.deepEqual(sh.rows[0], ['1', 'A B', 'Qualcomm', '10/01/2026', '10:00 - 11:00', 'say "hi" there']);
  assert.deepEqual(A.parseSheet('SNo\tCompany\tDate\n\t\t[MM/DD/YYYY]\n1\tHP\t10/03/2026').headers, ['SNo', 'Company', 'Date [MM/DD/YYYY]'], 'unquoted two-line header merged');
  const csv = A.parseSheet(CSV);
  assert.equal(A.colOf(csv.headers, 'company'), 3);
  assert.equal(A.colOf(csv.headers, 'name'), 1);
  assert.equal(A.colOf(sh.headers, 'name'), -1, 'POC column is not a student name');
  const hit = A.idMatcher(['asha rao']);
  assert.deepEqual(csv.rows.map(hit), [true, false, false], 'case-insensitive');
  const sr = A.parseSheet('Name,SR\nA,00-11-22-3-12345\nB,112345\n');
  assert.deepEqual(sr.rows.map(A.idMatcher(['12345'])), [true, false], 'whole-token id match');
  assert.deepEqual(sr.rows.map(A.idMatcher(['ab', ''])), [false, false], 'ids under 3 characters ignored');
  const cos = [{ company: 'InMobi' }, { company: 'Fujitsu' }, { company: 'Lam Research' }, { company: 'Samsung Semiconductor India' }, { company: 'HP' }, { company: 'Capital One' }];
  const cm = n => A.companyMatch(n, cos).map(c => c.company);
  assert.deepEqual(cm('Inmobi'), ['InMobi']);
  assert.deepEqual(cm('Fujitsu Research'), ['Fujitsu']);
  assert.deepEqual(cm('Fujitsu Research India Pvt. Ltd.'), ['Fujitsu']);
  assert.deepEqual(cm('Samsung (SSIR)'), ['Samsung Semiconductor India']);
  assert.deepEqual(cm('Lam'), ['Lam Research']);
  assert.deepEqual(cm('HP Inc'), ['HP']);
  assert.deepEqual(cm('Qualcomm'), []);
});

test('sheet dates, time ranges and tab kinds', () => {
  assert.equal(A.parseSheetDate('9/28/2026'), '2026-09-28');
  assert.equal(A.parseSheetDate(' 10/01/2026 '), '2026-10-01');
  assert.equal(A.parseSheetDate('2026-10-05'), '2026-10-05');
  assert.equal(A.parseSheetDate('TBD'), '');
  assert.equal(A.parseSheetDate('13/01/2026'), '', 'month 13 rejected');
  const tr = s => { const x = A.parseTimeRange(s); return x && x.start + '-' + x.end; };
  assert.equal(tr('07 00 AM - 08 00 AM'), '07:00-08:00');
  assert.equal(tr('4:00 PM to 6:00 PM'), '16:00-18:00');
  assert.equal(tr('12 00 PM - 01 00 PM'), '12:00-13:00');
  assert.equal(tr('11:30 AM - 1:00 PM'), '11:30-13:00');
  assert.equal(tr('4:00 - 6:00 PM'), '16:00-18:00', 'start takes the end meridiem');
  assert.equal(tr('14:00-16:00'), '14:00-16:00');
  assert.equal(tr('15:00-16:00 (also 2 Oct 16:00-18:00)'), '15:00-16:00', 'first range only');
  assert.equal(tr('10 AM'), '10:00-');
  assert.equal(A.parseTimeRange('TBD'), null);
  const SCH = ['S.No', 'Company', 'Date [MM/DD/YYYY]', 'Timings', 'Mode', 'Venue', 'Remarks'];
  assert.deepEqual(A.sheetKind('Test schedule', SCH), { type: 'schedule', what: 'test' });
  assert.deepEqual(A.sheetKind('Interview schedule', SCH), { type: 'schedule', what: 'interview' });
  assert.deepEqual(A.sheetKind('Shortlist for Test', ['S No', 'Student Name', 'Company']), { type: 'shortlist', what: 'test' });
  assert.deepEqual(A.sheetKind('Shortlist for Interviews', ['S No', 'Student Name', 'Company']), { type: 'shortlist', what: 'interview' });
  assert.deepEqual(A.sheetKind('Slot 1 tests', SCH), { type: 'schedule', what: 'test' }, 'type from headers');
  assert.deepEqual(A.sheetKind('', ['SR No', 'Company']), { type: 'shortlist', what: 'test' }, 'SR column = shortlist');
  assert.equal(A.sheetKind('Notes', ['Company', 'CTC']), null);
});

test('analyzeTab keeps only schedule rows or your own matches; nothing about other students', () => {
  const sch = A.analyzeTab('Test schedule', 'S.No\tCompany\tDate [MM/DD/YYYY]\tTimings\tMode\tVenue\tRemarks\n1\tQualcomm\t9/29/2026\t07 00 AM - 08 00 AM\tOnline\tLab 2\tTentative\n2\tIBM\t9/28/2026\t4:00 PM\tOnline\t\t\n3\tQualcomm\t9/30/2026\t4:00 PM to 6:00 PM\tOnline\tCDS lab\t\n', FEED.companies, []);
  assert.deepEqual(sch.kind, { type: 'schedule', what: 'test' });
  assert.deepEqual(sch.sched, [{ kind: 'test', slug: 'qc', date: '2026-09-29', start: '07:00', end: '08:00', mode: 'Online', tentative: true },
    { kind: 'test', slug: 'qc', date: '2026-09-30', start: '16:00', end: '18:00', mode: 'Online', tentative: false }], 'IBM is not in the feed; venue not kept');
  const sl = A.analyzeTab('Shortlist for Test', 'S No,Student Name,Email,Company\n1,Asha Rao,asha@example.org,Qualcomm\n2,X Y,xy@example.org,Qualcomm\n3,Z W,zw@example.org,NVIDIA\n', FEED.companies, ['Asha Rao']);
  assert.deepEqual([sl.me, sl.all.sort()], [['qc'], ['nv', 'qc']]);
  const s = JSON.stringify(sl);
  assert.ok(!/X Y|Z W|example\.org|Asha/.test(s), 'no names or emails in the result');
  assert.deepEqual(A.analyzeTab('', 'Company,CTC\nQualcomm,1\n', FEED.companies, []).kind, null);
  assert.deepEqual(A.analyzeTab('Shortlist for Test', 'Name,Company\nAsha Rao,OCCaP\n', FEED.companies, ['Asha Rao']).me, [], 'tasks never match a sheet company');
  assert.deepEqual(A.analyzeTab('NVIDIA test shortlist', 'Name,SR No\nA B,1\n', FEED.companies, ['Asha Rao']).all, ['nv'], 'company from the tab name');
});

test('autoChanges: forward-only status proposals and undo', () => {
  const apps = { 'qc::GPU': { status: 'applied' }, 'nv::SSE': { status: 'applied' } };
  const tab = 'S No,Student Name,Company\n1,Asha Rao,Qualcomm\n2,X Y,Qualcomm\n3,Z W,NVIDIA\n4,Asha Rao,Texas Instruments\n5,Asha Rao,Late Co\n';
  let res = A.analyzeTab('Shortlist for Test', tab, FEED.companies, ['Asha Rao']), ac = A.autoChanges(apps, FEED.companies, res);
  assert.deepEqual(ac.changes, [
    { key: 'late::DS', label: 'Late Co - DS', from: { status: 'not_applied' }, to: { status: 'shortlisted' } },
    { key: 'qc::GPU', label: 'Qualcomm - GPU', from: { status: 'applied' }, to: { status: 'shortlisted' } }], 'marked role moves; a single-role company moves; RF untouched');
  assert.deepEqual(ac.none, ['Texas Instruments'], 'several roles, none marked: ask');
  assert.deepEqual(ac.absent, ['NVIDIA'], 'applied but not on the list: reported, no change');
  for (const c of ac.changes) apps[c.key] = Object.assign({}, apps[c.key], c.to);
  assert.equal(A.autoChanges(apps, FEED.companies, res).changes.length, 0, 're-import is a no-op (forward only)');
  res = A.analyzeTab('Shortlist for Interviews', 'Student Name,Company\nAsha Rao,Qualcomm\n', FEED.companies, ['Asha Rao']);
  const sched = [{ kind: 'interview', slug: 'qc', date: '2026-10-07', start: '09:00', end: '17:00', mode: '' }];
  ac = A.autoChanges(apps, FEED.companies, res, sched);
  assert.deepEqual(ac.changes.map(c => [c.key, c.to]), [['qc::GPU', { status: 'interview_scheduled', interview_date: '2026-10-07', interview_time: '09:00' }]]);
  assert.deepEqual(A.autoChanges(apps, FEED.companies, res).changes[0].to, { status: 'interview_scheduled', interview_date: '2026-10-05' }, 'feed interview date without a schedule row');
  for (const c of ac.changes) apps[c.key] = Object.assign({}, apps[c.key], c.to);
  apps['qc::GPU'].interview_time = '10:00'; // edited by hand afterwards: undo leaves it
  assert.deepEqual(A.undoChanges(apps, ac.changes), [{ key: 'qc::GPU', patch: { status: 'shortlisted', interview_date: '' } }]);
  assert.deepEqual(A.autoChanges(apps, FEED.companies, A.analyzeTab('x', 'Company,CTC\nQualcomm,1\n', FEED.companies, [])), { changes: [], none: [], absent: [] });
});

test('feed changes since the last visit', () => {
  const keys = A.feedKeys(FEED);
  assert.deepEqual(A.feedChanges(keys, FEED), []);
  assert.deepEqual(A.feedChanges([], FEED), [], 'first visit reports nothing');
  const f = clone(FEED);
  f.companies[0].deadline = '2026-09-25T13:00:00+05:30';
  f.companies[2].test.time = '19:00-21:00';
  f.companies[1].roles.push({ title: 'ML', track: 'AIML' });
  f.companies.push({ slug: 'zz', company: 'Zeta', kind: 'company', deadline: null, test: null, interview: null, roles: [{ title: 'SDE', track: 'SW' }] });
  assert.deepEqual(A.feedChanges(keys, f).map(c => [c.what, c.slug, c.title || '']), [['deadline', 'acme', ''], ['role', 'late', 'ML'], ['test', 'qc', ''], ['new', 'zz', '']]);
  assert.ok(keys.every(k => /^[0-9a-z]{1,7}$/.test(k)), 'stored as short hashes');
});

test('merge: last writer wins per record, device tie-break, tombstones, expiry', () => {
  const a = { apps: { x: { status: 'applied', u: 10, d: 'a' }, y: { status: 'offer', u: 5, d: 'a' } }, dsa: {}, ids: { names: ['A'], u: 3, d: 'a' }, tomb: {} };
  const b = { apps: { x: { status: 'offer', u: 20, d: 'b' } }, dsa: { 'Two Sum': { status: 'done', u: 7, d: 'b' } }, ids: { names: ['B'], u: 4, d: 'b' }, tomb: {} };
  const m = A.merge(a, b, NOW);
  assert.equal(m.apps.x.status, 'offer'); assert.equal(m.apps.y.status, 'offer'); assert.equal(m.dsa['Two Sum'].status, 'done'); assert.deepEqual(m.ids.names, ['B']);
  assert.deepEqual(A.merge(b, a, NOW), m, 'commutative');
  assert.deepEqual(A.merge(m, m, NOW), m, 'idempotent');
  const t1 = { apps: { x: { v: 1, u: 9, d: 'a' } } }, t2 = { apps: { x: { v: 2, u: 9, d: 'b' } } };
  assert.equal(A.merge(t1, t2, NOW).apps.x.v, 2); assert.equal(A.merge(t2, t1, NOW).apps.x.v, 2, 'same u: higher device id wins both ways');
  const U = NOW - 1000, del = { apps: {}, cv: undefined, tomb: { cv: U + 30, 'apps/x': U + 30 } };
  const old = { apps: { x: { u: U + 25, d: 'b' } }, cv: { text: 'cv', u: U + 25, d: 'b' } };
  const md = A.merge(old, del, NOW);
  assert.equal(md.cv, undefined); assert.equal(md.apps.x, undefined, 'deletion beats older records');
  assert.deepEqual(md.tomb, { cv: U + 30, 'apps/x': U + 30 }, 'tombstones travel');
  assert.deepEqual(A.merge(del, old, NOW), md, 'commutative with tombstones');
  const later = { cv: { text: 'new', u: U + 35, d: 'b' } };
  assert.equal(A.merge(del, later, NOW).cv.text, 'new', 'a record newer than its tombstone comes back');
  const day = 86400000, tt = { tomb: { gone: NOW - 91 * day, kept: NOW - 89 * day } };
  assert.deepEqual(A.merge(tt, {}, NOW).tomb, { kept: NOW - 89 * day }, 'tombstones expire after 90 days');
  assert.equal(A.maxU(md), U + 30, 'clock sees tombstones');
  assert.deepEqual(A.merge(null, undefined, NOW), { tomb: {}, apps: {}, dsa: {} });
});

test('hybrid clock: a device with a slow clock still wins after it has synced', () => {
  const T = NOW, slow = T - 3600000;
  const A1 = { apps: { k: { status: 'applied', u: A.tick(0, T), d: 'fast' } } };
  let B1 = A.merge({}, A1, T);
  const naive = { apps: { k: { status: 'offer', u: slow, d: 'slow' } } };
  assert.equal(A.merge(A1, naive, T).apps.k.status, 'applied', 'wall clock alone: the later edit loses');
  B1 = A.merge(B1, { apps: { k: { status: 'offer', u: A.tick(A.maxU(B1), slow), d: 'slow' } } }, T);
  assert.equal(A.merge(A1, B1, T).apps.k.status, 'offer', 'hybrid clock: the later edit wins');
  assert.equal(A.tick(100, 50), 101); assert.equal(A.tick(100, 500), 500);
});

test('DSA spaced repetition and streak', () => {
  let it = A.srsDone({ status: 'todo', done_on: '', stage: 0, next_due: '' }, '2026-09-24');
  assert.deepEqual([it.status, it.done_on, it.stage, it.next_due], ['done', '2026-09-24', 0, '2026-09-25']);
  const dues = [];
  for (let n = 0; n < 4; n++) { dues.push(it.next_due); it = A.srsReview(it, it.next_due, true); }
  assert.deepEqual(dues, ['2026-09-25', '2026-09-27', '2026-10-01', '2026-10-15']);
  assert.equal(it.next_due, '', 'mastered after the 21-day review');
  assert.equal(it.stage, 4); assert.equal(it.done_on, '2026-09-24', 'solve date kept'); assert.equal(it.rev_on, '2026-10-15');
  it = A.srsReview(A.srsDone({ status: 'todo' }, '2026-09-24'), '2026-09-30', true);
  assert.equal(it.next_due, '2026-10-02', 'a late review pushes the next gap from the day you reviewed');
  it = A.srsReview(it, '2026-10-02', false);
  assert.deepEqual([it.status, it.stage, it.next_due], ['revisit', 0, '2026-10-03']);
  it = A.srsReview(it, '2026-10-03', true);
  assert.deepEqual([it.status, it.stage, it.next_due], ['done', 1, '2026-10-05']);
  assert.equal(A.srsDue(it, '2026-10-04'), false); assert.equal(A.srsDue(it, '2026-10-05'), true); assert.equal(A.srsDue(it, '2026-10-09'), true, 'overdue stays due');
  assert.equal(A.srsDue({ status: 'todo', next_due: '2026-01-01' }, '2026-10-09'), false); assert.equal(A.srsDue(undefined, '2026-10-09'), false);
  const act = { '2026-09-20': 1, '2026-09-21': 2, '2026-09-22': 1 };
  assert.deepEqual(A.streak(act, '2026-09-22'), { n: 3, today: true });
  assert.deepEqual(A.streak(act, '2026-09-23'), { n: 3, today: false });
  assert.deepEqual(A.streak(act, '2026-09-24'), { n: 0, today: false });
  assert.deepEqual(A.streak(null, '2026-09-24'), { n: 0, today: false });
});

test('CV match: dictionary hits, frequent words, score, ranking', () => {
  assert.equal(A.normText('C++, CUDA/MPI & GPUs.'), ' c++ cuda mpi gpu ');
  const dict = A.buildDict(['C/C++', 'CUDA', 'MPI (OpenMPI, Intel MPI)', 'Python', 'Kubernetes', 'CUDA', 'experience', 'Nsight Systems / Nsight Compute']);
  assert.equal(dict.length, 6, 'duplicates and stopword-only terms dropped');
  assert.deepEqual(dict.find(d => d.label === 'MPI').alts, [' mpi ']);
  assert.deepEqual(dict.find(d => d.label === 'C/C++').alts, [' c c++ ', ' c ', ' c++ ']);
  const jd = 'We need C++ and CUDA experience with MPI. Kubernetes is a plus. You will write kernels: GPU kernels, fast kernels. Nsight Compute profiling.';
  const kws = A.atsKeywords(jd, dict);
  assert.deepEqual(kws.filter(k => k.w === 2).map(k => k.term).sort(), ['C/C++', 'CUDA', 'Kubernetes', 'MPI', 'Nsight Systems / Nsight Compute']);
  assert.ok(kws.some(k => k.term === 'kernel' && k.w === 1), 'frequent word "kernels" (x3) extracted, stemmed');
  assert.ok(!kws.some(k => k.term === 'gpu'), 'words seen once are not extras');
  let sc = A.atsScore(kws, 'Built C++ and CUDA kernels with MPI on 16 GPUs; profiled in Nsight Compute.');
  assert.deepEqual(sc.miss.map(k => k.term), ['Kubernetes']);
  assert.equal(sc.pct, Math.round(100 * 9 / 11));
  assert.equal(A.atsScore(kws, 'Python and Excel.').pct, 0);
  assert.deepEqual(A.atsScore([], 'anything'), { pct: 0, hit: [], miss: [] });
  const jds = [{ id: 'a::DS', label: 'A - DS', kws: A.atsKeywords('Python Kubernetes Python Kubernetes', dict) }, { id: 'b::HPC', label: 'B - HPC', kws }];
  assert.deepEqual(A.atsRank(jds, 'C++ CUDA MPI kernels Nsight Compute').map(r => r.id), ['b::HPC', 'a::DS']);
});

test('JD texts: search, company filter, grouping, escaped links', () => {
  const docs = [{ slug: 'acme', company: 'Acme', file: 'FT JD', text: 'C++ and CUDA in Bangalore' }, { slug: 'acme', company: 'Acme', file: 'JAF', text: 'CTC 20 LPA' },
    { slug: 'zed', company: 'Zed Labs', file: 'Data Scientist', text: 'Python, SQL. Pune.' }];
  const files = (q, slug) => A.jdFilter(docs, q, slug).map(d => d.file);
  assert.deepEqual(files(''), ['FT JD', 'JAF', 'Data Scientist'], 'no query: all, in order');
  assert.deepEqual(files('cuda'), ['FT JD'], 'text, any case');
  assert.deepEqual(files('jaf'), ['JAF'], 'file name');
  assert.deepEqual(files('ZED'), ['Data Scientist'], 'company');
  assert.deepEqual(files('  bangalore   c++ '), ['FT JD'], 'every word, anywhere in the doc');
  assert.deepEqual(files('cuda pune'), [], 'all words in one doc');
  assert.deepEqual(files('', 'zed'), ['Data Scientist'], 'one company');
  assert.deepEqual(files('cuda', 'zed'), []);
  assert.deepEqual(A.jdFilter(undefined, 'x'), [], 'older feed without jd_docs');
  assert.deepEqual(A.jdGroups(docs).map(g => [g.slug, g.company, g.docs.map(d => d.file)]), [['acme', 'Acme', ['FT JD', 'JAF']], ['zed', 'Zed Labs', ['Data Scientist']]]);
  assert.deepEqual(A.jdGroups([docs[2], docs[0], docs[1]]).map(g => g.slug), ['zed', 'acme'], 'companies in order of first appearance');
  assert.deepEqual(A.jdGroups(undefined), []);
  const a = u => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`;
  assert.equal(A.linkify('Apply at https://example.com/jobs?a=1&b=2. <b>Now</b>'), `Apply at ${a('https://example.com/jobs?a=1&amp;b=2')}. &lt;b&gt;Now&lt;/b&gt;`, 'text escaped, & in the link too');
  assert.equal(A.linkify('(see http://x.org/a), then\nnext'), `(see ${a('http://x.org/a')}), then\nnext`, 'trailing punctuation outside the link');
  assert.equal(A.linkify('https://a.b/"onmouseover=x'), `${a('https://a.b/')}&quot;onmouseover=x`, 'a quote ends the link');
  assert.equal(A.linkify('javascript:alert(1) ftp://x www.x.org'), 'javascript:alert(1) ftp://x www.x.org', 'only http(s) becomes a link');
  assert.equal(A.linkify(null), '');
});

test('crypto: feed round trip, wrong key, tampering', async () => {
  const k = A.newBatchKey();
  assert.match(k, /^[A-Za-z0-9_-]{22}$/);
  const f = await A.sealFeed(k, FEED, '2026-10-02T15:00:00.000Z');
  assert.deepEqual(Object.keys(f), ['v', 'salt', 'iv', 'ct', 'updated']);
  assert.ok(!JSON.stringify(f).includes('Acme'), 'ciphertext only');
  assert.deepEqual(await A.openFeed(k, f), FEED);
  await assert.rejects(A.openFeed(A.newBatchKey(), f), 'wrong key');
  await assert.rejects(A.openFeed(k, Object.assign({}, f, { updated: '2026-10-03T00:00:00.000Z' })), 'updated is authenticated');
  const ct = A.unb64u(f.ct); ct[5] ^= 1;
  await assert.rejects(A.openFeed(k, Object.assign({}, f, { ct: A.b64u(ct) })), 'tampered ciphertext');
  await assert.rejects(A.openFeed('short', f), /bad batch key/);
  await assert.rejects(A.openFeed(k, Object.assign({}, f, { v: 2 })), /unknown feed format/);
  const g = await A.sealFeed(k, FEED, f.updated);
  assert.notEqual(g.ct, f.ct, 'fresh salt and IV each time');
});

test('crypto: the sync key comes from the code alone', async () => {
  const code = A.rnd(16), blob = await A.seal(await A.syncKey(code), { apps: { x: 1 } });
  assert.deepEqual(await A.open(await A.syncKey(code.slice()), blob), { apps: { x: 1 } }, 'same code, same key');
  await assert.rejects(A.open(await A.syncKey(A.rnd(16)), blob), 'another code cannot read it');
  assert.match(blob, /^[A-Za-z0-9_-]+$/, 'base64url ciphertext only');
});

test('crypto: passphrase backup (PBKDF2 600k), base32 and base64url', async () => {
  const st = { apps: { 'acme::HPC Eng': { status: 'offer', u: 1, d: 'a' } }, dsa: {}, tomb: {} };
  const f = await A.wrapBackup('correct horse battery', st);
  assert.equal(f.iter, 600000); assert.equal(f.kdf, 'PBKDF2-SHA256');
  assert.deepEqual(await A.unwrapBackup('correct horse battery', f), st);
  await assert.rejects(A.unwrapBackup('wrong passphrase', f));
  await assert.rejects(A.unwrapBackup('x', { v: 1 }), /not a Placement HQ backup/);
  const code = A.rnd(16), s = A.b32(code);
  assert.match(s, /^[A-Z2-7]{26}$/);
  assert.deepEqual(A.unb32(A.groups(s).toLowerCase()), code, 'grouped, lower case still decodes');
  assert.deepEqual(A.unb32(A.b32(Uint8Array.of(0, 255, 16))), Uint8Array.of(0, 255, 16));
  const big = new Uint8Array(100000).map((_, i) => i * 7 + (i >> 8));
  assert.deepEqual(A.unb64u(A.b64u(big)), big, 'chunked base64url');
});

// A fake api.github.com with just what the gist client calls: /user scopes, gists with ETags and 304s, the
// truncation of large files (then served from raw_url), 401 for other tokens and a switchable rate limit.
function fakeGitHub({ scopes = 'gist', token = 'ghp_test' } = {}) {
  const gists = new Map(), raw = new Map(), gh = { calls: [], limited: 0, truncate: false };
  const res = (status, body, headers = {}) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
  const files = id => {
    const g = gists.get(id), raw_url = `https://gist.githubusercontent.com/someone/${id}/raw/${g.rev}/hq.enc`;
    raw.set(raw_url, g.content);
    return { 'hq.enc': gh.truncate ? { content: g.content.slice(0, 10), truncated: true, raw_url } : { content: g.content, truncated: false, raw_url } };
  };
  gh.fetch = async (url, o = {}) => {
    const m = o.method || 'GET', h = o.headers || {}, body = o.body && JSON.parse(o.body);
    gh.calls.push({ m, url, h, body });
    if (raw.has(url)) return new Response(raw.get(url));
    if (h.authorization !== 'Bearer ' + token) return res(401, { message: 'Bad credentials' });
    if (gh.limited) return res(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(gh.limited) });
    if (url === 'https://api.github.com/user') return res(200, { login: 'someone' }, { 'x-oauth-scopes': scopes });
    if (url === 'https://api.github.com/gists' && m === 'POST') {
      const id = 'g' + (gists.size + 1);
      gists.set(id, { rev: 1, content: body.files['hq.enc'].content });
      return res(201, { id, files: files(id) }, { etag: `"${id}-1"` });
    }
    const id = (/^https:\/\/api\.github\.com\/gists\/(\w+)$/.exec(url) || [])[1], g = gists.get(id);
    if (!g) return res(404, { message: 'Not Found' });
    if (m === 'DELETE') { gists.delete(id); return res(204); }
    if (m === 'PATCH') Object.assign(g, { rev: g.rev + 1, content: body.files['hq.enc'].content });
    const etag = `"${id}-${g.rev}"`;
    return m === 'GET' && h['if-none-match'] === etag ? res(304, undefined, { etag }) : res(200, { id, files: files(id) }, { etag });
  };
  return gh;
}

test('gist client: token scope check, create, pull 200/304, truncated file via raw_url, 401, 404', async () => {
  for (const [scopes, ok] of [['gist', true], ['gist, read:org', true], ['gist, repo', false], ['public_repo, gist', false], ['admin:org, gist', false],
    ['delete_repo, gist', false], ['gist, workflow', false], ['gist, user', false], ['repo', false], ['', false]]) {
    const p = A.gistClient('ghp_test', fakeGitHub({ scopes }).fetch).check();
    if (ok) await p; else await assert.rejects(p, 'refused: ' + scopes);
  }
  await assert.rejects(A.gistClient('ghp_test', fakeGitHub({ scopes: 'gist, repo' }).fetch).check(), /also use repo/, 'names the broad scope');
  await assert.rejects(A.gistClient('ghp_test', fakeGitHub({ scopes: '' }).fetch).check(), /only the gist scope/, 'fine-grained or scopeless token');
  await assert.rejects(A.gistClient('revoked', fakeGitHub().fetch).check(), e => e.status === 401);

  const gh = fakeGitHub(), gc = A.gistClient('ghp_test', gh.fetch), key = await A.syncKey(A.rnd(16));
  const st = { apps: { 'acme::HPC Eng': { status: 'offer', notes: 'private note', u: 1, d: 'a' } }, dsa: {}, tomb: {} };
  const { id, etag } = await gc.create(await A.seal(key, st)), post = gh.calls.at(-1);
  assert.deepEqual([post.m, post.body.public, post.body.description, Object.keys(post.body.files)], ['POST', false, 'Placement HQ sync (encrypted)', ['hq.enc']]);
  assert.ok(!/private|offer|acme/i.test(JSON.stringify(post.body)), 'only ciphertext goes to GitHub');
  assert.equal(post.h.authorization, 'Bearer ghp_test');
  const got = await gc.get(id, '');
  assert.deepEqual(await A.open(key, got.content), st); assert.equal(got.etag, etag);
  assert.equal(await gc.get(id, got.etag), null, '304: unchanged'); assert.equal(gh.calls.at(-1).h['if-none-match'], got.etag);
  gh.truncate = true;
  assert.deepEqual(await A.open(key, (await gc.get(id, '')).content), st, 'a truncated file is read from raw_url');
  assert.match(gh.calls.at(-1).url, /^https:\/\/gist\.githubusercontent\.com\//); assert.equal(gh.calls.at(-1).h.authorization, undefined, 'no token to the raw host');
  await assert.rejects(A.gistClient('revoked', gh.fetch).get(id, ''), e => e.status === 401 && /did not accept/.test(e.message));
  await gc.del(id);
  await assert.rejects(gc.get(id, etag), e => e.status === 404, 'deleted gist');
});

test('gist sync: pull, merge, push; concurrent edits converge; wrong code; rate-limit backoff', async () => {
  const gh = fakeGitHub(), key = await A.syncKey(A.rnd(16)), a = A.gistClient('ghp_test', gh.fetch), b = A.gistClient('ghp_test', gh.fetch);
  let sa = { apps: { x: { status: 'applied', u: 10, d: 'a' } }, dsa: {}, tomb: {} };
  let sb = { apps: { x: { status: 'offer', u: 5, d: 'b' }, y: { status: 'applied', u: 3, d: 'b' } }, dsa: {}, tomb: {} };
  const { id, etag } = await a.create(await A.seal(key, sa));
  let rb = await A.gistSync(b, id, '', key, sb, false, NOW);
  assert.deepEqual([rb.pulled, rb.pushed, rb.state.apps.x.status, rb.state.apps.y.status], [true, true, 'applied', 'applied'], 'join: older x loses; y is new to the gist, so b writes');
  let ra = await A.gistSync(a, id, etag, key, sa, false, NOW);
  assert.deepEqual([ra.pulled, ra.pushed, Object.keys(ra.state.apps).sort()], [true, false, ['x', 'y']], 'a gets y and has nothing new to write');
  [sa, sb] = [ra.state, rb.state];
  let n = gh.calls.length;
  ra = await A.gistSync(a, id, ra.etag, key, sa, false, NOW);
  assert.deepEqual([ra.pulled, ra.pushed, gh.calls.length - n], [false, false, 1], 'unchanged: one 304, no write');
  // both edit from the same ETag (gists have no compare-and-swap): a writes after its 304, b merges a's edit before writing
  sa = A.merge(sa, { apps: { y: { status: 'shortlisted', u: 20, d: 'a' } } }, NOW);
  sb = A.merge(sb, { apps: { z: { status: 'applied', u: 21, d: 'b' } } }, NOW);
  ra = await A.gistSync(a, id, ra.etag, key, sa, true, NOW);
  assert.deepEqual([ra.pulled, ra.pushed], [false, true]);
  rb = await A.gistSync(b, id, rb.etag, key, sb, true, NOW);
  assert.deepEqual([rb.pulled, rb.pushed, rb.state.apps.y.status, rb.state.apps.z.status], [true, true, 'shortlisted', 'applied']);
  ra = await A.gistSync(a, id, ra.etag, key, ra.state, false, NOW);
  assert.deepEqual(ra.state, rb.state, 'converged, nothing lost');
  await assert.rejects(A.gistSync(a, id, '', await A.syncKey(A.rnd(16)), sa, false, NOW), /sync code does not open this gist/);
  await assert.rejects(A.gistSync(A.gistClient('revoked', gh.fetch), id, '', key, sa, true, NOW), e => e.status === 401);
  await assert.rejects(A.gistSync(a, 'gone', '', key, sa, true, NOW), e => e.status === 404);
  // rate limit: every call fails until x-ratelimit-reset, without asking GitHub
  let now = NOW;
  const c = A.gistClient('ghp_test', gh.fetch, () => now), reset = Math.floor(NOW / 1000) + 600;
  gh.limited = reset;
  await assert.rejects(c.get(id, ''), e => e.status === 403 && e.reset === reset * 1000);
  gh.limited = 0; n = gh.calls.length;
  await assert.rejects(c.patch(id, 'x'), e => e.reset === reset * 1000, 'held');
  assert.equal(gh.calls.length, n, 'no request while held');
  now = reset * 1000;
  assert.ok(await c.get(id, ''), 'calls again from the reset time');
});

test('publish: privacy check required, *_raw stripped, leaks refused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hq-test-')), w = (f, s) => { writeFileSync(join(dir, f), s); return join(dir, f); };
  const ok = w('ok.cjs', 'process.exit(0)'), bad = w('bad.cjs', 'process.exit(1)'), key = A.newBatchKey(), out = join(dir, 'out.json');
  const feed = { companies: [Object.assign({ notes_raw: 'unreviewed text' }, FEED.companies[0])], jds: [], skills: [], dsa: [] };
  const src = w('in.json', JSON.stringify(feed));
  const run = (...a) => spawnSync(process.execPath, [join(ROOT, 'tools/publish.mjs'), '--key', key, '--out', out, ...a], { encoding: 'utf8' });
  assert.notEqual(run('--feed', src).status, 0, '--check is required'); assert.ok(!existsSync(out));
  assert.notEqual(run('--feed', src, '--check', bad).status, 0, 'a failing check stops it'); assert.ok(!existsSync(out));
  for (const text of ['write to someone@example.com', 'call +91 98450 00000', 'C:\\Users\\x\\cv.pdf', 'ring 9845000000']) {
    const r = run('--feed', w('leak.json', JSON.stringify(Object.assign({}, feed, { jds: [{ id: 'a', label: 'a', text }] }))), '--check', ok);
    assert.match(r.stderr, /looks private/, text); assert.ok(!existsSync(out));
  }
  const r = run('--feed', src, '--check', ok);
  assert.equal(r.status, 0, r.stderr);
  const dec = await A.openFeed(key, JSON.parse(readFileSync(out, 'utf8')));
  assert.equal(dec.companies[0].notes_raw, undefined, '*_raw dropped'); assert.equal(dec.companies[0].company, 'Acme');
});

test('index.html: CSP and SRI hashes match the files; nothing third-party; precache list exists', () => {
  const html = rd('index.html').toString(), csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
  assert.ok(csp.includes(`style-src '${sha('sha256', STYLE.exec(html)[1])}'`), 'style hash (run node test.mjs --fix)');
  assert.ok(csp.includes(`script-src 'self' '${sha('sha256', MAP.exec(html)[1])}'`), 'import map hash');
  for (const [u, h] of Object.entries(JSON.parse(MAP.exec(html)[1]).integrity)) assert.equal(h, sha('sha384', rd(u)), 'SRI ' + u);
  assert.equal(/src="app\.js" integrity="([^"]+)"/.exec(html)[1], sha('sha384', rd('app.js')), 'SRI app.js');
  assert.ok(csp.includes("connect-src 'self' https://api.github.com https://gist.githubusercontent.com;"), 'connects only to this origin and GitHub');
  assert.doesNotMatch(csp.replace(/connect-src [^;]*/, ''), /https?:|\*|unsafe/, 'otherwise only self, hashes, blob: and data:');
  assert.doesNotMatch(html, /<(script|link|img)[^>]+(src|href)="(https?:)?\/\//, 'no third-party scripts, styles, fonts or images');
  const man = JSON.parse(rd('manifest.webmanifest'));
  for (const i of man.icons) assert.ok(existsSync(join(ROOT, i.src)), i.src);
  const shell = JSON.parse(/SHELL = (\[[^\]]*\])/.exec(rd('sw.js').toString())[1].replace(/'/g, '"'));
  for (const f of shell) assert.ok(existsSync(join(ROOT, f === './' ? 'index.html' : f)), 'precache ' + f);
});

/* ---------------------------------------------------------------- My status: API, cards, service worker, config, tools */
const API = require('./api/shared/status.js');
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64');
const SKEY = Buffer.alloc(32, 7).toString('base64');
const who = (userDetails, identityProvider = 'aad') => ({ 'x-ms-client-principal': b64({ identityProvider, userId: 'u1', userDetails, userRoles: ['anonymous', 'authenticated'] }) });
const RECS = { v: 1, updated: '2026-10-09T10:00:00Z',
  students: {
    'student1@iisc.ac.in': [{ id: 'a1', kind: 'interview_shortlist', company: 'Acme', role: 'HPC Eng', list: 'Shortlist for Interview', position: 3, note: '', first_seen: '2026-10-09', internal: 'x' }],
    'student2@iisc.ac.in': [{ id: 'b1', kind: 'selected', company: 'Qualcomm', role: 'GPU', list: 'Selection Status', position: null, note: 'Blocked for Selected Company', first_seen: '2026-10-09' }] },
  lists: [{ stage: 'interview', company: 'Acme', role: 'HPC Eng', list: 'Shortlist for Interview' }],
  results: [{ company: 'Qualcomm', slot: 'Slot 1' }],
  schedule: [{ stage: 'interview', company: 'Acme', date: '2026-10-12', time: '10:00 AM - 12:00 PM', mode: 'In Person', venue: 'TBD', tentative: false, sheet: 'Slot 1 Interview Schedule' }] };

test('api: signed-in principal and the IISc rule', () => {
  const P = (e, p) => API.principal(who(e, p)['x-ms-client-principal']);
  assert.deepEqual(P(' Student1@IISc.ac.in '), { status: 200, email: 'student1@iisc.ac.in' }, 'trimmed, lower case');
  assert.equal(P('student1@iisc.ac.in', 'github').status, 403, 'GitHub sign-in refused');
  assert.equal(P('someone@outlook.com').status, 403, 'a personal Microsoft account is refused');
  assert.match(P('someone@outlook.com').error, /IISc Microsoft account/);
  for (const e of ['x@iisc.ac.in.evil.org', 'x@sub.iisc.ac.in', '@iisc.ac.in', 'x y@iisc.ac.in', '']) assert.equal(P(e).status, 403, e);
  assert.equal(API.principal(undefined).status, 401, 'no header');
  assert.equal(API.principal('').status, 401);
  assert.equal(API.principal('%%% not base64 json').status, 401);
});

test('api: AES-256-GCM records round trip; wrong key and tampering refused', () => {
  const f = API.seal(RECS, SKEY);
  assert.deepEqual(Object.keys(f), ['v', 'alg', 'iv', 'ct']);
  assert.ok(!/student|acme|iisc|qualcomm/i.test(JSON.stringify(f)), 'ciphertext only');
  assert.deepEqual(API.open(f, SKEY), RECS);
  assert.throws(() => API.open(f, Buffer.alloc(32, 8).toString('base64')), 'wrong key');
  const ct = Buffer.from(f.ct, 'base64'); ct[3] ^= 1;
  assert.throws(() => API.open(Object.assign({}, f, { ct: ct.toString('base64') }), SKEY), 'tampered');
  assert.throws(() => API.seal(RECS, Buffer.alloc(16).toString('base64')), /32 bytes/);
  assert.throws(() => API.open({ v: 2 }, SKEY), /not a status file/);
  assert.notEqual(API.seal(RECS, SKEY).iv, f.iv, 'fresh IV each time');
});

test('api: GET /api/status returns only the caller\'s entries; cache, stale copy, errors; no emails in logs', async () => {
  let t = 0, calls = 0, fail = false;
  const logs = [], file = API.seal(RECS, SKEY), log = m => logs.push(m);
  const fetch = async url => { calls++; assert.equal(url, API.STATUS_URL); return fail ? new Response('bad gateway', { status: 502 }) : new Response(JSON.stringify(file)); };
  const h = API.makeHandler({ env: { STATUS_KEY: SKEY }, fetch, now: () => t, log });
  let r = await h(who('Student1@iisc.ac.in'));
  assert.equal(r.status, 200); assert.equal(r.headers['cache-control'], 'no-store');
  const body = JSON.parse(r.body);
  assert.deepEqual(body.items, [{ id: 'a1', kind: 'interview_shortlist', company: 'Acme', role: 'HPC Eng', list: 'Shortlist for Interview', position: 3, note: '', first_seen: '2026-10-09' }], 'only the listed fields');
  assert.deepEqual([body.email, body.updated], ['student1@iisc.ac.in', '2026-10-09T10:00:00Z']);
  assert.ok(!/student2|Blocked|GPU/.test(r.body), 'nothing about anyone else');
  assert.deepEqual(body.results, [{ company: 'Qualcomm', slot: 'Slot 1' }], 'company-level facts only');
  assert.equal(body.schedule[0].sheet, undefined);
  assert.deepEqual(JSON.parse((await h(who('student3@iisc.ac.in'))).body).items, [], 'not on any list: no entries');
  assert.equal(calls, 1, 'decrypted copy reused for 5 minutes');
  t += API.TTL; fail = true;
  assert.equal((await h(who('student1@iisc.ac.in'))).status, 200, 'a stale copy beats an error'); assert.equal(calls, 2);
  r = await API.makeHandler({ env: { STATUS_KEY: SKEY }, fetch, now: () => t, log })(who('student1@iisc.ac.in'));
  assert.equal(r.status, 503); assert.match(JSON.parse(r.body).error, /Try again/);
  assert.equal((await API.makeHandler({ env: {}, fetch, log })(who('student1@iisc.ac.in'))).status, 503, 'no STATUS_KEY: not set up');
  r = await API.makeHandler({ env: { STATUS_KEY: Buffer.alloc(32, 9).toString('base64') }, fetch: async () => new Response(JSON.stringify(file)), log })(who('student1@iisc.ac.in'));
  assert.equal(r.status, 503, 'wrong key: generic error');
  assert.equal((await h({})).status, 401);
  assert.equal((await h(who('student1@outlook.com'))).status, 403);
  assert.equal((await h(who('student1@iisc.ac.in', 'github'))).status, 403);
  assert.ok(logs.length >= 3 && logs.every(l => !/@|student|acme/i.test(l)), 'logs carry no emails or records: ' + logs.join(' | '));
  const own = API.makeHandler({ env: { STATUS_KEY: SKEY, STATUS_URL: 'https://example.org/s' }, fetch: async u => { assert.equal(u, 'https://example.org/s'); return new Response(JSON.stringify(file)); } });
  assert.equal((await own(who('student1@iisc.ac.in'))).status, 200, 'STATUS_URL overrides the release asset');
  const fn = require('./api/status/index.js'), ctx = {};
  await fn(ctx, { headers: {} });
  assert.equal(ctx.res.status, 401, 'Functions v3 entry point wired to the handler');
  const fj = JSON.parse(rd('api/status/function.json')).bindings[0];
  assert.deepEqual([fj.type, fj.route, fj.methods], ['httpTrigger', 'status', ['get']]);
});

test('staticwebapp.config.json: Microsoft sign-in only, API for signed-in users, same CSP as index.html', () => {
  const cfg = JSON.parse(rd('staticwebapp.config.json')), csp = CSP.exec(rd('index.html').toString())[1], route = r => cfg.routes.find(x => x.route === r) || {};
  assert.deepEqual(route('/api/*').allowedRoles, ['authenticated']);
  assert.equal(cfg.routes[0].route, '/api/*', 'first rule');
  assert.equal(route('/.auth/login/github').statusCode, 404, 'GitHub sign-in blocked');
  assert.deepEqual([route('/login').redirect, route('/logout').redirect], ['/.auth/login/aad', '/.auth/logout']);
  assert.deepEqual(cfg.responseOverrides['401'], { statusCode: 302, redirect: '/.auth/login/aad?post_login_redirect_uri=.referrer' });
  assert.equal(cfg.globalHeaders['content-security-policy'], swaCsp(csp), 'header CSP = index.html CSP (run node test.mjs --fix)');
  assert.match(csp, /connect-src 'self'/, '/api and /.auth are same-origin');
  assert.ok(['/api/*', '/.auth/*'].every(x => cfg.navigationFallback.exclude.includes(x)));
  assert.equal(cfg.platform.apiRuntime, 'node:22');
  const swa = rd('.github/workflows/swa.yml').toString();
  assert.match(swa, /secrets\.AZURE_STATIC_WEB_APPS_API_TOKEN/); assert.match(swa, /if: needs\.gate\.outputs\.ready == 'true'/, 'skipped, not failed, without the secret');
  assert.match(swa, /api_location: api/); assert.match(swa, /sed -i "s\/const V = 'hq-dev'/, 'same cache-name rewrite as Pages');
  for (const f of ['.status-key', 'records.json', 'status.enc.json']) assert.ok(rd('.gitignore').toString().split(/\r?\n/).includes(f), '.gitignore: ' + f);
});

test('tools/status.mjs: refuses bad records, encrypts what the API opens, shows the key on request', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hq-st-')), w = (f, s) => { writeFileSync(join(dir, f), s); return join(dir, f); };
  const keyFile = join(dir, 'k'), out = join(dir, 'out.json');
  const run = (...a) => spawnSync(process.execPath, [join(ROOT, 'tools/status.mjs'), '--key-file', keyFile, ...a], { encoding: 'utf8' });
  let r = run('--records', w('ok.json', JSON.stringify(RECS)), '--out', out);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /2 students, 2 entries/);
  const key = readFileSync(keyFile, 'utf8').trim();
  assert.equal(Buffer.from(key, 'base64').length, 32, 'new 32-byte key, base64');
  assert.deepEqual(API.open(JSON.parse(readFileSync(out, 'utf8')), key), RECS, 'the API can open it');
  assert.equal(run('--show-key').stdout.trim(), key);
  const other = { ...RECS, students: { 'someone@outlook.com': [] } };
  assert.match(run('--records', w('bad.json', JSON.stringify(other))).stderr, /not IISc addresses/);
  const phone = JSON.parse(JSON.stringify(RECS)); phone.students['student1@iisc.ac.in'][0].note = 'call 98450 00000';
  assert.match(run('--records', w('ph.json', JSON.stringify(phone))).stderr, /phone number/);
  assert.notEqual(run('--records', join(dir, 'missing.json')).status, 0);
});

test('real feed (HQ_FEED, local only)', { skip: !process.env.HQ_FEED && 'set HQ_FEED=<feed.json> to run' }, async () => {
  const f = JSON.parse(readFileSync(process.env.HQ_FEED, 'utf8')), evs = A.events(f, {});
  assert.ok(evs.length > 10 && evs.every(e => /^\d{4}-\d\d-\d\d$/.test(e.date) && !isNaN(e.when)), 'events parse');
  assert.equal(new Set(evs.map(e => e.uid)).size, evs.length, 'unique uids');
  assert.ok(A.buildIcs(A.icsSeq({}, A.calItems(evs)).items).split('\r\n').every(l => l.length <= 75));
  const dict = A.buildDict(f.skills), jds = f.jds.map(j => ({ id: j.id, label: j.label, kws: A.atsKeywords(j.text, dict) }));
  assert.ok(jds.every(j => j.kws.length > 0), 'every JD yields keywords');
  const top = A.atsRank(jds, 'C++ CUDA MPI OpenMP GPU kernels Linux performance profiling parallel computing HPC').slice(0, 5);
  assert.ok(top[0].pct > A.atsRank(jds, 'Excel PowerPoint')[0].pct, 'a systems CV outranks an empty one');
  const docs = f.jd_docs || [];
  assert.ok(docs.every(d => d.slug && d.company && d.file && d.text.length >= 200), 'JD texts complete');
  const key = A.newBatchKey(), enc = await A.sealFeed(key, f);
  assert.deepEqual(await A.openFeed(key, enc), f);
  console.log(`  real feed: ${f.companies.length} entries, ${evs.length} events, ${jds.length} JDs, ${docs.length} JD texts, ${(JSON.stringify(enc).length / 1024).toFixed(0)} KB encrypted; top match ${top[0].label} ${top[0].pct}%`);
});
