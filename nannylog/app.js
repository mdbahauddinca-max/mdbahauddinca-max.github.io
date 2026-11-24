/* Nanny Log v2.0 */
'use strict';
/* ================= storage (IndexedDB) ================= */
const DB_NAME = 'nannylog', DB_VER = 1;
let db;
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('entries')) { const s = d.createObjectStore('entries', { keyPath: 'id' }); s.createIndex('date', 'date'); }
      if (!d.objectStoreNames.contains('shifts')) { const s = d.createObjectStore('shifts', { keyPath: 'id' }); s.createIndex('date', 'date'); }
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
    };
    r.onsuccess = () => { db = r.result; res(db); };
    r.onerror = () => rej(r.error);
  });
}
const tx = (store, mode = 'readonly') => db.transaction(store, mode).objectStore(store);
const P = req => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
const put = (s, v, k) => P(tx(s, 'readwrite').put(v, k)).then(r => { if (s !== 'kv' || ['settings', 'timers', 'shopping', 'events', 'perms', 'instr'].includes(k) || String(k).startsWith('rc:')) scheduleSync(); return r; });
const del = (s, k) => P(tx(s, 'readwrite').delete(k)).then(r => { scheduleSync(); return r; });
const getAll = s => P(tx(s).getAll());
const byDate = (s, d) => P(tx(s).index('date').getAll(d));
const kvGet = k => P(tx('kv').get(k));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ================= state ================= */
let S = { name: '', parent: '', phone: '', rate: 17.95, lang: 'en-CA', keepAudio: '1', translate: '1', kids: [], sync: { db: '', code: '', on: false } };
let TIMERS = {};          // {nap:{start,kid}, feed:{start,kid,kind}}
let SHOP = [], EVENTS = [], PERMS = [], INSTR = [];
let curDate = today(), filterKid = 'all', curView = 'log', planTab = 'routines', repWeek = 0, hrsWeek = 0;

function today(d = new Date()) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function fmtDate(s, o = { weekday: 'long', month: 'short', day: 'numeric' }) { return new Date(s + 'T12:00').toLocaleDateString('en-CA', o); }
function fmtTime(ts) { return new Date(ts).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }); }
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
const saveSettings = () => put('kv', S, 'settings');
const hasBangla = t => /[ঀ-৿]/.test(t || '');
function nowTimeStr(d = new Date()) { return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
function tsFrom(dateStr, timeStr) { return new Date(dateStr + 'T' + (timeStr || '12:00')).getTime(); }
function mins(m) { m = Math.round(m); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; }
function hms(ms) { const s = Math.max(0, Math.floor(ms / 1000)); return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(x => String(x).padStart(2, '0')).join(':'); }

const TYPES = {
  meal: { ic: '🍽️', lbl: 'Meal' }, snack: { ic: '🍎', lbl: 'Snack' }, bottle: { ic: '🍼', lbl: 'Bottle' },
  nap: { ic: '😴', lbl: 'Nap' }, diaper: { ic: '🧷', lbl: 'Diaper' }, potty: { ic: '🚽', lbl: 'Potty' },
  play: { ic: '🧩', lbl: 'Activity' }, outing: { ic: '🌳', lbl: 'Outing' }, school: { ic: '🎒', lbl: 'School' },
  medicine: { ic: '💊', lbl: 'Medicine' }, mood: { ic: '🙂', lbl: 'Mood' }, incident: { ic: '🩹', lbl: 'Incident' },
  photo: { ic: '📷', lbl: 'Photo' }, cooking: { ic: '🍳', lbl: 'Cooking' }, tidying: { ic: '🧹', lbl: 'Tidying' }, instruction: { ic: '📌', lbl: 'Instruction' }, note: { ic: '📝', lbl: 'Note' }, voice: { ic: '🎙️', lbl: 'Voice note' }, routine: { ic: '✅', lbl: 'Routine' }
};
const QUICK = ['meal', 'snack', 'bottle', 'nap', 'diaper', 'potty', 'play', 'outing', 'school', 'cooking', 'tidying', 'medicine', 'mood', 'incident', 'photo', 'note'];
const DEFAULT_ROUTINES = {
  morning: ['Wake up, diaper or potty', 'Wash face, brush teeth', 'Get dressed', 'Breakfast', 'Pack bag / shoes on'],
  afterschool: ['Snack and water', 'Homework or reading', 'Outdoor play', 'Tidy toys'],
  bedtime: ['Bath', 'Pyjamas', 'Brush teeth', 'Story', 'Lights out']
};
const RLBL = { morning: 'Morning', afterschool: 'After school', bedtime: 'Bedtime' };

/* ================= ui helpers ================= */
const $ = id => document.getElementById(id);
function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2000); }
function openSheet(html, onReady) { $('sheetBody').innerHTML = html; $('sheetBg').style.display = 'block'; requestAnimationFrame(() => $('sheet').classList.add('open')); onReady && onReady(); }
function closeSheet() { stopVoice(); $('sheet').classList.remove('open'); setTimeout(() => { $('sheetBg').style.display = 'none'; $('sheetBody').innerHTML = ''; }, 250); }
$('sheetBg').onclick = closeSheet;
window.addEventListener('scroll', () => $('hdr').classList.toggle('scrolled', scrollY > 4));
function kidName(id) { return (S.kids.find(k => k.id === id) || {}).name || ''; }
function kidNames(ids) { return (ids || []).map(kidName).filter(Boolean).join(', '); }
function kidChips(sel, id = 'kidSel', single = false) {
  if (!S.kids.length) return '<p class="hint" style="text-align:left">Tip: add children in More → Children.</p>';
  return `<label>Child</label><div class="row" id="${id}" data-single="${single ? 1 : ''}" style="flex-wrap:wrap;gap:6px">` +
    S.kids.map(k => `<button type="button" class="chip ${sel.includes(k.id) ? 'on' : ''}" data-k="${k.id}">${esc(k.name)}</button>`).join('') + '</div>';
}
function bindKidChips(id = 'kidSel') {
  const w = $(id); if (!w) return;
  w.querySelectorAll('.chip').forEach(b => b.onclick = () => {
    if (w.dataset.single) { w.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === b)); return; }
    b.classList.toggle('on');
  });
}
function readKids(id = 'kidSel') { const w = $(id); if (!w) return []; return [...w.querySelectorAll('.chip.on')].map(b => b.dataset.k); }
const defaultKids = () => S.kids.length === 1 ? [S.kids[0].id] : [];

/* ================= entry details ================= */
const DETAIL = {
  meal: [['what', 'What did they eat?', 'text', 'e.g. rice, dal, chicken'], ['amount', 'How much?', 'select', ['All', 'Most', 'Half', 'A little', 'None']]],
  snack: [['what', 'Snack', 'text', 'e.g. apple slices + cheese'], ['amount', 'How much?', 'select', ['All', 'Most', 'Half', 'A little', 'None']]],
  bottle: [['ml', 'Amount (ml)', 'number', 'e.g. 150'], ['kind', 'Type', 'select', ['Formula', 'Breast milk', 'Milk', 'Water']], ['dur', 'Feeding time (min)', 'number', '']],
  nap: [['start', 'Start', 'time'], ['end', 'End', 'time']],
  diaper: [['kind', 'Diaper', 'select', ['Wet', 'Dirty', 'Wet + dirty', 'Dry']]],
  potty: [['kind', 'Potty', 'select', ['Pee', 'Poop', 'Tried, nothing', 'Accident']]],
  play: [['what', 'Activity', 'text', 'e.g. blocks, painting, reading']],
  outing: [['where', 'Where?', 'text', 'e.g. park, library']],
  school: [['kind', 'School', 'select', ['Drop-off', 'Pick-up', 'Homework']]],
  medicine: [['name', 'Medicine and dose', 'text', 'e.g. Tylenol 5 ml'], ['permission', 'Signed permission form?', 'select', ['Yes', 'No']]],
  mood: [['kind', 'Mood', 'select', ['Happy', 'Calm', 'Tired', 'Cranky', 'Sad', 'Unwell']]],
  incident: [['what', 'What happened?', 'text', 'e.g. fell at park, scraped knee'], ['action', 'What did you do?', 'text', 'e.g. cleaned, ice pack'], ['told', 'Parent informed?', 'select', ['Yes, called', 'Yes, text', 'Will tell at pick-up']]],
  cooking: [['what', 'What did you cook?', 'text', 'e.g. chicken curry, rice, veggie soup'], ['for', 'For', 'select', ['Kids', 'Family dinner', 'Kids + family', 'Prep for tomorrow']], ['allergy', 'Allergy-safe checked?', 'select', ['Yes', 'Not needed']]],
  tidying: [['area', 'Area', 'select', ['Toys / play area', "Kids' room", 'Kitchen', 'Dishes', 'Laundry (kids)', 'Living room', 'Bathroom', 'Other']], ['what', 'What was done?', 'text', 'e.g. washed bottles, folded clothes']],
  routine: [], instruction: [], photo: [], note: []
};
function detailHtml(type, d = {}) {
  return (DETAIL[type] || []).map(([k, l, t, ph]) => {
    if (t === 'select') return `<label>${l}</label><select data-f="${k}">` + ph.map(o => `<option ${d[k] === o ? 'selected' : ''}>${o}</option>`).join('') + '</select>';
    return `<label>${l}</label><input type="${t}" data-f="${k}" value="${esc(d[k] || '')}" placeholder="${ph || ''}">`;
  }).join('');
}
function napMin(e) { const d = e.details || {}; if (!d.start || !d.end) return 0; const [a, b] = d.start.split(':').map(Number), [c, f] = d.end.split(':').map(Number); let m = (c * 60 + f) - (a * 60 + b); if (m < 0) m += 1440; return m; }
function summary(e) {
  const d = e.details || {};
  switch (e.type) {
    case 'meal': case 'snack': return [d.what, d.amount && `(${d.amount.toLowerCase()})`].filter(Boolean).join(' ');
    case 'bottle': return [d.ml && d.ml + ' ml', d.kind, d.dur && d.dur + ' min'].filter(Boolean).join(' · ');
    case 'nap': return d.start ? `${d.start}${d.end ? ' – ' + d.end : ' (sleeping)'}${napMin(e) ? ' · ' + mins(napMin(e)) : ''}` : '';
    case 'diaper': case 'potty': case 'mood': case 'school': return d.kind || '';
    case 'play': return d.what || ''; case 'cooking': return [d.what, d.for && `(${d.for.toLowerCase()})`].filter(Boolean).join(' '); case 'tidying': return [d.area, d.what].filter(Boolean).join(': '); case 'instruction': return d.what || ''; case 'outing': return d.where || ''; case 'routine': return d.what || '';
    case 'medicine': return [d.name, d.permission && ('signed form: ' + d.permission)].filter(Boolean).join(' · ');
    case 'incident': return [d.what, d.action && ('Action: ' + d.action), d.told && ('Parent: ' + d.told)].filter(Boolean).join('\n');
    default: return '';
  }
}
const noteText = e => e.textEn || e.text || '';

/* ================= translation (Bangla -> English) ================= */
async function translateBn(text) {
  const parts = text.split(/(?<=[।.!?])\s+/).reduce((a, s) => { if (a.length && (a[a.length - 1] + ' ' + s).length < 450) a[a.length - 1] += ' ' + s; else a.push(s); return a; }, []);
  const out = [];
  for (const p of parts) {
    const r = await fetch('https://api.mymemory.translated.net/get?langpair=bn|en&q=' + encodeURIComponent(p));
    if (!r.ok) throw new Error('http ' + r.status);
    const j = await r.json();
    const t = j && j.responseData && j.responseData.translatedText;
    if (!t || /MYMEMORY WARNING|QUERY LENGTH/i.test(t)) throw new Error(t || 'no result');
    out.push(t);
  }
  return out.join(' ');
}
function trButtonHtml(id) { return S.translate === '1' ? `<button type="button" class="sbtn sec" id="${id}" style="margin-top:8px">🌐 Translate to English</button>` : ''; }
function bindTranslate(btnId, srcId, dstId) {
  const b = $(btnId); if (!b) return;
  b.onclick = async () => {
    const src = $(srcId).value.trim(); if (!src) { toast('Nothing to translate'); return; }
    b.disabled = true; b.textContent = 'Translating…';
    try { $(dstId).value = await translateBn(src); $(dstId).closest('.trwrap').style.display = 'block'; toast('Translated'); }
    catch (err) { toast('Translation failed. Check internet, or type the English.'); $(dstId).closest('.trwrap').style.display = 'block'; }
    b.disabled = false; b.textContent = '🌐 Translate to English';
  };
}

/* ================= entry editor ================= */
async function openEntry(type, existing, preset) {
  const e = existing || Object.assign({ id: uid(), date: curDate, type, kids: defaultKids(), details: {}, text: '' }, preset || {});
  if (!existing && type === 'nap' && !e.details.start) e.details.start = nowTimeStr();
  const t = TYPES[e.type] || TYPES.note;
  const perms = e.type === 'medicine' ? activePerms() : [];
  openSheet(`
    <div class="hrow"><h2 style="margin:0">${t.ic} ${t.lbl}</h2><button class="link" id="cancelE">Cancel</button></div>
    ${kidChips(e.kids)}
    ${perms.length ? `<label for="ePerm">From a signed permission form</label><select id="ePerm"><option value="">— choose —</option>${perms.map(p => `<option value="${p.id}">${esc(kidName(p.kid))}: ${esc(p.medicine)} ${esc(p.dose)}</option>`).join('')}</select>` : ''}
    <div ${e.type === 'nap' ? 'style="display:none"' : ''}><label for="eTime">Time</label><input type="time" id="eTime" value="${existing ? new Date(e.ts).toTimeString().slice(0, 5) : nowTimeStr()}"></div>
    ${detailHtml(e.type, e.details)}
    <label for="eText">Notes</label>
    <textarea id="eText" placeholder="Type, or tap the 🎤 on your keyboard to dictate">${esc(e.text)}</textarea>
    ${trButtonHtml('eTrBtn')}
    <div class="trwrap" style="display:${e.textEn ? 'block' : 'none'}"><label for="eTextEn">English translation (editable)</label><textarea id="eTextEn" style="min-height:70px">${esc(e.textEn || '')}</textarea></div>
    ${e.type === 'photo' || e.photo ? `<label>Photo</label><input type="file" id="ePhoto" accept="image/*" capture="environment"><div id="ePrev"></div>` : ''}
    ${e.type === 'medicine' ? `<div class="note" style="margin-top:10px">Give medicine only with a signed permission form. ${perms.length ? '' : 'No active form yet: More → Medicine permission forms.'}</div>` : ''}
    ${e.type === 'incident' ? '<div class="note" style="margin-top:10px">Tell the parents about every injury, even small ones. Call 911 if it is serious.</div>' : ''}
    <div style="height:14px"></div>
    <button class="big" id="saveE">Save</button>
    ${existing ? '<div style="text-align:center;margin-top:8px"><button class="link danger" id="delE">Delete entry</button></div>' : ''}
  `, () => {
    bindKidChips(); $('cancelE').onclick = closeSheet;
    const trb = $('eTrBtn'); if (trb) trb.style.display = hasBangla(e.text) || S.lang === 'bn-BD' ? '' : 'none';
    $('eText').addEventListener('input', () => { if (trb) trb.style.display = hasBangla($('eText').value) || S.lang === 'bn-BD' ? '' : 'none'; });
    bindTranslate('eTrBtn', 'eText', 'eTextEn');
    if ($('ePerm')) $('ePerm').onchange = ev => {
      const p = PERMS.find(x => x.id === ev.target.value); if (!p) return;
      document.querySelector('[data-f=name]').value = `${p.medicine} ${p.dose}`.trim();
      document.querySelector('[data-f=permission]').value = 'Yes';
      $('kidSel') && $('kidSel').querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.dataset.k === p.kid));
    };
    let photoBlob = e.photo || null;
    const showPrev = () => { if ($('ePrev') && photoBlob) $('ePrev').innerHTML = `<img src="${URL.createObjectURL(photoBlob)}" style="max-width:100%;border-radius:10px;margin-top:8px">`; };
    showPrev();
    if ($('ePhoto')) $('ePhoto').onchange = async ev => { const f = ev.target.files[0]; if (!f) return; photoBlob = await shrink(f); showPrev(); };
    $('saveE').onclick = async () => {
      const det = {}; document.querySelectorAll('#sheetBody [data-f]').forEach(i => det[i.dataset.f] = i.value.trim());
      e.details = det; e.text = $('eText').value.trim(); e.textEn = ($('eTextEn').value || '').trim() || undefined; e.kids = readKids();
      e.ts = tsFrom(e.date, (e.type === 'nap' && det.start) ? det.start : $('eTime').value);
      if (photoBlob) e.photo = photoBlob;
      if (e.type === 'photo' && !e.photo && !e.text) { toast('Add a photo or a note'); return; }
      await put('entries', e); closeSheet(); toast('Saved'); render();
    };
    if ($('delE')) $('delE').onclick = async () => { if (confirm('Delete this entry?')) { await del('entries', e.id); closeSheet(); toast('Deleted'); render(); } };
  });
}
function shrink(file, max = 1280) {
  return new Promise(res => {
    const img = new Image();
    img.onload = () => { const s = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = img.width * s; c.height = img.height * s; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); c.toBlob(b => res(b || file), 'image/jpeg', .82); };
    img.onerror = () => res(file); img.src = URL.createObjectURL(file);
  });
}

/* ================= voice note ================= */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, recOn = false, mediaRec = null, audioChunks = [], audioBlob = null, finalText = '';
function stopVoice() { try { rec && recOn && rec.stop(); } catch (_) { } recOn = false; try { mediaRec && mediaRec.state === 'recording' && mediaRec.stop(); } catch (_) { } }
function openVoice() {
  audioBlob = null; finalText = '';
  openSheet(`
    <div class="hrow"><h2 style="margin:0">🎙️ Voice note</h2><button class="link" id="cancelV">Cancel</button></div>
    ${kidChips(defaultKids())}
    <label for="vLang">Speaking in</label>
    <div class="seg" id="vLangSeg"><button data-l="en-CA" class="${S.lang.startsWith('en') ? 'on' : ''}">English</button><button data-l="bn-BD" class="${S.lang === 'bn-BD' ? 'on' : ''}">বাংলা Bangla</button></div>
    <div style="text-align:center;margin-top:6px">
      <button class="mic" id="micBtn" aria-label="Start recording">🎤</button>
      <div class="hint" id="micHint">${SR ? 'Tap to start speaking. Tap again to stop.' : 'Live speech-to-text is not available here. Tap in the box and use the 🎤 on the iPhone keyboard to dictate.'}</div>
    </div>
    <label for="vText">Text (you can edit it)</label>
    <textarea id="vText" placeholder="Your words will appear here…"></textarea>
    ${trButtonHtml('vTrBtn')}
    <div class="trwrap" style="display:none"><label for="vTextEn">English translation (editable)</label><textarea id="vTextEn" style="min-height:70px"></textarea></div>
    <label for="vType">Save as</label>
    <select id="vType">${QUICK.filter(q => q !== 'photo').map(q => `<option value="${q}" ${q === 'note' ? 'selected' : ''}>${TYPES[q].lbl}</option>`).join('')}</select>
    <div id="vAudio"></div>
    <div style="height:14px"></div>
    <button class="big" id="saveV">Save</button>
  `, () => {
    bindKidChips(); $('cancelV').onclick = closeSheet;
    const trb = $('vTrBtn'); const upd = () => { if (trb) trb.style.display = (hasBangla($('vText').value) || S.lang === 'bn-BD') ? '' : 'none'; }; upd();
    $('vText').addEventListener('input', upd);
    $('vLangSeg').querySelectorAll('button').forEach(b => b.onclick = async () => { $('vLangSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); S.lang = b.dataset.l; await saveSettings(); upd(); });
    bindTranslate('vTrBtn', 'vText', 'vTextEn');
    $('micBtn').onclick = () => recOn ? stopVoice() : startVoice();
    $('saveV').onclick = async () => {
      stopVoice(); await new Promise(r => setTimeout(r, 350));
      const text = $('vText').value.trim(); if (!text && !audioBlob) { toast('Nothing to save yet'); return; }
      const e = { id: uid(), date: curDate, ts: curDate === today() ? Date.now() : tsFrom(curDate, nowTimeStr()), type: $('vType').value, kids: readKids(), details: {}, text, voice: true };
      const en = $('vTextEn').value.trim(); if (en) e.textEn = en;
      if (audioBlob && S.keepAudio === '1') e.audio = audioBlob;
      await put('entries', e); closeSheet(); toast('Voice note saved'); render();
    };
  });
}
async function startVoice() {
  const box = $('vText'); finalText = box.value ? box.value.trim() + ' ' : '';
  if (!SR) { box.focus(); return; }
  if (S.keepAudio === '1' && navigator.mediaDevices && window.MediaRecorder) {
    try {
      const st = await navigator.mediaDevices.getUserMedia({ audio: true }); audioChunks = [];
      mediaRec = new MediaRecorder(st); mediaRec.ondataavailable = ev => ev.data.size && audioChunks.push(ev.data);
      mediaRec.onstop = () => { st.getTracks().forEach(t => t.stop()); audioBlob = new Blob(audioChunks, { type: mediaRec.mimeType || 'audio/mp4' }); if ($('vAudio')) $('vAudio').innerHTML = `<label>Recording</label><audio controls src="${URL.createObjectURL(audioBlob)}"></audio>`; };
      mediaRec.start();
    } catch (err) { mediaRec = null; }
  }
  rec = new SR(); rec.lang = S.lang; rec.interimResults = true; rec.continuous = true;
  rec.onresult = ev => {
    let interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) { const r = ev.results[i]; if (r.isFinal) finalText += r[0].transcript.trim() + ' '; else interim += r[0].transcript; }
    box.value = (finalText + interim).trimStart(); box.dispatchEvent(new Event('input'));
  };
  rec.onerror = ev => { $('micHint').textContent = ev.error === 'not-allowed' ? 'Microphone or speech permission was denied. Allow it in Settings, or use keyboard dictation.' : 'Speech stopped (' + ev.error + '). You can type or use keyboard dictation.'; };
  rec.onend = () => { if (recOn) { try { rec.start(); } catch (_) { recOn = false; uiMic(); } } else uiMic(); };
  try { rec.start(); recOn = true; uiMic(); } catch (err) { $('micHint').textContent = 'Could not start. Use keyboard dictation instead.'; }
}
function uiMic() {
  const b = $('micBtn'); if (!b) return;
  b.classList.toggle('rec', recOn); b.textContent = recOn ? '■' : '🎤'; b.setAttribute('aria-label', recOn ? 'Stop recording' : 'Start recording');
  $('micHint').textContent = recOn ? 'Listening… tap ■ to stop.' : (SR ? 'Tap to speak again, or edit the text.' : $('micHint').textContent);
  if (!recOn && mediaRec && mediaRec.state === 'recording') mediaRec.stop();
}

/* ================= timers + bottle due ================= */
async function saveTimers() { await put('kv', TIMERS, 'timers'); }
function timerKidPicker(kind) {
  if (S.kids.length <= 1) return startTimer(kind, S.kids[0] ? S.kids[0].id : '');
  openSheet(`<div class="hrow"><h2 style="margin:0">${kind === 'nap' ? '😴 Start nap' : '🍼 Start feeding'}</h2><button class="link" id="cancelT">Cancel</button></div>
    ${kidChips([], 'tKid', true)}
    ${kind === 'feed' ? `<label for="tKind">Type</label><select id="tKind"><option>Formula</option><option>Breast milk</option><option>Milk</option></select>` : ''}
    <div style="height:14px"></div><button class="big" id="goT">Start</button>`, () => {
    bindKidChips('tKid'); $('cancelT').onclick = closeSheet;
    $('goT').onclick = () => { const k = readKids('tKid')[0]; if (!k) { toast('Choose a child'); return; } startTimer(kind, k, $('tKind') && $('tKind').value); closeSheet(); };
  });
}
async function startTimer(kind, kid, sub) {
  TIMERS[kind + ':' + kid] = { kind, kid, start: Date.now(), sub: sub || (kind === 'feed' ? 'Formula' : '') };
  await saveTimers(); renderTimers(); toast(kind === 'nap' ? 'Nap timer started' : 'Feeding timer started');
}
async function stopTimer(key) {
  const t = TIMERS[key]; if (!t) return; delete TIMERS[key]; await saveTimers();
  const end = new Date(), start = new Date(t.start), date = today(start);
  if (t.kind === 'nap') {
    const e = { id: uid(), date, ts: t.start, type: 'nap', kids: t.kid ? [t.kid] : [], details: { start: nowTimeStr(start), end: nowTimeStr(end) }, text: '' };
    await put('entries', e); toast('Nap saved · ' + mins((end - start) / 60000)); render();
  } else {
    curDate = date; render();
    openEntry('bottle', null, { ts: t.start, kids: t.kid ? [t.kid] : [], details: { kind: t.sub, dur: String(Math.max(1, Math.round((end - start) / 60000))) } });
  }
}
function renderTimers() {
  const keys = Object.keys(TIMERS);
  let h = keys.map(k => { const t = TIMERS[k]; return `<div class="timer run"><span style="font-size:24px">${t.kind === 'nap' ? '😴' : '🍼'}</span><div class="grow"><div class="small">${t.kind === 'nap' ? 'Nap' : 'Feeding' + (t.sub ? ' · ' + esc(t.sub) : '')}${t.kid ? ' · ' + esc(kidName(t.kid)) : ''} · since ${fmtTime(t.start)}</div><div class="clk" data-start="${t.start}">${hms(Date.now() - t.start)}</div></div><button class="sbtn stop" data-stop="${k}">Stop</button></div>`; }).join('');
  if (curDate === today()) h += `<div class="row" style="gap:8px;margin:8px 0"><button class="sbtn sec" style="flex:1" id="tNap">😴 Nap timer</button><button class="sbtn sec" style="flex:1" id="tFeed">🍼 Feeding timer</button></div>`;
  $('timerBox').innerHTML = h;
  $('timerBox').querySelectorAll('[data-stop]').forEach(b => b.onclick = () => stopTimer(b.dataset.stop));
  if ($('tNap')) $('tNap').onclick = () => timerKidPicker('nap');
  if ($('tFeed')) $('tFeed').onclick = () => timerKidPicker('feed');
}
let lastBottles = {}; const alerted = {};
async function computeBottleDue() {
  lastBottles = {};
  const list = (await byDate('entries', today())).filter(e => e.type === 'bottle').sort((a, b) => a.ts - b.ts);
  for (const k of S.kids) if (+k.bottleEvery > 0) { const l = list.filter(e => e.kids && e.kids.includes(k.id)).pop(); if (l) lastBottles[k.id] = l.ts; }
  renderDue();
}
function renderDue() {
  if (curDate !== today()) { $('dueBox').innerHTML = ''; return; }
  const now = Date.now();
  $('dueBox').innerHTML = S.kids.filter(k => +k.bottleEvery > 0 && lastBottles[k.id]).map(k => {
    const due = lastBottles[k.id] + k.bottleEvery * 60000, diff = due - now;
    const cls = diff < 0 ? 'over' : diff < 15 * 60000 ? 'soon' : '';
    if (diff < 0 && !alerted[k.id + due]) { alerted[k.id + due] = 1; buzz(`${k.name}: bottle is due now`); }
    return `<div class="due ${cls}"><span>🍼 <b>${esc(k.name)}</b>: next bottle ${fmtTime(due)} ${diff < 0 ? `· overdue ${mins(-diff / 60000)}` : `· in ${mins(diff / 60000)}`}</span><button class="sbtn sec" data-bq="${k.id}">Log</button></div>`;
  }).join('');
  $('dueBox').querySelectorAll('[data-bq]').forEach(b => b.onclick = () => openEntry('bottle', null, { kids: [b.dataset.bq] }));
}
function buzz(msg) {
  toast('⏰ ' + msg); try { navigator.vibrate && navigator.vibrate([300, 150, 300]); } catch (_) { }
  try { if ('Notification' in window && Notification.permission === 'granted' && navigator.serviceWorker) navigator.serviceWorker.ready.then(r => r.showNotification('Nanny Log', { body: msg, icon: 'icons/icon-192.png' })); } catch (_) { }
}
setInterval(() => {
  document.querySelectorAll('.clk[data-start]').forEach(c => c.textContent = hms(Date.now() - +c.dataset.start));
  if (curView === 'log') renderDue();
  checkEventAlerts();
}, 1000);

/* ================= routines ================= */
const rcKey = d => 'rc:' + d;
async function renderRoutines() {
  const box = $('p-routines');
  if (!S.kids.length) { box.innerHTML = '<div class="card empty">Add children in More → Children to use routines.</div>'; return; }
  const state = (await kvGet(rcKey(curDate))) || {};
  box.innerHTML = `<p class="small" style="margin:4px 2px">${fmtDate(curDate)}</p>` + S.kids.map(k => {
    const R = k.routines || DEFAULT_ROUTINES;
    return Object.keys(RLBL).filter(r => (R[r] || []).length).map(r => {
      const items = R[r], st = (state[k.id] || {})[r] || [];
      const done = items.filter((_, i) => st[i]).length;
      return `<div class="card"><div class="hrow"><div><b>${esc(k.name)}</b> · ${RLBL[r]}</div><button class="link" data-edit="${k.id}|${r}">Edit</button></div>
        <div class="bar"><i style="width:${Math.round(done / items.length * 100)}%"></i></div><div class="small">${done} of ${items.length} done</div>
        ${items.map((it, i) => `<label class="check ${st[i] ? 'done' : ''}" style="margin:0;font-size:15px;color:var(--ink);font-weight:400"><input type="checkbox" data-rc="${k.id}|${r}|${i}" ${st[i] ? 'checked' : ''}><span>${esc(it)}</span></label>`).join('')}</div>`;
    }).join('');
  }).join('');
  box.querySelectorAll('[data-rc]').forEach(cb => cb.onchange = async () => {
    const [kid, r, i] = cb.dataset.rc.split('|'); const st = (await kvGet(rcKey(curDate))) || {};
    st[kid] = st[kid] || {}; st[kid][r] = st[kid][r] || []; st[kid][r][+i] = cb.checked ? Date.now() : 0;
    await put('kv', st, rcKey(curDate));
    const k = S.kids.find(x => x.id === kid), items = (k.routines || DEFAULT_ROUTINES)[r];
    if (cb.checked && items.every((_, j) => st[kid][r][j])) {
      await put('entries', { id: uid(), date: curDate, ts: Date.now(), type: 'routine', kids: [kid], details: { what: `${RLBL[r]} routine completed` }, text: '' });
      toast(`${k.name}: ${RLBL[r].toLowerCase()} routine done ✓`);
    }
    renderRoutines();
  });
  box.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editRoutine(...b.dataset.edit.split('|')));
}
function editRoutine(kid, r) {
  const k = S.kids.find(x => x.id === kid); const R = k.routines || JSON.parse(JSON.stringify(DEFAULT_ROUTINES));
  openSheet(`<div class="hrow"><h2 style="margin:0">${esc(k.name)} · ${RLBL[r]}</h2><button class="link" id="cancelR">Cancel</button></div>
    <label for="rItems">One step per line (leave empty to hide this routine)</label><textarea id="rItems" style="min-height:200px">${esc((R[r] || []).join('\n'))}</textarea>
    <div style="height:14px"></div><button class="big" id="saveR">Save</button>`, () => {
    $('cancelR').onclick = closeSheet;
    $('saveR').onclick = async () => { R[r] = $('rItems').value.split('\n').map(s => s.trim()).filter(Boolean); k.routines = R; await saveSettings(); closeSheet(); renderRoutines(); toast('Routine saved'); };
  });
}

/* ================= events / calendar ================= */
const saveEvents = () => put('kv', EVENTS, 'events');
function occurrences(ev, from, days) {
  const out = []; const base = new Date(ev.date + 'T' + (ev.time || '09:00'));
  for (let i = 0; i < days; i++) {
    const d = new Date(from); d.setDate(d.getDate() + i); const ds = today(d);
    if (ds < ev.date) continue;
    const dow = d.getDay();
    const ok = ev.repeat === 'weekly' ? dow === base.getDay() : ev.repeat === 'weekdays' ? (dow > 0 && dow < 6) : ev.repeat === 'daily' ? true : ds === ev.date;
    if (ok && (!ev.until || ds <= ev.until)) out.push({ ev, date: ds, ts: tsFrom(ds, ev.time || '09:00') });
  }
  return out;
}
function upcoming(days = 14, from = new Date()) { const f = new Date(from); f.setHours(0, 0, 0, 0); return EVENTS.flatMap(ev => occurrences(ev, f, days)).sort((a, b) => a.ts - b.ts); }
function renderEvents() {
  const list = upcoming(14);
  $('eventList').innerHTML = list.length ? list.map(o => { const d = new Date(o.date + 'T12:00'); return `<div class="ev" data-id="${o.ev.id}"><div class="dt">${d.toLocaleDateString('en-CA', { weekday: 'short' })}<b>${d.getDate()}</b></div><div style="flex:1"><div><b>${esc(o.ev.title)}</b></div><div class="small">${o.ev.time ? fmtTime(o.ts) : 'All day'}${o.ev.kid ? ' · ' + esc(kidName(o.ev.kid)) : ''}${o.ev.repeat !== 'none' ? ' · repeats ' + o.ev.repeat : ''}</div>${o.ev.notes ? `<div class="small">${esc(o.ev.notes)}</div>` : ''}</div></div>`; }).join('') : '<div class="empty">No events. Add school days, swimming class, doctor visits…</div>';
  $('eventList').querySelectorAll('.ev').forEach(d => d.onclick = () => openEvent(EVENTS.find(e => e.id === d.dataset.id)));
}
function renderTodayEvents() {
  const list = curDate === today() ? upcoming(1) : [];
  $('todayEvents').innerHTML = list.length ? `<div class="card" style="padding:10px 12px"><div class="sub" style="font-weight:600">Today's plan</div>${list.map(o => `<div class="small" style="color:var(--ink);padding:3px 0">🗓️ ${o.ev.time ? fmtTime(o.ts) : 'All day'} · ${esc(o.ev.title)}${o.ev.kid ? ' (' + esc(kidName(o.ev.kid)) + ')' : ''}</div>`).join('')}</div>` : '';
}
function openEvent(ev) {
  const e = ev || { id: uid(), title: '', kid: '', date: curDate, time: '', repeat: 'none', until: '', notes: '', remind: 15 };
  openSheet(`<div class="hrow"><h2 style="margin:0">🗓️ ${ev ? 'Edit' : 'New'} event</h2><button class="link" id="cancelEv">Cancel</button></div>
    <label for="evTitle">What</label><input type="text" id="evTitle" value="${esc(e.title)}" placeholder="e.g. Swimming class, school pick-up">
    ${kidChips(e.kid ? [e.kid] : [], 'evKid', true)}
    <div class="row"><div style="flex:1"><label for="evDate">Date</label><input type="date" id="evDate" value="${e.date}"></div><div style="flex:1"><label for="evTime">Time</label><input type="time" id="evTime" value="${e.time}"></div></div>
    <label for="evRep">Repeat</label><select id="evRep">${['none', 'daily', 'weekdays', 'weekly'].map(r => `<option value="${r}" ${e.repeat === r ? 'selected' : ''}>${{ none: 'Does not repeat', daily: 'Every day', weekdays: 'Weekdays (Mon–Fri)', weekly: 'Every week' }[r]}</option>`).join('')}</select>
    <label for="evUntil">Repeat until (optional)</label><input type="date" id="evUntil" value="${e.until || ''}">
    <label for="evRem">Reminder</label><select id="evRem">${[0, 10, 15, 30, 60].map(m => `<option value="${m}" ${+e.remind === m ? 'selected' : ''}>${m ? m + ' min before' : 'None'}</option>`).join('')}</select>
    <label for="evNotes">Notes</label><input type="text" id="evNotes" value="${esc(e.notes)}" placeholder="e.g. bring towel, room 12">
    <div style="height:14px"></div><button class="big" id="saveEv">Save</button>
    ${ev ? `<div style="height:8px"></div><button class="big sec" id="icsEv">📅 Add to iPhone Calendar (with alert)</button><div style="text-align:center;margin-top:8px"><button class="link danger" id="delEv">Delete event</button></div>` : ''}`, () => {
    bindKidChips('evKid'); $('cancelEv').onclick = closeSheet;
    $('saveEv').onclick = async () => {
      e.title = $('evTitle').value.trim(); if (!e.title) { toast('Enter a title'); return; }
      e.kid = readKids('evKid')[0] || ''; e.date = $('evDate').value || today(); e.time = $('evTime').value; e.repeat = $('evRep').value; e.until = $('evUntil').value; e.remind = +$('evRem').value; e.notes = $('evNotes').value.trim();
      if (!ev) EVENTS.push(e); await saveEvents(); closeSheet(); renderEvents(); renderTodayEvents(); toast('Event saved');
    };
    if ($('icsEv')) $('icsEv').onclick = () => shareFile(new File([eventICS(e)], (e.title.replace(/\W+/g, '-') || 'event') + '.ics', { type: 'text/calendar' }), e.title);
    if ($('delEv')) $('delEv').onclick = async () => { if (confirm('Delete this event?')) { EVENTS = EVENTS.filter(x => x.id !== e.id); await saveEvents(); closeSheet(); renderEvents(); renderTodayEvents(); } };
  });
}
function icsDate(d) { return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + 'T' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0') + '00'; }
function eventICS(e) {
  const st = new Date(e.date + 'T' + (e.time || '09:00')), en = new Date(st.getTime() + 60 * 60000);
  const rr = e.repeat === 'weekly' ? 'FREQ=WEEKLY' : e.repeat === 'weekdays' ? 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' : e.repeat === 'daily' ? 'FREQ=DAILY' : '';
  const until = e.until ? ';UNTIL=' + e.until.replace(/-/g, '') + 'T235959' : '';
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//NannyLog//EN', 'BEGIN:VEVENT', 'UID:' + e.id + '@nannylog', 'DTSTAMP:' + icsDate(new Date()),
    (e.time ? 'DTSTART:' + icsDate(st) : 'DTSTART;VALUE=DATE:' + e.date.replace(/-/g, '')), (e.time ? 'DTEND:' + icsDate(en) : ''),
    'SUMMARY:' + (e.title + (e.kid ? ' (' + kidName(e.kid) + ')' : '')).replace(/[,;]/g, ' '), e.notes ? 'DESCRIPTION:' + e.notes.replace(/[,;\n]/g, ' ') : '', rr ? 'RRULE:' + rr + until : '',
    e.remind ? `BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:${e.title}\r\nTRIGGER:-PT${e.remind}M\r\nEND:VALARM` : '', 'END:VEVENT', 'END:VCALENDAR'];
  return L.filter(Boolean).join('\r\n');
}
function checkEventAlerts() {
  const now = Date.now();
  for (const o of upcoming(1)) { if (!o.ev.remind || !o.ev.time) continue; const at = o.ts - o.ev.remind * 60000; const k = o.ev.id + o.date; if (now >= at && now < o.ts && !alerted[k]) { alerted[k] = 1; buzz(`${o.ev.title} at ${fmtTime(o.ts)}`); } }
}

/* ================= shopping ================= */
const SHOP_QUICK = ['Diapers', 'Wipes', 'Formula', 'Milk', 'Bread', 'Fruit', 'Snacks', 'Diaper cream', 'Baby shampoo', 'Juice boxes'];
const saveShop = () => put('kv', SHOP, 'shopping');
function renderShop() {
  $('shopQuick').innerHTML = SHOP_QUICK.map(s => `<button class="chip" data-q="${s}">+ ${s}</button>`).join('');
  $('shopQuick').querySelectorAll('.chip').forEach(b => b.onclick = () => addShop(b.dataset.q));
  $('shopList').innerHTML = SHOP.length ? SHOP.map(it => `<label class="check ${it.done ? 'done' : ''}" style="margin:0;font-size:15px;color:var(--ink);font-weight:400"><input type="checkbox" data-s="${it.id}" ${it.done ? 'checked' : ''}><span style="flex:1">${esc(it.name)}</span><span class="small">${fmtDate(today(new Date(it.added)), { month: 'short', day: 'numeric' })}</span></label>`).join('') : '<div class="empty">Nothing needed right now.</div>';
  $('shopList').querySelectorAll('[data-s]').forEach(cb => cb.onchange = async () => { const it = SHOP.find(x => x.id === cb.dataset.s); it.done = cb.checked; await saveShop(); renderShop(); });
}
async function addShop(name) { name = (name || '').trim(); if (!name) return; if (SHOP.some(x => !x.done && x.name.toLowerCase() === name.toLowerCase())) { toast('Already on the list'); return; } SHOP.unshift({ id: uid(), name, done: false, added: Date.now() }); await saveShop(); renderShop(); toast('Added: ' + name); }
$('shopAdd').onclick = () => { addShop($('shopInput').value); $('shopInput').value = ''; };
$('shopInput').onkeydown = e => { if (e.key === 'Enter') $('shopAdd').click(); };
$('shopClear').onclick = async () => { SHOP = SHOP.filter(x => !x.done); await saveShop(); renderShop(); };
$('shopShare').onclick = async () => { const items = SHOP.filter(x => !x.done); if (!items.length) { toast('List is empty'); return; } const t = `${S.parent ? 'Hi ' + S.parent + ', w' : 'W'}e're running low on:\n` + items.map(i => '• ' + i.name).join('\n') + (S.name ? `\n— ${S.name}` : ''); if (navigator.share) { try { await navigator.share({ text: t }); } catch (_) { } } else copy(t); };

/* ================= medicine permission forms ================= */
const savePerms = () => put('kv', PERMS, 'perms');
const activePerms = () => PERMS.filter(p => p.signature && (!p.end || p.end >= today()) && (!p.start || p.start <= today()));
function renderPerms() {
  $('permList').innerHTML = PERMS.length ? PERMS.slice().reverse().map(p => { const act = activePerms().includes(p); return `<div class="li" data-id="${p.id}"><div><div>💊 ${esc(p.medicine)} ${esc(p.dose)}</div><div class="sub">${esc(kidName(p.kid))} · ${p.start || ''}${p.end ? ' to ' + p.end : ''}</div></div><span class="pill ${act ? 'ok' : 'bad'}">${act ? 'Active' : p.signature ? 'Expired' : 'Unsigned'}</span></div>`; }).join('') : '<div class="sub" style="padding:8px 0">No forms yet. Parents sign on this phone before you give any medicine.</div>';
  $('permList').querySelectorAll('.li').forEach(li => li.onclick = () => openPerm(PERMS.find(p => p.id === li.dataset.id)));
}
function openPerm(pm) {
  const p = pm || { id: uid(), kid: S.kids[0] ? S.kids[0].id : '', medicine: '', dose: '', times: '', reason: '', start: today(), end: today(), parentName: S.parent, signature: '', signedAt: 0, notes: '' };
  const locked = !!p.signature;
  openSheet(`<div class="hrow"><h2 style="margin:0">💊 Medicine permission</h2><button class="link" id="cancelP">Close</button></div>
    ${kidChips(p.kid ? [p.kid] : [], 'pKid', true)}
    <label for="pMed">Medicine name</label><input type="text" id="pMed" value="${esc(p.medicine)}" placeholder="e.g. Children's Tylenol" ${locked ? 'disabled' : ''}>
    <label for="pDose">Dose</label><input type="text" id="pDose" value="${esc(p.dose)}" placeholder="e.g. 5 ml" ${locked ? 'disabled' : ''}>
    <label for="pTimes">When / how often</label><input type="text" id="pTimes" value="${esc(p.times)}" placeholder="e.g. every 6 hours if fever over 38.5°C, max 4 doses" ${locked ? 'disabled' : ''}>
    <label for="pReason">Reason</label><input type="text" id="pReason" value="${esc(p.reason)}" placeholder="e.g. fever, ear infection" ${locked ? 'disabled' : ''}>
    <div class="row"><div style="flex:1"><label for="pStart">From</label><input type="date" id="pStart" value="${p.start}" ${locked ? 'disabled' : ''}></div><div style="flex:1"><label for="pEnd">Until</label><input type="date" id="pEnd" value="${p.end}" ${locked ? 'disabled' : ''}></div></div>
    <label for="pNotes">Special instructions</label><input type="text" id="pNotes" value="${esc(p.notes)}" placeholder="e.g. give with food" ${locked ? 'disabled' : ''}>
    <label for="pParent">Parent / guardian name</label><input type="text" id="pParent" value="${esc(p.parentName)}" ${locked ? 'disabled' : ''}>
    <label>Parent signature</label>
    ${locked ? `<img src="${p.signature}" style="width:100%;background:#fff;border-radius:12px;border:1px solid var(--line)"><div class="small">Signed ${new Date(p.signedAt).toLocaleString('en-CA')}</div>` : `<canvas class="sig" id="sig"></canvas><div class="row" style="justify-content:space-between"><span class="small">Parent signs with a finger</span><button class="link" id="sigClear">Clear</button></div>
      <p class="small">By signing, the parent/guardian authorizes the caregiver to give this medicine as written above.</p>`}
    <div style="height:12px"></div>
    ${locked ? `<button class="big" id="pdfP">📄 PDF copy for parents</button>` : `<button class="big" id="saveP">Save signed form</button>`}
    ${pm ? '<div style="text-align:center;margin-top:8px"><button class="link danger" id="delP">Delete form</button></div>' : ''}`, () => {
    bindKidChips('pKid'); $('cancelP').onclick = closeSheet;
    if (locked) $('pKid') && $('pKid').querySelectorAll('.chip').forEach(c => c.disabled = true);
    let pad = null; if (!locked) pad = sigPad($('sig'));
    if ($('sigClear')) $('sigClear').onclick = () => pad.clear();
    if ($('saveP')) $('saveP').onclick = async () => {
      const kid = readKids('pKid')[0]; const med = $('pMed').value.trim(), dose = $('pDose').value.trim(), parent = $('pParent').value.trim();
      if (!kid || !med || !dose || !parent) { toast('Fill child, medicine, dose and parent name'); return; }
      if (pad.empty()) { toast('Parent signature needed'); return; }
      Object.assign(p, { kid, medicine: med, dose, times: $('pTimes').value.trim(), reason: $('pReason').value.trim(), start: $('pStart').value, end: $('pEnd').value, notes: $('pNotes').value.trim(), parentName: parent, signature: pad.data(), signedAt: Date.now() });
      if (!pm) PERMS.push(p); await savePerms(); closeSheet(); renderPerms(); toast('Signed form saved');
    };
    if ($('pdfP')) $('pdfP').onclick = () => permPdf(p);
    if ($('delP')) $('delP').onclick = async () => { if (confirm('Delete this form?')) { PERMS = PERMS.filter(x => x.id !== p.id); await savePerms(); closeSheet(); renderPerms(); } };
  });
}
function sigPad(c) {
  const r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1; c.width = r.width * dpr; c.height = r.height * dpr;
  const x = c.getContext('2d'); x.scale(dpr, dpr); x.lineWidth = 2.4; x.lineCap = 'round'; x.lineJoin = 'round'; x.strokeStyle = '#111';
  let drawing = false, any = false, last = null;
  const pt = e => { const b = c.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  c.addEventListener('pointerdown', e => { drawing = true; last = pt(e); c.setPointerCapture(e.pointerId); e.preventDefault(); });
  c.addEventListener('pointermove', e => { if (!drawing) return; const p = pt(e); x.beginPath(); x.moveTo(...last); x.lineTo(...p); x.stroke(); last = p; any = true; e.preventDefault(); });
  const up = () => drawing = false; c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
  return { clear: () => { x.clearRect(0, 0, c.width, c.height); any = false; }, empty: () => !any, data: () => c.toDataURL('image/png') };
}

/* ================= PDF helpers ================= */
const latin = t => String(t || '').replace(/[ঀ-৿]+[ঀ-৿\s]*/g, '[Bangla text] ').replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ]/g, '');
function newPdf() { const { jsPDF } = window.jspdf; return new jsPDF({ unit: 'pt', format: 'letter' }); }
function pdfWriter(doc) {
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 48; let y = M;
  const api = {
    W, H, M, get y() { return y; }, set y(v) { y = v; },
    ensure(h) { if (y + h > H - M) { doc.addPage(); y = M; } },
    text(t, { size = 10.5, bold = false, color = [34, 33, 28], indent = 0, gap = 4 } = {}) {
      doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...color);
      const lines = doc.splitTextToSize(latin(t), W - 2 * M - indent);
      for (const l of lines) { api.ensure(size + 3); doc.text(l, M + indent, y + size); y += size + 3; }
      y += gap;
    },
    rule(color = [228, 225, 216]) { api.ensure(8); doc.setDrawColor(...color); doc.line(M, y, W - M, y); y += 8; },
    header(title, sub) {
      doc.setFillColor(194, 80, 46); doc.rect(0, 0, W, 6, 'F');
      api.text(title, { size: 18, bold: true, gap: 2 }); if (sub) api.text(sub, { size: 10, color: [107, 106, 99], gap: 8 }); api.rule();
    },
    footer() { const n = doc.getNumberOfPages(); for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(140); doc.text(`Nanny Log · page ${i} of ${n}`, W / 2, H - 22, { align: 'center' }); } }
  };
  return api;
}
async function shareFile(file, title) {
  try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title }); return; } } catch (err) { if (err && err.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  toast('Saved: ' + file.name);
}
function weekRange(offset = 0) { const s = weekStart(); s.setDate(s.getDate() + offset * 7); const days = [...Array(7)].map((_, i) => { const d = new Date(s); d.setDate(d.getDate() + i); return today(d); }); return days; }
const pdfName = (base, d) => `${base}-${d}.pdf`;

async function weeklyPdf() {
  const days = weekRange(repWeek); const doc = newPdf(), w = pdfWriter(doc);
  w.header('Weekly Childcare Report', `${fmtDate(days[0], { month: 'long', day: 'numeric' })} to ${fmtDate(days[6], { month: 'long', day: 'numeric', year: 'numeric' })}${S.name ? ' · Caregiver: ' + S.name : ''}${S.parent ? ' · For: ' + S.parent : ''}`);
  let any = false;
  for (const d of days) {
    const list = (await byDate('entries', d)).sort((a, b) => a.ts - b.ts); if (!list.length) continue; any = true;
    w.ensure(40); w.text(fmtDate(d), { size: 13, bold: true, color: [194, 80, 46], gap: 2 });
    const groups = S.kids.length ? [...S.kids.map(k => ({ n: k.name, items: list.filter(e => e.kids && e.kids.includes(k.id)) })), { n: 'General', items: list.filter(e => !e.kids || !e.kids.length) }] : [{ n: '', items: list }];
    for (const g of groups) {
      if (!g.items.length) continue; if (g.n) w.text(g.n, { size: 11, bold: true, gap: 1 });
      const nap = g.items.filter(e => e.type === 'nap').reduce((a, e) => a + napMin(e), 0);
      const line = (lbl, arr) => arr.length && w.text(`${lbl}: ${arr.join('; ')}`, { indent: 10, gap: 1 });
      line('Food', g.items.filter(e => ['meal', 'snack', 'bottle'].includes(e.type)).map(e => `${fmtTime(e.ts)} ${summary(e) || TYPES[e.type].lbl}`));
      if (nap) w.text(`Nap: ${mins(nap)}`, { indent: 10, gap: 1 });
      const dp = g.items.filter(e => ['diaper', 'potty'].includes(e.type)); if (dp.length) w.text(`Diaper/potty: ${dp.length} (${dp.map(summary).filter(Boolean).join(', ')})`, { indent: 10, gap: 1 });
      line('Activities', g.items.filter(e => ['play', 'outing', 'school', 'routine'].includes(e.type)).map(e => summary(e) || TYPES[e.type].lbl));
      line('Cooking', g.items.filter(e => e.type === 'cooking').map(summary));
      line('Tidying', g.items.filter(e => e.type === 'tidying').map(summary));
      line('Parent instructions done', g.items.filter(e => e.type === 'instruction').map(e => `${fmtTime(e.ts)} ${summary(e)}`));
      line('Mood', g.items.filter(e => e.type === 'mood').map(summary));
      line('Medicine given', g.items.filter(e => e.type === 'medicine').map(e => `${fmtTime(e.ts)} ${summary(e)}`));
      g.items.filter(e => e.type === 'incident').forEach(e => w.text(`INCIDENT ${fmtTime(e.ts)}: ${summary(e).replace(/\n/g, '. ')}${noteText(e) ? '. ' + noteText(e) : ''}`, { indent: 10, gap: 1, bold: true, color: [179, 38, 30] }));
      const notes = g.items.filter(e => noteText(e) && e.type !== 'incident').map(noteText); if (notes.length) w.text(`Notes: ${notes.join(' ')}`, { indent: 10, gap: 1, color: [80, 80, 75] });
      w.y += 4;
    }
    w.rule();
  }
  if (!any) w.text('No entries were logged this week.');
  w.footer();
  await shareFile(new File([doc.output('blob')], pdfName('Weekly-Report', days[0]), { type: 'application/pdf' }), 'Weekly report');
}

async function timesheetPdf() {
  const days = weekRange(hrsWeek); const all = (await getAll('shifts')).filter(s => days.includes(s.date)).sort((a, b) => (a.date + a.in).localeCompare(b.date + b.in));
  const doc = newPdf(), w = pdfWriter(doc); const rate = +S.rate || 0;
  w.header('Timesheet', `Week of ${fmtDate(days[0], { month: 'long', day: 'numeric' })} to ${fmtDate(days[6], { month: 'long', day: 'numeric', year: 'numeric' })}`);
  w.text(`Employee: ${S.name || '________________'}      Employer: ${S.parent || '________________'}`, { gap: 10 });
  const cols = [w.M, w.M + 170, w.M + 250, w.M + 330, w.M + 420]; const hdr = ['Date', 'Start', 'End', 'Break', 'Hours'];
  doc.setFillColor(246, 244, 238); doc.rect(w.M, w.y, w.W - 2 * w.M, 20, 'F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(34);
  hdr.forEach((h, i) => doc.text(h, cols[i] + 4, w.y + 14)); w.y += 24; doc.setFont('helvetica', 'normal');
  let total = 0;
  for (const s of all) { const h = shiftHrs(s); total += h; w.ensure(18); [fmtDate(s.date, { weekday: 'short', month: 'short', day: 'numeric' }), s.in || '', s.out || '(open)', (s.brk || 0) + ' min', h.toFixed(2)].forEach((t, i) => doc.text(String(t), cols[i] + 4, w.y + 12)); w.y += 18; doc.setDrawColor(228, 225, 216); doc.line(w.M, w.y, w.W - w.M, w.y); w.y += 2; }
  if (!all.length) w.text('No shifts recorded this week.');
  w.y += 10; const reg = Math.min(total, 44), ot = Math.max(0, total - 44);
  [['Regular hours', reg.toFixed(2)], ['Overtime hours (over 44, at 1.5x)', ot.toFixed(2)], ['Total hours', total.toFixed(2)], ['Hourly rate', '$' + rate.toFixed(2)], ['Estimated gross pay (before deductions)', '$' + (reg * rate + ot * rate * 1.5).toFixed(2)]]
    .forEach(([a, b], i) => { w.ensure(18); doc.setFont('helvetica', i === 4 ? 'bold' : 'normal'); doc.setFontSize(10.5); doc.text(a, w.M, w.y + 12); doc.text(b, w.W - w.M, w.y + 12, { align: 'right' }); w.y += 18; });
  w.y += 30; w.ensure(60); doc.setDrawColor(120); doc.line(w.M, w.y, w.M + 200, w.y); doc.line(w.W - w.M - 200, w.y, w.W - w.M, w.y);
  doc.setFontSize(9); doc.setTextColor(110); doc.text('Employee signature / date', w.M, w.y + 12); doc.text('Employer signature / date', w.W - w.M - 200, w.y + 12);
  w.y += 30; w.text('Estimate only. Ontario overtime generally applies after 44 hours in a work week. Statutory deductions (CPP, EI, income tax) are handled by the employer.', { size: 8.5, color: [130, 130, 125] });
  w.footer();
  await shareFile(new File([doc.output('blob')], pdfName('Timesheet', days[0]), { type: 'application/pdf' }), 'Timesheet');
}

async function permPdf(p) {
  const doc = newPdf(), w = pdfWriter(doc);
  w.header('Medication Permission Form', 'Authorization for caregiver to give medicine');
  [['Child', kidName(p.kid)], ['Medicine', p.medicine], ['Dose', p.dose], ['When / how often', p.times], ['Reason', p.reason], ['Dates', `${p.start || ''} to ${p.end || ''}`], ['Special instructions', p.notes], ['Caregiver', S.name]]
    .forEach(([a, b]) => { w.text(a, { size: 9, color: [107, 106, 99], gap: 0 }); w.text(b || '-', { size: 11.5, gap: 6 }); });
  w.text(`I, ${p.parentName}, parent/guardian of the child named above, authorize the caregiver to give this medicine as written.`, { gap: 10 });
  w.ensure(130); try { doc.addImage(p.signature, 'PNG', w.M, w.y, 220, 80); } catch (_) { } w.y += 84;
  doc.setDrawColor(120); doc.line(w.M, w.y, w.M + 220, w.y); w.y += 4;
  w.text(`Signature of ${p.parentName} · signed ${new Date(p.signedAt).toLocaleString('en-CA')}`, { size: 9, color: [107, 106, 99] });
  const given = (await getAll('entries')).filter(e => e.type === 'medicine' && e.kids && e.kids.includes(p.kid) && e.date >= (p.start || '') && e.date <= (p.end || '9999')).sort((a, b) => a.ts - b.ts);
  if (given.length) { w.y += 10; w.text('Doses given (from the log)', { size: 12, bold: true }); given.forEach(e => w.text(`${fmtDate(e.date, { month: 'short', day: 'numeric' })} ${fmtTime(e.ts)} · ${summary(e)}`, { indent: 8, gap: 1 })); }
  w.footer();
  await shareFile(new File([doc.output('blob')], `Medicine-Permission-${(kidName(p.kid) || 'child').replace(/\W+/g, '')}-${p.start}.pdf`, { type: 'application/pdf' }), 'Medicine permission');
}

/* ================= render log ================= */
async function render() {
  $('dateLbl').textContent = curDate === today() ? 'Today · ' + fmtDate(curDate, { month: 'short', day: 'numeric' }) : fmtDate(curDate);
  $('title').textContent = ({ log: curDate === today() ? 'Today' : 'Log', plan: 'Plan', report: 'Report', hours: 'Hours', more: 'More' })[curView];
  renderClock();
  if (curView === 'plan') return renderPlan();
  if (curView === 'report') return renderReport();
  if (curView !== 'log') return;
  renderTimers(); computeBottleDue(); renderTodayEvents(); renderInstr();
  let list = (await byDate('entries', curDate)).sort((a, b) => a.ts - b.ts);
  const fk = $('childFilter');
  fk.innerHTML = S.kids.length > 1 ? ['all', ...S.kids.map(k => k.id)].map(id => `<button class="chip ${filterKid === id ? 'on' : ''}" data-f="${id}">${id === 'all' ? 'All' : esc(kidName(id))}</button>`).join('') : '';
  fk.querySelectorAll('.chip').forEach(b => b.onclick = () => { filterKid = b.dataset.f; render(); });
  if (filterKid !== 'all') list = list.filter(e => !e.kids || !e.kids.length || e.kids.includes(filterKid));
  $('sMeals').textContent = list.filter(e => e.type === 'meal').length;
  $('sNap').textContent = mins(list.filter(e => e.type === 'nap').reduce((a, e) => a + napMin(e), 0));
  $('sDiaper').textContent = list.filter(e => e.type === 'diaper' || e.type === 'potty').length;
  const tl = $('timeline');
  tl.innerHTML = !list.length ? '<div class="empty">No entries yet for this day.<br>Tap <b>Voice note</b> or a quick-add button.</div>' :
    list.slice().reverse().map(e => {
      const t = TYPES[e.type] || TYPES.note, s = summary(e);
      return `<div class="item ${e.type === 'incident' ? 'incident' : ''}" data-id="${e.id}">
      <div class="t">${fmtTime(e.ts)}${e.kids && e.kids.length ? ' · ' + esc(kidNames(e.kids)) : ''}${e.voice ? ' · <span class="tag">voice</span>' : ''}</div>
      <div class="h">${t.ic} ${t.lbl}</div>
      ${s ? `<div class="tx">${esc(s)}</div>` : ''}${e.text ? `<div class="tx">${esc(e.text)}</div>` : ''}${e.textEn ? `<div class="tr">🌐 ${esc(e.textEn)}</div>` : ''}
      ${e.photo ? `<img alt="Photo">` : ''}${e.audio ? `<audio controls preload="none"></audio>` : ''}</div>`;
    }).join('');
  tl.querySelectorAll('.item').forEach(div => {
    const e = list.find(x => x.id === div.dataset.id);
    const img = div.querySelector('img'); if (img && e.photo) img.src = URL.createObjectURL(e.photo);
    const au = div.querySelector('audio'); if (au && e.audio) au.src = URL.createObjectURL(e.audio);
    div.onclick = ev => { if (ev.target.tagName === 'AUDIO') return; openEntry(e.type, e); };
  });
}
function renderPlan() {
  $('planSeg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.p === planTab));
  ['routines', 'events', 'shop'].forEach(p => $('p-' + p).style.display = p === planTab ? '' : 'none');
  $('datebar').style.display = planTab === 'routines' ? 'flex' : 'none';
  if (planTab === 'routines') renderRoutines(); else if (planTab === 'events') renderEvents(); else renderShop();
}
$('planSeg').querySelectorAll('button').forEach(b => b.onclick = () => { planTab = b.dataset.p; renderPlan(); });
$('addEvent').onclick = () => openEvent();

/* ================= report ================= */
async function buildReport(date = curDate) {
  const list = (await byDate('entries', date)).sort((a, b) => a.ts - b.ts);
  const L = [S.parent ? `Hi ${S.parent},` : 'Hi,', `Here is the day summary for ${fmtDate(date)}.`, ''];
  const groups = S.kids.length ? [...S.kids.map(k => ({ k, items: list.filter(e => e.kids && e.kids.includes(k.id)) })), { k: { name: 'General' }, items: list.filter(e => !e.kids || !e.kids.length) }] : [{ k: null, items: list }];
  for (const g of groups) {
    if (!g.items.length) continue; if (g.k) L.push(`— ${g.k.name} —`);
    const nap = g.items.filter(e => e.type === 'nap').reduce((a, e) => a + napMin(e), 0);
    const meals = g.items.filter(e => ['meal', 'snack', 'bottle'].includes(e.type)); if (meals.length) L.push('Food: ' + meals.map(e => `${fmtTime(e.ts)} ${summary(e) || TYPES[e.type].lbl}`).join('; '));
    if (nap) L.push('Nap: ' + mins(nap));
    const dp = g.items.filter(e => ['diaper', 'potty'].includes(e.type)); if (dp.length) L.push(`Diaper/potty: ${dp.length} (` + dp.map(summary).filter(Boolean).join(', ') + ')');
    const act = g.items.filter(e => ['play', 'outing', 'school', 'routine'].includes(e.type)); if (act.length) L.push('Activities: ' + act.map(e => summary(e) || TYPES[e.type].lbl).join('; '));
    const ck = g.items.filter(e => e.type === 'cooking'); if (ck.length) L.push('Cooking: ' + ck.map(summary).join('; '));
    const td = g.items.filter(e => e.type === 'tidying'); if (td.length) L.push('Tidying: ' + td.map(summary).join('; '));
    const ins = g.items.filter(e => e.type === 'instruction'); if (ins.length) L.push('Your instructions: ' + ins.map(e => '✓ ' + summary(e)).join('; '));
    const md = g.items.filter(e => e.type === 'mood').map(summary); if (md.length) L.push('Mood: ' + md.join(', '));
    const med = g.items.filter(e => e.type === 'medicine'); if (med.length) L.push('Medicine: ' + med.map(e => `${fmtTime(e.ts)} ${summary(e)}`).join('; '));
    const inc = g.items.filter(e => e.type === 'incident'); if (inc.length) L.push('⚠️ Incident: ' + inc.map(e => `${fmtTime(e.ts)} ${summary(e).replace(/\n/g, '. ')}`).join('; '));
    const notes = g.items.filter(e => noteText(e) && e.type !== 'incident').map(noteText); if (notes.length) L.push('Notes: ' + notes.join(' '));
    L.push('');
  }
  if (!list.length) L.push('(No entries logged for this day.)', '');
  if (S.name) L.push(`— ${S.name}`);
  return L.join('\n').trim();
}
async function renderReport() { $('repText').textContent = await buildReport(); }
$('shareRep').onclick = async () => { const t = await buildReport(); if (navigator.share) { try { await navigator.share({ title: 'Daily report', text: t }); } catch (_) { } } else copy(t); };
$('copyRep').onclick = async () => copy(await buildReport());
async function copy(t) { try { await navigator.clipboard.writeText(t); toast('Copied'); } catch (_) { toast('Select the text and copy'); } }
$('repWeekSeg').querySelectorAll('button').forEach(b => b.onclick = () => { repWeek = +b.dataset.w; $('repWeekSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); });
$('weekPdf').onclick = () => weeklyPdf().catch(err => toast('PDF failed: ' + err.message));
$('searchBox').oninput = async ev => {
  const q = ev.target.value.trim().toLowerCase(), out = $('searchRes'); if (q.length < 2) { out.innerHTML = ''; return; }
  const all = (await getAll('entries')).filter(e => ((e.text || '') + ' ' + (e.textEn || '') + ' ' + summary(e) + ' ' + kidNames(e.kids) + ' ' + (TYPES[e.type] || {}).lbl).toLowerCase().includes(q)).sort((a, b) => b.ts - a.ts).slice(0, 40);
  out.innerHTML = all.length ? all.map(e => `<div class="li" data-d="${e.date}"><div><div class="sub">${fmtDate(e.date)} · ${fmtTime(e.ts)}</div><div>${(TYPES[e.type] || TYPES.note).ic} ${esc((summary(e) + ' ' + noteText(e)).trim().slice(0, 90))}</div></div><span>›</span></div>`).join('') : '<div class="empty">No matches</div>';
  out.querySelectorAll('.li').forEach(li => li.onclick = () => { curDate = li.dataset.d; show('log'); });
};

/* ================= hours ================= */
function shiftHrs(s) { if (!s.in || !s.out) return 0; const [a, b] = s.in.split(':').map(Number), [c, d] = s.out.split(':').map(Number); let m = (c * 60 + d) - (a * 60 + b); if (m < 0) m += 1440; return Math.max(0, m - (s.brk || 0)) / 60; }
function weekStart(d = new Date()) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - x.getDay()); return x; }
function openShift(sh) {
  const s = sh || { id: uid(), date: curDate, in: nowTimeStr(), out: '', brk: 0 };
  openSheet(`<div class="hrow"><h2 style="margin:0">⏱️ Shift</h2><button class="link" id="cancelS">Cancel</button></div>
    <label for="sDate">Date</label><input type="date" id="sDate" value="${s.date}">
    <label for="sIn">Start</label><input type="time" id="sIn" value="${s.in}">
    <label for="sOut">End</label><input type="time" id="sOut" value="${s.out || ''}">
    <label for="sBreak">Unpaid break (minutes)</label><input type="number" id="sBreak" value="${s.brk || 0}" min="0">
    <div style="height:14px"></div><button class="big" id="saveS">Save</button>
    ${sh ? '<div style="text-align:center;margin-top:8px"><button class="link danger" id="delS">Delete shift</button></div>' : ''}`, () => {
    $('cancelS').onclick = closeSheet;
    $('saveS').onclick = async () => { s.date = $('sDate').value; s.in = $('sIn').value; s.out = $('sOut').value; s.brk = +$('sBreak').value || 0; await put('shifts', s); closeSheet(); toast('Shift saved'); renderHours(); renderClock(); };
    if ($('delS')) $('delS').onclick = async () => { if (confirm('Delete this shift?')) { await del('shifts', s.id); closeSheet(); renderHours(); renderClock(); } };
  });
}
async function renderHours() {
  const days = weekRange(hrsWeek);
  const all = (await getAll('shifts')).sort((a, b) => (b.date + b.in).localeCompare(a.date + a.in));
  const wk = all.filter(s => days.includes(s.date));
  const h = wk.reduce((a, s) => a + shiftHrs(s), 0), reg = Math.min(h, 44), ot = Math.max(0, h - 44), rate = +S.rate || 0;
  $('hWeek').textContent = h.toFixed(1); $('hPay').textContent = '$' + (reg * rate + ot * rate * 1.5).toFixed(2);
  const n = $('otNote'); if (ot > 0) { n.style.display = 'block'; n.textContent = `${ot.toFixed(1)} overtime hours (paid at 1.5× = $${(rate * 1.5).toFixed(2)}/h).`; } else n.style.display = 'none';
  $('shiftList').innerHTML = wk.length ? wk.map(s => `<div class="li" data-id="${s.id}"><div><div>${fmtDate(s.date)}</div><div class="sub">${s.in} – ${s.out || '…working'}${s.brk ? ` · ${s.brk}m break` : ''}</div></div><b>${s.out ? shiftHrs(s).toFixed(2) + ' h' : ''}</b></div>`).join('') : '<div class="empty">No shifts this week. Use “Clock in” at the top.</div>';
  $('shiftList').querySelectorAll('.li').forEach(li => li.onclick = () => openShift(all.find(s => s.id === li.dataset.id)));
}
async function openShiftNow() { return (await getAll('shifts')).find(s => !s.out && s.date >= today(new Date(Date.now() - 86400000))); }
async function renderClock() { const o = await openShiftNow(); const b = $('clockBtn'); b.textContent = o ? 'Clock out · ' + o.in : 'Clock in'; b.classList.toggle('on', !!o); }
$('clockBtn').onclick = async () => {
  const o = await openShiftNow();
  if (o) { o.out = nowTimeStr(); await put('shifts', o); toast('Clocked out · ' + shiftHrs(o).toFixed(2) + ' h'); }
  else { await put('shifts', { id: uid(), date: today(), in: nowTimeStr(), out: '', brk: 0 }); toast('Clocked in'); }
  renderClock(); if (curView === 'hours') renderHours();
};
$('addShift').onclick = () => openShift();
$('hrsWeekSeg').querySelectorAll('button').forEach(b => b.onclick = () => { hrsWeek = +b.dataset.w; $('hrsWeekSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); renderHours(); });
$('tsPdf').onclick = () => timesheetPdf().catch(err => toast('PDF failed: ' + err.message));

/* ================= settings / kids ================= */
function renderMore() {
  $('setName').value = S.name; $('setParent').value = S.parent; $('setPhone').value = S.phone; $('setRate').value = S.rate; $('setLang').value = S.lang; $('setAudio').value = S.keepAudio; $('setTr').value = S.translate;
  $('parentLbl').textContent = S.parent ? `${S.parent} (parent)` : 'Parent'; $('parentNum').textContent = S.phone || 'Add in settings';
  $('parentCall').href = S.phone ? 'tel:' + S.phone.replace(/[^\d+]/g, '') : '#';
  const al = S.kids.filter(k => k.allergy).map(k => `${esc(k.name)}: ${esc(k.allergy)}`);
  $('allergyBox').style.display = al.length ? 'block' : 'none'; $('allergyBox').innerHTML = '<b>Allergies</b><br>' + al.join('<br>');
  $('kidList').innerHTML = S.kids.length ? S.kids.map(k => `<div class="li" data-id="${k.id}"><div><div>${esc(k.name)}</div><div class="sub">${esc([k.age, k.allergy && ('allergy: ' + k.allergy), +k.bottleEvery ? 'bottle every ' + mins(+k.bottleEvery) : ''].filter(Boolean).join(' · ') || 'tap to edit')}</div></div><span>›</span></div>`).join('') : '<div class="sub" style="padding:8px 0">No children added yet.</div>';
  $('kidList').querySelectorAll('.li').forEach(li => li.onclick = () => openKid(S.kids.find(k => k.id === li.dataset.id)));
  renderPerms(); renderSyncDot();
}
['setName', 'setParent', 'setPhone', 'setRate', 'setLang', 'setAudio', 'setTr'].forEach(id => $(id).onchange = async () => {
  S.name = $('setName').value.trim(); S.parent = $('setParent').value.trim(); S.phone = $('setPhone').value.trim(); S.rate = parseFloat($('setRate').value) || 0; S.lang = $('setLang').value; S.keepAudio = $('setAudio').value; S.translate = $('setTr').value;
  await saveSettings(); renderMore(); toast('Saved');
});
function openKid(k) {
  const kid = k || { id: uid(), name: '', age: '', allergy: '', notes: '', bottleEvery: 0 };
  openSheet(`<div class="hrow"><h2 style="margin:0">${k ? 'Edit child' : 'Add child'}</h2><button class="link" id="cancelK">Cancel</button></div>
  <label for="kName">Name</label><input type="text" id="kName" value="${esc(kid.name)}">
  <label for="kAge">Age</label><input type="text" id="kAge" value="${esc(kid.age)}" placeholder="e.g. 3 years">
  <label for="kAll">Allergies</label><input type="text" id="kAll" value="${esc(kid.allergy)}" placeholder="e.g. peanuts (EpiPen in bag)">
  <label for="kBottle">Bottle reminder</label><select id="kBottle">${[0, 120, 150, 180, 210, 240].map(m => `<option value="${m}" ${+kid.bottleEvery === m ? 'selected' : ''}>${m ? 'Every ' + mins(m) + ' after last bottle' : 'Off'}</option>`).join('')}</select>
  <label for="kNotes">Routine notes</label><textarea id="kNotes" placeholder="nap time, foods, rules">${esc(kid.notes)}</textarea>
  <div style="height:14px"></div><button class="big" id="saveK">Save</button>
  ${k ? '<div style="text-align:center;margin-top:8px"><button class="link danger" id="delK">Remove child</button></div>' : ''}`, () => {
    $('cancelK').onclick = closeSheet;
    $('saveK').onclick = async () => {
      kid.name = $('kName').value.trim(); if (!kid.name) { toast('Enter a name'); return; }
      kid.age = $('kAge').value.trim(); kid.allergy = $('kAll').value.trim(); kid.notes = $('kNotes').value.trim(); kid.bottleEvery = +$('kBottle').value;
      if (!k) S.kids.push(kid); await saveSettings(); closeSheet(); renderMore(); toast('Saved');
      if (kid.bottleEvery && 'Notification' in window && Notification.permission === 'default') { try { Notification.requestPermission(); } catch (_) { } }
    };
    if ($('delK')) $('delK').onclick = async () => { if (confirm('Remove ' + kid.name + '? Past log entries stay.')) { S.kids = S.kids.filter(x => x.id !== kid.id); await saveSettings(); closeSheet(); renderMore(); } };
  });
}
$('addKid').onclick = () => openKid();
$('addPerm').onclick = () => openPerm();


/* ================= instructions from Mom / Dad ================= */
const saveInstr = () => put('kv', INSTR, 'instr');
function instrApplies(i, d) {
  if (i.archived) return false;
  const dow = new Date(d + 'T12:00').getDay();
  if (i.repeat === 'daily') return d >= i.date;
  if (i.repeat === 'weekdays') return d >= i.date && dow > 0 && dow < 6;
  return i.date === d;
}
const instrFor = d => INSTR.filter(i => instrApplies(i, d)).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
function fromOptions() { const o = ['Mom', 'Dad']; if (S.parent && !o.includes(S.parent)) o.unshift(S.parent); return o; }
function renderInstr() {
  const list = instrFor(curDate), box = $('instrBox'); if (!box) return;
  const pending = list.filter(i => !(i.done || {})[curDate]).length;
  box.innerHTML = `<div class="card" style="padding:12px"><div class="hrow"><div class="sub" style="font-weight:600">📌 Instructions from Mom & Dad${list.length ? ` · ${pending ? pending + ' to do' : 'all done ✓'}` : ''}</div><button class="link" id="addInstr">+ Add</button></div>
    ${list.length ? list.map(i => { const dn = (i.done || {})[curDate]; return `<div class="check ${dn ? 'done' : ''}" style="align-items:flex-start"><input type="checkbox" data-i="${i.id}" ${dn ? 'checked' : ''} aria-label="Mark done" style="margin-top:2px"><div style="flex:1" data-open="${i.id}"><span>${esc(i.text)}</span>${i.textEn ? `<div class="tr" style="margin-top:4px">🌐 ${esc(i.textEn)}</div>` : ''}<div class="small">${esc(i.from)}${i.kid ? ' · ' + esc(kidName(i.kid)) : ''}${i.time ? ' · by ' + fmtTime(tsFrom(curDate, i.time)) : ''}${i.repeat !== 'once' ? ' · ' + (i.repeat === 'daily' ? 'every day' : 'weekdays') : ''}${i.source === 'parent' ? ' · <span class="tag">sent by parent</span>' : ''}${dn ? ' · done ' + fmtTime(dn) : ''}</div></div></div>`; }).join('') : '<div class="small" style="padding:6px 0">No instructions for this day. Add what Mom or Dad asked, or they can send them from the parent link.</div>'}</div>`;
  $('addInstr').onclick = () => openInstr();
  box.querySelectorAll('[data-i]').forEach(cb => cb.onchange = async () => {
    const i = INSTR.find(x => x.id === cb.dataset.i); i.done = i.done || {};
    if (cb.checked) {
      i.done[curDate] = curDate === today() ? Date.now() : tsFrom(curDate, nowTimeStr());
      await put('entries', { id: 'ins-' + i.id + '-' + curDate, date: curDate, ts: i.done[curDate], type: 'instruction', kids: i.kid ? [i.kid] : [], details: { what: `${i.textEn || i.text} (${i.from})` }, text: '' });
      toast('Done ✓');
    } else { delete i.done[curDate]; await del('entries', 'ins-' + i.id + '-' + curDate); }
    await saveInstr(); render();
  });
  box.querySelectorAll('[data-open]').forEach(d => d.onclick = () => openInstr(INSTR.find(x => x.id === d.dataset.open)));
}
function openInstr(ins) {
  const i = ins || { id: uid(), from: fromOptions()[0], text: '', textEn: '', kid: '', date: curDate, time: '', repeat: 'once', source: 'nanny', done: {}, created: Date.now() };
  openSheet(`<div class="hrow"><h2 style="margin:0">📌 Instruction</h2><button class="link" id="cancelI">Cancel</button></div>
    <label>From</label><div class="seg" id="iFrom">${[...new Set([...fromOptions(), i.from])].map(f => `<button type="button" data-f="${esc(f)}" class="${f === i.from ? 'on' : ''}">${esc(f)}</button>`).join('')}</div>
    ${kidChips(i.kid ? [i.kid] : [], 'iKid', true)}
    <label for="iText">What should be done?</label>
    <textarea id="iText" placeholder="e.g. Give Maya her vitamins after lunch. No screen time today. Pack swimming bag.">${esc(i.text)}</textarea>
    ${trButtonHtml('iTrBtn')}
    <div class="trwrap" style="display:${i.textEn ? 'block' : 'none'}"><label for="iTextEn">English translation (editable)</label><textarea id="iTextEn" style="min-height:70px">${esc(i.textEn || '')}</textarea></div>
    <div class="row"><div style="flex:1"><label for="iDate">Starting</label><input type="date" id="iDate" value="${i.date}"></div><div style="flex:1"><label for="iTime">By time (optional)</label><input type="time" id="iTime" value="${i.time || ''}"></div></div>
    <label for="iRep">Repeat</label><select id="iRep">${[['once', 'Only this day'], ['daily', 'Every day'], ['weekdays', 'Weekdays (Mon–Fri)']].map(([v, l]) => `<option value="${v}" ${i.repeat === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <p class="small">Tip: tap the 🎤 on the keyboard to dictate exactly what the parent said.</p>
    <div style="height:10px"></div><button class="big" id="saveI">Save</button>
    ${ins ? `<div style="text-align:center;margin-top:8px"><button class="link danger" id="delI">${ins.repeat !== 'once' ? 'Stop this instruction' : 'Delete'}</button></div>` : ''}`, () => {
    $('cancelI').onclick = closeSheet; bindKidChips('iKid');
    $('iFrom').querySelectorAll('button').forEach(b => b.onclick = () => $('iFrom').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)));
    const trb = $('iTrBtn'); const upd = () => { if (trb) trb.style.display = hasBangla($('iText').value) ? '' : 'none'; }; upd(); $('iText').addEventListener('input', upd);
    bindTranslate('iTrBtn', 'iText', 'iTextEn');
    $('saveI').onclick = async () => {
      i.text = $('iText').value.trim(); if (!i.text) { toast('Write the instruction'); return; }
      i.textEn = ($('iTextEn').value || '').trim(); i.from = ($('iFrom').querySelector('.on') || {}).dataset?.f || 'Mom';
      i.kid = readKids('iKid')[0] || ''; i.date = $('iDate').value || curDate; i.time = $('iTime').value; i.repeat = $('iRep').value;
      if (!ins) INSTR.push(i); await saveInstr(); closeSheet(); render(); toast('Instruction saved');
    };
    if ($('delI')) $('delI').onclick = async () => {
      if (!confirm('Remove this instruction?')) return;
      if (ins.repeat !== 'once' && Object.keys(ins.done || {}).length) ins.archived = true; else INSTR = INSTR.filter(x => x.id !== ins.id);
      await saveInstr(); closeSheet(); render();
    };
  });
}
async function pullInbox() {
  if (!S.sync.on || !S.sync.db) return;
  const base = `${S.sync.db.replace(/\/+$/, '')}/families/${S.sync.code}/inbox`;
  const r = await fetch(base + '.json'); if (!r.ok) throw new Error('HTTP ' + r.status);
  const box = await r.json(); if (!box) return;
  let n = 0;
  for (const [id, m] of Object.entries(box)) {
    if (m && m.text && !INSTR.some(x => x.id === id)) {
      INSTR.push({ id, from: String(m.from || 'Parent').slice(0, 30), text: String(m.text).slice(0, 1000), textEn: '', kid: S.kids.some(k => k.id === m.kid) ? m.kid : '', date: /^\d{4}-\d{2}-\d{2}$/.test(m.date) ? m.date : today(), time: /^\d{2}:\d{2}$/.test(m.time || '') ? m.time : '', repeat: ['once', 'daily', 'weekdays'].includes(m.repeat) ? m.repeat : 'once', source: 'parent', done: {}, created: m.created || Date.now() });
      n++;
    }
    await fetch(`${base}/${id}.json`, { method: 'DELETE' });
  }
  if (n) { await P(tx('kv', 'readwrite').put(INSTR, 'instr')); buzz(n === 1 ? 'New instruction from a parent' : n + ' new instructions from parents'); if (curView === 'log') renderInstr(); }
}

/* ================= parent sharing (Firebase live sync + snapshot) ================= */
let syncTimer = null, syncState = 'off', syncing = false;
function scheduleSync() { if (!S.sync || !S.sync.on) return; clearTimeout(syncTimer); syncTimer = setTimeout(doSync, 1500); }
function renderSyncDot() { const d = $('syncDot'); if (!d) return; d.className = 'sync ' + (syncState === 'ok' ? 'on' : syncState === 'err' ? 'err' : ''); $('syncTxt').textContent = !S.sync.on ? 'off' : syncState === 'ok' ? 'live' : syncState === 'err' ? 'offline' : 'starting…'; }
async function dayPayload(date) {
  const list = (await byDate('entries', date)).sort((a, b) => a.ts - b.ts);
  return {
    date, updated: Date.now(),
    entries: list.map(e => ({ id: e.id, ts: e.ts, type: e.type, kids: e.kids || [], s: summary(e), t: e.text || '', en: e.textEn || '', photo: !!e.photo, voice: !!e.voice })),
    routines: (await kvGet(rcKey(date))) || {}
  };
}
async function statePayload() {
  return {
    updated: Date.now(), nanny: S.name, parent: S.parent,
    kids: S.kids.map(k => ({ id: k.id, name: k.name, age: k.age, allergy: k.allergy, routines: k.routines || DEFAULT_ROUTINES, bottleEvery: +k.bottleEvery || 0 })),
    timers: TIMERS, shopping: SHOP.filter(x => !x.done).map(x => ({ name: x.name, added: x.added })),
    events: upcoming(14).map(o => ({ title: o.ev.title, date: o.date, time: o.ev.time, kid: o.ev.kid, notes: o.ev.notes })),
    clockedIn: !!(await openShiftNow()), report: await buildReport(today()),
    instructions: instrFor(today()).map(i => ({ id: i.id, from: i.from, text: i.text, en: i.textEn || '', kid: i.kid, time: i.time, repeat: i.repeat, done: (i.done || {})[today()] || 0 }))
  };
}
async function fbPut(path, data) {
  const base = S.sync.db.replace(/\/+$/, '');
  const r = await fetch(`${base}/families/${S.sync.code}/${path}.json`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
}
async function doSync() {
  if (!S.sync.on || !S.sync.db || syncing) return; syncing = true;
  try { await pullInbox(); await fbPut('state', await statePayload()); await fbPut('days/' + today(), await dayPayload(today())); if (curDate !== today()) await fbPut('days/' + curDate, await dayPayload(curDate)); syncState = 'ok'; }
  catch (err) { syncState = 'err'; }
  syncing = false; renderSyncDot();
}
window.addEventListener('online', scheduleSync);
function parentLiveLink() { return new URL('parent.html', location.href).href + '#db=' + encodeURIComponent(S.sync.db.replace(/\/+$/, '')) + '&f=' + S.sync.code; }
async function snapshotLink() {
  const data = { state: await statePayload(), day: await dayPayload(curDate) };
  const json = JSON.stringify(data); let enc = 'j', bytes = new TextEncoder().encode(json);
  if (window.CompressionStream) { const cs = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw')); bytes = new Uint8Array(await new Response(cs).arrayBuffer()); enc = 'z'; }
  let bin = ''; bytes.forEach(b => bin += String.fromCharCode(b));
  const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return new URL('parent.html', location.href).href + '#s=' + enc + b64;
}
$('openShare').onclick = () => {
  const s = S.sync;
  openSheet(`<div class="hrow"><h2 style="margin:0">👪 Share with parents</h2><button class="link" id="cancelSh">Close</button></div>
    <div class="seg" id="shSeg"><button class="on" data-m="snap">Quick link</button><button data-m="live">Live link</button></div>
    <div id="shSnap">
      <p class="small">Makes a link with this day's log inside it. No setup needed. It does not update by itself: send a new link when you want to share again.</p>
      <button class="big" id="shSnapBtn">📤 Send today's link</button>
    </div>
    <div id="shLive" style="display:none">
      <p class="small">Parents keep one link and see updates within seconds. Needs a free Google Firebase database, set up once by you or the parents (steps in the README).</p>
      <label for="shDb">Firebase Realtime Database URL</label><input type="text" id="shDb" value="${esc(s.db)}" placeholder="https://your-project-default-rtdb.firebaseio.com">
      <label for="shCode">Family code (secret)</label><div class="row"><input type="text" id="shCode" value="${esc(s.code)}" readonly><button class="sbtn sec" id="shNew">New</button></div>
      <label for="shOn">Live sharing</label><select id="shOn"><option value="1" ${s.on ? 'selected' : ''}>On</option><option value="0" ${!s.on ? 'selected' : ''}>Off</option></select>
      <div style="height:12px"></div><button class="big" id="shSave">Save and test</button>
      <div id="shResult" style="margin-top:10px"></div>
      <p class="small">Anyone with the link can see the log, so share it only with the parents. Photos and audio are never uploaded, only text.</p>
    </div>`, () => {
    $('cancelSh').onclick = closeSheet;
    if (!$('shCode').value) $('shCode').value = randCode();
    $('shSeg').querySelectorAll('button').forEach(b => b.onclick = () => { $('shSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); $('shSnap').style.display = b.dataset.m === 'snap' ? '' : 'none'; $('shLive').style.display = b.dataset.m === 'live' ? '' : 'none'; });
    if (s.on) $('shSeg').querySelector('[data-m=live]').click();
    $('shNew').onclick = () => { if (!s.code || confirm('Make a new code? The old parent link will stop working.')) $('shCode').value = randCode(); };
    $('shSnapBtn').onclick = async () => { const link = await snapshotLink(); const t = `${S.parent ? 'Hi ' + S.parent + ', h' : 'H'}ere is today's log for ${S.kids.map(k => k.name).join(' & ') || 'the kids'}:\n${link}`; if (navigator.share) { try { await navigator.share({ text: t }); } catch (_) { } } else copy(link); };
    $('shSave').onclick = async () => {
      const dbu = $('shDb').value.trim();
      if ($('shOn').value === '1' && !/^https:\/\/[\w.-]+\.(firebaseio\.com|firebasedatabase\.app)\/?$/.test(dbu)) { $('shResult').innerHTML = '<div class="note">Enter the database URL exactly as Firebase shows it, e.g. https://name-default-rtdb.firebaseio.com</div>'; return; }
      S.sync = { db: dbu, code: $('shCode').value, on: $('shOn').value === '1' }; await saveSettings();
      if (!S.sync.on) { syncState = 'off'; renderSyncDot(); $('shResult').innerHTML = '<div class="note">Live sharing is off.</div>'; return; }
      $('shResult').innerHTML = '<div class="small">Testing…</div>'; syncState = 'starting'; await doSync();
      if (syncState === 'ok') {
        const link = parentLiveLink();
        $('shResult').innerHTML = `<div class="note okn">Connected ✓ Send this link to the parents once:</div><input type="text" readonly value="${esc(link)}" style="margin-top:8px"><div style="height:8px"></div><button class="big" id="shSend">📤 Send link to parents</button>`;
        $('shSend').onclick = async () => { const t = `Here is the live link to see ${S.kids.map(k => k.name).join(' & ') || 'the kids'}'s day (log, naps, meals):\n${link}`; if (navigator.share) { try { await navigator.share({ text: t }); } catch (_) { } } else copy(link); };
      } else $('shResult').innerHTML = '<div class="note">Could not connect. Check the URL, internet, and that the database rules from the README are published.</div>';
    };
  });
};
function randCode() { const a = new Uint8Array(18); crypto.getRandomValues(a); return [...a].map(b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join(''); }

/* ================= backup ================= */
const b64 = blob => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); });
const unb64 = async u => (await fetch(u)).blob();
function download(name, data, type) { shareFile(new File([data], name, { type }), name); }
$('exportJson').onclick = async () => {
  const entries = await getAll('entries');
  for (const e of entries) { if (e.photo) e.photo = await b64(e.photo); if (e.audio) e.audio = await b64(e.audio); }
  const kv = {}; const keys = await P(tx('kv').getAllKeys()); for (const k of keys) kv[k] = await kvGet(k);
  const data = { app: 'nannylog', v: 2, exported: new Date().toISOString(), kv, entries, shifts: await getAll('shifts') };
  download(`nanny-log-backup-${today()}.json`, JSON.stringify(data), 'application/json');
};
$('exportCsv').onclick = async () => {
  const rows = [['Date', 'Time', 'Child', 'Type', 'Details', 'Notes', 'English']];
  (await getAll('entries')).sort((a, b) => a.ts - b.ts).forEach(e => rows.push([e.date, fmtTime(e.ts), kidNames(e.kids), (TYPES[e.type] || {}).lbl, summary(e).replace(/\n/g, ' | '), e.text || '', e.textEn || '']));
  const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\r\n');
  download(`nanny-log-${today()}.csv`, '﻿' + csv, 'text/csv');
};
$('importFile').onchange = async ev => {
  const f = ev.target.files[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text()); if (d.app !== 'nannylog') throw 0;
    if (!confirm(`Restore ${d.entries.length} entries and ${d.shifts.length} shifts? Existing items with the same ID will be replaced.`)) return;
    for (const e of d.entries) { if (e.photo) e.photo = await unb64(e.photo); if (e.audio) e.audio = await unb64(e.audio); await put('entries', e); }
    for (const s of d.shifts) await put('shifts', s);
    if (d.kv) for (const k in d.kv) await put('kv', d.kv[k], k); else if (d.settings) await put('kv', { ...S, ...d.settings }, 'settings');
    await loadKV(); toast('Restored'); renderMore(); render();
  } catch (_) { toast('Not a valid Nanny Log backup'); }
  ev.target.value = '';
};

/* ================= navigation ================= */
function show(v) {
  curView = v; document.querySelectorAll('.view').forEach(s => s.classList.toggle('on', s.id === 'v-' + v));
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  $('datebar').style.display = (v === 'log' || v === 'report' || (v === 'plan' && planTab === 'routines')) ? 'flex' : 'none';
  if (v === 'hours') renderHours(); if (v === 'more') renderMore(); render(); scrollTo(0, 0);
}
document.querySelectorAll('nav button').forEach(b => b.onclick = () => show(b.dataset.v));
function shiftDay(n) { const d = new Date(curDate + 'T12:00'); d.setDate(d.getDate() + n); curDate = today(d); render(); }
$('prevDay').onclick = () => shiftDay(-1); $('nextDay').onclick = () => shiftDay(1); $('todayBtn').onclick = () => { curDate = today(); render(); };
$('voiceBtn').onclick = openVoice;
$('quick').innerHTML = QUICK.map(q => `<button class="qa" data-q="${q}"><span class="ic">${TYPES[q].ic}</span>${TYPES[q].lbl}</button>`).join('');
$('quick').querySelectorAll('.qa').forEach(b => b.onclick = () => openEntry(b.dataset.q));

/* ================= boot ================= */
async function loadKV() {
  const s = await kvGet('settings'); if (s) S = { ...S, ...s }; S.sync = S.sync || { db: '', code: '', on: false };
  if (S.translate === undefined) S.translate = '1';
  TIMERS = (await kvGet('timers')) || {}; SHOP = (await kvGet('shopping')) || []; EVENTS = (await kvGet('events')) || []; PERMS = (await kvGet('perms')) || []; INSTR = (await kvGet('instr')) || [];
}
(async () => {
  await openDB(); await loadKV();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });
  render(); scheduleSync();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (curDate !== today() && curView === 'log') { } render(); scheduleSync(); } });
  setInterval(() => S.sync.on && doSync(), 30000);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => { });
})();
