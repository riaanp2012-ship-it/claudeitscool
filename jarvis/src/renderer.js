/* global jarvis */
const $ = (id) => document.getElementById(id);
const orbCanvas = $('orb');
const ctx = orbCanvas.getContext('2d');

// state: idle | listening | hearing | thinking | speaking | muted
let state = 'idle';
let level = 0; // 0..1 audio level driving the orb
let voiceOn = true;
let busy = false;
let currentAudio = null;

// ---------- UI helpers ----------
const LABELS = { idle: 'STANDBY', listening: 'LISTENING', hearing: 'RECEIVING', thinking: 'PROCESSING', speaking: 'SPEAKING', muted: 'VOICE OFF' };
function setState(s) {
  state = s;
  $('stateLabel').textContent = LABELS[s] || s.toUpperCase();
  $('stateLabel').className = 'state-label' + (s === 'speaking' ? ' speaking' : '');
  $('statusText').textContent = LABELS[s];
  $('micBtn').classList.toggle('on', voiceOn);
  $('micBtn').classList.toggle('rec', s === 'hearing');
}
function addMsg(who, text) {
  const el = document.createElement('div');
  el.className = 'msg ' + who;
  el.innerHTML = `<small>${who === 'user' ? 'YOU' : who === 'err' ? 'ALERT' : 'JARVIS'}</small>`;
  el.appendChild(document.createTextNode(text));
  $('log').appendChild(el);
  $('log').scrollTop = $('log').scrollHeight;
}
function addActivity(html, fail) {
  const li = document.createElement('li');
  if (fail) li.className = 'fail';
  li.innerHTML = html;
  $('activity').prepend(li);
  while ($('activity').children.length > 30) $('activity').lastChild.remove();
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function tick() {
  const d = new Date();
  $('clock').textContent = d.toLocaleTimeString([], { hour12: false });
  $('dateText').textContent = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
}
setInterval(tick, 1000); tick();

// ---------- the arc-reactor orb ----------
let t = 0;
function drawOrb() {
  const dpr = window.devicePixelRatio || 1;
  const size = orbCanvas.clientWidth * dpr;
  if (orbCanvas.width !== size) { orbCanvas.width = size; orbCanvas.height = size; }
  const c = size / 2, R = size * 0.36;
  t += 0.016;
  const speaking = state === 'speaking';
  const hue = speaking ? '255,181,71' : state === 'hearing' ? '255,110,140' : '63,224,255';
  const energy = state === 'thinking' ? 0.45 + 0.25 * Math.sin(t * 6) : level;
  ctx.clearRect(0, 0, size, size);

  // glow
  const g = ctx.createRadialGradient(c, c, R * 0.1, c, c, R * 1.4);
  g.addColorStop(0, `rgba(${hue},${0.35 + energy * 0.5})`);
  g.addColorStop(0.45, `rgba(${hue},0.08)`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);

  ctx.lineCap = 'round';
  // segmented rotating rings
  const rings = [
    { r: 1.18, w: 2, segs: 60, speed: 0.15, gap: 0.5, a: 0.35 },
    { r: 1.05, w: 6, segs: 6, speed: -0.4, gap: 0.25, a: 0.8 },
    { r: 0.92, w: 2, segs: 120, speed: 0.08, gap: 0.6, a: 0.5 },
    { r: 0.80, w: 10, segs: 3, speed: 0.7, gap: 0.45, a: 0.5 },
  ];
  for (const ring of rings) {
    ctx.strokeStyle = `rgba(${hue},${ring.a})`;
    ctx.lineWidth = ring.w * dpr;
    const step = (Math.PI * 2) / ring.segs;
    const rot = t * ring.speed * (state === 'thinking' ? 4 : 1);
    for (let i = 0; i < ring.segs; i++) {
      ctx.beginPath();
      ctx.arc(c, c, R * ring.r, rot + i * step, rot + i * step + step * (1 - ring.gap));
      ctx.stroke();
    }
  }

  // audio waveform ring
  ctx.beginPath();
  const pts = 128;
  for (let i = 0; i <= pts; i++) {
    const a = (i / pts) * Math.PI * 2;
    const n = Math.sin(a * 6 + t * 3) * 0.5 + Math.sin(a * 11 - t * 5) * 0.3 + Math.sin(a * 17 + t * 7) * 0.2;
    const rr = R * (0.62 + n * 0.04 + n * energy * 0.22);
    const x = c + Math.cos(a) * rr, y = c + Math.sin(a) * rr;
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.strokeStyle = `rgba(${hue},0.95)`; ctx.lineWidth = 2 * dpr;
  ctx.shadowColor = `rgba(${hue},1)`; ctx.shadowBlur = 20 * dpr; ctx.stroke(); ctx.shadowBlur = 0;

  // core
  const coreR = R * (0.32 + energy * 0.08);
  const cg = ctx.createRadialGradient(c, c, 0, c, c, coreR);
  cg.addColorStop(0, 'rgba(255,255,255,0.95)');
  cg.addColorStop(0.35, `rgba(${hue},0.85)`);
  cg.addColorStop(1, `rgba(${hue},0)`);
  ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(c, c, coreR, 0, Math.PI * 2); ctx.fill();

  // triangle (Mk-style reactor)
  ctx.strokeStyle = `rgba(${hue},0.6)`; ctx.lineWidth = 1.5 * dpr; ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 3 - t * 0.2;
    const x = c + Math.cos(a) * R * 0.45, y = c + Math.sin(a) * R * 0.45;
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.closePath(); ctx.stroke();

  level *= 0.92;
  requestAnimationFrame(drawOrb);
}
requestAnimationFrame(drawOrb);

// ---------- speaking ----------
let audioCtx;
function analyserLoop(analyser) {
  const buf = new Uint8Array(analyser.fftSize);
  const step = () => {
    if (state !== 'speaking') return;
    analyser.getByteTimeDomainData(buf);
    let sum = 0; for (const v of buf) sum += ((v - 128) / 128) ** 2;
    level = Math.max(level, Math.min(1, Math.sqrt(sum / buf.length) * 4));
    requestAnimationFrame(step);
  };
  step();
}

async function speak(text) {
  $('caption').textContent = text;
  const res = await jarvis.tts(text);
  if (!res.ok || !res.audio) {
    if (!res.ok) addMsg('err', 'Voice: ' + res.error);
    return;
  }
  setState('speaking');
  audioCtx = audioCtx || new AudioContext();
  const url = URL.createObjectURL(new Blob([res.audio], { type: 'audio/mpeg' }));
  const audio = new Audio(url);
  currentAudio = audio;
  const src = audioCtx.createMediaElementSource(audio);
  const an = audioCtx.createAnalyser(); an.fftSize = 512;
  src.connect(an); an.connect(audioCtx.destination);
  await new Promise((resolve) => {
    audio.onended = audio.onerror = audio.onpause = resolve;
    audio.play().catch(resolve);
    analyserLoop(an);
  });
  currentAudio = null;
  URL.revokeObjectURL(url);
}
function stopSpeaking() { if (currentAudio) currentAudio.pause(); }

// ---------- conversation ----------
async function handle(text) {
  text = text.trim();
  if (!text || busy) return;
  busy = true;
  stopSpeaking();
  addMsg('user', text);
  $('caption').textContent = '“' + text + '”';
  setState('thinking');
  const res = await jarvis.chat(text);
  if (res.ok) { addMsg('jarvis', res.text); await speak(res.text); }
  else { addMsg('err', res.error); $('caption').textContent = 'Something went wrong, sir.'; }
  busy = false;
  setState(voiceOn ? 'listening' : 'muted');
}

jarvis.onEvent((ev) => {
  if (ev.type === 'tool') {
    const arg = Object.values(ev.args || {})[0];
    addActivity(`<b>${esc(ev.name.replace(/_/g, ' ').toUpperCase())}</b><br>${esc(String(arg ?? '').slice(0, 80))}`);
  } else if (ev.type === 'tool-result' && !ev.ok) {
    addActivity(`<b>${esc(ev.name.toUpperCase())}</b> failed`, true);
  }
});

// ---------- always-on voice input (VAD + ElevenLabs Scribe) ----------
const VAD = { threshold: 0.035, startMs: 120, silenceMs: 1100, minMs: 450, maxMs: 30000 };
let stream, recorder, chunks = [], speechStart = 0, lastVoice = 0, aboveSince = 0;

async function initMic() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (e) {
    addMsg('err', 'Microphone unavailable: ' + e.message + '. You can still type.');
    voiceOn = false; setState('muted'); return;
  }
  audioCtx = audioCtx || new AudioContext();
  const src = audioCtx.createMediaStreamSource(stream);
  const an = audioCtx.createAnalyser(); an.fftSize = 1024;
  src.connect(an);
  const buf = new Float32Array(an.fftSize);

  const loop = () => {
    requestAnimationFrame(loop);
    an.getFloatTimeDomainData(buf);
    let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    const now = performance.now();
    if (!voiceOn || busy || state === 'speaking') { if (recorder) cancelRecording(); aboveSince = 0; return; }
    if (state === 'listening' || state === 'hearing') level = Math.max(level, Math.min(1, rms * 8));

    if (rms > VAD.threshold) {
      lastVoice = now;
      if (!recorder) {
        if (!aboveSince) aboveSince = now;
        if (now - aboveSince > VAD.startMs) startRecording(now);
      }
    } else {
      aboveSince = 0;
    }
    if (recorder && (now - lastVoice > VAD.silenceMs || now - speechStart > VAD.maxMs)) finishRecording(now);
  };
  loop();
}

function startRecording(now) {
  chunks = [];
  speechStart = now;
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
  recorder = new MediaRecorder(stream, { mimeType: mime });
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.start(100);
  setState('hearing');
}
function cancelRecording() {
  recorder.ondataavailable = null; recorder.onstop = null;
  try { recorder.stop(); } catch { /* already stopped */ }
  recorder = null;
}
function finishRecording(now) {
  const rec = recorder; recorder = null;
  const dur = now - speechStart;
  rec.onstop = async () => {
    if (dur - VAD.silenceMs < VAD.minMs - VAD.startMs) { setState('listening'); return; }
    const blob = new Blob(chunks, { type: rec.mimeType });
    setState('thinking');
    busy = true;
    const res = await jarvis.stt(await blob.arrayBuffer(), rec.mimeType);
    busy = false;
    const text = res.ok ? res.text.replace(/^\(.*\)$/, '').trim() : '';
    if (!res.ok) addMsg('err', 'Hearing: ' + res.error);
    if (text.length > 1) handle(text); else setState('listening');
  };
  rec.stop();
}

// ---------- controls ----------
$('sendBtn').onclick = () => { handle($('textInput').value); $('textInput').value = ''; };
$('textInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('sendBtn').click(); });
$('micBtn').onclick = toggleVoice;
function toggleVoice() {
  voiceOn = !voiceOn;
  if (voiceOn && !stream) initMic();
  if (!busy && state !== 'speaking') setState(voiceOn ? 'listening' : 'muted');
  else $('micBtn').classList.toggle('on', voiceOn);
}
document.addEventListener('keydown', (e) => {
  if (document.activeElement === $('textInput') || e.metaKey || e.ctrlKey) return;
  if (e.key === 'm') toggleVoice();
  if (e.key === 'Escape') stopSpeaking();
});
orbCanvas.onclick = () => (state === 'speaking' ? stopSpeaking() : $('textInput').focus());

// settings
async function refreshSettings() {
  const s = await jarvis.getSettings();
  $('voiceLink').textContent = s.hasEleven ? 'ONLINE' : 'NO KEY'; $('voiceLink').className = s.hasEleven ? 'ok' : 'bad';
  $('aiLink').textContent = s.hasGemini ? 'ONLINE' : 'NO KEY'; $('aiLink').className = s.hasGemini ? 'ok' : 'bad';
  $('elevenState').textContent = s.hasEleven ? '● saved' : '';
  $('geminiState').textContent = s.hasGemini ? '● saved' : '';
  $('voiceId').value = s.voiceId; $('model').value = s.model;
  return s;
}
$('settingsBtn').onclick = () => { refreshSettings(); $('settings').classList.remove('hidden'); };
$('closeSettings').onclick = () => $('settings').classList.add('hidden');
$('clearChat').onclick = async () => { await jarvis.reset(); $('log').innerHTML = ''; $('settings').classList.add('hidden'); };
$('saveSettings').onclick = async () => {
  await jarvis.setSettings({ eleven: $('elevenKey').value, gemini: $('geminiKey').value, voiceId: $('voiceId').value, model: $('model').value, resetPermissions: $('resetPerms').checked });
  $('elevenKey').value = $('geminiKey').value = ''; $('resetPerms').checked = false;
  $('settings').classList.add('hidden');
  refreshSettings();
};

// ---------- boot ----------
(async () => {
  const s = await refreshSettings();
  if (!s.hasEleven || !s.hasGemini) $('settings').classList.remove('hidden');
  await initMic();
  const h = new Date().getHours();
  const greet = `Good ${h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'}, sir. All systems are online. How may I help?`;
  addMsg('jarvis', greet);
  busy = true;
  if (s.hasEleven) await speak(greet); else $('caption').textContent = greet;
  busy = false;
  setState(voiceOn ? 'listening' : 'muted');
})();
