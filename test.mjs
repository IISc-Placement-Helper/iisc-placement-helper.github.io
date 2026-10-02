// node test.mjs  (no deps, fixed timestamps). HQ_FEED=<feed.json> adds checks against a real feed, which is never committed.
// node test.mjs --fix rewrites the CSP and SRI hashes in index.html after editing its CSS, app.js, core.js or vendor/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as A from './core.js';
import relay from './relay/worker.js';

const ROOT = dirname(fileURLToPath(import.meta.url)), rd = f => readFileSync(join(ROOT, f));
const NOW = Date.parse('2026-09-23T09:00:00+05:30');
const sha = (alg, s) => alg + '-' + createHash(alg).update(s).digest('base64');
const STYLE = /<style>([\s\S]*?)<\/style>/, MAP = /<script type="importmap">([\s\S]*?)<\/script>/;
if (process.argv.includes('--fix')) {
  let html = rd('index.html').toString();
  html = html.replace(MAP, (_, m) => { const j = JSON.parse(m); for (const u of Object.keys(j.integrity)) j.integrity[u] = sha('sha384', rd(u)); return `<script type="importmap">${JSON.stringify(j)}</script>`; });
  html = html.replace(/(src="app\.js" integrity=")[^"]*/, '$1' + sha('sha384', rd('app.js')));
  html = html.replace(/script-src [^;]*/, `script-src 'self' '${sha('sha256', MAP.exec(html)[1])}'`).replace(/style-src [^;]*/, `style-src '${sha('sha256', STYLE.exec(html)[1])}'`);
  writeFileSync(join(ROOT, 'index.html'), html);
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

test('crypto: sync id and key are separate HKDF outputs', async () => {
  const code = A.rnd(16), s = await A.syncIds(code), s2 = await A.syncIds(code), other = await A.syncIds(A.rnd(16));
  assert.match(s.id, /^[0-9a-f]{64}$/);
  assert.equal(s.id, s2.id, 'deterministic'); assert.notEqual(s.id, other.id);
  const none = new Uint8Array(0), idBits = await A.hkdfBits(code, none, 'hq-sync-id'), keyBits = await A.hkdfBits(code, none, 'hq-sync-key');
  assert.equal(A.hex(idBits), s.id); assert.notEqual(A.hex(keyBits), s.id, 'different labels, different outputs');
  const blob = await A.seal(s.key, { apps: { x: 1 } });
  assert.deepEqual(await A.open(s2.key, blob), { apps: { x: 1 } });
  await assert.rejects(A.open(other.key, blob), 'another code cannot read it');
  const fromId = await crypto.subtle.importKey('raw', idBits, 'AES-GCM', false, ['decrypt']);
  await assert.rejects(A.open(fromId, blob), 'the relay id is not the key');
  assert.ok(!blob.includes(s.id));
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

// In-memory D1: just the four statements relay/worker.js runs.
function d1() {
  const t = new Map();
  const run = (sql, a) => {
    if (sql.startsWith('SELECT')) return t.has(a[0]) ? Object.assign({}, t.get(a[0])) : null;
    if (sql.startsWith('UPDATE')) {
      const [data, wcount, wstart, id, base] = a, r = t.get(id);
      if (!r || r.ver !== base) return { meta: { changes: 0 } };
      Object.assign(r, { ver: r.ver + 1, data, wcount, wstart });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('INSERT')) {
      const [id, data, wstart] = a;
      if (t.has(id)) return { meta: { changes: 0 } };
      t.set(id, { id, ver: 1, data, wcount: 1, wstart });
      return { meta: { changes: 1 } };
    }
    throw new Error('unexpected SQL ' + sql);
  };
  return { t, prepare: sql => ({ bind: (...a) => ({ first: async () => run(sql, a), run: async () => run(sql, a) }) }) };
}

test('relay: 200/304/404/409/413/429, CORS', async () => {
  const env = { DB: d1(), ORIGIN: 'https://hq.example.org' }, id = 'a'.repeat(64), id2 = 'b'.repeat(64);
  const call = (method, path, { body, headers = {}, origin = env.ORIGIN } = {}) => relay.fetch(new Request('https://relay.example.org' + path,
    { method, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body), headers: Object.assign(origin ? { origin } : {}, headers) }), env);
  let r = await call('GET', '/v1/b/' + id);
  assert.equal(r.status, 404); assert.equal(r.headers.get('access-control-allow-origin'), env.ORIGIN);
  r = await call('PUT', '/v1/b/' + id, { body: { base: 0, data: 'AAAA' } });
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ver: 1 });
  r = await call('GET', '/v1/b/' + id);
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ver: 1, data: 'AAAA' }); assert.equal(r.headers.get('etag'), '"1"');
  assert.equal((await call('GET', '/v1/b/' + id, { headers: { 'if-none-match': '1' } })).status, 304);
  r = await call('GET', '/v1/b/' + id, { headers: { 'if-none-match': '"1"' } });
  assert.equal(r.status, 304); assert.equal(r.headers.get('access-control-allow-origin'), env.ORIGIN, 'CORS on 304 too');
  assert.equal((await call('GET', '/v1/b/' + id, { headers: { 'if-none-match': '0' } })).status, 200);
  r = await call('PUT', '/v1/b/' + id, { body: { base: 0, data: 'BBBB' } });
  assert.equal(r.status, 409); assert.deepEqual(await r.json(), { ver: 1, data: 'AAAA' }, 'create race: the stored blob comes back');
  assert.equal((await call('PUT', '/v1/b/' + id, { body: { base: 1, data: 'CCCC' } })).status, 200);
  r = await call('PUT', '/v1/b/' + id, { body: { base: 1, data: 'DDDD' } });
  assert.equal(r.status, 409); assert.deepEqual(await r.json(), { ver: 2, data: 'CCCC' }, 'stale base');
  assert.equal((await call('PUT', '/v1/b/' + id2, { body: { base: 3, data: 'AAAA' } })).status, 409, 'no row and base > 0');
  assert.equal((await call('PUT', '/v1/b/' + id, { body: { base: 2, data: 'A'.repeat(256 * 1024 + 1) } })).status, 413);
  assert.equal((await call('PUT', '/v1/b/' + id, { body: { base: 2, data: 'A'.repeat(256 * 1024) } })).status, 200, '256 KB exactly is fine');
  assert.equal((await call('PUT', '/v1/b/' + id, { body: '{nope' })).status, 400);
  assert.equal((await call('PUT', '/v1/b/' + id, { body: { base: 3, data: 'not base64!' } })).status, 400);
  assert.equal((await call('GET', '/v1/b/' + id.toUpperCase())).status, 404, 'lower-case hex ids only');
  assert.equal((await call('GET', '/v1/b/abc')).status, 404);
  assert.equal((await call('DELETE', '/v1/b/' + id)).status, 405);
  // rate limit: 120 writes an hour per id
  const id3 = 'c'.repeat(64);
  for (let v = 0; v < 120; v++) assert.equal((await call('PUT', '/v1/b/' + id3, { body: { base: v, data: 'AAAA' } })).status, 200);
  r = await call('PUT', '/v1/b/' + id3, { body: { base: 120, data: 'AAAA' } });
  assert.equal(r.status, 429); assert.ok(+r.headers.get('retry-after') > 0);
  env.DB.t.get(id3).wstart -= 3600000;
  assert.equal((await call('PUT', '/v1/b/' + id3, { body: { base: 120, data: 'AAAA' } })).status, 200, 'new window');
  // CORS
  r = await call('OPTIONS', '/v1/b/' + id);
  assert.equal(r.status, 204); assert.match(r.headers.get('access-control-allow-methods'), /PUT/); assert.match(r.headers.get('access-control-allow-headers'), /if-none-match/);
  r = await call('OPTIONS', '/v1/b/' + id, { origin: 'https://evil.example.com' });
  assert.equal(r.status, 403); assert.equal(r.headers.get('access-control-allow-origin'), null);
  assert.equal((await call('GET', '/v1/b/' + id, { origin: 'https://evil.example.com' })).status, 403);
  r = await call('GET', '/v1/b/' + id, { origin: null });
  assert.equal(r.status, 200); assert.equal(r.headers.get('access-control-allow-origin'), null, 'no Origin (curl): served without CORS headers');
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
  assert.doesNotMatch(csp, /https?:|\*|unsafe/, 'only self, hashes, blob: and data:');
  assert.doesNotMatch(html, /<(script|link|img)[^>]+(src|href)="(https?:)?\/\//, 'no third-party scripts, styles, fonts or images');
  const man = JSON.parse(rd('manifest.webmanifest'));
  for (const i of man.icons) assert.ok(existsSync(join(ROOT, i.src)), i.src);
  const shell = JSON.parse(/SHELL = (\[[^\]]*\])/.exec(rd('sw.js').toString())[1].replace(/'/g, '"'));
  for (const f of shell) assert.ok(existsSync(join(ROOT, f === './' ? 'index.html' : f)), 'precache ' + f);
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
  const key = A.newBatchKey(), enc = await A.sealFeed(key, f);
  assert.deepEqual(await A.openFeed(key, enc), f);
  console.log(`  real feed: ${f.companies.length} entries, ${evs.length} events, ${jds.length} JDs, ${(JSON.stringify(enc).length / 1024).toFixed(0)} KB encrypted; top match ${top[0].label} ${top[0].pct}%`);
});
