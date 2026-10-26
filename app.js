/* global supabase, CONFIG */
const app = document.getElementById('app');
const $ = sel => document.querySelector(sel);
const PHOTO_BUCKET = 'exercise-photos';
const DEFAULT_SETS = 4; // for an exercise nobody has done yet
let sb = null;
let session = null;

// ---------- helpers ----------

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const go = hash => { location.hash = hash; };
const fmtDate = d => new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const fmtShort = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const byCreated = (a, b) => a.created_at.localeCompare(b.created_at);

// Throws Supabase errors so callers can just await the data
function check({ data, error }) {
  if (error) throw error;
  return data;
}

// Wraps an event handler so errors show up instead of failing silently
const act = fn => async e => {
  try { await fn(e); } catch (err) { console.error(err); alert(err.message || err); }
};

// "60kg × 10", or "10 reps" without weight
const fmtKgReps = x => (x.weight != null && x.weight !== '' ? `${x.weight}kg × ${x.reps}` : `${x.reps} reps`);

// A set as the same green kg / cream reps bubbles as the sets tables: [60 kg] × [10]
const kgRepsPills = x => `<span class="pills">${x.weight != null && x.weight !== ''
  ? `<span class="pill kg">${esc(x.weight)}<small>kg</small></span><span class="times">×</span><span class="pill reps">${esc(x.reps ?? '?')}</span>`
  : `<span class="pill reps">${esc(x.reps ?? '?')}<small>reps</small></span>`}</span>`;

// "10 @ 60kg"
const fmtSet = s => `${s.reps ?? '?'}${s.weight != null && s.weight !== '' ? ` @ ${s.weight}kg` : ''}`;

// "3 × 10 @ 60kg" when all sets match, otherwise "10 @ 60kg · 8 @ 65kg"
function fmtSets(sets) {
  if (!sets || !sets.length) return '—';
  const same = sets.every(s => s.reps === sets[0].reps && s.weight === sets[0].weight);
  return same ? `${sets.length} × ${fmtSet(sets[0])}` : sets.map(fmtSet).join(' · ');
}

// Sets as small columns, one per set: set number, kg (blue) and ×reps (cream), so values line up and compare easily.
// At most 4 per line so the cells stay wide enough on a phone; later sets wrap below in the same columns.
// items: [{ reps, weight, no (set number), best }]
function setGrid(items) {
  const has = v => v != null && v !== '';
  const hasKg = items.some(x => has(x.weight));
  return `
    <div class="set-grid" style="--n:${Math.min(items.length, 4)}">${items.map(x => `
      <div class="sg-set ${x.best ? 'best' : ''}">
        <span class="sg-no">${x.no}</span>
        ${hasKg ? `<span class="sg-val sg-weight">${has(x.weight) ? `${esc(x.weight)}<small>kg</small>` : '–'}</span>` : ''}
        <span class="sg-val sg-reps">${!has(x.reps) ? '–' : hasKg ? `<small>×</small>${esc(x.reps)}` : `${esc(x.reps)}<small>reps</small>`}</span>
      </div>`).join('')}
    </div>`;
}

const icon = path => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
const ICONS = {
  dumbbell: icon('<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>'),
  plates: icon('<ellipse cx="12" cy="6" rx="7" ry="2.5"/><path d="M5 6v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6M5 10v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-4"/>'),
  trophy: icon('<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5v1a3 3 0 0 0 3 3M16 6h3v1a3 3 0 0 1-3 3M12 13v4M8.5 20h7"/>'),
  people: icon('<circle cx="9" cy="8" r="3.2"/><path d="M3 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16 5.2a3 3 0 0 1 0 5.6M18 13.8c1.8.7 3 2.6 3 5.2"/>'),
  calendar: icon('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>'),
};
const CHEVRON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 6l-6 6 6 6"/></svg>';

// Row of three stat cards. items: [{ icon, value, label, tone: 'orange' | 'green' | '' }]
const statsHtml = items => `
  <div class="stats">${items.map(s => `
    <div class="stat ${s.tone || ''}">
      <div class="stat-icon">${ICONS[s.icon]}</div>
      <div class="stat-text"><b>${s.value}</b><span>${s.label}</span></div>
    </div>`).join('')}
  </div>`;

const draft = {
  load(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ } },
  clear(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
};

// ---------- outbox: sets wait on the phone until they reach the database (gym signal can be bad) ----------

// One item per exercise of a workout: { wid, exerciseId, weId, rows, sending }, rows/sending as { [memberId]: { absent, sets, soft } }.
// A soft row only fills in a member nobody has saved yet (e.g. "not here" carried over from the last exercise).
let outbox = draft.load('outbox') || [];
let flushing = null, retryTimer = null, retryDelay = 3000;
// The app open twice on one phone: take the other tab's outbox, so an upload it already did is never sent again later
window.addEventListener('storage', e => {
  if (e.key !== 'outbox') return;
  outbox = draft.load('outbox') || [];
  renderSync();
});

// A member's row ({ absent, sets }) as a string, to tell whether two versions are the same
const rowSig = r => JSON.stringify([!!r.absent, r.sets.map(x => [x.reps ?? null, x.weight ?? null])]);

// Each row also keeps `base`: the member's row as the phone knew it before this change (kept from the first change
// while several wait), so a row someone else changed meanwhile can be noticed when it's sent
function mergeRows(old = {}, rows) {
  const out = { ...old };
  for (const [mid, row] of Object.entries(rows)) {
    out[mid] = { ...row, soft: row.soft && (old[mid]?.soft ?? true), base: old[mid] ? old[mid].base : row.base };
  }
  return out;
}
const pendingRows = item => ({ ...item.sending, ...item.rows });
const outboxItem = (wid, exerciseId) => outbox.find(x => x.wid === wid && x.exerciseId === exerciseId);

function saveOutbox() {
  draft.save('outbox', outbox);
  renderSync();
  window.dispatchEvent(new Event('gb:outbox'));
}

function queueSave(wid, exerciseId, weId, rows) {
  let item = outboxItem(wid, exerciseId);
  if (!item) outbox.push(item = { wid, exerciseId, weId: null, rows: {} });
  item.weId ||= weId;
  item.rows = mergeRows(item.rows, rows);
  saveOutbox();
}

function dropSaves(wid, exerciseId) {
  outbox = outbox.filter(x => !(x.wid === wid && x.exerciseId === exerciseId));
  saveOutbox();
}

// The workout's row for this exercise, created if it isn't there yet. Shared, so two saves never create it twice.
const ensuring = new Map();
function ensureWorkoutExercise(wid, exerciseId) {
  const key = `${wid}:${exerciseId}`;
  if (!ensuring.has(key)) {
    const find = async () => check(await sb.from('workout_exercises').select('id')
      .eq('workout_id', wid).eq('exercise_id', exerciseId).order('created_at').limit(1))[0]?.id;
    ensuring.set(key, (async () => {
      const found = await find();
      if (found) return found;
      const { data, error } = await sb.from('workout_exercises').insert({ workout_id: wid, exercise_id: exerciseId }).select('id').single();
      if (error?.code === '23505') return find(); // another phone added it at the same moment
      return check({ data, error }).id;
    })());
  }
  const p = ensuring.get(key);
  p.then(() => ensuring.delete(key), () => ensuring.delete(key));
  return p;
}

async function sendItem(item) {
  if (!session) throw new Error('Locked');
  item.weId ||= await ensureWorkoutExercise(item.wid, item.exerciseId);
  window.dispatchEvent(new CustomEvent('gb:weid', { detail: item }));
  // Two phones can log the same people (two groups on two exercises, a phone that was asleep or without signal):
  // sets logged on another phone are never lost to a change made here without seeing them
  const current = new Map(check(await sb.from('entries').select('member_id, absent, sets')
    .eq('workout_exercise_id', item.weId).in('member_id', Object.keys(item.sending))).map(e => [e.member_id, e]));
  const theirsWins = (r, cur) => r.base != null && rowSig(cur) !== r.base && rowSig(cur) !== rowSig(r)
    && !cur.absent && cur.sets.length > (r.absent ? 0 : r.sets.length);
  const rows = [];
  let kept = false;
  for (const [member_id, r] of Object.entries(item.sending)) {
    const cur = current.get(member_id);
    if (cur && (r.soft || theirsWins(r, cur))) { kept = true; continue; }
    rows.push({ workout_exercise_id: item.weId, member_id, absent: r.absent, sets: r.sets, soft: r.soft });
  }
  const strip = list => list.map(({ soft, ...r }) => r);
  const hard = rows.filter(r => !r.soft), soft = rows.filter(r => r.soft);
  const onConflict = 'workout_exercise_id,member_id';
  if (hard.length) check(await sb.from('entries').upsert(strip(hard), { onConflict }));
  if (soft.length) check(await sb.from('entries').upsert(strip(soft), { onConflict, ignoreDuplicates: true }));
  // The page shows this phone's version: have it take the database's instead
  if (kept) setTimeout(() => window.dispatchEvent(new CustomEvent('gb:theirs', { detail: item })));
}

// Uploads everything waiting; on failure tries again a bit later (and whenever the phone gets signal back)
function flushSaves() {
  clearTimeout(retryTimer);
  if (flushing) return flushing;
  if (!outbox.length) return Promise.resolve();
  flushing = (async () => {
    renderSync();
    while (outbox.length) {
      const item = outbox[0];
      item.sending = mergeRows(item.sending, item.rows);
      item.rows = {};
      saveOutbox();
      try {
        await sendItem(item);
        delete item.sending;
      } catch (err) {
        if (err?.code !== '23503') { // 23503: the workout or exercise was deleted meanwhile, nothing left to save to
          console.error(err);
          retryTimer = setTimeout(flushSaves, retryDelay);
          retryDelay = Math.min(retryDelay * 2, 30000);
          return;
        }
        item.rows = {};
        delete item.sending;
      }
      if (!Object.keys(item.rows).length) outbox = outbox.filter(x => x !== item);
      retryDelay = 3000;
    }
  })().finally(() => {
    flushing = null;
    saveOutbox();
  });
  return flushing;
}

// Header badge while anything is waiting to be uploaded
function renderSync() {
  const btn = $('#sync');
  const n = outbox.reduce((sum, x) => sum + Object.keys(pendingRows(x)).length, 0);
  btn.hidden = !n;
  btn.textContent = flushing ? 'Uploading…' : `${n} waiting to upload`;
}

// ---------- live updates from other phones ----------

let cleanups = []; // run when the page changes
const onLeave = fn => cleanups.push(fn);

// `onReady` runs each time the connection is (re)made: changes saved before that (while connecting, or while the
// phone was asleep) never arrive as live updates, so it fetches them instead
function subscribe(changes, onChange, onReady) {
  const ch = sb.channel(`live-${Date.now()}-${Math.random()}`);
  for (const c of changes) ch.on('postgres_changes', { schema: 'public', ...c }, onChange);
  ch.subscribe(status => { if (status === 'SUBSCRIBED') onReady?.(); });
  onLeave(() => sb.removeChannel(ch));
}

// ---------- celebrations ----------

const CONFETTI_COLORS = ['#e3c9a5', '#b9644a', '#7f9b79', '#e8a23a', '#f1ebe2'];
let sheetConfetti = null;

// Confetti; the sheet has its own canvas because a modal dialog sits above everything else on the page
function celebrate(big, inSheet) {
  if (typeof confetti !== 'function') return;
  const fire = inSheet ? (sheetConfetti ??= confetti.create($('#sheet-confetti'), { resize: true })) : confetti;
  const base = { colors: CONFETTI_COLORS, disableForReducedMotion: true };
  if (!big) {
    fire({ ...base, particleCount: 70, spread: 70, startVelocity: 38, origin: { y: 0.65 } });
    return;
  }
  fire({ ...base, particleCount: 150, spread: 100, origin: { y: 0.55 } });
  setTimeout(() => {
    fire({ ...base, particleCount: 70, angle: 60, spread: 65, origin: { x: 0, y: 0.7 } });
    fire({ ...base, particleCount: 70, angle: 120, spread: 65, origin: { x: 1, y: 0.7 } });
  }, 300);
}

let toastTimer = null;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

// A set beats last time's same set if it's heavier, or the same weight for more reps
function beats(x, prev) {
  if (!prev) return false;
  const w = num(x.weight) ?? 0, pw = prev.weight ?? 0;
  return w > pw || (w === pw && (num(x.reps) ?? 0) > (prev.reps ?? 0));
}

// Bottom sheet with a Close button; resolves once it's closed
function showSheet(html) {
  const dlg = $('#sheet');
  $('#sheet-body').innerHTML = html;
  dlg.scrollTop = 0;
  document.documentElement.classList.add('no-scroll');
  return new Promise(resolve => {
    dlg.onclose = () => {
      dlg.onclose = null;
      document.documentElement.classList.remove('no-scroll');
      resolve();
    };
    dlg.showModal();
    celebrate(true, true);
  });
}

// ---------- exercise photos ----------

const photoUrl = path => sb.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
const DUMBBELL = '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/></svg>';
// Left-hand photo of an exercise row, or a dumbbell when there is no photo
const exImg = path => path
  ? `<div class="ex-img" style="background-image:url('${esc(photoUrl(path))}')"></div>`
  : `<div class="ex-img">${DUMBBELL}</div>`;

// Phone photos are huge; shrink to a reasonable JPEG before uploading
async function resizeImage(file, max = 1280) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not process the photo'))), 'image/jpeg', 0.8));
}

async function uploadExercisePhoto(exercise, file) {
  const blob = await resizeImage(file);
  const path = `${exercise.id}/${Date.now()}.jpg`;
  check(await sb.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: 'image/jpeg' }));
  check(await sb.from('exercises').update({ photo_path: path }).eq('id', exercise.id));
  if (exercise.photo_path) sb.storage.from(PHOTO_BUCKET).remove([exercise.photo_path]); // best effort cleanup
  return path;
}

// ---------- auth (one shared Supabase user; its password is the group password) ----------

function renderLock() {
  const btn = $('#lock');
  btn.textContent = session ? 'Lock' : 'Unlock';
  btn.classList.toggle('unlocked', !!session);
}

// `required`: the password screen shown on entering the site, which can't be cancelled
function requireAuth(required) {
  if (session) return Promise.resolve(true);
  return new Promise(resolve => {
    const dlg = $('#login'), form = $('#login-form'), pw = $('#pw'), err = $('#login-err');
    err.textContent = '';
    pw.value = '';
    $('#login-cancel').hidden = !!required;
    const done = ok => {
      form.onsubmit = dlg.oncancel = dlg.onclose = $('#login-cancel').onclick = null;
      if (dlg.open) dlg.close();
      resolve(ok);
    };
    // Browsers don't always let Escape be blocked, so the required screen just comes back
    if (required) dlg.onclose = () => dlg.showModal();
    form.onsubmit = async e => {
      e.preventDefault();
      const { error } = await sb.auth.signInWithPassword({ email: CONFIG.GROUP_EMAIL, password: pw.value });
      if (error) { err.textContent = error.message === 'Invalid login credentials' ? 'Wrong password' : error.message; return; }
      done(true);
    };
    $('#login-cancel').onclick = () => done(false);
    dlg.oncancel = e => { if (required) e.preventDefault(); else done(false); };
    dlg.showModal();
    pw.focus();
  });
}

// ---------- router ----------

const STALE = Symbol('stale');
let routeId = 0;
let leaveHook = null; // set by a view that must finish saving before the next page loads

const routes = [
  [/^$/, home],
  [/^members$/, membersView],
  [/^m\/([\w-]+)$/, memberView],
  [/^exercises$/, exercisesView],
  [/^w\/([\w-]+)$/, workoutView],
  [/^w\/([\w-]+)\/pick$/, pickView],
  [/^w\/([\w-]+)\/(new|edit)\/([\w-]+)$/, logView],
];

// `refresh`: redraw the same page with fresh data (a live update), keeping the scroll position
async function router(refresh) {
  const id = ++routeId;
  const leaving = leaveHook;
  leaveHook = null;
  cleanups.splice(0).forEach(fn => fn());
  if (leaving) {
    app.querySelectorAll('button, input').forEach(el => { el.disabled = true; });
    await leaving();
    if (id !== routeId) return;
  }
  const path = location.hash.replace(/^#\/?/, '');
  // Views call mount() once their data is loaded; a stale view (user navigated away meanwhile) is dropped
  const mount = html => {
    if (id !== routeId) throw STALE;
    const y = window.scrollY;
    app.innerHTML = `<div class="view">${html}</div>`;
    window.scrollTo(0, refresh === true ? y : 0);
    return app.firstElementChild;
  };
  for (const [re, view] of routes) {
    const m = path.match(re);
    if (!m) continue;
    if (refresh !== true) app.innerHTML = '<p class="muted center">Loading…</p>';
    try {
      await view(mount, ...m.slice(1));
    } catch (e) {
      if (e === STALE) return;
      console.error(e);
      app.innerHTML = `<div class="error">${esc(e.message || e)}</div><a class="btn" href="#/">Home</a>`;
    }
    return;
  }
  location.replace('#/');
}

// ---------- views ----------

let pastMonth = null; // month picked on the home screen ("2026-10"), kept while moving around the app

async function home(mount) {
  const [workouts, members] = await Promise.all([
    sb.from('workouts')
      .select('id, started_at, finished_at, workout_exercises(created_at, exercises(name), entries(absent, sets, members(name, created_at)))')
      .order('started_at', { ascending: false })
      .limit(500)
      .then(check),
    sb.from('members').select('id').eq('active', true).then(check),
  ]);
  const active = workouts.find(w => !w.finished_at);
  const past = workouts.filter(w => w.finished_at);
  // Past workouts are shown one month at a time, newest month first
  const monthOf = w => { const d = new Date(w.started_at); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const monthName = k => new Date(`${k}-15T12:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const months = [...new Set(past.map(monthOf))];
  if (!months.includes(pastMonth)) pastMonth = months[0];
  const summary = w => [...w.workout_exercises].sort(byCreated).map(we => we.exercises.name).join(' · ') || 'No exercises';
  const totals = w => {
    const sets = w.workout_exercises.flatMap(we => we.entries.flatMap(e => (e.absent ? [] : e.sets)));
    return { sets: sets.length, kg: Math.round(sets.reduce((sum, x) => sum + (x.weight || 0) * (x.reps || 0), 0)) };
  };
  // Everyone who logged at least one set, in the usual member order
  const people = w => {
    const byName = new Map();
    for (const e of w.workout_exercises.flatMap(we => we.entries)) {
      if (!e.absent && e.sets.length) byName.set(e.members.name, e.members.created_at);
    }
    return [...byName].sort((a, b) => a[1].localeCompare(b[1])).map(([name]) => name);
  };

  const v = mount(`
    <img class="hero" src="assets/banner.webp" alt="${esc(CONFIG.APP_NAME)}" width="1300" height="610">
    ${!members.length ? '<div class="notice">Start by adding the members of your group.</div>' : ''}
    ${active
      ? `<a class="btn cream big" href="#/w/${active.id}">Resume workout<small>Started ${fmtDate(active.started_at)}</small></a>`
      : `<button class="btn cream big" data-start ${members.length ? '' : 'disabled'}>Start workout</button>`}
    <div class="row nowrap">
      <a class="btn block grow tile" href="#/members">${ICONS.people}Members (${members.length})</a>
      <a class="btn block grow tile" href="#/exercises">${ICONS.dumbbell}Exercises</a>
    </div>
    <h2>Past workouts</h2>
    ${months.length ? `<div class="months">${months.map(k => `
      <button class="month ${k === pastMonth ? 'on' : ''}" data-month="${k}">${monthName(k)}<span>${past.filter(w => monthOf(w) === k).length}</span></button>`).join('')}</div>` : ''}
    <div data-past></div>
  `);

  function renderPast() {
    const shown = past.filter(w => monthOf(w) === pastMonth);
    v.querySelector('[data-past]').innerHTML = shown.length
      ? `<div class="list">${shown.map(w => {
          const t = totals(w);
          return `
          <a class="list-item past" href="#/w/${w.id}">
            <span class="past-head">
              <b>${fmtDate(w.started_at)}</b>
              ${t.sets ? `<span class="past-stats">${t.sets} sets${t.kg ? ` · ${t.kg.toLocaleString('en-GB')} kg` : ''}</span>` : ''}
            </span>
            <span class="muted small">${esc(summary(w))}</span>
            ${people(w).length ? `<span class="bubbles">${people(w).map(n => `<span class="bubble">${esc(n)}</span>`).join('')}</span>` : ''}
          </a>`;
        }).join('')}</div>`
      : '<p class="muted">No workouts yet.</p>';
  }
  renderPast();

  v.querySelector('.months')?.addEventListener('click', e => {
    const b = e.target.closest('[data-month]');
    if (!b) return;
    pastMonth = b.dataset.month;
    v.querySelectorAll('[data-month]').forEach(x => x.classList.toggle('on', x === b));
    renderPast();
  });

  v.querySelector('[data-start]')?.addEventListener('click', act(async () => {
    if (!await requireAuth()) return;
    const w = check(await sb.from('workouts').insert({}).select('id').single());
    go(`#/w/${w.id}`);
  }));
}

async function membersView(mount) {
  const [members, entries] = await Promise.all([
    sb.from('members').select('id, name').eq('active', true).order('created_at').then(check),
    sb.from('entries').select('member_id, sets, workout_exercises(workout_id)').eq('absent', false).then(check),
  ]);
  // Workouts each member logged at least one set in
  const sessions = new Map();
  for (const e of entries) {
    if (!e.sets.length || !e.workout_exercises) continue;
    if (!sessions.has(e.member_id)) sessions.set(e.member_id, new Set());
    sessions.get(e.member_id).add(e.workout_exercises.workout_id);
  }
  const count = id => sessions.get(id)?.size || 0;
  const v = mount(`
    <a class="back" href="#/">${CHEVRON}Home</a>
    <h1>Members</h1>
    <p class="sub">Everyone who trains together</p>
    <div class="list">
      ${members.map(m => `
        <a class="list-item link-row" href="#/m/${m.id}">
          <span class="grow">${esc(m.name)}</span>
          <span class="count-pill">${count(m.id)} session${count(m.id) === 1 ? '' : 's'}</span>
          <span class="muted">›</span>
        </a>`).join('') || '<p class="muted">No members yet.</p>'}
    </div>
    <h2>Add member</h2>
    <form class="row" data-add>
      <input class="grow" placeholder="Name" autocomplete="off" required>
      <button class="btn primary">Add</button>
    </form>
    <p class="muted">Tap a member to see their progress, rename or remove them.</p>
  `);

  v.querySelector('[data-add]').addEventListener('submit', act(async e => {
    e.preventDefault();
    const name = e.target.querySelector('input').value.trim();
    if (!name || !await requireAuth()) return;
    check(await sb.from('members').insert({ name }));
    router();
  }));
}

// Round-numbered y-axis ticks covering lo..hi
function niceTicks(lo, hi, count = 3) {
  if (lo === hi) { lo = Math.max(0, lo - 1); hi += 1; }
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(f => f * mag).find(s => s >= raw);
  const ticks = [];
  for (let t = Math.floor(lo / step) * step; ; t += step) {
    ticks.push(+t.toFixed(4));
    if (t >= hi) return ticks;
  }
}

// Line chart of one number over time. points: [{ t, v, label }]; returns the svg and each point's x for tap lookups
function lineChart(points, unit) {
  const W = 320, H = 150, L = 36, R = 16, T = 18, B = 22;
  const t0 = points[0].t, t1 = points[points.length - 1].t;
  const ticks = niceTicks(Math.min(...points.map(p => p.v)), Math.max(...points.map(p => p.v)));
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const x = t => L + (t1 === t0 ? 0.5 : (t - t0) / (t1 - t0)) * (W - L - R);
  const y = v => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const xs = points.map(p => x(p.t));
  const end = points[points.length - 1];
  const svg = `
    <svg class="chart chart-${unit === 'kg' ? 'kg' : 'reps'}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(unit)} over time">
      ${ticks.map(t => `
        <line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/>
        <text class="axis" x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${t}</text>`).join('')}
      <text class="axis" x="${xs[0]}" y="${H - 4}" text-anchor="start">${fmtShort(t0)}</text>
      ${points.length > 1 ? `<text class="axis" x="${xs[xs.length - 1]}" y="${H - 4}" text-anchor="end">${fmtShort(t1)}</text>` : ''}
      <line class="cross" x1="0" x2="0" y1="${T - 6}" y2="${H - B}" visibility="hidden"/>
      <path class="line" d="${points.map((p, k) => `${k ? 'L' : 'M'}${xs[k]},${y(p.v)}`).join('')}"/>
      ${points.map((p, k) => `<circle class="pt" data-k="${k}" cx="${xs[k]}" cy="${y(p.v)}" r="4.5"/>`).join('')}
      <text class="end-label" x="${xs[xs.length - 1]}" y="${y(end.v) - 10}" text-anchor="end">${end.v} ${esc(unit)}</text>
    </svg>`;
  return { svg, xs, W };
}

async function memberView(mount, id) {
  const [member, entries] = await Promise.all([
    sb.from('members').select('id, name, active').eq('id', id).maybeSingle().then(check),
    sb.from('entries')
      .select('sets, workout_exercises(created_at, workout_id, exercises(id, name, photo_path))')
      .eq('member_id', id)
      .eq('absent', false)
      .then(check),
  ]);
  if (!member) {
    mount(`<a class="back" href="#/members">${CHEVRON}Members</a><div class="notice">This member doesn’t exist anymore.</div>`);
    return;
  }

  // Every time they did each exercise, oldest first; the most recently done exercise comes first
  const byExercise = new Map();
  for (const e of entries.filter(e => e.sets.length && e.workout_exercises)) {
    const we = e.workout_exercises;
    if (!byExercise.has(we.exercises.id)) byExercise.set(we.exercises.id, { exercise: we.exercises, sessions: [] });
    byExercise.get(we.exercises.id).sessions.push({ t: new Date(we.created_at).getTime(), sets: e.sets });
  }
  const groups = [...byExercise.values()];
  for (const g of groups) g.sessions.sort((a, b) => a.t - b.t);
  groups.sort((a, b) => b.sessions[b.sessions.length - 1].t - a.sessions[a.sessions.length - 1].t);

  const sets = entries.flatMap(e => e.sets);
  const kg = sets.reduce((sum, x) => sum + (x.weight || 0) * (x.reps || 0), 0);
  const workouts = new Set(entries.filter(e => e.sets.length).map(e => e.workout_exercises?.workout_id));
  // Heaviest set, more reps breaking a tie
  const topSet = list => list.reduce((best, x) => (!best || beats(x, best) ? x : best), null);
  const mostReps = list => list.reduce((best, x) => (!best || (x.reps ?? 0) > (best.reps ?? 0) ? x : best), null);
  const hasKg = g => g.sessions.some(s => s.sets.some(x => x.weight));
  const metric = new Map(groups.map(g => [g.exercise.id, hasKg(g) ? 'kg' : 'reps']));
  const charts = new Map();

  function chartHtml(g) {
    const m = metric.get(g.exercise.id);
    if (g.sessions.length < 2) return '<p class="muted small">Done once so far. The chart shows up after the next time.</p>';
    const points = g.sessions.map(s => {
      const x = m === 'kg' ? topSet(s.sets) : mostReps(s.sets);
      return { t: s.t, v: (m === 'kg' ? x.weight : x.reps) ?? 0, label: `<span>${fmtShort(s.t)}</span>${kgRepsPills(x)}` };
    });
    const chart = lineChart(points, m);
    charts.set(g.exercise.id, { ...chart, points });
    return `
      ${hasKg(g) ? `
        <div class="seg" role="group" aria-label="Show">
          <button class="${m === 'kg' ? 'on' : ''}" data-metric="kg">Heaviest kg</button>
          <button class="${m === 'reps' ? 'on' : ''}" data-metric="reps">Most reps</button>
        </div>` : ''}
      ${chart.svg}
      <div class="readout">${points[points.length - 1].label}</div>`;
  }

  function cardHtml(g) {
    const all = g.sessions.flatMap(s => s.sets);
    const best = hasKg(g) ? topSet(all) : mostReps(all);
    const lastT = g.sessions[g.sessions.length - 1].t;
    return `
      <div class="card progress" data-ex="${g.exercise.id}">
        <div class="progress-head">
          ${exImg(g.exercise.photo_path)}
          <span class="grow col">
            <span class="ex-title">${esc(g.exercise.name)}</span>
            <span class="muted small">${g.sessions.length} time${g.sessions.length === 1 ? '' : 's'} · last ${fmtShort(lastT)}</span>
            <span class="best-line"><span class="best-label">Best:</span>${kgRepsPills(best)}</span>
          </span>
        </div>
        <div data-chart>${chartHtml(g)}</div>
        <details>
          <summary>Show all ${g.sessions.length} session${g.sessions.length === 1 ? '' : 's'} with sets</summary>
          ${[...g.sessions].reverse().map(s => `
            <div class="ms-row">
              <span class="muted small">${fmtDate(s.t)}</span>
              ${setGrid(s.sets.map((x, i) => ({ ...x, no: i + 1 })))}
            </div>`).join('')}
        </details>
      </div>`;
  }

  const v = mount(`
    <a class="back" href="#/members">${CHEVRON}Members</a>
    <h1>${esc(member.name)}</h1>
    <p class="sub">${member.active ? 'Progress over time' : 'No longer a member'}</p>
    ${statsHtml([
      { icon: 'calendar', value: workouts.size, label: `workout${workouts.size === 1 ? '' : 's'}`, tone: 'orange' },
      { icon: 'plates', value: sets.length, label: 'sets' },
      { icon: 'trophy', value: Math.round(kg).toLocaleString('en-GB'), label: 'kg lifted', tone: 'blue' },
    ])}
    <h2>Exercises</h2>
    ${groups.map(cardHtml).join('') || '<p class="muted">Nothing logged yet.</p>'}
    <h2>Settings</h2>
    <div class="list-item row">
      <input class="grow" value="${esc(member.name)}" data-rename aria-label="Name">
      ${member.active ? '<button class="btn small danger" data-remove>Remove</button>' : ''}
    </div>
    <p class="muted">Removed members keep their history but stop showing up in new workouts.</p>
  `);

  // Tap or drag along a chart to read any point
  function pick(chartEl, e) {
    const card = chartEl.closest('[data-ex]');
    const c = charts.get(card.dataset.ex);
    const rect = chartEl.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (c.W / rect.width);
    let k = 0;
    c.xs.forEach((x, j) => { if (Math.abs(x - px) < Math.abs(c.xs[k] - px)) k = j; });
    chartEl.querySelectorAll('.pt').forEach(p => p.classList.toggle('active', +p.dataset.k === k));
    const cross = chartEl.querySelector('.cross');
    cross.setAttribute('x1', c.xs[k]);
    cross.setAttribute('x2', c.xs[k]);
    cross.setAttribute('visibility', 'visible');
    card.querySelector('.readout').innerHTML = c.points[k].label;
  }
  v.addEventListener('pointerdown', e => { const c = e.target.closest('.chart'); if (c) pick(c, e); });
  v.addEventListener('pointermove', e => { const c = e.target.closest('.chart'); if (c && (e.buttons || e.pointerType === 'mouse')) pick(c, e); });

  v.addEventListener('click', e => {
    const b = e.target.closest('[data-metric]');
    if (!b) return;
    const card = b.closest('[data-ex]');
    metric.set(card.dataset.ex, b.dataset.metric);
    card.querySelector('[data-chart]').innerHTML = chartHtml(byExercise.get(card.dataset.ex));
  });

  v.querySelector('[data-rename]').addEventListener('change', act(async e => {
    const name = e.target.value.trim();
    if (!name || !await requireAuth()) return;
    check(await sb.from('members').update({ name }).eq('id', id));
    v.querySelector('h1').textContent = name;
  }));
  v.querySelector('[data-remove]')?.addEventListener('click', act(async () => {
    if (!confirm(`Remove ${member.name}?`) || !await requireAuth()) return;
    check(await sb.from('members').update({ active: false }).eq('id', id));
    go('#/members');
  }));
}

async function exercisesView(mount) {
  const exercises = check(await sb.from('exercises').select('id, name, photo_path').order('name'));
  const v = mount(`
    <a class="back" href="#/">${CHEVRON}Home</a>
    <h1>Exercises</h1>
    <p class="sub">Add exercises here so they're ready to pick in a workout</p>
    <form class="row nowrap" data-add style="margin-bottom:16px">
      <input class="grow" placeholder="New exercise name" autocomplete="off" required>
      <button class="btn primary">Add</button>
    </form>
    <div class="list">
      ${exercises.map(e => `
        <div class="list-item row">
          <label class="photo-pick" aria-label="${e.photo_path ? 'Change' : 'Add'} photo">
            ${exImg(e.photo_path)}
            <span class="cam"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg></span>
            <input type="file" accept="image/*" hidden data-photo="${e.id}">
          </label>
          <input class="grow" value="${esc(e.name)}" data-rename="${e.id}" aria-label="Name">
          <button class="btn small danger" data-remove="${e.id}">Delete</button>
        </div>`).join('') || '<p class="muted">No exercises yet.</p>'}
    </div>
  `);

  // Tap a thumbnail to take or choose a photo for that exercise
  v.querySelector('.list').addEventListener('change', act(async e => {
    const input = e.target.closest('[data-photo]');
    const file = input?.files?.[0];
    if (!file || !await requireAuth()) return;
    const exercise = exercises.find(x => x.id === input.dataset.photo);
    input.closest('.photo-pick').classList.add('busy');
    try {
      await uploadExercisePhoto(exercise, file);
    } finally {
      router();
    }
  }));

  v.querySelector('[data-add]').addEventListener('submit', act(async e => {
    e.preventDefault();
    const name = e.target.querySelector('input').value.trim();
    if (!name || !await requireAuth()) return;
    const { error } = await sb.from('exercises').insert({ name });
    if (error?.code === '23505') return alert(`${name} already exists`);
    check({ error });
    router();
  }));
  v.querySelectorAll('[data-rename]').forEach(input => input.addEventListener('change', act(async () => {
    const name = input.value.trim();
    if (!name || !await requireAuth()) return;
    check(await sb.from('exercises').update({ name }).eq('id', input.dataset.rename));
  })));
  v.querySelectorAll('[data-remove]').forEach(btn => btn.addEventListener('click', act(async () => {
    if (!confirm('Delete this exercise?') || !await requireAuth()) return;
    const { error } = await sb.from('exercises').delete().eq('id', btn.dataset.remove);
    if (error?.code === '23503') return alert('This exercise has been used in a workout, so it can\'t be deleted.');
    check({ error });
    router();
  })));
}

let openCards = new Set(), openCardsFor = null; // exercises expanded on the workout page, kept across live refreshes

async function workoutView(mount, wid) {
  if (openCardsFor !== wid) { openCardsFor = wid; openCards = new Set(); }
  const w = check(await sb.from('workouts')
    .select('id, started_at, finished_at, workout_exercises(id, created_at, exercises(name, photo_path), entries(absent, sets, members(name, created_at)))')
    .eq('id', wid)
    .maybeSingle());
  if (!w) {
    mount('<div class="notice">This workout doesn’t exist anymore.</div><a class="btn" href="#/">Home</a>');
    return;
  }
  const wes = [...w.workout_exercises].sort(byCreated);

  // One row per member who was there: reps above kg for each set; absent members on one line
  function memberRows(we) {
    const entries = [...we.entries].sort((a, b) => byCreated(a.members, b.members));
    const absent = entries.filter(e => e.absent).map(e => e.members.name);
    return entries.filter(e => !e.absent).map(e => `
      <div class="ms-row">
        <div class="ms-head">
          <span class="ms-name">${esc(e.members.name)}</span>
          <span class="muted small">${e.sets.length ? `${e.sets.length} set${e.sets.length === 1 ? '' : 's'}` : 'No sets yet'}</span>
        </div>
        ${e.sets.length ? setGrid(e.sets.map((x, i) => ({ ...x, no: i + 1 }))) : ''}
      </div>`).join('') + (absent.length ? `<div class="ms-row"><div class="ms-head"><span class="muted small">Not here: ${esc(absent.join(', '))}</span></div></div>` : '');
  }
  const isDone = we => we.entries.length && we.entries.every(e => e.absent || e.sets.length);
  const participants = we => [...we.entries].sort((a, b) => byCreated(a.members, b.members))
    .filter(e => !e.absent && e.sets.length).map(e => e.members.name);

  const allSets = wes.flatMap(we => we.entries.flatMap(e => (e.absent ? [] : e.sets)));
  const kg = allSets.reduce((sum, x) => sum + (x.weight || 0) * (x.reps || 0), 0);
  // Everyone who logged a set, in the usual member order
  const people = new Set(wes.flatMap(we => we.entries.filter(e => !e.absent && e.sets.length))
    .map(e => e.members).sort(byCreated).map(m => m.name));
  const stats = statsHtml([
    { icon: 'dumbbell', value: wes.length, label: `exercise${wes.length === 1 ? '' : 's'}`, tone: 'orange' },
    { icon: 'plates', value: allSets.length, label: 'sets' },
    { icon: 'trophy', value: Math.round(kg).toLocaleString('en-GB'), label: 'kg lifted', tone: 'blue' },
  ]);

  const v = mount(`
    <a class="back" href="#/">${CHEVRON}Home</a>
    <h1>${w.finished_at ? 'Workout' : 'Today’s Workout'}</h1>
    <p class="sub">${fmtDate(w.started_at)}</p>
    ${people.size ? `<div class="bubbles workout-people">${[...people].map(n => `<span class="bubble">${esc(n)}</span>`).join('')}</div>` : ''}
    ${allSets.length ? stats : ''}
    <div class="panel">
    ${wes.map(we => `
      <div class="card ex-summary ${openCards.has(we.id) ? 'open' : ''}">
        <button class="ex-summary-head" data-expand>
          ${exImg(we.exercises.photo_path)}
          <span class="grow col">
            <span class="ex-title">${esc(we.exercises.name)}</span>
            ${participants(we).length ? '' : '<span class="muted small">No sets yet</span>'}
          </span>
          <span class="check ${isDone(we) ? 'done' : ''}"></span>
          <span class="chev">▾</span>
        </button>
        <div class="ex-details" data-we="${we.id}" ${openCards.has(we.id) ? '' : 'hidden'}>
          ${memberRows(we)}
          <a class="btn small" href="#/w/${wid}/edit/${we.id}" style="margin-top:12px">Open exercise</a>
        </div>
      </div>`).join('') || '<p class="muted center">No exercises yet.</p>'}
      <a class="btn dashed big" href="#/w/${wid}/pick"><span class="plus-dot">+</span>Add exercise</a>
    </div>
    ${w.finished_at ? '' : '<button class="btn primary block" data-finish>Finish workout</button>'}
    <button class="btn small danger" data-delete>Delete workout</button>
  `);

  // Tap an exercise to show or hide its sets
  v.querySelectorAll('[data-expand]').forEach(head => head.addEventListener('click', () => {
    const details = head.nextElementSibling;
    details.hidden = !details.hidden;
    head.closest('.ex-summary').classList.toggle('open', !details.hidden);
    if (details.hidden) openCards.delete(details.dataset.we); else openCards.add(details.dataset.we);
  }));

  // Sets logged on another phone show up here as they're saved
  let refreshTimer = null, connected = false; // (a reconnect refreshes; the first connect comes right after loading)
  const refresh = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => router(true), 500);
  };
  onLeave(() => clearTimeout(refreshTimer));
  subscribe([
    { event: 'INSERT', table: 'workout_exercises', filter: `workout_id=eq.${wid}` },
    ...(wes.length ? [{ event: '*', table: 'entries', filter: `workout_exercise_id=in.(${wes.map(we => we.id).join(',')})` }] : []),
  ], refresh, () => { if (connected) refresh(); else connected = true; });

  function workoutSummary() {
    return `
      <div class="sheet-title">Workout finished 🎉</div>
      <p class="sub">${fmtDate(w.started_at)} · ${people.size} member${people.size === 1 ? '' : 's'}</p>
      ${stats}
      ${wes.map(we => `
        <div class="sheet-row">
          <b>${esc(we.exercises.name)}</b>
          <span class="muted small">${esc(participants(we).join(', ')) || 'No sets'}</span>
        </div>`).join('')}`;
  }

  v.querySelector('[data-finish]')?.addEventListener('click', act(async () => {
    if (!await requireAuth()) return;
    if (!wes.length) {
      check(await sb.from('workouts').delete().eq('id', wid)); // nothing logged, don't keep an empty workout
      return go('#/');
    }
    check(await sb.from('workouts').update({ finished_at: new Date().toISOString() }).eq('id', wid));
    await showSheet(workoutSummary());
    go('#/');
  }));
  v.querySelector('[data-delete]').addEventListener('click', act(async () => {
    if (!confirm('Delete this whole workout? This cannot be undone.') || !await requireAuth()) return;
    check(await sb.from('workouts').delete().eq('id', wid));
    go('#/');
  }));
}

async function pickView(mount, wid) {
  const [exercises, used] = await Promise.all([
    sb.from('exercises').select('id, name, photo_path').order('name').then(check),
    sb.from('workout_exercises').select('id, exercise_id').eq('workout_id', wid).then(check),
  ]);
  const usedBy = new Map(used.map(u => [u.exercise_id, u.id]));

  const v = mount(`
    <a class="back" href="#/w/${wid}">${CHEVRON}Workout</a>
    <h1>Add exercise</h1>
    <p class="sub">Pick one you've done before, or type a new name</p>
    <div class="search">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input type="search" placeholder="Search exercises…" data-search autocomplete="off">
    </div>
    <div data-list></div>
  `);
  const search = v.querySelector('[data-search]');
  const list = v.querySelector('[data-list]');

  function renderList() {
    const q = search.value.trim();
    const matches = exercises.filter(e => e.name.toLowerCase().includes(q.toLowerCase()));
    const exact = exercises.some(e => e.name.toLowerCase() === q.toLowerCase());
    list.innerHTML = `
      ${q && !exact ? `
        <button class="ex-card" data-create>
          ${exImg(null)}
          <span class="ex-info"><span class="ex-title">“${esc(q)}”</span><span class="muted">Create new exercise</span></span>
          <span class="ex-side"><span class="plus">+</span></span>
        </button>` : ''}
      ${matches.map(e => `
        <button class="ex-card" data-id="${e.id}">
          ${exImg(e.photo_path)}
          <span class="ex-info">
            <span class="ex-title">${esc(e.name)}</span>
            ${usedBy.has(e.id) ? '<span class="tag">✓ In this workout</span>' : ''}
          </span>
          <span class="ex-side">${usedBy.has(e.id) ? '<span class="check done"></span>' : '<span class="plus">+</span>'}</span>
        </button>`).join('')}
      ${!q && !exercises.length ? '<p class="muted">No exercises yet. Type a name above to create one.</p>' : ''}
    `;
  }
  renderList();
  search.addEventListener('input', renderList);

  list.addEventListener('click', act(async e => {
    const item = e.target.closest('button');
    if (!item) return;
    if (item.dataset.id) {
      const weId = usedBy.get(item.dataset.id);
      return go(weId ? `#/w/${wid}/edit/${weId}` : `#/w/${wid}/new/${item.dataset.id}`);
    }
    if (item.hasAttribute('data-create')) {
      if (!await requireAuth()) return;
      const ex = check(await sb.from('exercises').insert({ name: search.value.trim() }).select('id').single());
      go(`#/w/${wid}/new/${ex.id}`);
    }
  }));
}

// For each member: the most recent time they did this exercise (skipping times they were not there)
async function lastTime(exerciseId, wid, before) {
  let q = sb.from('workout_exercises')
    .select('id, created_at')
    .eq('exercise_id', exerciseId)
    .neq('workout_id', wid)
    .order('created_at', { ascending: false })
    .limit(50);
  if (before) q = q.lt('created_at', before);
  const wes = check(await q);
  const result = new Map();
  if (!wes.length) return result;

  const entries = check(await sb.from('entries')
    .select('member_id, sets, workout_exercise_id')
    .in('workout_exercise_id', wes.map(we => we.id))
    .eq('absent', false));
  const order = new Map(wes.map((we, i) => [we.id, i]));
  entries.sort((a, b) => order.get(a.workout_exercise_id) - order.get(b.workout_exercise_id));
  for (const e of entries) {
    if (e.sets.length && !result.has(e.member_id)) {
      result.set(e.member_id, { sets: e.sets, date: wes[order.get(e.workout_exercise_id)].created_at });
    }
  }
  return result;
}

async function logView(mount, wid, mode, id) {
  let weId = mode === 'edit' ? id : null;
  let exercise, weCreated = null, existing = [], finished = false;

  if (weId) {
    const we = check(await sb.from('workout_exercises')
      .select('*, exercises(id, name, photo_path), entries(member_id, absent, sets)')
      .eq('id', weId)
      .single());
    exercise = we.exercises;
    weCreated = we.created_at;
    existing = we.entries;
    finished = !!we.finished_at;
  } else {
    // Already in this workout (e.g. added on another phone): open that one instead of adding it twice
    const found = check(await sb.from('workout_exercises').select('id').eq('workout_id', wid).eq('exercise_id', id).order('created_at').limit(1))[0];
    if (found) {
      const newKey = `draft2:${wid}:new-${id}`, editKey = `draft2:${wid}:${found.id}`;
      if (draft.load(newKey) && !draft.load(editKey)) draft.save(editKey, draft.load(newKey));
      draft.clear(newKey);
      location.replace(`#/w/${wid}/edit/${found.id}`);
      return;
    }
    exercise = check(await sb.from('exercises').select('id, name, photo_path').eq('id', id).single());
  }

  const [allMembers, last, siblings, workout] = await Promise.all([
    sb.from('members').select('id, name, active').order('created_at').then(check),
    lastTime(exercise.id, wid, weCreated),
    sb.from('workout_exercises').select('*, entries(member_id, absent, sets)').eq('workout_id', wid).then(check),
    sb.from('workouts').select('*').eq('id', wid).maybeSingle().then(check),
  ]);
  const existingBy = new Map(existing.map(e => [e.member_id, e]));
  const others = siblings.filter(x => x.id !== weId).sort(byCreated);
  // Another phone's exercise still going (sets logged, not finished): the group is split, e.g. half on bench and half
  // on triceps with a phone each. (Without the finished_at column every exercise counts as finished.)
  const lastExKey = `ex:${wid}`; // the exercise this phone logged last in this workout
  const ongoing = we => 'finished_at' in we && !we.finished_at && we.entries.some(e => !e.absent && e.sets.length);
  const split = others.some(we => ongoing(we) && we.exercise_id !== draft.load(lastExKey));
  // Whoever was not here in the latest exercise of this workout is still not here. While the group is split that's
  // the latest exercise of this phone's group (the one this phone logged last), else simply the latest one. Whoever
  // has done sets in this workout is here though: a mix-up on one exercise mustn't spread to the next ones (but while
  // split, "not here" just means in the other group).
  const wasAbsent = new Map(), lifted = new Set();
  for (const we of others) {
    for (const e of we.entries) {
      if (!split || we.exercise_id === draft.load(lastExKey)) wasAbsent.set(e.member_id, e.absent);
      if (!split && !e.absent && e.sets.length) lifted.add(e.member_id);
    }
  }
  const members = allMembers.filter(m => m.active || existingBy.has(m.id));
  const memberById = new Map(members.map(m => [m.id, m]));
  // A set in the form: values as typed, plus whether it has been confirmed (only confirmed sets are saved)
  const toInput = (s, done) => ({ reps: String(s.reps ?? ''), weight: String(s.weight ?? ''), done });
  const copySet = s => ({ reps: s ? String(s.reps ?? '') : '10', weight: s?.weight != null ? String(s.weight) : '', done: false });

  // Local copy of the input (and where the guided flow is), so blank sets and the guided position survive too
  let draftKey = `draft2:${wid}:${weId || 'new-' + exercise.id}`;
  const saved = draft.load(draftKey) || {};
  const state = saved.members || {};
  // Someone without history gets the set count the others did last time (the most common one, higher on a tie)
  const counts = {};
  for (const l of last.values()) counts[l.sets.length] = (counts[l.sets.length] || 0) + 1;
  const groupSets = +Object.keys(counts).sort((a, b) => counts[b] - counts[a] || b - a)[0] || DEFAULT_SETS;

  // Only members changed on this phone are saved, so two phones logging different people never overwrite each other.
  // savedSig: each member's row as the database has it (or as this phone last handed it to the outbox).
  const rowOf = s => ({ absent: s.absent, sets: s.absent ? [] : s.sets.filter(x => x.done)
    .map(x => ({ reps: num(x.reps), weight: num(x.weight) })).filter(x => x.reps != null) });
  const sig = rowSig;
  const NO_ROW = sig({ absent: false, sets: [] });
  const savedSig = new Map();
  const sent = new Map(); // member -> rows this phone saved, so their echo from the database is ignored
  const inferred = new Set(); // "not here" carried over from the last exercise, not chosen on this exercise
  // Puts a row from the database into a member's state, keeping sets that are planned but not done yet
  function takeRow(s, row) {
    s.absent = row.absent;
    if (row.absent) return;
    const done = row.sets.map(x => toInput(x, true));
    s.sets = [...done, ...s.sets.slice(done.length).map(x => ({ ...x, done: false }))];
  }

  for (const m of members) {
    const ex = existingBy.get(m.id);
    const dbSig = ex ? sig(ex) : NO_ROW;
    savedSig.set(m.id, dbSig);
    if (state[m.id]) {
      for (const set of state[m.id].sets) set.done ??= set.reps !== ''; // drafts from before sets had a done flag
      // Changed on another phone since this draft, and nothing changed here: take theirs
      const base = saved.base?.[m.id];
      if (ex && base != null && sig(rowOf(state[m.id])) === base && dbSig !== base) takeRow(state[m.id], ex);
      continue;
    }
    const prev = last.get(m.id)?.sets;
    state[m.id] = ex && (ex.absent || ex.sets.length)
      ? { absent: ex.absent, sets: ex.sets.map(x => toInput(x, true)) }
      // Start from what they did last time; they just confirm or adjust each set
      : { absent: wasAbsent.get(m.id) === true && !lifted.has(m.id), sets: prev ? prev.map(x => toInput(x, false)) : Array.from({ length: groupSets }, () => copySet()) };
    if (!ex && state[m.id].absent) inferred.add(m.id);
  }
  // Guided flow: members take turns, each doing their next set. On the workout's first exercise the order is picked
  // as set 1 goes (whoever goes next is tapped), then kept for every set and exercise after that. It's stored on the
  // workout so every phone uses the same one. While the group is split, each phone keeps its own order instead (the
  // shared one would start with the other group): picked on its first exercise like that, then reused on this phone.
  const orderKey = split ? `order:${wid}:split` : `order:${wid}`;
  let picking = !!saved.picking; // picking the order: `order` holds whoever has been picked so far
  let order = saved.order || (split ? null : workout?.member_order) || draft.load(orderKey);
  if (order) {
    order = order.filter(mid => state[mid]);
    if (!picking) order.push(...members.map(m => m.id).filter(mid => !order.includes(mid)));
  }
  let cursor = order ? saved.cursor || null : null; // { r: set index, i: index in order } while guided
  let choosing = false; // showing "who's next?"
  let resume = saved.resume || null; // { r, mid }: where the guided flow was last, so Continue picks up there
  let showList = null; // null: closed while there are sets to do, open once everything is done
  const saveDraft = () => draft.save(draftKey, { members: state, order, picking, cursor, resume, base: Object.fromEntries(savedSig) });
  let sharedOrder = JSON.stringify(workout?.member_order ?? null);
  const persist = () => {
    saveDraft();
    if (order && !picking) {
      draft.save(orderKey, order);
      if (!split && JSON.stringify(order) !== sharedOrder) {
        sharedOrder = JSON.stringify(order);
        sb.from('workouts').update({ member_order: order }).eq('id', wid)
          .then(({ error }) => { if (error) console.warn('Order not shared:', error.message); });
      }
    }
    scheduleSave();
  };

  // ----- autosave: changes go to the outbox shortly after they're made, and from there to the database -----

  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 800);
    refreshStatus();
  }
  // Hands the members that changed here to the outbox (safe on the phone from then on)
  function queueChanges() {
    clearTimeout(saveTimer);
    saveTimer = null;
    const rows = {};
    for (const m of members) {
      const row = rowOf(state[m.id]), s = sig(row);
      if (s === savedSig.get(m.id)) continue;
      rows[m.id] = { ...row, soft: inferred.has(m.id), base: savedSig.get(m.id) };
      savedSig.set(m.id, s);
      if (!sent.has(m.id)) sent.set(m.id, new Set());
      sent.get(m.id).add(s);
    }
    if (Object.keys(rows).length) queueSave(wid, exercise.id, weId, rows);
    saveDraft();
  }
  function saveNow() {
    queueChanges();
    return flushSaves();
  }

  // Once the exercise is in the database (added by this phone's first save, or by another phone): from now on it's
  // an existing exercise of the workout
  function adopt(id) {
    if (weId) return;
    weId = id;
    history.replaceState(null, '', `#/w/${wid}/edit/${weId}`);
    draft.clear(draftKey);
    draftKey = `draft2:${wid}:${weId}`;
    saveDraft();
    listen();
  }
  const onWeId = e => { if (e.detail.wid === wid && e.detail.exerciseId === exercise.id) adopt(e.detail.weId); };
  window.addEventListener('gb:weid', onWeId);
  onLeave(() => window.removeEventListener('gb:weid', onWeId));

  const waiting = () => !!outboxItem(wid, exercise.id);
  let statusShown = false;
  function refreshStatus() {
    if (saveTimer) statusShown = true;
    if (!statusShown) return;
    if (saveTimer || (waiting() && flushing)) setStatus('Saving…');
    else if (waiting()) setStatus('Saved on this phone · uploads when there’s signal', 'wait');
    else setStatus('Saved ✓');
  }
  window.addEventListener('gb:outbox', refreshStatus);
  onLeave(() => window.removeEventListener('gb:outbox', refreshStatus));

  // ----- live: sets saved on another phone -----

  const refetch = () => sb.from('entries').select('member_id, absent, sets').eq('workout_exercise_id', weId)
    .then(({ data }) => data?.forEach(applyRemote));
  function listen() {
    subscribe([{ event: '*', table: 'entries', filter: `workout_exercise_id=eq.${weId}` }],
      ({ new: row }) => row?.member_id && applyRemote(row), refetch);
  }
  // A change from here wasn't saved because another phone had logged more sets for them: show those
  const onTheirs = e => { if (weId && e.detail.wid === wid && e.detail.exerciseId === exercise.id) refetch(); };
  window.addEventListener('gb:theirs', onTheirs);
  onLeave(() => window.removeEventListener('gb:theirs', onTheirs));
  // Reps or kg typed in the step on screen and not confirmed yet
  function stepEdited() {
    const reps = body.querySelector('[data-step] [data-f="reps"]'), weight = body.querySelector('[data-step] [data-f="weight"]');
    const set = state[order[cursor.i]].sets[cursor.r];
    return !!reps && (reps.value.trim() !== set.reps || (!!set.weight && weight.value.trim() !== set.weight));
  }
  function applyRemote(row) {
    const mid = row.member_id, s = state[mid];
    if (!s) return;
    const remote = sig(row);
    if (remote === savedSig.get(mid) || sent.get(mid)?.has(remote)) return; // nothing new, or this phone's own save
    // Changed here and not uploaded yet: this phone's version wins
    if (sig(rowOf(s)) !== savedSig.get(mid) || pendingRows(outboxItem(wid, exercise.id) || {})[mid]) return;
    const onScreen = cursor && order[cursor.i] === mid;
    // "Not here" from another phone for someone whose set is on screen here is a mix-up, e.g. "That's everyone" tapped
    // there before their first set arrived: they stay, and are saved again so the other phone sees them back
    if (row.absent && !s.absent && onScreen) {
      savedSig.set(mid, remote);
      sent.delete(mid);
      inferred.delete(mid);
      return scheduleSave();
    }
    if (onScreen && stepEdited()) return;
    takeRow(s, row);
    savedSig.set(mid, remote);
    sent.delete(mid);
    inferred.delete(mid);
    saveDraft();
    if (cursor && !onScreen) { // the step on screen is someone else's; only who's next may have changed
      const label = body.querySelector('[data-g="next"] small');
      if (label) label.textContent = nextLabel(nextTodo(cursor));
      return;
    }
    // Redraw, keeping the keyboard where it was
    const f = document.activeElement;
    const sel = f?.matches?.('.set-row input')
      ? (f.dataset.m ? `[data-m="${f.dataset.m}"][data-i="${f.dataset.i}"][data-f="${f.dataset.f}"]` : `[data-step] [data-f="${f.dataset.f}"]`)
      : null;
    render();
    if (sel) body.querySelector(sel)?.focus();
  }

  const eligible = (r, i) => { const s = state[order[i]]; return !!s && !s.absent && r < s.sets.length; };
  const isTodo = p => eligible(p.r, p.i) && !state[order[p.i]].sets[p.r].done;
  const same = (a, b) => a && b && a.r === b.r && a.i === b.i;
  const after = (a, b) => a.r > b.r || (a.r === b.r && a.i > b.i);
  const rounds = () => Math.max(0, ...members.filter(m => !state[m.id].absent).map(m => state[m.id].sets.length));
  function slots() {
    const list = [];
    for (let r = 0; r < rounds(); r++) for (let i = 0; i < order.length; i++) if (eligible(r, i)) list.push({ r, i });
    return list;
  }
  // Taking turns: the next member in the order after `from` who has a set left does their first unfinished one.
  // So someone who shows up late (and goes to the back of the order) does set 1 when it's their turn.
  function nextTodo(from) {
    const start = from ? from.i + 1 : 0;
    for (let k = 0; k < order.length; k++) {
      const i = (start + k) % order.length;
      const s = state[order[i]];
      if (!s || s.absent) continue;
      // (the set we're coming from doesn't count, so whoever is last left just carries on with their next set)
      const r = s.sets.findIndex((x, j) => !x.done && !same({ r: j, i }, from));
      if (r >= 0) return { r, i };
    }
    return null;
  }

  // Once a set is confirmed, the next one starts from those reps, or last time's reps for it if that was more
  function carryReps(mid, j) {
    const sets = state[mid].sets;
    const next = sets[j + 1];
    if (!next || next.done || next.edited) return;
    next.reps = String(Math.max(num(sets[j].reps) ?? 0, last.get(mid)?.sets[j + 1]?.reps ?? 0));
  }
  const hasTodo = () => members.some(m => !state[m.id].absent && state[m.id].sets.some(s => !s.done));

  const v = mount(`
    <a class="back" href="#/w/${wid}">${CHEVRON}Workout</a>
    <h1>${esc(exercise.name)}</h1>
    <button class="save-status" data-status></button>
    <div class="photo-block" data-photo></div>
    <div data-body></div>
    <div class="sticky-bottom" data-bottom></div>
  `);
  const photoEl = v.querySelector('[data-photo]');
  const body = v.querySelector('[data-body]');
  const bottom = v.querySelector('[data-bottom]');
  const statusEl = v.querySelector('[data-status]');

  function setStatus(text, wait) {
    statusEl.textContent = text;
    statusEl.classList.toggle('wait', !!wait);
  }
  statusEl.addEventListener('click', () => saveNow());
  // Leaving only has to get the changes into the outbox; uploading carries on in the background
  leaveHook = () => {
    saveNow();
    if (sent.size) draft.save(lastExKey, exercise.id); // (just looking at one doesn't count)
    if (!hasTodo()) markFinished();
  };

  // Done with (Complete pressed, or left with every set done): from now on it no longer counts as still going
  function markFinished() {
    if (finished || !(weId || waiting())) return;
    finished = true;
    (async () => {
      const id = weId || await ensureWorkoutExercise(wid, exercise.id);
      const { error } = await sb.from('workout_exercises').update({ finished_at: new Date().toISOString() }).eq('id', id);
      if (error) console.warn('Not marked finished:', error.message);
    })().catch(() => {});
  }

  // ----- photo -----

  function renderPhoto(busy) {
    photoEl.innerHTML = `
      ${exercise.photo_path ? `<img class="ex-photo" src="${esc(photoUrl(exercise.photo_path))}" alt="">` : ''}
      <label class="btn small ${exercise.photo_path ? 'on-photo' : ''}">${busy ? 'Uploading…' : exercise.photo_path ? '📷 Change' : '📷 Add photo'}
        <input type="file" accept="image/*" capture="environment" hidden ${busy ? 'disabled' : ''}>
      </label>`;
  }
  photoEl.addEventListener('change', act(async e => {
    const file = e.target.files?.[0];
    if (!file || !await requireAuth()) return;
    renderPhoto(true);
    try {
      exercise.photo_path = await uploadExercisePhoto(exercise, file);
    } finally {
      renderPhoto();
    }
  }));
  renderPhoto();

  // ----- list mode: every member as a card -----

  const TICK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  function cardHtml(m) {
    const s = state[m.id];
    const l = last.get(m.id);
    const ls = l?.sets || [];
    if (s.absent) {
      return `
        <div class="absent-row">
          <span class="grow">${esc(m.name)}</span>
          <button class="btn small" data-absent="${m.id}">Here</button>
        </div>`;
    }
    return `
      <div class="card member">
        <div class="card-head">
          <div class="col"><h3>${esc(m.name)}</h3><span class="muted small">${l ? `Last time ${fmtShort(l.date)}` : 'First time'}</span></div>
          <button class="btn small ghost" data-absent="${m.id}">Not here</button>
        </div>
        ${s.sets.length ? `<div class="set-head"><span>Set</span><span>Previous</span><span>kg</span><span>Reps</span><span>${TICK}</span></div>` : ''}
        ${s.sets.map((set, i) => `
          <div class="set-row ${set.done ? 'done' : ''}">
            <span class="set-no">${i + 1}</span>
            <span class="prev">${ls[i] ? esc(fmtKgReps(ls[i])) : '—'}</span>
            <input inputmode="decimal" data-m="${m.id}" data-i="${i}" data-f="weight" value="${esc(set.weight)}" placeholder="kg" aria-label="Weight">
            <input inputmode="numeric" data-m="${m.id}" data-i="${i}" data-f="reps" value="${esc(set.reps)}" placeholder="reps" aria-label="Reps">
            <button class="tick" data-tick="${m.id}" data-i="${i}" aria-label="Set done">${TICK}</button>
          </div>`).join('')}
        <div class="row">
          <button class="btn small" data-addset="${m.id}">+ Set</button>
          ${s.sets.length ? `<button class="btn small" data-delset="${m.id}">− Set</button>` : ''}
        </div>
      </div>`;
  }

  const listOpen = () => showList ?? (!hasTodo() && members.some(m => state[m.id].sets.some(x => x.done)));

  function renderList() {
    const anyDone = members.some(m => state[m.id].sets.some(x => x.done));
    const todo = hasTodo();
    const ordered = order ? [...order.map(mid => memberById.get(mid)).filter(Boolean), ...members.filter(m => !order.includes(m.id))] : members;
    const present = ordered.filter(m => !state[m.id].absent);
    const absent = ordered.filter(m => state[m.id].absent);
    body.innerHTML = `
      <div class="card stepper">
        <span class="grow">Sets for everyone</span>
        <button class="btn small" data-sets="-1" aria-label="One set fewer">−</button>
        <b>${rounds()}</b>
        <button class="btn small" data-sets="1" aria-label="One set more">+</button>
      </div>
      ${todo
        ? `<button class="btn cream big" data-g="start">▶ ${anyDone ? 'Continue' : 'Start'}<small>One person at a time, set by set</small></button>`
        : anyDone ? `
          <div class="all-done">
            <span class="all-done-icon">${TICK}</span>
            <span class="grow col"><b>All sets done!</b><span>Nice work, everyone 💪</span></span>
            <button class="btn small" data-g="round">+ Round</button>
          </div>` : ''}
      <button class="btn block" data-toggle-list>${listOpen() ? 'Hide sets ▴' : `Show all sets ▾<small>${present.length} here${absent.length ? `, ${absent.length} not here` : ''}</small>`}</button>
      ${listOpen() ? `
        ${present.map(cardHtml).join('')}
        ${absent.length ? `<h2>Not here</h2>${absent.map(cardHtml).join('')}` : ''}` : ''}
      ${weId ? '<button class="btn small danger" data-remove>Remove from workout</button>' : ''}
    `;
    // Start is the obvious next step; Complete only becomes the main button once all sets are done
    bottom.innerHTML = `<button class="btn ${todo ? '' : 'primary'} big" data-done>Complete exercise →</button>`;
  }

  // Confetti and a message when a confirmed set beats the same set last time
  function cheerIfBest(mid, j) {
    if (!beats(state[mid].sets[j], last.get(mid)?.sets[j])) return;
    celebrate();
    toast(`New best for ${memberById.get(mid).name}! 🎉`);
  }

  function exerciseSummary() {
    const rows = members.filter(m => !state[m.id].absent).map(m => {
      const ls = last.get(m.id)?.sets || [];
      const done = state[m.id].sets.map((x, j) => ({ x, j })).filter(({ x }) => x.done);
      if (!done.length) return '';
      const best = done.some(({ x, j }) => beats(x, ls[j]));
      return `
        <div class="sheet-row">
          <div class="ms-head"><b>${esc(m.name)}</b>${best ? '<span class="best-tag">⬆ New best</span>' : ''}</div>
          ${setGrid(done.map(({ x, j }) => ({ ...x, no: j + 1, best: beats(x, ls[j]) })))}
        </div>`;
    }).join('');
    const absent = members.filter(m => state[m.id].absent).map(m => m.name);
    const setTotal = members.reduce((n, m) => n + (state[m.id].absent ? 0 : state[m.id].sets.filter(x => x.done).length), 0);
    return `
      <div class="sheet-title">${esc(exercise.name)}</div>
      <p class="sub">Exercise complete 💪 · ${setTotal} set${setTotal === 1 ? '' : 's'}</p>
      ${rows || '<p class="muted">No sets were logged.</p>'}
      ${absent.length ? `<p class="muted small">Not here: ${esc(absent.join(', '))}</p>` : ''}`;
  }

  // ----- guided mode: one member and one set at a time -----

  // The weight of the nearest member before `i` in the order who has done set `r` with a weight
  function weightBefore(r, i) {
    for (let k = 1; k < order.length; k++) {
      const set = state[order[(i - k + order.length) % order.length]]?.sets[r];
      if (set?.done && set.weight) return set.weight;
    }
    return '';
  }

  // The current member's whole set table; the current set is editable, tap another set to jump to it
  function renderStep() {
    const { r, i } = cursor;
    const m = memberById.get(order[i]);
    const s = state[m.id];
    const ls = last.get(m.id)?.sets || [];
    const next = nextTodo(cursor);
    const isFirst = same(slots()[0], cursor);

    const row = (x, j) => {
      const cells = `<span class="set-no">${j + 1}</span><span class="prev">${ls[j] ? esc(fmtKgReps(ls[j])) : '—'}</span>`;
      if (j === r) {
        // Weight usually stays the same, so fall back to the previous set's; someone doing this exercise for the
        // first time starts from the weight of whoever went before them in this round
        const weight = x.weight || s.sets[j - 1]?.weight || (!last.has(m.id) && weightBefore(r, i)) || '';
        return `
          <div class="set-row current ${x.done ? 'done' : ''}" data-step>
            ${cells}
            <input readonly data-f="weight" value="${esc(weight)}" placeholder="kg" aria-label="Weight">
            <input readonly data-f="reps" value="${esc(x.reps)}" placeholder="reps" aria-label="Reps">
            <span class="tick">${TICK}</span>
          </div>`;
      }
      return `
        <div class="set-row ${x.done ? 'done' : 'upcoming'}" data-jump="${j}">
          ${cells}
          <span class="val">${esc(x.weight) || '–'}</span>
          <span class="val">${esc(x.reps) || '–'}</span>
          <span class="tick">${TICK}</span>
        </div>`;
    };

    body.innerHTML = `
      <div class="step">
        <div class="step-meta">Set ${r + 1} of ${s.sets.length}</div>
        <div class="step-name">${esc(m.name)}</div>
        <div class="set-head"><span>Set</span><span>Previous</span><span>kg</span><span>Reps</span><span>${TICK}</span></div>
        ${s.sets.map(row).join('')}
        <button class="btn primary big" data-g="next">Next →<small>${esc(nextLabel(next))}</small></button>
        <div class="row">
          <button class="btn small" data-g="back" ${isFirst ? 'disabled' : ''}>← Back</button>
          <button class="btn small ghost" data-g="absent">Not here</button>
          ${r > 0 ? '<button class="btn small ghost" data-g="done">No more sets</button>' : ''}
          <button class="btn small ghost" data-g="stop">Show list</button>
        </div>
      </div>
    `;
    bottom.innerHTML = '';
  }

  // "Who's next?" while picking the order during the first set
  function renderPick() {
    const picked = order.filter(mid => state[mid] && !state[mid].absent).map(mid => memberById.get(mid).name);
    body.innerHTML = `
      <div class="step">
        <div class="step-meta">Set 1 · picking the order</div>
        <div class="step-name">${order.length ? 'Who’s next?' : 'Who’s first?'}</div>
        <div class="pick-grid">${toPick().map(m => `<button class="btn" data-pick="${m.id}">${esc(m.name)}</button>`).join('')}</div>
        ${picked.length ? `<p class="muted small">Order so far: ${esc(picked.join(' → '))}</p>` : ''}
        ${order.length ? '<button class="btn block" data-g="everyone">That’s everyone<small>The rest are not here</small></button>' : ''}
        <div class="row">
          ${order.length ? '<button class="btn small" data-g="back">← Back</button>' : ''}
          <button class="btn small ghost" data-g="stop">Show list</button>
        </div>
      </div>
    `;
    bottom.innerHTML = '';
  }

  function render() {
    closePad();
    if (choosing && !toPick().length) { // everyone left was done on another phone meanwhile
      choosing = false;
      return pickedNext(null);
    }
    if (cursor && !eligible(cursor.r, cursor.i)) cursor = nextTodo(cursor); // e.g. a stale saved position
    photoEl.hidden = !!cursor || choosing;
    if (choosing) renderPick(); else if (cursor) renderStep(); else renderList();
  }

  // Writes the step's inputs into state (and confirms the set if asked); returns false if reps are missing
  function commitStep(markDone) {
    const reps = body.querySelector('[data-step] [data-f="reps"]');
    const weight = body.querySelector('[data-step] [data-f="weight"]');
    const set = state[order[cursor.i]].sets[cursor.r];
    if (set.reps !== reps.value.trim()) set.edited = true;
    set.reps = reps.value.trim();
    set.weight = weight.value.trim();
    if (markDone && set.reps !== '') set.done = true;
    return set.reps !== '';
  }

  function move(to) {
    cursor = to;
    if (cursor) resume = { r: cursor.r, mid: order[cursor.i] };
    else window.scrollTo(0, 0);
    persist();
    render();
  }

  // ----- picking the order: whoever does set 1 next is tapped, until everyone here has done it -----

  // Here, with a first set still to do, and not picked yet
  const toPick = () => members.filter(m => {
    const s = state[m.id];
    return !s.absent && s.sets[0] && !s.sets[0].done && !order.includes(m.id);
  });
  // After a set while picking: someone picked whose set 1 isn't done (after Back), else "who's next?", else the
  // order is complete: everyone else goes on the end and it's the order from now on
  function pickedNext(from) {
    const again = order.findIndex((mid, i) => i !== from?.i && isTodo({ r: 0, i }));
    if (again >= 0) return move({ r: 0, i: again });
    if (toPick().length === 1) return pick(toPick()[0].id); // only one left: no need to ask
    if (toPick().length) {
      choosing = true;
      return move(null);
    }
    finishPicking(from);
  }
  function finishPicking(from) {
    picking = false;
    choosing = false;
    order.push(...members.map(m => m.id).filter(mid => !order.includes(mid)));
    move(nextTodo(from));
  }
  const goOn = from => (picking ? pickedNext(from) : move(nextTodo(from)));
  // Who Next leads to, from the step on screen (the same choices as pickedNext while picking)
  function nextLabel(next) {
    if (picking) {
      const again = order.findIndex((_, i) => i !== cursor.i && isTodo({ r: 0, i }));
      const left = toPick();
      if (again >= 0) return `${memberById.get(order[again]).name} · set 1`;
      if (left.length > 1) return 'Pick who’s next';
      if (left.length === 1) return `${left[0].name} · set 1`;
    }
    return next ? `${memberById.get(order[next.i]).name} · set ${next.r + 1}` : 'Last one';
  }
  function begin() {
    if (!order) { order = []; picking = true; } // first exercise of the workout
    if (picking) return pickedNext(null);
    move(nextTodo(null));
  }

  function guidedAction(action) {
    const mid = cursor && order[cursor.i];
    if (action === 'start') {
      // Continue where we left off
      const at = order && resume && order.includes(resume.mid) ? { r: resume.r, i: order.indexOf(resume.mid) } : null;
      if (at && isTodo(at)) move(at);
      else if (at && !picking) move(nextTodo(at));
      else begin();
    } else if (action === 'round') {
      // Add a set for everyone who did the full number of sets
      const n = rounds();
      for (const m of members) {
        const s = state[m.id];
        if (!s.absent && s.sets.length === n) s.sets.push(copySet(s.sets[n - 1]));
      }
      begin();
    } else if (action === 'next') {
      if (!commitStep(true)) {
        const reps = body.querySelector('[data-f="reps"]');
        reps.classList.add('invalid');
        reps.focus();
        return;
      }
      cheerIfBest(mid, cursor.r);
      carryReps(mid, cursor.r);
      goOn(cursor);
    } else if (action === 'back') {
      if (choosing) {
        // back to whoever was picked last
        choosing = false;
        const i = order.findLastIndex((_, j) => eligible(0, j));
        return move(i >= 0 ? { r: 0, i } : null);
      }
      commitStep();
      const prev = slots().filter(p => after(cursor, p)).pop();
      if (prev) move(prev);
    } else if (action === 'absent') {
      state[mid].absent = true;
      goOn(cursor);
    } else if (action === 'done') {
      state[mid].sets.splice(cursor.r); // drop this and any later sets
      goOn(cursor);
    } else if (action === 'everyone') {
      // Whoever hasn't been picked isn't here (except anyone who's done sets in this workout, see `lifted`); that
      // completes the order
      for (const m of toPick()) {
        if (lifted.has(m.id)) continue;
        state[m.id].absent = true;
        inferred.delete(m.id);
      }
      finishPicking({ r: 0, i: order.length - 1 });
    } else if (action === 'stop') {
      if (cursor) commitStep();
      choosing = false;
      showList = true;
      move(null);
    }
  }

  // Picked as the next one to do set 1
  function pick(mid) {
    order.push(mid);
    choosing = false;
    move({ r: 0, i: order.length - 1 });
  }

  // ----- events -----

  body.addEventListener('input', e => {
    const t = e.target;
    t.classList.remove('invalid');
    if (!t.dataset.m) return;
    const set = state[t.dataset.m].sets[+t.dataset.i];
    set[t.dataset.f] = t.value;
    if (t.dataset.f === 'reps') set.edited = true;
    persist();
  });

  // Enter on the keyboard: kg -> reps -> next
  // ----- kg / reps pad: tapping a box of the current set opens buttons for it, centred where you tapped -----

  const padEl = document.createElement('div');
  padEl.className = 'pad-layer';
  padEl.hidden = true;
  document.body.appendChild(padEl);
  onLeave(() => padEl.remove());
  const PAD_STEPS = { weight: [1, 5, 6, 10], reps: [1, 2] };
  const KEYBOARD = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h1M10.5 10h1M14.5 10h1M6.5 14h11"/></svg>';
  let padField = null, padTyping = false;
  const padInput = () => body.querySelector(`[data-step] [data-f="${padField}"]`);
  const fmtNum = n => String(Math.round(n * 100) / 100);

  function openPad(field, typing) {
    padField = field;
    padTyping = !!typing;
    const input = padInput();
    if (!input) return closePad();
    input.blur();
    body.querySelectorAll('[data-step] input').forEach(x => x.classList.toggle('open', x === input));
    const kg = field === 'weight';
    const chip = n => `<button class="chip ${n < 0 ? 'minus' : ''}" data-add="${n}">${n < 0 ? '−' : '+'}${Math.abs(n)}</button>`;
    const steps = PAD_STEPS[field];
    padEl.innerHTML = `
      <div class="scrim" data-pad-close></div>
      <div class="pad ${kg ? 'kg' : 'reps'}">
        <div class="pad-head">
          <span class="label">${kg ? 'Weight' : 'Reps'}</span>
          <span class="value"><span data-pad-value>${esc(input.value || '0')}</span><small>${kg ? 'kg' : 'reps'}</small></span>
          <button class="btn small kbd" data-pad-type>${KEYBOARD}${padTyping ? 'Buttons' : 'Type'}</button>
        </div>
        ${padTyping
          ? `<input inputmode="${kg ? 'decimal' : 'numeric'}" enterkeyhint="done" data-pad-typed value="${esc(input.value)}" aria-label="${kg ? 'Weight' : 'Reps'}" autocomplete="off">`
          : `<div class="chips" style="--cols:${steps.length}">${steps.map(chip).join('')}</div>
             <div class="chips" style="--cols:${steps.length}">${steps.map(n => chip(-n)).join('')}</div>`}
        <button class="btn primary" data-pad-close>Done</button>
      </div>`;
    padEl.hidden = false;
    // Centred on the box that was tapped (so the finger lands in the middle), kept on screen; at the top while
    // typing, so the keyboard doesn't cover it
    const pad = padEl.querySelector('.pad'), r = input.getBoundingClientRect();
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
    pad.style.left = `${clamp(r.left + r.width / 2 - pad.offsetWidth / 2, 12, innerWidth - pad.offsetWidth - 12)}px`;
    pad.style.top = padTyping ? 'max(12px, env(safe-area-inset-top))'
      : `${clamp(r.top + r.height / 2 - pad.offsetHeight / 2, 12, innerHeight - pad.offsetHeight - 12)}px`;
    padEl.querySelector('[data-pad-typed]')?.focus();
  }
  function closePad() {
    padField = null;
    padEl.hidden = true;
    padEl.innerHTML = '';
    body.querySelectorAll('[data-step] input.open').forEach(x => x.classList.remove('open'));
  }
  function setPadValue(value) {
    padInput().value = value;
    padEl.querySelector('[data-pad-value]').textContent = value || '0';
  }

  padEl.addEventListener('click', e => {
    const b = e.target.closest('[data-add], [data-pad-type], [data-pad-close]');
    if (!b) return;
    if (b.dataset.add) setPadValue(fmtNum(Math.max(0, (num(padInput().value) ?? 0) + +b.dataset.add)));
    else if (b.hasAttribute('data-pad-type')) openPad(padField, !padTyping);
    else closePad();
  });
  padEl.addEventListener('input', e => {
    if (e.target.matches('[data-pad-typed]')) setPadValue(e.target.value.trim());
  });
  padEl.addEventListener('focusin', e => { if (e.target.matches('[data-pad-typed]')) e.target.select(); });
  padEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('[data-pad-typed]')) { e.preventDefault(); closePad(); }
  });

  // Values are usually prefilled, so tapping a box selects it and typing replaces it
  body.addEventListener('focusin', e => {
    if (e.target.matches('.set-row input:not([readonly])')) e.target.select();
  });

  body.addEventListener('click', e => {
    const box = e.target.closest('[data-step] input[data-f]');
    if (box) return openPad(box.dataset.f);
    const jump = e.target.closest('[data-jump]');
    if (jump && cursor) {
      commitStep();
      return move({ r: +jump.dataset.jump, i: cursor.i });
    }
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if (d.g) return guidedAction(d.g);
    if (d.pick) return pick(d.pick);
    if (b.hasAttribute('data-remove')) return removeExercise();
    if (b.hasAttribute('data-toggle-list')) {
      showList = !listOpen();
      return render();
    }
    if (d.sets) {
      // Give every present member the same number of sets; finished sets are never removed
      const n = Math.max(1, rounds() + +d.sets);
      for (const m of members) {
        const sets = state[m.id].sets;
        if (state[m.id].absent) continue;
        while (sets.length < n) sets.push(copySet(last.get(m.id)?.sets[sets.length] || sets[sets.length - 1]));
        while (sets.length > n && !sets[sets.length - 1].done) sets.pop();
      }
    } else if (d.absent) {
      const s = state[d.absent];
      s.absent = !s.absent;
      inferred.delete(d.absent); // chosen here now, so it's saved like any other change
      if (!s.absent && !s.sets.length) s.sets.push(copySet(last.get(d.absent)?.sets[0]));
      // Latecomers go to the back of the queue
      if (!s.absent && order && !picking) order =[...order.filter(mid => mid !== d.absent), d.absent];
    } else if (d.addset) {
      const sets = state[d.addset].sets;
      sets.push(copySet(last.get(d.addset)?.sets[sets.length] || sets[sets.length - 1])); // last time's set, or a copy of the previous one
    } else if (d.delset) {
      state[d.delset].sets.pop();
    } else if (d.tick) {
      const set = state[d.tick].sets[+d.i];
      if (!set.done && set.reps.trim() === '') {
        const reps = b.closest('.set-row').querySelector('[data-f="reps"]');
        reps.classList.add('invalid');
        reps.focus();
        return;
      }
      set.done = !set.done;
      if (set.done) {
        cheerIfBest(d.tick, +d.i);
        carryReps(d.tick, +d.i);
      }
    } else {
      return;
    }
    persist();
    render();
  });

  bottom.addEventListener('click', act(async e => {
    if (!e.target.closest('[data-done]')) return;
    saveNow(); // safe in the outbox even without signal
    if (sent.size) draft.save(lastExKey, exercise.id);
    markFinished();
    leaveHook = null;
    draft.clear(draftKey);
    await showSheet(exerciseSummary());
    go(`#/w/${wid}`);
  }));

  const removeExercise = act(async () => {
    if (!confirm(`Remove ${exercise.name} from this workout?`) || !await requireAuth()) return;
    clearTimeout(saveTimer);
    leaveHook = null;
    dropSaves(wid, exercise.id);
    await flushing?.catch(() => {});
    check(await sb.from('workout_exercises').delete().eq('id', weId));
    draft.clear(draftKey);
    go(`#/w/${wid}`);
  });

  if (weId) listen();
  // New here, but another phone may add it first: from then on this phone gets their sets too
  else subscribe([{ event: 'INSERT', table: 'workout_exercises', filter: `workout_id=eq.${wid}` }],
    ({ new: row }) => row?.exercise_id === exercise.id && adopt(row.id));
  render();
}

// ---------- start ----------

// No pinch-zoom on iPhone (Safari ignores user-scalable=no); accidental zooms while scrolling are annoying
document.addEventListener('gesturestart', e => e.preventDefault());

(async function init() {
  document.title = CONFIG.APP_NAME;
  if (CONFIG.SUPABASE_URL.includes('YOUR-PROJECT')) {
    app.innerHTML = '<div class="notice">Set your Supabase URL, key and group email in <b>config.js</b> (see README.md).</div>';
    return;
  }
  // On bad signal a request can hang for minutes; give up after 20s so the outbox can try again
  const timedFetch = (url, opts = {}) => fetch(url, opts.signal || !AbortSignal.timeout ? opts : { ...opts, signal: AbortSignal.timeout(20000) });
  sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, { global: { fetch: timedFetch } });
  session = (await sb.auth.getSession()).data.session;
  sb.auth.onAuthStateChange((_event, s) => { session = s; renderLock(); });
  renderLock();
  $('#lock').addEventListener('click', act(async () => {
    if (session) {
      if (!confirm('Lock this device? You will need the password to get in again.')) return;
      await sb.auth.signOut();
      location.reload();
    } else await requireAuth();
  }));
  // The whole site is behind the group password
  if (!session) await requireAuth(true);
  window.addEventListener('hashchange', router);
  router();

  // Anything saved without signal goes up as soon as possible
  renderSync();
  $('#sync').addEventListener('click', () => flushSaves());
  window.addEventListener('online', () => flushSaves());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) flushSaves(); });
  flushSaves();
})();
