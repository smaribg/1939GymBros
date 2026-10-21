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
const thumb = path => path ? `<img class="thumb" src="${esc(photoUrl(path))}" alt="" loading="lazy">` : '';

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

const routes = [
  [/^$/, home],
  [/^members$/, membersView],
  [/^w\/([\w-]+)$/, workoutView],
  [/^w\/([\w-]+)\/pick$/, pickView],
  [/^w\/([\w-]+)\/(new|edit)\/([\w-]+)$/, logView],
];

async function router() {
  const id = ++routeId;
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
    ${!members.length ? '<div class="notice">Start by adding the members of your group.</div>' : ''}
    ${active
      ? `<a class="btn primary big" href="#/w/${active.id}">Resume workout<small>Started ${fmtDate(active.started_at)}</small></a>`
      : `<button class="btn primary big" data-start ${members.length ? '' : 'disabled'}>Start workout</button>`}
    <a class="btn block" href="#/members">Members (${members.length})</a>
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
    <a class="back" href="#/">← Home</a>
    <h1>Members</h1>
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

async function workoutView(mount, wid) {
  const w = check(await sb.from('workouts')
    .select('id, started_at, finished_at, workout_exercises(id, created_at, exercises(name, photo_path), entries(absent, sets, members(name, created_at)))')
    .eq('id', wid)
    .single());
  const wes = [...w.workout_exercises].sort(byCreated);

  const v = mount(`
    <a class="back" href="#/">← Home</a>
    <h1>${w.finished_at ? 'Workout' : 'Current workout'}</h1>
    <p class="muted">${fmtDate(w.started_at)}</p>
    ${wes.map(we => `
      <div class="card">
        <div class="card-head">
          <div class="row nowrap">${thumb(we.exercises.photo_path)}<h3>${esc(we.exercises.name)}</h3></div>
          <a class="btn small" href="#/w/${wid}/edit/${we.id}">Edit</a>
        </div>
        <table class="summary">
          ${[...we.entries].sort((a, b) => byCreated(a.members, b.members)).map(e => `
            <tr><td>${esc(e.members.name)}</td><td>${e.absent ? '<span class="muted">Not here</span>' : esc(fmtSets(e.sets))}</td></tr>`).join('')}
        </table>
      </div>`).join('') || '<p class="muted">No exercises yet.</p>'}
    <a class="btn ${w.finished_at ? '' : 'primary big'} block" href="#/w/${wid}/pick">+ Add exercise</a>
    ${w.finished_at ? '' : '<button class="btn block" data-finish>Finish workout</button>'}
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
    <a class="back" href="#/w/${wid}">← Workout</a>
    <h1>Pick exercise</h1>
    <input type="search" placeholder="Search or type a new exercise" data-search autocomplete="off">
    <div class="list" data-list style="margin-top:12px"></div>
  `);
  const search = v.querySelector('[data-search]');
  const list = v.querySelector('[data-list]');

  function renderList() {
    const q = search.value.trim();
    const matches = exercises.filter(e => e.name.toLowerCase().includes(q.toLowerCase()));
    const exact = exercises.some(e => e.name.toLowerCase() === q.toLowerCase());
    list.innerHTML = `
      ${q && !exact ? `<button class="list-item" data-create><b>+ Create “${esc(q)}”</b><span class="muted">New exercise</span></button>` : ''}
      ${matches.map(e => `
        <button class="list-item with-thumb" data-id="${e.id}">
          ${thumb(e.photo_path)}
          <span class="col">
            <b>${esc(e.name)}</b>
            ${usedBy.has(e.id) ? '<span class="tag">✓ Already done in this workout</span>' : ''}
          </span>
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
  const toInput = s => ({ reps: String(s.reps ?? ''), weight: String(s.weight ?? '') });

  // Unsaved input (and where the guided flow is) survives reloads and navigating back
  const draftKey = `draft2:${wid}:${weId || 'new-' + exercise.id}`;
  const saved = draft.load(draftKey) || {};
  const state = saved.members || {};
  for (const m of members) {
    if (state[m.id]) continue;
    const ex = existingBy.get(m.id);
    state[m.id] = ex
      ? { absent: ex.absent, sets: ex.sets.map(toInput) }
      : { absent: false, sets: Array.from({ length: last.get(m.id)?.sets.length || 3 }, () => ({ reps: '', weight: '' })) };
  }
  // Guided flow: members in random order, everyone does set 1, then everyone does set 2, ...
  let order = saved.order ? saved.order.filter(mid => state[mid]) : null;
  if (order) order.push(...members.map(m => m.id).filter(mid => !order.includes(mid)));
  let cursor = order ? saved.cursor || null : null; // { r: set index, i: index in order } while guided
  const persist = () => draft.save(draftKey, { members: state, order, cursor });

  const eligible = (r, i) => { const s = state[order[i]]; return !!s && !s.absent && r < s.sets.length; };
  const isTodo = p => eligible(p.r, p.i) && state[order[p.i]].sets[p.r].reps === '';
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
  const hasTodo = () => members.some(m => !state[m.id].absent && state[m.id].sets.some(s => s.reps === ''));

  const v = mount(`
    <a class="back" href="#/w/${wid}">← Workout</a>
    <h1>${esc(exercise.name)}</h1>
    <div class="photo-block" data-photo></div>
    <div data-body></div>
    <div class="sticky-bottom" data-bottom></div>
  `);
  const photoEl = v.querySelector('[data-photo]');
  const body = v.querySelector('[data-body]');
  const bottom = v.querySelector('[data-bottom]');

  // ----- photo -----

  function renderPhoto(busy) {
    photoEl.innerHTML = `
      ${exercise.photo_path ? `<img class="ex-photo" src="${esc(photoUrl(exercise.photo_path))}" alt="">` : ''}
      <label class="btn small">${busy ? 'Uploading…' : exercise.photo_path ? '📷 Change photo' : '📷 Add photo'}
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

  function cardHtml(m) {
    const s = state[m.id];
    const l = last.get(m.id);
    const ls = l?.sets || [];
    if (s.absent) {
      return `
        <div class="card member absent">
          <div class="card-head"><h3>${esc(m.name)} <span class="muted">· not here</span></h3>
          <button class="btn small" data-absent="${m.id}">Here</button></div>
        </div>`;
    }
    return `
      <div class="card member">
        <div class="card-head"><h3>${esc(m.name)}</h3>
        <button class="btn small ghost" data-absent="${m.id}">Not here</button></div>
        <div class="last">${l ? `Last time (${fmtShort(l.date)}): <b>${esc(fmtSets(ls))}</b>` : 'No previous record'}</div>
        ${s.sets.map((set, i) => `
          <div class="set-row">
            <span class="set-no">${i + 1}</span>
            <label><input inputmode="numeric" data-m="${m.id}" data-i="${i}" data-f="reps" value="${esc(set.reps)}" placeholder="${esc(ls[i]?.reps ?? '')}"><span>reps</span>${lastHint(ls[i]?.reps)}</label>
            <label><input inputmode="decimal" data-m="${m.id}" data-i="${i}" data-f="weight" value="${esc(set.weight)}" placeholder="${esc(ls[i]?.weight ?? '')}"><span>kg</span>${lastHint(ls[i]?.weight, 'kg')}</label>
            <button class="icon" data-del="${m.id}" data-i="${i}" aria-label="Remove set">×</button>
          </div>`).join('')}
        <div class="row">
          <button class="btn small" data-addset="${m.id}">+ Set</button>
          ${ls.length ? `<button class="btn small" data-copy="${m.id}">Copy last time</button>` : ''}
        </div>
      </div>`;
  }

  function renderList() {
    const anyFilled = members.some(m => state[m.id].sets.some(s => s.reps !== ''));
    const todo = hasTodo();
    const cardOrder = order ? order.map(mid => memberById.get(mid)).filter(Boolean) : members;
    body.innerHTML = `
      <div class="card stepper">
        <span class="grow">Sets for everyone</span>
        <button class="btn small" data-sets="-1" aria-label="One set fewer">−</button>
        <b>${rounds()}</b>
        <button class="btn small" data-sets="1" aria-label="One set more">+</button>
      </div>
      ${todo
        ? `<button class="btn primary big" data-g="start">▶ ${anyFilled ? 'Continue' : 'Start'}<small>One person at a time, set by set</small></button>`
        : anyFilled ? '<div class="notice row"><span class="grow">All sets done 💪</span><button class="btn small" data-g="round">+ Another round</button></div>' : ''}
      ${cardOrder.map(cardHtml).join('')}
      ${weId ? '<button class="btn small danger" data-remove>Remove from workout</button>' : ''}
    `;
    bottom.innerHTML = `<button class="btn ${todo && !anyFilled ? '' : 'primary'} big" data-save>Finish exercise</button>`;
  }

  // ----- guided mode: one member and one set at a time -----

  function renderStep() {
    const { r, i } = cursor;
    const m = memberById.get(order[i]);
    const s = state[m.id];
    const set = s.sets[r];
    const l = last.get(m.id);
    const lastSet = l?.sets[r];
    const today = s.sets.slice(0, r).filter(x => x.reps !== '');
    // Weight usually stays the same, so prefill it from the previous set or from last time
    const weight = set.weight || s.sets[r - 1]?.weight || (lastSet?.weight != null ? String(lastSet.weight) : '');
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

  // Writes the step's inputs into state; returns false if reps are missing
  function commitStep() {
    const reps = body.querySelector('[data-step] [data-f="reps"]');
    const weight = body.querySelector('[data-step] [data-f="weight"]');
    const set = state[order[cursor.i]].sets[cursor.r];
    set.reps = reps.value.trim();
    set.weight = weight.value.trim();
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
        if (!s.absent && s.sets.length === n) s.sets.push({ reps: '', weight: '' });
      }
      if (!order) order = shuffle(members.map(m => m.id));
      move(nextTodo(null));
    } else if (action === 'next') {
      if (!commitStep()) {
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
      // Give every present member the same number of sets; filled-in sets are never removed
      const n = Math.max(1, rounds() + +d.sets);
      for (const m of members) {
        const sets = state[m.id].sets;
        if (state[m.id].absent) continue;
        while (sets.length < n) sets.push({ reps: '', weight: '' });
        while (sets.length > n && sets[sets.length - 1].reps === '') sets.pop();
      }
    } else if (d.absent) {
      const s = state[d.absent];
      s.absent = !s.absent;
      if (!s.absent && !s.sets.length) s.sets.push({ reps: '', weight: '' });
    } else if (d.addset) {
      const sets = state[d.addset].sets;
      sets.push({ ...(sets[sets.length - 1] || { reps: '', weight: '' }) }); // new set starts as a copy of the previous one
    } else if (d.del) {
      state[d.del].sets.splice(+d.i, 1);
    } else if (d.copy) {
      state[d.copy].sets = last.get(d.copy).sets.map(toInput);
    } else {
      return;
    }
    persist();
    render();
  });

  bottom.addEventListener('click', act(async e => {
    const saveBtn = e.target.closest('[data-save]');
    if (!saveBtn) return;
    const rows = members.map(m => {
      const s = state[m.id];
      const sets = s.absent ? [] : s.sets
        .map(x => ({ reps: num(x.reps), weight: num(x.weight) }))
        .filter(x => x.reps != null);
      return { member_id: m.id, absent: s.absent || !sets.length, sets }; // no sets entered counts as not here
    });
    if (rows.every(r => r.absent) && !confirm('No sets entered for anyone. Save anyway?')) return;
    if (!await requireAuth()) return;

    saveBtn.disabled = true;
    try {
      if (!weId) {
        weId = check(await sb.from('workout_exercises').insert({ workout_id: wid, exercise_id: exercise.id }).select('id').single()).id;
      }
      check(await sb.from('entries').upsert(
        rows.map(r => ({ ...r, workout_exercise_id: weId })),
        { onConflict: 'workout_exercise_id,member_id' },
      ));
    } finally {
      saveBtn.disabled = false;
    }
    draft.clear(draftKey);
    go(`#/w/${wid}`);
  }));

  const removeExercise = act(async () => {
    if (!confirm(`Remove ${exercise.name} from this workout?`) || !await requireAuth()) return;
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
