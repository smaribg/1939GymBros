/* global supabase, CONFIG */
const app = document.getElementById('app');
const $ = sel => document.querySelector(sel);
const PHOTO_BUCKET = 'exercise-photos';
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

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// "60kg × 10", or "10 reps" without weight
const fmtKgReps = x => (x.weight != null && x.weight !== '' ? `${x.weight}kg × ${x.reps}` : `${x.reps} reps`);

// "10 @ 60kg"
const fmtSet = s => `${s.reps ?? '?'}${s.weight != null && s.weight !== '' ? ` @ ${s.weight}kg` : ''}`;

// "3 × 10 @ 60kg" when all sets match, otherwise "10 @ 60kg · 8 @ 65kg"
function fmtSets(sets) {
  if (!sets || !sets.length) return '—';
  const same = sets.every(s => s.reps === sets[0].reps && s.weight === sets[0].weight);
  return same ? `${sets.length} × ${fmtSet(sets[0])}` : sets.map(fmtSet).join(' · ');
}

const draft = {
  load(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ } },
  clear(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
};

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

function requireAuth() {
  if (session) return Promise.resolve(true);
  return new Promise(resolve => {
    const dlg = $('#login'), form = $('#login-form'), pw = $('#pw'), err = $('#login-err');
    err.textContent = '';
    pw.value = '';
    const done = ok => {
      form.onsubmit = dlg.oncancel = $('#login-cancel').onclick = null;
      if (dlg.open) dlg.close();
      resolve(ok);
    };
    form.onsubmit = async e => {
      e.preventDefault();
      const { error } = await sb.auth.signInWithPassword({ email: CONFIG.GROUP_EMAIL, password: pw.value });
      if (error) { err.textContent = error.message === 'Invalid login credentials' ? 'Wrong password' : error.message; return; }
      done(true);
    };
    $('#login-cancel').onclick = () => done(false);
    dlg.oncancel = () => done(false);
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
  [/^exercises$/, exercisesView],
  [/^w\/([\w-]+)$/, workoutView],
  [/^w\/([\w-]+)\/pick$/, pickView],
  [/^w\/([\w-]+)\/(new|edit)\/([\w-]+)$/, logView],
];

async function router() {
  const id = ++routeId;
  const leaving = leaveHook;
  leaveHook = null;
  if (leaving) {
    app.querySelectorAll('button, input').forEach(el => { el.disabled = true; });
    await leaving();
    if (id !== routeId) return;
  }
  const path = location.hash.replace(/^#\/?/, '');
  // Views call mount() once their data is loaded; a stale view (user navigated away meanwhile) is dropped
  const mount = html => {
    if (id !== routeId) throw STALE;
    app.innerHTML = `<div class="view">${html}</div>`;
    window.scrollTo(0, 0);
    return app.firstElementChild;
  };
  for (const [re, view] of routes) {
    const m = path.match(re);
    if (!m) continue;
    app.innerHTML = '<p class="muted center">Loading…</p>';
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

async function home(mount) {
  const [workouts, members] = await Promise.all([
    sb.from('workouts')
      .select('id, started_at, finished_at, workout_exercises(created_at, exercises(name))')
      .order('started_at', { ascending: false })
      .limit(100)
      .then(check),
    sb.from('members').select('id').eq('active', true).then(check),
  ]);
  const active = workouts.find(w => !w.finished_at);
  const past = workouts.filter(w => w.finished_at);
  const summary = w => [...w.workout_exercises].sort(byCreated).map(we => we.exercises.name).join(', ') || 'No exercises';

  const v = mount(`
    <img class="hero" src="assets/logo.png" alt="${esc(CONFIG.APP_NAME)}">
    ${!members.length ? '<div class="notice">Start by adding the members of your group.</div>' : ''}
    ${active
      ? `<a class="btn cream big" href="#/w/${active.id}">Resume workout<small>Started ${fmtDate(active.started_at)}</small></a>`
      : `<button class="btn cream big" data-start ${members.length ? '' : 'disabled'}>Start workout</button>`}
    <div class="row nowrap">
      <a class="btn block grow" href="#/members">Members (${members.length})</a>
      <a class="btn block grow" href="#/exercises">Exercises</a>
    </div>
    <h2>Past workouts</h2>
    ${past.length
      ? `<div class="list">${past.map(w => `
          <a class="list-item" href="#/w/${w.id}">
            <b>${fmtDate(w.started_at)}</b>
            <span class="muted">${esc(summary(w))}</span>
          </a>`).join('')}</div>`
      : '<p class="muted">No workouts yet.</p>'}
  `);

  v.querySelector('[data-start]')?.addEventListener('click', act(async () => {
    if (!await requireAuth()) return;
    const w = check(await sb.from('workouts').insert({}).select('id').single());
    go(`#/w/${w.id}`);
  }));
}

async function membersView(mount) {
  const members = check(await sb.from('members').select('id, name').eq('active', true).order('created_at'));
  const v = mount(`
    <a class="back" href="#/">‹ Home</a>
    <h1>Members</h1>
    <p class="sub">Everyone who trains together</p>
    <div class="list">
      ${members.map(m => `
        <div class="list-item row">
          <input class="grow" value="${esc(m.name)}" data-rename="${m.id}" aria-label="Name">
          <button class="btn small danger" data-remove="${m.id}">Remove</button>
        </div>`).join('') || '<p class="muted">No members yet.</p>'}
    </div>
    <h2>Add member</h2>
    <form class="row" data-add>
      <input class="grow" placeholder="Name" autocomplete="off" required>
      <button class="btn primary">Add</button>
    </form>
    <p class="muted">Removed members keep their history but stop showing up in new workouts.</p>
  `);

  v.querySelector('[data-add]').addEventListener('submit', act(async e => {
    e.preventDefault();
    const name = e.target.querySelector('input').value.trim();
    if (!name || !await requireAuth()) return;
    check(await sb.from('members').insert({ name }));
    router();
  }));
  v.querySelectorAll('[data-rename]').forEach(input => input.addEventListener('change', act(async () => {
    const name = input.value.trim();
    if (!name || !await requireAuth()) return;
    check(await sb.from('members').update({ name }).eq('id', input.dataset.rename));
  })));
  v.querySelectorAll('[data-remove]').forEach(btn => btn.addEventListener('click', act(async () => {
    if (!confirm('Remove this member?') || !await requireAuth()) return;
    check(await sb.from('members').update({ active: false }).eq('id', btn.dataset.remove));
    router();
  })));
}

async function exercisesView(mount) {
  const exercises = check(await sb.from('exercises').select('id, name, photo_path').order('name'));
  const v = mount(`
    <a class="back" href="#/">‹ Home</a>
    <h1>Exercises</h1>
    <p class="sub">Add exercises here so they're ready to pick in a workout</p>
    <form class="row nowrap" data-add style="margin-bottom:16px">
      <input class="grow" placeholder="New exercise name" autocomplete="off" required>
      <button class="btn primary">Add</button>
    </form>
    <div class="list">
      ${exercises.map(e => `
        <div class="list-item row">
          ${exImg(e.photo_path)}
          <input class="grow" value="${esc(e.name)}" data-rename="${e.id}" aria-label="Name">
          <button class="btn small danger" data-remove="${e.id}">Delete</button>
        </div>`).join('') || '<p class="muted">No exercises yet.</p>'}
    </div>
  `);

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

async function workoutView(mount, wid) {
  const w = check(await sb.from('workouts')
    .select('id, started_at, finished_at, workout_exercises(id, created_at, exercises(name, photo_path), entries(absent, sets, members(name, created_at)))')
    .eq('id', wid)
    .single());
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
        ${e.sets.length ? `<div class="set-chips">${e.sets.map((x, i) => `<span class="set-chip"><b>${i + 1}</b>${esc(fmtKgReps(x))}</span>`).join('')}</div>` : ''}
      </div>`).join('') + (absent.length ? `<div class="ms-row"><div class="ms-head"><span class="muted small">Not here: ${esc(absent.join(', '))}</span></div></div>` : '');
  }
  const isDone = we => we.entries.length && we.entries.every(e => e.absent || e.sets.length);
  const setCount = we => {
    const n = we.entries.filter(e => !e.absent).length;
    return `${n} member${n === 1 ? '' : 's'}`;
  };

  const v = mount(`
    <a class="back" href="#/">‹ Home</a>
    <h1>${w.finished_at ? 'Workout' : 'Today’s Workout'}</h1>
    <p class="sub">${fmtDate(w.started_at)}${wes.length ? ` · ${wes.length} exercise${wes.length === 1 ? '' : 's'}` : ''}</p>
    ${wes.map(we => `
      <a class="card ex-summary" href="#/w/${wid}/edit/${we.id}">
        <div class="ex-summary-head">
          ${exImg(we.exercises.photo_path)}
          <div class="grow">
            <div class="ex-title">${esc(we.exercises.name)}</div>
            <span class="muted">${setCount(we)}</span>
          </div>
          <span class="check ${isDone(we) ? 'done' : ''}"></span>
        </div>
        ${memberRows(we)}
      </a>`).join('') || '<p class="muted">No exercises yet.</p>'}
    <a class="btn cream big" href="#/w/${wid}/pick">+ Add exercise</a>
    ${w.finished_at ? '' : '<button class="btn primary block" data-finish>Finish workout</button>'}
    <button class="btn small danger" data-delete>Delete workout</button>
  `);

  v.querySelector('[data-finish]')?.addEventListener('click', act(async () => {
    if (!await requireAuth()) return;
    if (wes.length) check(await sb.from('workouts').update({ finished_at: new Date().toISOString() }).eq('id', wid));
    else check(await sb.from('workouts').delete().eq('id', wid)); // nothing logged, don't keep an empty workout
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
    <a class="back" href="#/w/${wid}">‹ Workout</a>
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
  let exercise, weCreated = null, existing = [];

  if (weId) {
    const we = check(await sb.from('workout_exercises')
      .select('created_at, exercises(id, name, photo_path), entries(member_id, absent, sets)')
      .eq('id', weId)
      .single());
    exercise = we.exercises;
    weCreated = we.created_at;
    existing = we.entries;
  } else {
    exercise = check(await sb.from('exercises').select('id, name, photo_path').eq('id', id).single());
  }

  const [allMembers, last] = await Promise.all([
    sb.from('members').select('id, name, active').order('created_at').then(check),
    lastTime(exercise.id, wid, weCreated),
  ]);
  const existingBy = new Map(existing.map(e => [e.member_id, e]));
  const members = allMembers.filter(m => m.active || existingBy.has(m.id));
  const memberById = new Map(members.map(m => [m.id, m]));
  // A set in the form: values as typed, plus whether it has been confirmed (only confirmed sets are saved)
  const toInput = (s, done) => ({ reps: String(s.reps ?? ''), weight: String(s.weight ?? ''), done });
  const copySet = s => ({ reps: s ? String(s.reps ?? '') : '10', weight: s?.weight != null ? String(s.weight) : '', done: false });

  // Local copy of the input (and where the guided flow is), so blank sets and the guided position survive too
  let draftKey = `draft2:${wid}:${weId || 'new-' + exercise.id}`;
  const saved = draft.load(draftKey) || {};
  const state = saved.members || {};
  for (const m of members) {
    if (state[m.id]) {
      for (const set of state[m.id].sets) set.done ??= set.reps !== ''; // drafts from before sets had a done flag
      continue;
    }
    const ex = existingBy.get(m.id);
    const prev = last.get(m.id)?.sets;
    state[m.id] = ex && (ex.absent || ex.sets.length)
      ? { absent: ex.absent, sets: ex.sets.map(x => toInput(x, true)) }
      // Start from what they did last time; they just confirm or adjust each set
      : { absent: false, sets: prev ? prev.map(x => toInput(x, false)) : [copySet(), copySet(), copySet()] };
  }
  // Guided flow: members in random order, everyone does set 1, then everyone does set 2, ...
  let order = saved.order ? saved.order.filter(mid => state[mid]) : null;
  if (order) order.push(...members.map(m => m.id).filter(mid => !order.includes(mid)));
  let cursor = order ? saved.cursor || null : null; // { r: set index, i: index in order } while guided
  const persist = () => {
    draft.save(draftKey, { members: state, order, cursor });
    scheduleSave();
  };

  // ----- autosave: every change goes to the database shortly after it's made -----

  let saveTimer = null, dirty = false, saving = Promise.resolve();
  function scheduleSave() {
    dirty = true;
    setStatus('Saving…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 800);
  }
  function saveNow() {
    clearTimeout(saveTimer);
    if (!dirty) return saving;
    dirty = false;
    saving = saving.then(writeToDb).catch(err => {
      dirty = true;
      console.error(err);
      setStatus('Not saved, tap to retry', true);
    });
    return saving;
  }
  async function writeToDb() {
    if (!await requireAuth()) { dirty = true; setStatus('Not saved, tap to unlock', true); return; }
    if (!weId) {
      weId = check(await sb.from('workout_exercises').insert({ workout_id: wid, exercise_id: exercise.id }).select('id').single()).id;
      // From now on this is an existing exercise in the workout
      history.replaceState(null, '', `#/w/${wid}/edit/${weId}`);
      draft.clear(draftKey);
      draftKey = `draft2:${wid}:${weId}`;
      draft.save(draftKey, { members: state, order, cursor });
    }
    const rows = members.map(m => {
      const s = state[m.id];
      const sets = s.absent ? [] : s.sets
        .filter(x => x.done)
        .map(x => ({ reps: num(x.reps), weight: num(x.weight) }))
        .filter(x => x.reps != null);
      return { workout_exercise_id: weId, member_id: m.id, absent: s.absent, sets };
    });
    check(await sb.from('entries').upsert(rows, { onConflict: 'workout_exercise_id,member_id' }));
    if (!dirty) setStatus('Saved ✓');
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
  // Next unfilled set after `from`, wrapping around to any earlier one that was skipped
  function nextTodo(from) {
    const todo = slots().filter(p => isTodo(p) && !same(p, from));
    return (from && todo.find(p => after(p, from))) || todo[0] || null;
  }
  const hasTodo = () => members.some(m => !state[m.id].absent && state[m.id].sets.some(s => !s.done));

  const v = mount(`
    <a class="back" href="#/w/${wid}">‹ Workout</a>
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

  function setStatus(text, isError) {
    statusEl.textContent = text;
    statusEl.classList.toggle('error-text', !!isError);
  }
  statusEl.addEventListener('click', () => { if (dirty) saveNow(); });
  leaveHook = saveNow; // the router waits for this before showing the next page

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

  // Stays visible under an input so last time's value isn't lost once you type
  const lastHint = (value, unit = '') => (value != null && value !== '' ? `<small class="hint">last: ${esc(value)}${unit}</small>` : '');

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

  function renderList() {
    const anyDone = members.some(m => state[m.id].sets.some(x => x.done));
    const todo = hasTodo();
    const ordered = order ? order.map(mid => memberById.get(mid)).filter(Boolean) : members;
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
        : anyDone ? '<div class="notice row"><span class="grow">All sets done 💪</span><button class="btn small" data-g="round">+ Another round</button></div>' : ''}
      ${present.map(cardHtml).join('')}
      ${absent.length ? `<h2>Not here</h2>${absent.map(cardHtml).join('')}` : ''}
      ${weId ? '<button class="btn small danger" data-remove>Remove from workout</button>' : ''}
    `;
    bottom.innerHTML = `<button class="btn primary big" data-done>Complete exercise →</button>`;
  }

  // ----- guided mode: one member and one set at a time -----

  function renderStep() {
    const { r, i } = cursor;
    const m = memberById.get(order[i]);
    const s = state[m.id];
    const set = s.sets[r];
    const l = last.get(m.id);
    const lastSet = l?.sets[r];
    const today = s.sets.slice(0, r).filter(x => x.done);
    // Weight usually stays the same, so fall back to the previous set's
    const weight = set.weight || s.sets[r - 1]?.weight || '';
    const inRound = slots().filter(p => p.r === r);
    const next = nextTodo(cursor);
    const isFirst = same(slots()[0], cursor);

    body.innerHTML = `
      <div class="step">
        <div class="step-meta">Set ${r + 1} · ${inRound.findIndex(p => p.i === i) + 1} of ${inRound.length}</div>
        <div class="step-name">${esc(m.name)}</div>
        <div class="last">${lastSet
          ? `Last time set ${r + 1}: <b>${esc(fmtSet(lastSet))}</b>`
          : l ? `Last time: <b>${esc(fmtSets(l.sets))}</b>` : 'No previous record'}</div>
        ${today.length ? `<div class="last">Today: <b>${esc(today.map(fmtSet).join(' · '))}</b></div>` : ''}
        <form class="step-inputs" data-step>
          <label><input inputmode="numeric" enterkeyhint="next" data-f="reps" value="${esc(set.reps)}" placeholder="${esc(lastSet?.reps ?? '')}" autocomplete="off"><span>reps</span>${lastHint(lastSet?.reps)}</label>
          <label><input inputmode="decimal" enterkeyhint="next" data-f="weight" value="${esc(weight)}" autocomplete="off"><span>kg</span>${lastHint(lastSet?.weight, 'kg')}</label>
        </form>
        <button class="btn primary big" data-g="next">Next →<small>${next ? `${esc(memberById.get(order[next.i]).name)} · set ${next.r + 1}` : 'Last one'}</small></button>
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

  function render(focusReps) {
    if (cursor && !eligible(cursor.r, cursor.i)) cursor = nextTodo(cursor); // e.g. a stale saved position
    photoEl.hidden = !!cursor;
    if (cursor) renderStep(); else renderList();
    if (focusReps && cursor) body.querySelector('[data-f="reps"]').focus();
  }

  // Writes the step's inputs into state (and confirms the set if asked); returns false if reps are missing
  function commitStep(markDone) {
    const reps = body.querySelector('[data-step] [data-f="reps"]');
    const weight = body.querySelector('[data-step] [data-f="weight"]');
    const set = state[order[cursor.i]].sets[cursor.r];
    set.reps = reps.value.trim();
    set.weight = weight.value.trim();
    if (markDone && set.reps !== '') set.done = true;
    return set.reps !== '';
  }

  function move(to) {
    cursor = to;
    if (!cursor) window.scrollTo(0, 0);
    persist();
    render(true);
  }

  // Everything here runs synchronously inside the tap, so focusing the next input keeps the phone keyboard open
  function guidedAction(action) {
    const mid = cursor && order[cursor.i];
    if (action === 'start') {
      if (!order) order = shuffle(members.map(m => m.id));
      move(nextTodo(null));
    } else if (action === 'round') {
      // Add a set for everyone who did the full number of sets
      const n = rounds();
      for (const m of members) {
        const s = state[m.id];
        if (!s.absent && s.sets.length === n) s.sets.push(copySet(s.sets[n - 1]));
      }
      if (!order) order = shuffle(members.map(m => m.id));
      move(nextTodo(null));
    } else if (action === 'next') {
      if (!commitStep(true)) {
        const reps = body.querySelector('[data-f="reps"]');
        reps.classList.add('invalid');
        reps.focus();
        return;
      }
      move(nextTodo(cursor));
    } else if (action === 'back') {
      commitStep();
      const prev = slots().filter(p => after(cursor, p)).pop();
      if (prev) move(prev);
    } else if (action === 'absent') {
      state[mid].absent = true;
      move(nextTodo(cursor));
    } else if (action === 'done') {
      state[mid].sets.splice(cursor.r); // drop this and any later sets
      move(nextTodo(cursor));
    } else if (action === 'stop') {
      commitStep();
      move(null);
    }
  }

  // ----- events -----

  body.addEventListener('input', e => {
    const t = e.target;
    t.classList.remove('invalid');
    if (!t.dataset.m) return;
    state[t.dataset.m].sets[+t.dataset.i][t.dataset.f] = t.value;
    persist();
  });

  // Enter on the keyboard: reps -> weight -> next
  body.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !e.target.closest('[data-step]')) return;
    e.preventDefault();
    if (e.target.dataset.f === 'reps') body.querySelector('[data-step] [data-f="weight"]').focus();
    else guidedAction('next');
  });

  body.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if (d.g) return guidedAction(d.g);
    if (b.hasAttribute('data-remove')) return removeExercise();
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
      if (!s.absent && !s.sets.length) s.sets.push(copySet(last.get(d.absent)?.sets[0]));
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
    } else {
      return;
    }
    persist();
    render();
  });

  bottom.addEventListener('click', act(async e => {
    if (!e.target.closest('[data-done]')) return;
    await saveNow();
    if (dirty) return; // save failed; the status line says so
    draft.clear(draftKey);
    go(`#/w/${wid}`);
  }));

  const removeExercise = act(async () => {
    if (!confirm(`Remove ${exercise.name} from this workout?`) || !await requireAuth()) return;
    clearTimeout(saveTimer);
    dirty = false;
    await saving;
    check(await sb.from('workout_exercises').delete().eq('id', weId));
    draft.clear(draftKey);
    go(`#/w/${wid}`);
  });

  render();
}

// ---------- start ----------

(async function init() {
  document.title = $('#logo').textContent = CONFIG.APP_NAME;
  if (CONFIG.SUPABASE_URL.includes('YOUR-PROJECT')) {
    app.innerHTML = '<div class="notice">Set your Supabase URL, key and group email in <b>config.js</b> (see README.md).</div>';
    return;
  }
  sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  session = (await sb.auth.getSession()).data.session;
  sb.auth.onAuthStateChange((_event, s) => { session = s; renderLock(); });
  renderLock();
  $('#lock').addEventListener('click', act(async () => {
    if (session) { if (confirm('Lock this device? You will need the password to save again.')) await sb.auth.signOut(); }
    else await requireAuth();
  }));
  window.addEventListener('hashchange', router);
  router();
})();
