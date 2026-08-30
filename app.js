/* ════════════════════════════════════════════════════════════
   ANCHOR — gentle planning for busy minds
   Local-first PWA: voice dump → inbox → gentle plan → now mode
   ════════════════════════════════════════════════════════════ */

// ─────────── Storage ───────────
const DB_KEY = 'anchor_v1';
let db = load();

function load() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return {
    inbox: [],            // raw brain-dump items {id, text, ts}
    tasks: [],            // sorted {id, text, estMin, energy, when, done, doneDate, plannedStart, plannedEnd}
    settings: { focusStart: '09:00', focusEnd: '17:00', maxTasks: 4, breakMin: 10, clientId: '' },
    manualEvents: [],     // {id, title, start, end, date} date = today string
    wins: {},             // {'2026-08-30': count}
    streak: { count: 0, lastDate: '' },
    gcalEvents: [],       // cached today's google events
    routines: [],         // {id, title, emoji, days:['all'|0-6], timeMin:null, items:[{id,text,done}]}
    notifEnabled: false,
    syncEnabled: false,
  };
}
function migrate() {
  if (!db.routines) db.routines = [];
  if (db.notifEnabled === undefined) db.notifEnabled = false;
  if (db.syncEnabled === undefined) db.syncEnabled = false;
}
function save() {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  notifyLocalChange();
}
function renderAll() { renderInbox(); renderToday(); renderTimeline(); renderEvents(); renderStreak(); renderRoutines(); renderTodayRoutines(); }
const todayStr = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local
const uid = () => Math.random().toString(36).slice(2, 10);

// ─────────── Motivation ───────────
const AFFIRMATIONS = [
  "You don't have to do everything — just the next small thing.",
  "Your brain works differently, and that's not broken. It's yours.",
  "Starting badly still counts as starting.",
  "Rest is part of the plan, not a reward for finishing it.",
  "You've survived 100% of your hardest days so far.",
  "Done is kinder than perfect.",
  "One gentle step. That's all today asks of you.",
  "You are allowed to move slowly.",
  "Forgetting things doesn't make you a failure. It makes you human.",
  "The fact that you showed up here? That's already a win.",
  "Your worth isn't measured by your productivity.",
  "Be as patient with yourself as you are with others.",
];
const WIN_MESSAGES = [
  "You did it! 🎉", "That's a real win. 💜", "Look at you go! ⭐",
  "Small step, big deal. 🌟", "Checked off and celebrated! 🎊",
  "Your future self says thank you. 🙌",
];
const GROUND_STEPS = [
  "Name 5 things you can SEE right now. Take your time.",
  "Name 4 things you can physically FEEL — your feet on the floor, the fabric of your clothes…",
  "Name 3 things you can HEAR. Near or far.",
  "Name 2 things you can SMELL (or two smells you love).",
  "Name 1 thing you can TASTE — or one kind thing you can say to yourself.",
  "You made it through. Notice how your body feels now. 💜",
];
let groundIdx = 0;

// ─────────── Voice capture (Web Speech API — free, on-device) ───────────
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recog = null, listening = false, finalTranscript = '';

function initSpeech() {
  if (!SR) return null;
  const r = new SR();
  r.continuous = true;
  r.interimResults = true;
  r.lang = navigator.language || 'en-US';
  r.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript + ' ';
      else interim += e.results[i][0].transcript;
    }
    document.getElementById('live-transcript').textContent = finalTranscript + interim;
  };
  r.onerror = (e) => {
    setMicStatus(e.error === 'not-allowed' ? '🎤 Microphone blocked — check browser permission' : 'Hmm, ' + e.error + '. Try again?');
    stopListening();
  };
  r.onend = () => { if (listening) { r.start(); } }; // auto-restart while toggled on
  return r;
}

function toggleListening() {
  if (!SR) {
    toast('Voice not supported in this browser — typing works great too! ⌨️');
    document.getElementById('typed-dump').focus();
    return;
  }
  if (listening) { stopListening(true); return; }
  recog = recog || initSpeech();
  finalTranscript = '';
  document.getElementById('live-transcript').textContent = '';
  try { recog.start(); } catch (e) {}
  listening = true;
  const btn = document.getElementById('mic-btn');
  btn.classList.add('mic-pulse');
  btn.textContent = '⏹️';
  setMicStatus('Listening… tap ⏹ when done');
}

function stopListening(commit) {
  if (recog) { listening = false; try { recog.stop(); } catch (e) {} }
  const btn = document.getElementById('mic-btn');
  btn.classList.remove('mic-pulse');
  btn.textContent = '🎙️';
  setMicStatus('Tap to start talking');
  if (commit && finalTranscript.trim()) commitDump(finalTranscript.trim());
}

function setMicStatus(t) { document.getElementById('mic-status').textContent = t; }

// Split a rambling transcript into individual items: new sentences /
// "and then" / "also" / "next" boundaries.
function commitDump(text) {
  const parts = text
    .split(/(?:\.\s+|\band then\b|\balso\b|\bnext\b|\boh and\b|\bthen\b)/i)
    .map(s => s.trim().replace(/^[,.\s]+|[,.\s]+$/g, ''))
    .filter(s => s.length > 1);
  parts.forEach(p => db.inbox.push({ id: uid(), text: p, ts: Date.now() }));
  save();
  document.getElementById('live-transcript').textContent = '';
  toast(`Caught ${parts.length} thing${parts.length > 1 ? 's' : ''} 📥`);
  renderInbox();
}

function addTypedDump() {
  const el = document.getElementById('typed-dump');
  const lines = el.value.split('\n').map(s => s.trim()).filter(Boolean);
  if (!lines.length) return;
  lines.forEach(t => db.inbox.push({ id: uid(), text: t, ts: Date.now() }));
  el.value = '';
  save(); renderInbox();
  toast(`Added ${lines.length} 📥`);
}

// ─────────── Sorting sheet ───────────
let sortingId = null;
function openSort(id) {
  sortingId = id;
  const item = db.inbox.find(i => i.id === id);
  if (!item) return;
  document.getElementById('sort-text').textContent = '"' + item.text + '"';
  document.getElementById('sort-sheet').classList.remove('hidden');
}
function closeSort() { document.getElementById('sort-sheet').classList.add('hidden'); sortingId = null; }

document.querySelectorAll('#sort-mins .chip, #sort-energy .chip, #sort-when .chip').forEach(c => {
  c.addEventListener('click', () => {
    c.parentElement.querySelectorAll('.chip').forEach(x => x.classList.remove('on'));
    c.classList.add('on');
  });
});

function confirmSort() {
  const item = db.inbox.find(i => i.id === sortingId);
  if (!item) { closeSort(); return; }
  const val = sel => document.querySelector(sel + ' .chip.on').dataset.v;
  db.tasks.push({
    id: uid(), text: item.text,
    estMin: +val('#sort-mins'), energy: val('#sort-energy'),
    when: val('#sort-when'), done: false, plannedStart: null, plannedEnd: null,
  });
  db.inbox = db.inbox.filter(i => i.id !== sortingId);
  save(); closeSort(); renderAll();
  toast('Sorted 🌱');
}

// ─────────── The gentle planner ───────────
// Places today's tasks into free gaps between calendar events inside focus
// hours, respecting per-day task cap and breaks. Easy (low-energy, short)
// tasks go earlier — momentum first.
function planMyDay() {
  const s = db.settings;
  const [fsH, fsM] = s.focusStart.split(':').map(Number);
  const [feH, feM] = s.focusEnd.split(':').map(Number);
  const now = new Date();
  let cursor = new Date(now); cursor.setHours(fsH, fsM, 0, 0);
  let focusEnd = new Date(now); focusEnd.setHours(feH, feM, 0, 0);
  if (cursor < now) { cursor = new Date(now); cursor.setMinutes(Math.ceil(cursor.getMinutes() / 15) * 15, 0, 0); }

  // busy intervals = google + manual events today
  const busy = getTodayEvents()
    .map(e => ({ start: new Date(e.start), end: new Date(e.end) }))
    .filter(e => e.end > now && e.start < focusEnd)
    .sort((a, b) => a.start - b.start);

  const pending = db.tasks
    .filter(t => !t.done && (t.when === 'today' || t.when === 'tomorrow' && false))
    .sort((a, b) => (energyRank(a.energy) - energyRank(b.energy)) || (a.estMin - b.estMin))
    .slice(0, +s.maxTasks);

  // clear old plan
  db.tasks.forEach(t => { t.plannedStart = null; t.plannedEnd = null; });

  const placed = [];
  for (const task of pending) {
    const slot = findSlot(cursor, focusEnd, busy, task.estMin);
    if (!slot) continue;
    task.plannedStart = slot.start.toISOString();
    task.plannedEnd = slot.end.toISOString();
    placed.push(task);
    cursor = new Date(slot.end.getTime() + (+s.breakMin) * 60000);
  }
  save();
  renderAll();
  const skipped = pending.length - placed.length;
  toast(placed.length
    ? `Planned ${placed.length} task${placed.length > 1 ? 's' : ''} gently ✨${skipped ? ` (${skipped} saved for later — that's okay)` : ''}`
    : 'No room left in focus hours — want to extend them in Plan tab? 💜');
  switchView('today');
}
function energyRank(e) { return e === 'low' ? 0 : e === 'med' ? 1 : 2; }

function findSlot(cursor, focusEnd, busy, needMin) {
  let cur = new Date(cursor);
  for (let guard = 0; guard < 64; guard++) {
    const end = new Date(cur.getTime() + needMin * 60000);
    if (end > focusEnd) return null;
    const clash = busy.find(b => cur < b.end && end > b.start);
    if (!clash) return { start: cur, end };
    cur = new Date(clash.end.getTime() + 5 * 60000); // small buffer after events
  }
  return null;
}

// ─────────── Recurring routines ───────────
const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function renderRoutineDaysPicker() {
  const wrap = document.getElementById('routine-days');
  if (!wrap) return;
  wrap.innerHTML = '';
  const all = document.createElement('button');
  all.className = 'chip on'; all.dataset.v = 'all'; all.textContent = 'Every day';
  wrap.appendChild(all);
  DAY_NAMES.forEach((n, i) => {
    const b = document.createElement('button');
    b.className = 'chip'; b.dataset.v = String(i); b.textContent = n;
    wrap.appendChild(b);
  });
  wrap.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => {
    if (c.dataset.v === 'all') {
      wrap.querySelectorAll('.chip').forEach(x => x.classList.remove('on'));
      c.classList.add('on');
    } else {
      wrap.querySelector('[data-v="all"]').classList.remove('on');
      c.classList.toggle('on');
      if (!wrap.querySelectorAll('.chip.on').length) wrap.querySelector('[data-v="all"]').classList.add('on');
    }
  }));
}
function selectedRoutineDays() {
  const on = [...document.querySelectorAll('#routine-days .chip.on')].map(c => c.dataset.v);
  return on.includes('all') ? ['all'] : on.map(Number);
}

function addRoutine() {
  const title = document.getElementById('routine-title').value.trim();
  if (!title) { toast('Give the routine a name'); return; }
  const emoji = document.getElementById('routine-emoji').value.trim() || '🌅';
  const t = document.getElementById('routine-time').value;
  const timeMin = t ? (+t.split(':')[0]) * 60 + (+t.split(':')[1]) : null;
  db.routines.push({ id: uid(), title, emoji, days: selectedRoutineDays(), timeMin, items: [] });
  document.getElementById('routine-title').value = '';
  document.getElementById('routine-time').value = '';
  save(); renderRoutines(); renderTodayRoutines();
  toast('Routine added 🌅');
}

function deleteRoutine(id) {
  db.routines = db.routines.filter(r => r.id !== id);
  save(); renderRoutines(); renderTodayRoutines();
}

function addRoutineItem(rid) {
  const r = db.routines.find(x => x.id === rid); if (!r) return;
  const inp = document.getElementById('ritem-' + rid);
  const text = inp.value.trim(); if (!text) return;
  r.items.push({ id: uid(), text, done: false });
  inp.value = '';
  save(); renderRoutines(); renderTodayRoutines();
}

function deleteRoutineItem(rid, iid) {
  const r = db.routines.find(x => x.id === rid); if (!r) return;
  r.items = r.items.filter(i => i.id !== iid);
  save(); renderRoutines(); renderTodayRoutines();
}

function toggleTodayRoutineItem(rid, iid) {
  const r = db.routines.find(x => x.id === rid); if (!r) return;
  const item = r.items.find(i => i.id === iid); if (!item) return;
  item.done = !item.done;
  if (item.done) registerWin(); else save();
  renderTodayRoutines(); renderRoutines();
}

function routineAppliesToday(r) {
  if (r.days.includes('all')) return true;
  return r.days.includes(new Date().getDay());
}

function daysLabel(r) {
  if (r.days.includes('all')) return 'every day';
  return r.days.map(d => DAY_NAMES[d]).join(' · ');
}

function renderRoutines() {
  const wrap = document.getElementById('routines-list');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!db.routines.length) {
    wrap.innerHTML = '<div class="card p-6 text-center text-sm" style="color:var(--ink-soft)"><p class="text-3xl mb-2">🌱</p>No routines yet. Small anchors make big days.</div>';
    return;
  }
  db.routines.forEach(r => {
    const card = document.createElement('div');
    card.className = 'card p-4';
    const items = r.items.map(i => `
      <div class="flex items-center gap-2 py-1">
        <span class="flex-1 text-sm">${esc(i.text)}</span>
        <button class="text-xs opacity-40 px-1" onclick="deleteRoutineItem('${r.id}','${i.id}')">✕</button>
      </div>`).join('');
    card.innerHTML = `
      <div class="flex items-center gap-2 mb-1">
        <span class="text-xl">${esc(r.emoji)}</span>
        <p class="flex-1 font-bold text-sm">${esc(r.title)}</p>
        <button class="text-xs opacity-40 px-1" onclick="deleteRoutine('${r.id}')" title="Delete routine">✕</button>
      </div>
      <p class="text-xs mb-2" style="color:var(--ink-soft)">${daysLabel(r)}${r.timeMin !== null ? ' · ⏰ ' + fmtMin(r.timeMin) : ''}</p>
      <div class="divide-y" style="border-color:rgba(124,106,170,.12)">${items || '<p class="text-xs py-1" style="color:var(--ink-soft)">No steps yet.</p>'}</div>
      <div class="flex gap-2 mt-2">
        <input id="ritem-${r.id}" type="text" placeholder="Add a step… (e.g. take meds)" class="flex-1 border rounded-xl px-3 py-1.5 text-xs" style="border-color:rgba(124,106,170,.3)"
          onkeydown="if(event.key==='Enter')addRoutineItem('${r.id}')">
        <button onclick="addRoutineItem('${r.id}')" class="btn-soft text-xs">+ Add</button>
      </div>`;
    wrap.appendChild(card);
  });
}

function fmtMin(mins) {
  const h = Math.floor(mins / 60), m = String(mins % 60).padStart(2, '0');
  const hr = h % 24;
  return ((hr % 12) || 12) + ':' + m + (hr < 12 ? ' AM' : ' PM');
}

function renderTodayRoutines() {
  const wrap = document.getElementById('today-routines');
  if (!wrap) return;
  const todays = db.routines.filter(routineAppliesToday);
  wrap.innerHTML = '';
  document.getElementById('today-routines-head').style.display = todays.length ? '' : 'none';
  todays.forEach(r => {
    const done = r.items.filter(i => i.done).length;
    const card = document.createElement('div');
    card.className = 'card p-3 task-enter';
    const rows = r.items.map(i => `
      <label class="flex items-center gap-2 py-1 cursor-pointer">
        <input type="checkbox" ${i.done ? 'checked' : ''} onchange="toggleTodayRoutineItem('${r.id}','${i.id}')" class="w-4 h-4 accent-purple-600">
        <span class="flex-1 text-sm ${i.done ? 'line-through opacity-50' : ''}">${esc(i.text)}</span>
      </label>`).join('');
    card.innerHTML = `
      <div class="flex items-center gap-2">
        <span class="text-lg">${esc(r.emoji)}</span>
        <p class="flex-1 font-bold text-sm">${esc(r.title)}</p>
        ${r.items.length ? `<span class="text-xs font-bold" style="color:var(--lav-dark)">${done}/${r.items.length}</span>` : ''}
      </div>
      ${r.items.length ? `<div class="h-1.5 rounded-full mt-1 mb-1" style="background:var(--lav-soft)"><div class="h-1.5 rounded-full" style="background:var(--lav);width:${r.items.length ? (done / r.items.length) * 100 : 0}%"></div></div>` : ''}
      ${rows || '<p class="text-xs" style="color:var(--ink-soft)">Add steps in the Routines tab.</p>'}`;
    wrap.appendChild(card);
  });
}

// Reset routine checkboxes at each new day
function resetRoutinesForNewDay() {
  const key = 'anchor_routines_reset';
  const last = localStorage.getItem(key);
  const t = todayStr();
  if (last === t) return;
  db.routines.forEach(r => r.items.forEach(i => i.done = false));
  localStorage.setItem(key, t);
  save();
}

// ─────────── Body-doubling timer ───────────
const BD_FOCUS = ["I'm right here with you.", "Nice and steady.", "You've got this.", "Still here. Keep going.", "No rush, no judgment. Just us."];
const BD_REST = ["Break time — I'm still here.", "Stretch, sip some water. 🌿", "Look away from the screen for a moment.", "Breathe in… and out. Well done."];
let bd = { running: false, phase: 'focus', focusMin: 25, breakMin: 5, left: 25 * 60, int: null, msgInt: null };

document.querySelectorAll('#bd-presets .chip').forEach(c => c.addEventListener('click', () => {
  document.querySelectorAll('#bd-presets .chip').forEach(x => x.classList.remove('on'));
  c.classList.add('on');
  bd.focusMin = +c.dataset.w; bd.breakMin = +c.dataset.b;
  if (!bd.running) { bd.phase = 'focus'; bd.left = bd.focusMin * 60; bdDraw(); }
}));

function bdDraw() {
  const m = String(Math.floor(bd.left / 60)).padStart(2, '0');
  const s = String(bd.left % 60).padStart(2, '0');
  document.getElementById('bd-timer').textContent = m + ':' + s;
  const ph = document.getElementById('bd-phase');
  ph.textContent = !bd.running ? 'READY' : (bd.phase === 'focus' ? '🫶 FOCUS — together' : '🌿 REST');
  document.getElementById('bd-dot').classList.toggle('live', bd.running && bd.phase === 'focus');
}
function bdMsg(pool) {
  document.getElementById('bd-message').textContent = '"' + pool[(Math.random() * pool.length) | 0] + '"';
}
function bdStartPause() {
  if (bd.running) { bdPause(); return; }
  bd.running = true;
  document.getElementById('bd-start-btn').textContent = '⏸ Pause';
  bdMsg(bd.phase === 'focus' ? BD_FOCUS : BD_REST);
  bdDraw();
  bd.int = setInterval(() => {
    bd.left--;
    bdDraw();
    if (bd.left <= 0) bdPhaseDone();
  }, 1000);
  bd.msgInt = setInterval(() => bdMsg(bd.phase === 'focus' ? BD_FOCUS : BD_REST), 60000);
}
function bdPause() {
  bd.running = false;
  clearInterval(bd.int); clearInterval(bd.msgInt);
  document.getElementById('bd-start-btn').textContent = '▶ Resume';
  bdDraw();
}
function bdPhaseDone() {
  clearInterval(bd.int); clearInterval(bd.msgInt);
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  if (bd.phase === 'focus') {
    bd.phase = 'rest'; bd.left = bd.breakMin * 60;
    bdMsg(BD_REST);
    toast('🌿 Focus block done — rest time');
    notify('Body-double: break time 🌿', 'Stretch, water, breathe. I\'m still here.');
    bd.running = false;
    bdStartPause(); // auto-roll into rest
  } else {
    bd.phase = 'focus'; bd.left = bd.focusMin * 60;
    bdMsg(BD_FOCUS);
    toast('🫶 Ready for another focus block together?');
    notify('Body-double: next focus block 🫶', 'Whenever you\'re ready — no pressure.');
    bd.running = false;
    document.getElementById('bd-start-btn').textContent = '▶ Start together';
    bdDraw();
  }
}
function bdEnd() {
  clearInterval(bd.int); clearInterval(bd.msgInt);
  bd.running = false; bd.phase = 'focus'; bd.left = bd.focusMin * 60;
  document.getElementById('bd-start-btn').textContent = '▶ Start together';
  document.getElementById('bd-message').textContent = 'I\'m right here with you. No judgment, just company.';
  bdDraw();
}

// ─────────── Notifications & reminders ───────────
const notifiedKey = 'anchor_notified';
function notifiedSet() { try { return new Set(JSON.parse(localStorage.getItem(notifiedKey) || '[]')); } catch (e) { return new Set(); } }
function markNotified(k) { const s = notifiedSet(); s.add(k); localStorage.setItem(notifiedKey, JSON.stringify([...s].slice(-200))); }

async function enableNotifications() {
  if (!('Notification' in window)) { toast('This browser doesn\'t support notifications'); return; }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { setNotifStatus('Blocked — check browser/site settings'); toast('Notifications were blocked by the browser'); return; }
  db.notifEnabled = true; save();
  setNotifStatus('On — gentle nudges for planned tasks & routines 🔔');
  toast('Reminders on 🔔');
}
function disableNotifications() {
  db.notifEnabled = false; save();
  setNotifStatus('Off');
  toast('Reminders off');
}
function setNotifStatus(t) { const el = document.getElementById('notif-status'); if (el) el.textContent = t; }
function testNotification() { notify('⚓ Anchor', 'Reminders are working. You\'ve got this. 💜'); }

async function notify(title, body) {
  if (!db.notifEnabled) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) { reg.showNotification(title, { body, icon: undefined }); return; }
    }
    new Notification(title, { body });
  } catch (e) { try { new Notification(title, { body }); } catch (e2) {} }
}

// checks every minute for planned tasks & routine times
timersInit();
function timersInit() {
  setInterval(checkReminders, 30000);
  setTimeout(checkReminders, 5000);
}
function checkReminders() {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  // planned tasks
  db.tasks.filter(t => !t.done && t.plannedStart).forEach(t => {
    const start = new Date(t.plannedStart);
    const diff = (start - now) / 60000;
    const k = 'task_' + t.id + '_' + t.plannedStart;
    if (diff > 0 && diff <= 10 && !notifiedSet().has(k)) {
      markNotified(k);
      notify('⚓ Coming up gently: ' + t.text, 'Starts at ' + fmtTime(t.plannedStart) + '. No rush — just a heads-up. 💜');
      toast('⏰ "' + t.text + '" starts at ' + fmtTime(t.plannedStart));
    }
  });
  // routines with a time
  db.routines.filter(r => r.timeMin !== null && routineAppliesToday(r)).forEach(r => {
    const k = 'routine_' + r.id + '_' + todayStr();
    if (nowMin >= r.timeMin && !notifiedSet().has(k)) {
      const undone = r.items.filter(i => !i.done).length;
      if (undone > 0 || r.items.length === 0) {
        markNotified(k);
        notify(r.emoji + ' ' + r.title, 'Gentle nudge — ' + (undone ? undone + ' step' + (undone > 1 ? 's' : '') + ' left today.' : 'time when you\'re ready.') + ' 💜');
      }
    }
  });
}

// ─────────── Cloud sync (Google Drive appDataFolder) ───────────
const SYNC_FILE = 'anchor-data.json';
let syncFileId = null, pushTimer = null, pulling = false;

function notifyLocalChange() {
  if (!db.syncEnabled || !gcalToken) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(syncPush, 3000); // debounce
}
function setSyncStatus(t) { const el = document.getElementById('sync-status'); if (el) el.textContent = t; }

async function enableSync() {
  db.syncEnabled = true; save();
  if (!gcalToken) { setSyncStatus('Reconnecting to grant Drive access…'); gcalConnect(); return; }
  setSyncStatus('Syncing…');
  await syncNow();
}

async function driveApi(path, opts) {
  const res = await fetch('https://www.googleapis.com/drive/v3' + path, opts);
  if (res.status === 401) { gcalToken = null; setSyncStatus('Session expired — reconnect in Calendar section'); throw new Error('401'); }
  return res;
}

async function findSyncFile() {
  const res = await driveApi('/files?spaces=appDataFolder&q=name%3D%27' + SYNC_FILE + '%27&fields=files(id,name,modifiedTime)',
    { headers: { Authorization: 'Bearer ' + gcalToken } });
  const data = await res.json();
  syncFileId = data.files && data.files.length ? data.files[0].id : null;
  return data.files && data.files.length ? data.files[0] : null;
}

async function syncPush() {
  if (!gcalToken || pulling) return;
  try {
    if (!syncFileId) await findSyncFile();
    const meta = { name: SYNC_FILE };
    const payload = JSON.stringify({ ...db, _syncedAt: new Date().toISOString() });
    const boundary = 'anchor_boundary_' + Date.now();
    let body;
    if (!syncFileId) meta.parents = ['appDataFolder'];
    body = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta)
      + '\r\n--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' + payload
      + '\r\n--' + boundary + '--';
    const url = syncFileId
      ? 'https://www.googleapis.com/upload/drive/v3/files/' + syncFileId + '?uploadType=multipart'
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
    const res = await fetch(url, {
      method: syncFileId ? 'PATCH' : 'POST',
      headers: { Authorization: 'Bearer ' + gcalToken, 'Content-Type': 'multipart/related; boundary=' + boundary },
      body,
    });
    if (res.status === 401) { gcalToken = null; setSyncStatus('Session expired — reconnect'); return; }
    const data = await res.json();
    if (data.id) syncFileId = data.id;
    setSyncStatus('✓ Synced ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
  } catch (e) { setSyncStatus('Sync failed — will retry on next change'); }
}

async function syncPull() {
  if (!gcalToken) return;
  pulling = true;
  try {
    const f = await findSyncFile();
    if (!f) { pulling = false; return; }
    const res = await driveApi('/files/' + f.id + '?alt=media', { headers: { Authorization: 'Bearer ' + gcalToken } });
    const remote = await res.json();
    const remoteAt = remote._syncedAt ? new Date(remote._syncedAt).getTime() : 0;
    const localRaw = localStorage.getItem(DB_KEY);
    let localAt = 0;
    try { const l = JSON.parse(localRaw); localAt = l._syncedAt ? new Date(l._syncedAt).getTime() : 0; } catch (e) {}
    if (remoteAt > localAt) {
      delete remote._syncedAt;
      db = remote; migrate();
      localStorage.setItem(DB_KEY, JSON.stringify(db));
      renderAll(); applySettingsToUI();
      setSyncStatus('✓ Pulled latest from cloud');
    } else {
      setSyncStatus('✓ This device is newest');
    }
  } catch (e) { setSyncStatus('Pull failed — check connection'); }
  pulling = false;
}

async function syncNow() {
  if (!gcalToken) { toast('Connect Google first (section above)'); return; }
  await syncPull();
  await syncPush();
}

// ─────────── Google Calendar (GIS token client) ───────────
const GCAL_SCOPE = 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive.appdata';
let gcalTokenClient = null, gcalToken = null;

function saveClientId() {
  const v = document.getElementById('gcal-client-id').value.trim();
  db.settings.clientId = v; save();
  toast(v ? 'Client ID saved on this device ✓' : 'Cleared');
}

function gcalConnect() {
  const cid = db.settings.clientId;
  if (!cid) { toast('Paste your Client ID first (setup guide above) 👆'); return; }
  if (!window.google || !google.accounts) { toast('Google library still loading — try again in a second'); return; }
  gcalTokenClient = gcalTokenClient || google.accounts.oauth2.initTokenClient({
    client_id: cid,
    scope: GCAL_SCOPE,
    callback: (resp) => {
      if (resp.error) { toast('Google said: ' + resp.error); return; }
      gcalToken = resp.access_token;
      setGcalStatus('Connected ✓');
      document.getElementById('gcal-connect-btn').textContent = 'Reconnect';
      document.getElementById('gcal-refresh-btn').classList.remove('hidden');
      gcalFetchEvents();
      if (db.syncEnabled) { setSyncStatus('Syncing…'); syncNow(); }
    },
  });
  gcalTokenClient.requestAccessToken({ prompt: gcalToken ? '' : 'consent' });
}

async function gcalFetchEvents() {
  if (!gcalToken) { toast('Connect first'); return; }
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(); end.setHours(23, 59, 59, 999);
  const url = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
    + '?timeMin=' + encodeURIComponent(start.toISOString())
    + '&timeMax=' + encodeURIComponent(end.toISOString())
    + '&singleEvents=true&orderBy=startTime';
  try {
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + gcalToken } });
    if (res.status === 401) { gcalToken = null; setGcalStatus('Session expired — reconnect'); return; }
    const data = await res.json();
    db.gcalEvents = (data.items || [])
      .filter(ev => ev.start && (ev.start.dateTime || ev.start.date))
      .map(ev => ({
        id: 'g_' + ev.id, gcalId: ev.id, title: ev.summary || '(busy)',
        start: ev.start.dateTime || ev.start.date + 'T09:00:00',
        end: ev.end.dateTime || ev.end.date + 'T10:00:00',
      }));
    save(); renderEvents(); renderToday();
    toast(`Pulled ${db.gcalEvents.length} event${db.gcalEvents.length === 1 ? '' : 's'} for today 📅`);
  } catch (e) { toast('Could not reach Google Calendar'); }
}

// Push one planned task to Google Calendar as an event
async function gcalPushTask(taskId) {
  if (!gcalToken) { toast('Connect Google Calendar first (Calendar tab)'); return; }
  const t = db.tasks.find(x => x.id === taskId);
  if (!t || !t.plannedStart) { toast('Plan the day first so this task has a time'); return; }
  try {
    const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + gcalToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: '⚓ ' + t.text,
        start: { dateTime: t.plannedStart },
        end: { dateTime: t.plannedEnd },
        description: 'Planned gently by Anchor 💜',
      }),
    });
    if (!res.ok) throw new Error();
    toast('Added to Google Calendar ✓');
  } catch (e) { toast('Could not push — try reconnecting'); }
}

function setGcalStatus(t) { document.getElementById('gcal-status').textContent = t; }

// ─────────── Manual events ───────────
function addManualEvent() {
  const title = document.getElementById('manual-event-title').value.trim();
  const st = document.getElementById('manual-event-start').value;
  const en = document.getElementById('manual-event-end').value;
  if (!title || !st || !en) { toast('Need a name, start and end time'); return; }
  db.manualEvents.push({ id: uid(), title, date: todayStr(), start: todayStr() + 'T' + st + ':00', end: todayStr() + 'T' + en + ':00' });
  document.getElementById('manual-event-title').value = '';
  save(); renderEvents();
}
function getTodayEvents() {
  return [
    ...db.gcalEvents,
    ...db.manualEvents.filter(e => e.date === todayStr()),
  ].sort((a, b) => new Date(a.start) - new Date(b.start));
}
function deleteManualEvent(id) { db.manualEvents = db.manualEvents.filter(e => e.id !== id); save(); renderEvents(); }

// ─────────── Now mode + timer ───────────
let nowTaskId = null, timerInt = null, timerLeft = 25 * 60;

function pickNowTask(excludeId) {
  const planned = db.tasks.filter(t => !t.done && t.plannedStart)
    .sort((a, b) => new Date(a.plannedStart) - new Date(b.plannedStart));
  const pool = planned.length ? planned : db.tasks.filter(t => !t.done && t.when === 'today');
  if (!pool.length) return null;
  const choices = pool.filter(t => t.id !== excludeId);
  return choices[0] || pool[0];
}

function renderNow() {
  const t = pickNowTask(nowTaskId);
  nowTaskId = t ? t.id : null;
  document.getElementById('now-task-title').textContent = t ? t.text : 'Nothing pending — breathe easy 🕊️';
  document.getElementById('now-task-meta').textContent = t
    ? `~${t.estMin} min · ${{ low: '🌙 gentle', med: '☀️ medium', high: '🔥 intense' }[t.energy]} energy`
    : '';
  document.getElementById('now-start-btn').style.display = t ? '' : 'none';
  document.getElementById('now-wins-today').textContent = db.wins[todayStr()] || 0;
  document.getElementById('now-encouragement').textContent =
    '"' + AFFIRMATIONS[(AFFIRMATIONS.length * Math.random()) | 0] + '"';
  resetTimer(t ? Math.min(t.estMin, 50) : 25);
}

function resetTimer(min) {
  clearInterval(timerInt); timerInt = null;
  timerLeft = min * 60;
  drawTimer();
  document.getElementById('now-start-btn').textContent = '▶ Start focus';
}
function drawTimer() {
  const m = String(Math.floor(timerLeft / 60)).padStart(2, '0');
  const s = String(timerLeft % 60).padStart(2, '0');
  document.getElementById('now-timer').textContent = m + ':' + s;
}
function nowToggleTimer() {
  if (timerInt) { clearInterval(timerInt); timerInt = null; document.getElementById('now-start-btn').textContent = '▶ Resume'; return; }
  document.getElementById('now-start-btn').textContent = '⏸ Pause';
  timerInt = setInterval(() => {
    timerLeft--;
    drawTimer();
    if (timerLeft <= 0) {
      clearInterval(timerInt); timerInt = null;
      document.getElementById('now-start-btn').textContent = '▶ Start focus';
      toast('⏰ Time! Stretch, water, breathe. 🌿');
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    }
  }, 1000);
}
function nowSkip() { renderNow(); }
function nowComplete() {
  if (!nowTaskId) return;
  completeTask(nowTaskId);
  nowTaskId = null;
  renderNow();
}

function completeTask(id) {
  const t = db.tasks.find(x => x.id === id);
  if (!t || t.done) return;
  t.done = true; t.doneDate = todayStr();
  db.wins[todayStr()] = (db.wins[todayStr()] || 0) + 1;
  // streak
  const y = new Date(); y.setDate(y.getDate() - 1);
  const yStr = y.toLocaleDateString('en-CA');
  db.streak.count = (db.streak.lastDate === todayStr()) ? db.streak.count
    : (db.streak.lastDate === yStr ? db.streak.count + 1 : 1);
  db.streak.lastDate = todayStr();
  save(); renderAll();
  confetti();
  toast(WIN_MESSAGES[(WIN_MESSAGES.length * Math.random()) | 0]);
}

function registerWin() {
  db.wins[todayStr()] = (db.wins[todayStr()] || 0) + 1;
  const y = new Date(); y.setDate(y.getDate() - 1);
  const yStr = y.toLocaleDateString('en-CA');
  db.streak.count = (db.streak.lastDate === todayStr()) ? db.streak.count
    : (db.streak.lastDate === yStr ? db.streak.count + 1 : 1);
  db.streak.lastDate = todayStr();
  save(); renderStreak(); renderNowWins();
  confetti();
  toast(WIN_MESSAGES[(WIN_MESSAGES.length * Math.random()) | 0]);
}
function renderNowWins() {
  const el = document.getElementById('now-wins-today');
  if (el) el.textContent = db.wins[todayStr()] || 0;
}

function confetti() {
  const colors = ['#7c6aaa', '#d6566e', '#9fc9b8', '#f4c95d', '#d98fb1'];
  for (let i = 0; i < 28; i++) {
    const p = document.createElement('div');
    p.className = 'confetti';
    p.style.cssText = `left:${Math.random() * 100}vw;width:${6 + Math.random() * 8}px;height:${8 + Math.random() * 10}px;background:${colors[i % colors.length]};border-radius:2px;animation-duration:${1.8 + Math.random() * 1.6}s;animation-delay:${Math.random() * .4}s`;
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 4000);
  }
}

// ─────────── Grounding ───────────
function openGrounding() { groundIdx = 0; document.getElementById('ground-step').textContent = 'When your mind is loud, this brings you back. Ready?'; document.getElementById('ground-next-btn').textContent = 'Begin'; document.getElementById('ground-modal').classList.remove('hidden'); }
function groundNext() {
  if (groundIdx >= GROUND_STEPS.length) { closeGrounding(); toast('Welcome back 💜'); return; }
  document.getElementById('ground-step').textContent = GROUND_STEPS[groundIdx];
  document.getElementById('ground-next-btn').textContent = groundIdx === GROUND_STEPS.length - 1 ? 'Finish 💜' : 'Next →';
  groundIdx++;
}
function closeGrounding() { document.getElementById('ground-modal').classList.add('hidden'); }

// ─────────── Rendering ───────────
const fmtTime = iso => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function renderInbox() {
  const el = document.getElementById('inbox-list');
  el.innerHTML = '';
  document.getElementById('inbox-empty').classList.toggle('hidden', db.inbox.length > 0);
  db.inbox.slice().reverse().forEach(item => {
    const row = document.createElement('div');
    row.className = 'card p-3 flex items-center gap-3 task-enter';
    row.innerHTML = `<p class="flex-1 text-sm">${esc(item.text)}</p>
      <button class="btn-soft text-xs" onclick="openSort('${item.id}')">Sort 🌱</button>
      <button class="text-xs opacity-50 px-1" onclick="inboxDelete('${item.id}')" title="Let it go">✕</button>`;
    el.appendChild(row);
  });
}
function inboxDelete(id) { db.inbox = db.inbox.filter(i => i.id !== id); save(); renderInbox(); }

function renderToday() {
  const wrap = document.getElementById('today-plan');
  wrap.innerHTML = '';
  const planned = db.tasks.filter(t => !t.done && t.plannedStart)
    .sort((a, b) => new Date(a.plannedStart) - new Date(b.plannedStart));
  const events = getTodayEvents();
  document.getElementById('today-empty').classList.toggle('hidden', planned.length > 0 || events.length > 0);

  // merge events + planned tasks into one timeline
  const rows = [
    ...events.map(e => ({ type: 'event', start: e.start, end: e.end, title: e.title })),
    ...planned.map(t => ({ type: 'task', start: t.plannedStart, end: t.plannedEnd, task: t })),
  ].sort((a, b) => new Date(a.start) - new Date(b.start));

  rows.forEach((r, i) => {
    const next = rows[i + 1];
    const div = document.createElement('div');
    div.className = 'timeline-row task-enter';
    const body = r.type === 'event'
      ? `<div class="card block-event p-2.5"><p class="text-sm font-semibold">📅 ${esc(r.title)}</p>
           <p class="text-xs" style="color:var(--ink-soft)">${fmtTime(r.start)} – ${fmtTime(r.end)}</p></div>`
      : `<div class="card block-task p-2.5 flex items-center gap-2">
           <button onclick="completeTask('${r.task.id}')" class="w-6 h-6 rounded-full border-2 flex-shrink-0" style="border-color:var(--lav)" title="Mark done"></button>
           <div class="flex-1"><p class="text-sm font-semibold">${esc(r.task.text)}</p>
             <p class="text-xs" style="color:var(--ink-soft)">${fmtTime(r.start)} – ${fmtTime(r.end)} · ~${r.task.estMin} min</p></div>
           <button onclick="gcalPushTask('${r.task.id}')" class="btn-soft text-xs" title="Send to Google Calendar">📅</button>
         </div>`;
    div.innerHTML = `<div class="time-label">${fmtTime(r.start)}</div>${body}`;
    wrap.appendChild(div);
    // break indicator
    if (next) {
      const gap = (new Date(next.start) - new Date(r.end)) / 60000;
      if (gap >= 5) {
        const b = document.createElement('div');
        b.className = 'timeline-row';
        b.innerHTML = `<div></div><div class="block-break rounded-lg px-3 py-1 text-xs" style="color:var(--ink-soft)">🍃 ${Math.round(gap)} min breathing room</div>`;
        wrap.appendChild(b);
      }
    }
  });

  const backlog = db.tasks.filter(t => !t.done && !t.plannedStart);
  const bl = document.getElementById('today-backlog');
  bl.innerHTML = backlog.length ? '' : '<p class="text-xs" style="color:var(--ink-soft)">All sorted tasks are planned ✓</p>';
  backlog.forEach(t => {
    const d = document.createElement('div');
    d.className = 'card p-3 flex items-center gap-2 task-enter';
    d.innerHTML = `<div class="flex-1"><p class="text-sm">${esc(t.text)}</p>
      <p class="text-xs" style="color:var(--ink-soft)">~${t.estMin} min · ${t.energy} energy · ${t.when}</p></div>
      <button onclick="completeTask('${t.id}')" class="btn-soft text-xs">✓</button>`;
    bl.appendChild(d);
  });
}

function renderTimeline() {
  const wrap = document.getElementById('plan-timeline');
  wrap.innerHTML = '';
  const planned = db.tasks.filter(t => !t.done && t.plannedStart).sort((a, b) => new Date(a.plannedStart) - new Date(b.plannedStart));
  if (!planned.length) { wrap.innerHTML = '<div class="card p-6 text-center text-sm" style="color:var(--ink-soft)"><p class="text-3xl mb-2">✨</p>Tap "Build today\'s plan" above.</div>'; return; }
  planned.forEach(t => {
    const d = document.createElement('div');
    d.className = 'timeline-row task-enter';
    d.innerHTML = `<div class="time-label">${fmtTime(t.plannedStart)}</div>
      <div class="card block-task p-2.5"><p class="text-sm font-semibold">${esc(t.text)}</p>
      <p class="text-xs" style="color:var(--ink-soft)">${fmtTime(t.plannedStart)} – ${fmtTime(t.plannedEnd)} · ${{ low: '🌙', med: '☀️', high: '🔥' }[t.energy]}</p></div>`;
    wrap.appendChild(d);
  });
}

function renderEvents() {
  const el = document.getElementById('events-list');
  const events = getTodayEvents();
  el.innerHTML = events.length ? '' : '<div class="card p-4 text-center text-sm" style="color:var(--ink-soft)">No events today. Open sky. 🌤️</div>';
  events.forEach(e => {
    const d = document.createElement('div');
    d.className = 'card block-event p-3 flex items-center gap-2';
    const isManual = !String(e.id).startsWith('g_');
    d.innerHTML = `<div class="flex-1"><p class="text-sm font-semibold">${esc(e.title)}</p>
      <p class="text-xs" style="color:var(--ink-soft)">${fmtTime(e.start)} – ${fmtTime(e.end)}</p></div>
      ${isManual ? `<button class="text-xs opacity-50 px-1" onclick="deleteManualEvent('${e.id}')">✕</button>` : '<span class="text-xs">📅</span>'}`;
    el.appendChild(d);
  });
  const ml = document.getElementById('manual-events-list');
  const todays = db.manualEvents.filter(e => e.date === todayStr());
  ml.innerHTML = todays.map(e => `<p class="text-xs py-1" style="color:var(--ink-soft)">📌 ${esc(e.title)} · ${fmtTime(e.start)}</p>`).join('');
}

function renderStreak() {
  const b = document.getElementById('streak-badge');
  if (db.streak.count > 0) { b.classList.remove('hidden'); document.getElementById('streak-count').textContent = db.streak.count; }
}

// ─────────── Data export / import ───────────
function exportData() {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'anchor-backup-' + todayStr() + '.json';
  a.click();
  toast('Backup downloaded ⬇');
}
function importData(ev) {
  const f = ev.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => { try { db = JSON.parse(r.result); save(); renderAll(); toast('Restored ✓'); } catch (e) { toast('That file didn\'t look right'); } };
  r.readAsText(f);
}

// ─────────── Service worker (PWA + background notifications) ───────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ─────────── Nav & misc ───────────
function switchView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  document.querySelectorAll('.navbtn').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'now') renderNow();
  window.scrollTo({ top: 0 });
}
let toastTimer = null;
function toast(msg) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 2800);
}
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ─────────── PWA manifest (inline so the app is a single file) ───────────
(function () {
  const icon = sz => 'data:image/svg+xml,' + encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${sz}' height='${sz}'><rect width='${sz}' height='${sz}' rx='${sz * .22}' fill='#7c6aaa'/><text x='50%' y='72%' font-size='${sz * .62}' text-anchor='middle'>⚓</text></svg>`);
  const manifest = {
    name: 'Anchor — gentle planning', short_name: 'Anchor',
    start_url: '.', display: 'standalone', background_color: '#f6f2fb', theme_color: '#7c6aaa',
    icons: [192, 512].map(sz => ({ src: icon(sz), sizes: sz + 'x' + sz, type: 'image/svg+xml' })),
  };
  document.getElementById('manifest-link').href =
    URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: 'application/json' }));
})();

// ─────────── Boot ───────────
document.getElementById('header-date').textContent =
  new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
document.getElementById('affirmation').textContent =
  '💜 "' + AFFIRMATIONS[new Date().getDate() % AFFIRMATIONS.length] + '"';
document.getElementById('set-focus-start').value = db.settings.focusStart;
document.getElementById('set-focus-end').value = db.settings.focusEnd;
document.getElementById('set-max-tasks').value = String(db.settings.maxTasks);
document.getElementById('set-break').value = String(db.settings.breakMin);
document.getElementById('gcal-client-id').value = db.settings.clientId || '';
if (db.settings.clientId) setGcalStatus('Client ID saved — tap Connect');
function savePlannerSettings() {
  db.settings.focusStart = document.getElementById('set-focus-start').value || '09:00';
  db.settings.focusEnd = document.getElementById('set-focus-end').value || '17:00';
  db.settings.maxTasks = +document.getElementById('set-max-tasks').value;
  db.settings.breakMin = +document.getElementById('set-break').value;
  save();
}
function applySettingsToUI() {
  document.getElementById('set-focus-start').value = db.settings.focusStart;
  document.getElementById('set-focus-end').value = db.settings.focusEnd;
  document.getElementById('set-max-tasks').value = String(db.settings.maxTasks);
  document.getElementById('set-break').value = String(db.settings.breakMin);
  document.getElementById('gcal-client-id').value = db.settings.clientId || '';
}

// boot extras
migrate();
resetRoutinesForNewDay();
renderRoutineDaysPicker();
setNotifStatus(db.notifEnabled && ('Notification' in window) && Notification.permission === 'granted'
  ? 'On — gentle nudges for planned tasks & routines 🔔'
  : (db.notifEnabled ? 'Permission needed — tap "Turn on reminders"' : 'Off'));
setSyncStatus(db.syncEnabled ? 'On — connect Google above to sync' : 'Off — data lives only on this device');
renderAll();
