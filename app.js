// Placement HQ app: UI, storage on this device, feed decryption, sync. The logic it relies on is in core.js.
import * as C from './core.js';

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)], esc = C.esc, KIND = C.KIND;
const RELAY = (($('meta[name=relay]') || {}).content || '').replace(/\/+$/, '');
const VIEWS = ['home', 'companies', 'calendar', 'shortlists', 'cv', 'dsa', 'settings'];
const LABEL = { not_applied: 'Not applied', applied: 'Applied', shortlisted: 'Shortlisted', test_scheduled: 'Test scheduled', test_done: 'Test done',
  interview_scheduled: 'Interview scheduled', interview_done: 'Interview done', offer: 'Offer', rejected: 'Rejected', withdrawn: 'Withdrawn', not_eligible: 'Not eligible' };
const ls =(k, v) => { try { if (v === undefined) return localStorage.getItem('hq:' + k); if (v === null) localStorage.removeItem('hq:' + k); else localStorage.setItem('hq:' + k, v); } catch { return null; } };

/* ---------------------------------------------------------------- storage: IndexedDB, localStorage fallback */
const idb = new Promise(res => {
  try { const q = indexedDB.open('hq', 1); q.onupgradeneeded = () => q.result.createObjectStore('kv'); q.onsuccess = () => res(q.result); q.onerror = q.onblocked = () => res(null); }
  catch { res(null); }
});
async function get(k) {
  const db = await idb;
  if (!db) { try { return JSON.parse(ls('db:' + k)); } catch { return null; } }
  return new Promise(res => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result ?? null); q.onerror = () => res(null); });
}
async function put(k, v) {
  const db = await idb;
  if (!db) return ls('db:' + k, v == null ? null : JSON.stringify(v));
  return new Promise(res => { const t = db.transaction('kv', 'readwrite'); v == null ? t.objectStore('kv').delete(k) : t.objectStore('kv').put(v, k); t.oncomplete = t.onerror = () => res(); });
}

/* ---------------------------------------------------------------- state */
let FEED = null, BY = {}, S = C.emptyState(), LASTU = 0, SYNC = null, VIEW = 'home', CHANGES = [], PEND = [], UNDO = null, MONTH = '', DAY = '', KWS = null, DEFER = null;
const DEV = ls('dev') || (() => { const d = C.hex(C.rnd(8)); ls('dev', d); return d; })();
const today = () => C.istDate(Date.now());

function setRec(sec, key, patch) {
  LASTU = C.tick(LASTU);
  const m = { u: LASTU, d: DEV };
  if (key == null) S[sec] = Object.assign({}, S[sec], patch, m);
  else S[sec][key] = Object.assign({}, S[sec][key], patch, m);
  save();
}
function delRec(sec, key) {
  LASTU = C.tick(LASTU);
  S.tomb[key == null ? sec : sec + '/' + key] = LASTU;
  if (key == null) delete S[sec]; else delete S[sec][key];
  save();
}
function save() { put('state', S); queuePush(); }
function absorb(remote) {
  S = C.merge(S, remote);
  LASTU = Math.max(LASTU, C.maxU(S));
  put('state', S);
  if (!document.activeElement || !document.activeElement.matches('input,textarea,select')) draw();
}

const evs = () => C.events(FEED, S.apps, S.sheet || {});
const mineAny = () => Object.values(S.apps).some(r => r.status && r.status !== 'not_applied');
const myIds = () => { const i = S.ids || {}; return [...(i.names || []), ...(i.emails || []), ...(i.srs || [])]; };
const name = slug => (BY[slug] || {}).company || slug;

/* ---------------------------------------------------------------- formatting */
const TZ = { timeZone: 'Asia/Kolkata' };
const fDay = d => new Date(C.istMs(d, '12:00')).toLocaleDateString('en-IN', Object.assign({ weekday: 'short', day: 'numeric', month: 'short' }, TZ));
const fWhen = iso => new Date(iso).toLocaleString('en-IN', Object.assign({ weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, TZ));
const cdText = iso => { const c = C.countdown(Date.now(), iso); return c ? (c.past ? 'closed' : c.text + ' left') : ''; };
const cdSpan = iso => { const c = C.countdown(Date.now(), iso); return c ? `<span class="cd${c.urgent ? ' urgent' : ''}${c.past ? ' past' : ''}" data-cd="${esc(iso)}">${cdText(iso)}</span>` : ''; };
const span = e => esc(e.start ? e.start + (e.end ? '–' + e.end : '') : 'All day');
const chip = (t, cls = '') => `<span class="chip${cls ? ' ' + cls : ''}">${esc(t)}</span>`;

function evLi(e, links) {
  const tags = [e.task && chip('task'), e.tentative && chip('tentative'), e.mine && chip('yours', 'ok'), e.short === 'yes' && chip('on shortlist', 'ok'), e.short === 'no' && chip('not on shortlist')].filter(Boolean).join(' ');
  const sub = [esc(e.mode), e.kind === 'deadline' ? cdSpan(e.iso) : ''].filter(Boolean).join(' · ');
  return `<li class="ev k-${e.kind}"><span class="when">${span(e)}</span><div><b>${KIND[e.kind]}:</b> ${esc(e.company)}${e.title ? ' · ' + esc(e.title) : ''} ${tags}${sub ? `<div class="mu">${sub}</div>` : ''}${links
    ? `<div class="links"><a href="${esc(C.gcalUrl(C.calItems([e])[0]))}" target="_blank" rel="noopener">Add to Google Calendar</a><button class="link" data-act="ics1" data-uid="${esc(e.uid)}">Download .ics</button></div>` : ''}</div></li>`;
}
function dayList(list, links) {
  const g = {}, t = today();
  for (const e of list) (g[e.date] = g[e.date] || []).push(e);
  return Object.entries(g).map(([d, xs]) => `<h3 class="dayh">${fDay(d)}${d === t ? ' · today' : ''}</h3><ul class="evs">${xs.map(e => evLi(e, links)).join('')}</ul>`).join('');
}
function download(file, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = file;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------------------------------------------------------------- views */
const V = {};

V.home = () => {
  const now = Date.now(), all = evs(), my = mineAny(), only = my && ls('homeAll') !== '1';
  const ag = C.agenda(all, now).filter(e => e.kind === 'deadline' ? Date.parse(e.iso) > now : (!only || e.mine) && e.short !== 'no');
  const cl = C.clashes(all, now);
  let h = '';
  if (CHANGES.length) h += `<section class="card note" aria-labelledby="h-chg"><h2 id="h-chg">What changed since your last visit</h2><ul>${CHANGES.map(changeLi).join('')}</ul><button data-act="seen">Got it</button></section>`;
  if (cl.length) h += `<section class="card warn" aria-labelledby="h-cl"><h2 id="h-cl">Possible clashes</h2><ul>${cl.map(([a, b]) =>
    `<li>${KIND[a.kind]} at ${esc(a.company)} and ${KIND[b.kind].toLowerCase()} at ${esc(b.company)}, ${fDay(a.date)} ${a.start && b.start ? `(${span(a)} and ${span(b)})` : '(same day)'}</li>`).join('')}</ul></section>`;
  h += `<div class="head"><h2>Next 7 days</h2>${my ? `<label class="ck"><input type="checkbox" id="homeMine"${only ? ' checked' : ''}> Only my roles</label>` : ''}</div>`;
  h += ag.length ? dayList(ag) : '<p class="mu">Nothing in the next 7 days.</p>';
  if (!my) h += '<p class="mu">Mark the roles you applied to under Companies: Home then shows your tests and interviews and warns about clashes.</p>';
  $('#v-home').innerHTML = h + installHint();
};
const tiText = x => x ? [fDay(x.date), x.time, x.mode, x.confirmed ? '' : 'tentative'].filter(Boolean).join(', ') : 'removed';
const changeLi = x => `<li>${x.what === 'new' ? 'New' : x.what === 'role' ? 'New role' : KIND[x.what] + ' changed'}: <b>${esc(x.company)}</b>${x.title ? ' · ' + esc(x.title) : ''}${
  x.what === 'deadline' ? ' → ' + (x.to ? fWhen(x.to) : 'none') : x.what === 'test' || x.what === 'interview' ? ' → ' + esc(tiText(x.to)) : ''}</li>`;

function installHint() {
  if (ls('nohint') || matchMedia('(display-mode: standalone)').matches || navigator.standalone) return '';
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
  const how = ios ? 'In Safari, tap Share, then <b>Add to Home Screen</b>. iPhones keep the installed app\'s data apart from Safari, so open it from the home screen and paste your link once.'
    : DEFER ? '<button data-act="install">Install the app</button>' : 'Open the browser menu and choose <b>Install app</b> or <b>Add to Home screen</b>.';
  return `<section class="card" aria-labelledby="h-inst"><h2 id="h-inst">Use it like an app</h2><p>${how} It works offline after the first visit.</p><button class="ghost" data-act="nohint">Hide this</button></section>`;
}

V.companies = () => {
  const q = $('#q').value.trim().toLowerCase(), trk = $('#trk').value, mine = $('#mine').checked, now = Date.now(), open = c => Date.parse(c.deadline) > now;
  const list = FEED.companies.filter(c => (!q || (c.company + ' ' + c.roles.map(r => r.title).join(' ')).toLowerCase().includes(q))
    && (!trk || c.roles.some(r => r.track === trk)) && (!mine || c.roles.some(r => C.statusOf(S.apps, c, r) !== 'not_applied')))
    .sort((a, b) => open(b) - open(a) || (open(a) ? Date.parse(a.deadline) - Date.parse(b.deadline) : a.company.localeCompare(b.company)));
  const was = $$('#co-list details[open]').map(d => d.dataset.slug);
  $('#co-n').textContent = `${list.length} of ${FEED.companies.length}`;
  $('#co-list').innerHTML = list.map(c => `<details class="card co" data-slug="${esc(c.slug)}"${was.includes(c.slug) ? ' open' : ''}><summary>${coSum(c)}</summary><div class="body">${
    was.includes(c.slug) ? coBody(c) : ''}</div></details>`).join('') || '<p class="mu">No companies match.</p>';
};
function coSum(c) {
  const st = c.roles.map(r => C.statusOf(S.apps, c, r)).filter(s => s !== 'not_applied');
  return `<span><b>${esc(c.company)}</b>${c.kind === 'task' ? ' ' + chip('task') : ''} ${c.deadline ? cdSpan(c.deadline) : ''}</span>
    <span class="mu">${esc([...new Set(c.roles.map(r => r.track))].join(' · '))}${c.ctc ? ' · ' + esc(c.ctc) : ''}</span>${st.length ? `<span class="mine">You: ${st.map(s => LABEL[s]).join(', ')}</span>` : ''}`;
}
function coBody(c) {
  const rows = [['Deadline', c.deadline && fWhen(c.deadline) + ' IST'], ['Max roles', c.max_roles], ['CTC', c.ctc], ['Location', c.location], ['Test', c.test && tiText(c.test)],
    ['Interview', c.interview && tiText(c.interview)], ['OCCaP contact', (c.poc || []).join(', ')]].filter(x => x[1] != null && x[1] !== '');
  return `<dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>${(c.process || []).length ? `<h3>Process</h3><ol>${c.process.map(p => `<li>${esc(p)}</li>`).join('')}</ol>` : ''}${
    c.info ? `<p>${esc(c.info)}</p>` : ''}${c.roles.map(r => roleBox(c, r)).join('')}`;
}
function roleBox(c, r) {
  const k = C.keyOf(c, r), s = S.apps[k] || {}, a = f => `name="${f}-${C.h32(k)}" data-k="${esc(k)}" data-f="${f}"`, v = f => esc(s[f] || '');
  const meta = [r.ctc && r.ctc !== c.ctc ? 'CTC ' + r.ctc : '', r.location && r.location !== c.location ? r.location : '', r.eligibility].filter(Boolean);
  return `<fieldset class="role"><legend>${esc(r.title)} ${chip(r.track)}</legend>${meta.length ? `<p class="mu">${esc(meta.join(' · '))}</p>` : ''}
    <label>My status <select ${a('status')}>${C.STATUSES.map(x => `<option value="${x}"${x === (s.status || 'not_applied') ? ' selected' : ''}>${LABEL[x]}</option>`).join('')}</select></label>
    <div class="two"><label>Test date <input type="date" ${a('test_date')} value="${v('test_date')}"></label><label>Test time <input type="time" ${a('test_time')} value="${v('test_time')}"></label></div>
    <div class="two"><label>Interview date <input type="date" ${a('interview_date')} value="${v('interview_date')}"></label><label>Interview time <input type="time" ${a('interview_time')} value="${v('interview_time')}"></label></div>
    <label>Notes <textarea rows="2" ${a('notes')}>${v('notes')}</textarea></label></fieldset>`;
}

const calList = () => evs().filter(e => (!$('#calMine').checked || e.mine) && e.short !== 'no');
V.calendar = () => {
  const t = today(), all = calList();
  MONTH = MONTH || t.slice(0, 7);
  const [y, m] = MONTH.split('-').map(Number), first = new Date(Date.UTC(y, m - 1, 1)), n = new Date(Date.UTC(y, m, 0)).getUTCDate(), by = {};
  for (const e of all) (by[e.date] = by[e.date] || []).push(e);
  $('#mon').textContent = first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  let g = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<span class="wd" aria-hidden="true">${d}</span>`).join('') + '<span></span>'.repeat((first.getUTCDay() + 6) % 7);
  for (let d = 1; d <= n; d++) {
    const iso = `${MONTH}-${String(d).padStart(2, '0')}`, xs = by[iso] || [];
    g += `<button class="${iso === t ? 'today' : ''}" data-day="${iso}" aria-pressed="${iso === DAY}" aria-label="${fDay(iso)}, ${xs.length || 'no'} item${xs.length === 1 ? '' : 's'}">${d}<span class="dots">${
      [...new Set(xs.map(e => e.kind))].map(k => `<i class="dot k-${k}"></i>`).join('')}</span></button>`;
  }
  $('#grid').innerHTML = g;
  const list = DAY ? all.filter(e => e.date === DAY) : all.filter(e => e.date >= t);
  $('#cal-h').textContent = DAY ? fDay(DAY) : 'Upcoming';
  $('#cal-list').innerHTML = list.length ? dayList(list, true) : '<p class="mu">Nothing here.</p>';
};
function exportIcs(list, file) {
  const prev = (S.ics || {}).seq || {}, { items, seq } = C.icsSeq(prev, C.calItems(list));
  if (JSON.stringify(seq) !== JSON.stringify(prev)) setRec('ics', null, { seq });
  download(file, C.buildIcs(items), 'text/calendar');
}

V.shortlists = () => {
  const sh = S.sheet || {}, short = sh.short || [], sched = sh.sched || [];
  $('#sl-ids').innerHTML = myIds().length ? '' : '<p class="card warn">Add your name, email or SR number in <button class="link" data-act="go" data-v="settings">Settings</button> first, so your rows can be found.</p>';
  $('#sl-saved').innerHTML = short.length || sched.length ? `<ul>${short.map(x => `<li>${KIND[x.what]} shortlist, ${esc(name(x.slug))}: ${x.me ? '<b>you are on it</b>' : 'you are not on it'}</li>`).join('')}${
    sched.map(x => `<li>${KIND[x.kind]}, ${esc(name(x.slug))}: ${fDay(x.date)}, ${span(x)}${x.mode ? ', ' + esc(x.mode) : ''}${x.tentative ? ' (tentative)' : ''}</li>`).join('')}</ul>
    <button class="ghost" data-act="sheetdel">Clear saved sheet data</button>` : '<p class="mu">Nothing saved yet.</p>';
};
function checkSheet() {
  const text = $('#sp').value, out = $('#sl-res');
  $('#sp').value = ''; // other students' rows are never kept, not even in the text box
  const res = C.analyzeTab($('#sk').value, text, FEED.companies, myIds()), sh = S.sheet || {};
  PEND = []; UNDO = null;
  if (!res.kind) { out.innerHTML = '<p class="card warn">Could not tell what this tab is. Choose its type above and paste it again.</p>'; return; }
  const w = res.kind.what;
  if (res.kind.type === 'schedule') {
    const hit = new Set(res.sched.map(x => x.slug));
    setRec('sheet', null, { sched: (sh.sched || []).filter(x => !(x.kind === w && hit.has(x.slug))).concat(res.sched), short: sh.short || [] });
    out.innerHTML = `<p class="card">${res.sched.length} ${w} slot${res.sched.length === 1 ? '' : 's'} saved for ${hit.size} compan${hit.size === 1 ? 'y' : 'ies'} in the feed (${res.rows} rows pasted). Your calendar now uses them.</p>`;
  } else {
    setRec('sheet', null, { sched: sh.sched || [], short: (sh.short || []).filter(x => !(x.what === w && res.all.includes(x.slug))).concat(res.all.map(slug => ({ what: w, slug, me: res.me.includes(slug) }))) });
    const ac = C.autoChanges(S.apps, FEED.companies, res, S.sheet.sched);
    PEND = ac.changes;
    out.innerHTML = `<div class="card"><p>${res.me.length ? `You are on this ${w} shortlist for <b>${esc(res.me.map(name).join(', '))}</b>.` : `None of your identifiers is on this ${w} shortlist${res.all.length ? ` (it covers ${esc(res.all.map(name).join(', '))})` : ''}.`}</p>${
      ac.absent.length ? `<p>Not on it, though you applied: ${esc(ac.absent.join(', '))}.</p>` : ''}${ac.none.length ? `<p>Mark which role you applied to at ${esc(ac.none.join(', '))} under Companies, then paste again.</p>` : ''}${
      PEND.length ? `<h3>Suggested updates</h3><ul>${PEND.map(c => `<li>${esc(c.label)}: ${LABEL[c.from.status]} → <b>${LABEL[c.to.status]}</b>${c.to.interview_date ? `, interview ${fDay(c.to.interview_date)}${c.to.interview_time ? ' ' + c.to.interview_time : ''}` : ''}</li>`).join('')}</ul><button data-act="apply">Apply</button>` : ''}</div>`;
  }
  V.shortlists();
}

async function cvFile(f) {
  $('#cv-msg').textContent = 'Reading the PDF on this device…';
  try {
    const pdf = await import('./vendor/pdf.min.mjs');
    pdf.GlobalWorkerOptions.workerSrc = new URL('vendor/pdf.worker.min.mjs', location.href).href;
    const doc = await pdf.getDocument({ data: new Uint8Array(await f.arrayBuffer()), isEvalSupported: false }).promise;
    let text = '';
    for (let i = 1; i <= doc.numPages; i++) text += (await (await doc.getPage(i)).getTextContent()).items.map(x => x.str + (x.hasEOL ? '\n' : ' ')).join('') + '\n';
    $('#cvt').value = text.trim();
    setRec('cv', null, { text: text.trim(), name: f.name });
    scoreCv();
  } catch { $('#cv-msg').textContent = 'Could not read that PDF. Paste the text instead.'; }
}
function scoreCv() {
  const text = (S.cv || {}).text || '', more = $('#cvmore');
  if (!text) { $('#cv-list').innerHTML = ''; $('#cv-msg').textContent = 'No CV yet.'; more.hidden = true; return; }
  if (!KWS) { const dict = C.buildDict(FEED.skills); KWS = FEED.jds.map(j => ({ id: j.id, label: j.label, kws: C.atsKeywords(j.text, dict) })); }
  const q = $('#cvq').value.trim().toLowerCase(), rank = C.atsRank(KWS, text).filter(r => !q || r.label.toLowerCase().includes(q)), shown = more.dataset.all ? rank : rank.slice(0, 20);
  $('#cv-msg').textContent = `${S.cv.name || 'Your CV'} against ${KWS.length} job descriptions: the share of each JD's keywords your CV contains.`;
  $('#cv-list').innerHTML = shown.map(r => `<li class="card"><div class="head"><b>${esc(r.label)}</b><span class="pct">${r.pct}%</span></div><meter min="0" max="100" value="${r.pct}" aria-label="Match ${r.pct}%"></meter>${
    r.hit.length ? `<p><span class="mu">Matched:</span> ${r.hit.map(k => chip(k.term, 'ok')).join(' ')}</p>` : ''}${r.miss.length ? `<p><span class="mu">Missing:</span> ${r.miss.slice(0, 15).map(k => chip(k.term)).join(' ')}</p>` : ''}</li>`).join('');
  more.hidden = shown.length === rank.length;
}
V.cv = () => { if (!$('#cvt').value) $('#cvt').value = (S.cv || {}).text || ''; scoreCv(); };

const lc = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
V.dsa = () => {
  const t = today(), it = S.dsa, f = $('#df').value, q = $('#dq').value.trim().toLowerCase(), st = p => (it[p.problem] || {}).status || 'todo';
  const due = FEED.dsa.filter(p => C.srsDue(it[p.problem], t)), act = {};
  for (const r of Object.values(it)) for (const d of [r.done_on, r.rev_on]) if (d) act[d] = 1;
  const sk = C.streak(act, t), done = FEED.dsa.filter(p => st(p) !== 'todo').length;
  $('#d-sum').textContent = `${done} of ${FEED.dsa.length} solved · ${due.length} due for review · streak ${sk.n} day${sk.n === 1 ? '' : 's'}`;
  $('#d-due').innerHTML = due.map(p => `<li><span>${esc(p.problem)}</span><button data-act="rev" data-ok="1" data-p="${esc(p.problem)}">Recalled</button><button class="ghost" data-act="rev" data-ok="" data-p="${esc(p.problem)}">Struggled</button></li>`).join('')
    || '<li class="mu">Nothing due. A solved problem comes back after 1, 3, 7 and 21 days.</li>';
  const g = {};
  for (const p of FEED.dsa) if ((!f || st(p) === f) && (!q || (p.problem + ' ' + p.topic).toLowerCase().includes(q))) (g[p.topic] = g[p.topic] || []).push(p);
  $('#d-list').innerHTML = Object.entries(g).map(([topic, ps]) => `<h3>${esc(topic)}</h3><ul class="dsa">${ps.map(p => `<li><label class="ck"><input type="checkbox" name="dsa-${C.h32(p.problem)}" data-dsa="${esc(p.problem)}"${st(p) !== 'todo' ? ' checked' : ''}> ${esc(p.problem)}</label>${
    chip(p.difficulty)}${st(p) === 'revisit' ? chip('revisit') : ''}<a href="https://leetcode.com/problems/${lc(p.problem)}/" target="_blank" rel="noopener" aria-label="${esc(p.problem)} on LeetCode">LeetCode</a></li>`).join('')}</ul>`).join('')
    || '<p class="mu">No problems match.</p>';
};

V.settings = () => {
  const i = S.ids || {};
  if (!$('#v-settings').contains(document.activeElement)) { $('#idn').value = (i.names || []).join('\n'); $('#ide').value = (i.emails || []).join('\n'); $('#idsr').value = (i.srs || []).join('\n'); }
  $('#relay').textContent = RELAY || 'not configured';
  $('#sync').innerHTML = !RELAY ? '<p>Live sync is not set up for this site yet. To move your data to another device, export an encrypted backup below and import it there.</p>'
    : !SYNC ? `<p>Keep your phone and laptop in step. Only ciphertext leaves the device; the relay cannot read it.</p><button data-act="screate">Create a sync code</button>
      <label>Or join with the code from your other device <input id="scode" autocomplete="off" spellcheck="false" autocapitalize="characters"></label><button class="ghost" data-act="sjoin">Join</button>`
    : `<p>Sync is on. <span class="mu">${esc(SYNC.msg || '')}</span></p><details id="qrbox"><summary>Show the code and QR for another device</summary><p class="code">${C.groups(SYNC.code)}</p>
      <img id="qr" alt="QR code that opens this app on another device with your sync code"><p class="mu">Anyone with this code can read and change your synced data: keep it to your own devices.</p></details>
      <button class="ghost" data-act="sstop">Stop syncing on this device</button>`;
};

function draw() { if (FEED) V[VIEW](); }
function show(v) {
  VIEW = VIEWS.includes(v) ? v : 'home';
  ls('view', VIEW);
  for (const x of VIEWS) $('#v-' + x).hidden = x !== VIEW;
  for (const b of $$('#nav button')) b.dataset.v === VIEW ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current');
  V[VIEW]();
  scrollTo(0, 0);
}

/* ---------------------------------------------------------------- sync (relay) */
const SK = {};
const syncKeys = async () => SK[SYNC.code] || (SK[SYNC.code] = await C.syncIds(C.unb32(SYNC.code)));
const blobUrl = id => `${RELAY}/v1/b/${id}`;
const syncNote = msg => { if (SYNC) { SYNC.msg = msg; put('sync', SYNC); if (VIEW === 'settings') V.settings(); } };
let pushT = 0, lastPull = 0;
function queuePush() { if (RELAY && SYNC) { clearTimeout(pushT); pushT = setTimeout(push, 2000); } }

async function push(retry = true) {
  if (!RELAY || !SYNC) return;
  try {
    const { id, key } = await syncKeys();
    const r = await fetch(blobUrl(id), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ base: SYNC.ver || 0, data: await C.seal(key, S) }) });
    if (r.status === 409 && retry) { const j = await r.json(); if (j.data) absorb(await C.open(key, j.data)); SYNC.ver = j.ver; return push(false); }
    if (!r.ok) throw new Error('relay answered ' + r.status);
    SYNC.ver = (await r.json()).ver;
    syncNote('Last synced ' + fWhen(new Date().toISOString()) + '.');
  } catch (e) { syncNote('Sync failed (' + e.message + '); will retry.'); }
}
// create: also write when the relay has nothing for this code (false when joining, so a typo is caught).
async function pull(create = true) {
  if (!RELAY || !SYNC || Date.now() - lastPull < 5000) return;
  lastPull = Date.now();
  try {
    const { id, key } = await syncKeys();
    const r = await fetch(blobUrl(id), { cache: 'no-store', headers: SYNC.ver ? { 'if-none-match': String(SYNC.ver) } : {} });
    if (r.status === 404) { if (!create) throw new Error('no data for this code'); SYNC.ver = 0; return push(); }
    if (r.status === 304) return syncNote('Last synced ' + fWhen(new Date().toISOString()) + '.');
    if (!r.ok) throw new Error('relay answered ' + r.status);
    const j = await r.json(), remote = await C.open(key, j.data);
    SYNC.ver = j.ver;
    absorb(remote);
    if (C.maxU(S) > C.maxU(remote)) return push(); // this device has edits the other has not seen
    syncNote('Last synced ' + fWhen(new Date().toISOString()) + '.');
  } catch (e) { if (!create) throw e; syncNote('Sync failed (' + e.message + '); will retry.'); }
}
async function joinSync(code) {
  const c = C.b32(C.unb32(code));
  if (C.unb32(code).length !== 16) return alert('That is not a sync code (26 letters and digits).');
  const prev = SYNC;
  SYNC = { code: c, ver: 0 }; lastPull = 0;
  try { await pull(false); await put('sync', SYNC); }
  catch (e) { SYNC = prev; alert('Could not join: ' + e.message + '.'); }
  if (VIEW === 'settings') V.settings();
}
setInterval(() => document.visibilityState === 'visible' && pull(), 60000);
addEventListener('focus', () => pull());
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && pull());

async function drawQr() {
  const { default: qrcode } = await import('./vendor/qrcode.mjs'), q = qrcode(0, 'M');
  q.addData(`${location.origin}${location.pathname}#k=${ls('k')}&sync=${SYNC.code}`);
  q.make();
  $('#qr').src = q.createDataURL(5, 4);
}

/* ---------------------------------------------------------------- actions */
const lines = id => $(id).value.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
const ACT = {
  go: b => show(b.dataset.v),
  seen: () => { setRec('seen', null, { feedUpdated: FEED.updated, keys: C.feedKeys(FEED) }); CHANGES = []; V.home(); },
  nohint: () => { ls('nohint', '1'); V.home(); },
  install: () => { if (DEFER) DEFER.prompt(); DEFER = null; V.home(); },
  'm-1': () => shiftMonth(-1), 'm+1': () => shiftMonth(1),
  icsAll: () => exportIcs(calList(), 'placement-hq.ics'),
  ics1: b => exportIcs(evs().filter(e => e.uid === b.dataset.uid), b.dataset.uid + '.ics'),
  sheet: checkSheet,
  apply: () => { for (const c of PEND) setRec('apps', c.key, c.to); UNDO = PEND; PEND = []; $('#sl-res').innerHTML = '<p class="card">Applied. <button class="ghost" data-act="undo">Undo</button></p>'; },
  undo: () => { for (const x of C.undoChanges(S.apps, UNDO)) setRec('apps', x.key, x.patch); UNDO = null; $('#sl-res').innerHTML = '<p class="card">Undone.</p>'; },
  sheetdel: () => { if (confirm('Clear the saved schedule rows and shortlist results?')) { delRec('sheet'); V.shortlists(); } },
  cv: () => { const text = $('#cvt').value.trim(); if (text && text !== (S.cv || {}).text) setRec('cv', null, { text, name: 'Pasted CV' }); scoreCv(); },
  cvdel: () => { if (S.cv) delRec('cv'); $('#cvt').value = ''; scoreCv(); },
  cvmore: b => { b.dataset.all = '1'; scoreCv(); },
  rev: b => { const p = b.dataset.p; setRec('dsa', p, C.srsReview(S.dsa[p] || {}, today(), !!b.dataset.ok)); V.dsa(); },
  ids: () => { setRec('ids', null, { names: lines('#idn'), emails: lines('#ide'), srs: lines('#idsr') }); $('#idmsg').textContent = 'Saved on this device.'; },
  screate: async () => { SYNC = { code: C.b32(C.rnd(16)), ver: 0 }; await put('sync', SYNC); await push(); V.settings(); },
  sjoin: () => joinSync($('#scode').value),
  sstop: async () => { if (!confirm('Stop syncing on this device? Your data stays here; the other devices keep their copy.')) return; SYNC = null; await put('sync', null); V.settings(); },
  bexp: async () => {
    const pw = $('#bpw').value, msg = $('#bmsg');
    if (pw.length < 8) { msg.textContent = 'Choose a passphrase of at least 8 characters; you need it to import.'; return; }
    msg.textContent = 'Encrypting…';
    download(`placement-hq-backup-${today()}.json`, JSON.stringify(await C.wrapBackup(pw, S)), 'application/json');
    msg.textContent = 'Saved. Keep the file and the passphrase: neither is stored anywhere else.';
  },
  csv: () => download('placement-hq-roles.csv', C.toCsv(FEED.companies.flatMap(c => c.roles.map(r => [c, r, S.apps[C.keyOf(c, r)]]))
    .filter(x => x[2]).map(([c, r, s]) => ({ company: c.company, role: r.title, track: r.track, status: s.status || 'not_applied', test_date: s.test_date || '', test_time: s.test_time || '',
      interview_date: s.interview_date || '', interview_time: s.interview_time || '', notes: s.notes || '' }))), 'text/csv'),
  link: async () => {
    try { await navigator.clipboard.writeText(`${location.origin}${location.pathname}#k=${ls('k')}`); $('#dmsg').textContent = 'Batch link copied. Share it only with your batch.'; }
    catch { $('#dmsg').textContent = 'Could not copy here.'; }
  },
  wipe: async () => {
    if (!confirm('Delete everything Placement HQ stored on this device: statuses, notes, CV text, identifiers, sync code and the batch key? Copies on your other devices stay.')) return;
    try { (await idb).close(); } catch { /* none open */ }
    try { indexedDB.deleteDatabase('hq'); localStorage.clear(); } catch { /* storage blocked */ }
    try { for (const k of await caches.keys()) await caches.delete(k); for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); } catch { /* no SW */ }
    location.replace(location.pathname);
  },
};
function shiftMonth(n) {
  const [y, m] = MONTH.split('-').map(Number), d = new Date(Date.UTC(y, m - 1 + n, 1));
  MONTH = d.toISOString().slice(0, 7); DAY = '';
  V.calendar();
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-act],[data-day],#nav button');
  if (!b) return;
  if (b.dataset.day) { DAY = DAY === b.dataset.day ? '' : b.dataset.day; return V.calendar(); }
  if (b.dataset.act) return ACT[b.dataset.act] && ACT[b.dataset.act](b);
  show(b.dataset.v);
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.k) {
    setRec('apps', t.dataset.k, { [t.dataset.f]: t.value });
    const d = t.closest('details.co');
    if (d && t.dataset.f === 'status') d.querySelector('summary').innerHTML = coSum(BY[d.dataset.slug]);
    return;
  }
  if (t.dataset.dsa) {
    const p = t.dataset.dsa;
    setRec('dsa', p, t.checked ? C.srsDone(S.dsa[p] || {}, today()) : { status: 'todo', stage: 0, next_due: '', done_on: '', rev_on: '' });
    V.dsa();
    const again = $$('#d-list input[data-dsa]').find(x => x.dataset.dsa === p);
    if (again) again.focus();
    return;
  }
  if (t.id === 'trk' || t.id === 'mine') V.companies();
  else if (t.id === 'calMine') V.calendar();
  else if (t.id === 'homeMine') { ls('homeAll', t.checked ? null : '1'); V.home(); }
  else if (t.id === 'df') V.dsa();
  else if (t.id === 'cvf' && t.files[0]) cvFile(t.files[0]);
  else if (t.id === 'bimp' && t.files[0]) {
    const f = t.files[0], msg = $('#bmsg');
    t.value = '';
    f.text().then(s => C.unwrapBackup($('#bpw').value, JSON.parse(s))).then(st => { absorb(st); save(); msg.textContent = 'Imported and merged with this device.'; })
      .catch(() => { msg.textContent = 'Wrong passphrase, or not a Placement HQ backup. Type the passphrase first, then choose the file.'; });
  }
});
let debT = 0;
document.addEventListener('input', e => {
  const f = { q: V.companies, dq: V.dsa, cvq: scoreCv }[e.target.id];
  if (f) { clearTimeout(debT); debT = setTimeout(f, 150); }
});
// Company cards fill in when opened; the QR is drawn when shown.
document.addEventListener('toggle', e => {
  const d = e.target;
  if (!d.open) return;
  if (d.matches('details.co')) { const b = d.querySelector('.body'); if (!b.innerHTML) b.innerHTML = coBody(BY[d.dataset.slug]); }
  if (d.id === 'qrbox') drawQr();
}, true);
const link = s => new URLSearchParams(s.includes('#') ? s.split('#')[1] : 'k=' + s); // a pasted link, a location.hash or a bare key
$('#lock-form').addEventListener('submit', e => {
  e.preventDefault();
  const p = link($('#lock-in').value.trim()), k = p.get('k'), s = p.get('sync');
  if (!/^[\w-]{22}$/.test(k || '')) { $('#lock-msg').textContent = 'That does not look like the batch link. Paste the whole link.'; return; }
  ls('k', k); $('#lock-in').value = '';
  unlock().then(ok => ok && s && joinPrompt(s));
});
addEventListener('beforeinstallprompt', e => { DEFER = e; if (VIEW === 'home' && FEED) V.home(); });
setInterval(() => { for (const el of $$('[data-cd]')) el.textContent = cdText(el.dataset.cd); }, 30000);

/* ---------------------------------------------------------------- boot */
function lock(msg) {
  for (const s of $$('main > section')) s.hidden = true;
  $('#boot').hidden = true; $('#nav').hidden = true; $('#lock').hidden = false;
  $('#lock-msg').textContent = msg || 'Placement HQ is for one batch. Open the link your batch was sent.';
  return false;
}
async function unlock() {
  const key = ls('k');
  if (!key) return lock();
  let file;
  try { const r = await fetch('feed.enc.json', { cache: 'no-cache' }); if (!r.ok) throw new Error(); file = await r.json(); }
  catch { return lock('The feed could not be loaded. Check your connection and reload.'); }
  try { FEED = await C.openFeed(key, file); }
  catch { return lock('This link does not open the current feed. It may be old or incomplete.'); }
  FEED.updated = file.updated; BY = Object.fromEntries(FEED.companies.map(c => [c.slug, c])); KWS = null;
  $('#upd').textContent = 'Feed updated ' + fWhen(file.updated) + (navigator.onLine ? '' : ' (offline copy)');
  const keys = C.feedKeys(FEED);
  if (!S.seen) setRec('seen', null, { feedUpdated: file.updated, keys });
  else if (S.seen.feedUpdated !== file.updated && !(CHANGES = C.feedChanges(S.seen.keys, FEED)).length) setRec('seen', null, { feedUpdated: file.updated, keys });
  $('#lock').hidden = true; $('#boot').hidden = true; $('#nav').hidden = false;
  show(ls('view') || 'home');
  return true;
}
async function joinPrompt(code) {
  if (!RELAY) return alert('This link carries a sync code, but live sync is not set up on this site. Use an encrypted backup instead.');
  if (SYNC && SYNC.code === C.b32(C.unb32(code))) return;
  if (confirm('Join sync with your other device? Its data and this device\'s are merged.')) { await joinSync(code); show('settings'); }
}
(async () => {
  const h = link(location.hash), k = h.get('k'), join = h.get('sync');
  if (k) ls('k', k);
  if (location.hash) history.replaceState(null, '', location.pathname + location.search); // the key does not stay in the address bar
  S = Object.assign(C.emptyState(), await get('state'));
  LASTU = C.maxU(S);
  SYNC = await get('sync');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (!await unlock()) return;
  if (join) await joinPrompt(join);
  pull();
})();
