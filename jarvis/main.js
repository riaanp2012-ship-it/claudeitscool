const { app, BrowserWindow, ipcMain, dialog, shell, systemPreferences } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------- config ----------
const CONFIG_PATH = () => path.join(app.getPath('userData'), 'config.json');
const DEFAULTS = {
  ELEVENLABS_API_KEY: '',
  GEMINI_API_KEY: '',
  ELEVENLABS_VOICE_ID: 'onwK4e9ZLuTAKqWW03F9', // "Daniel" – British, calm
  GEMINI_MODEL: 'gemini-2.5-flash',
  allow: {}, // permission category -> true once user picked "Always allow"
};

function readEnvFile() {
  const p = path.join(__dirname, '.env');
  if (!fs.existsSync(p)) return {};
  const out = {};
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && m[2]) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

let config = { ...DEFAULTS };
function loadConfig() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(CONFIG_PATH(), 'utf8')); } catch { /* first run */ }
  config = { ...DEFAULTS, ...readEnvFile(), ...saved, allow: saved.allow || {} };
}
function saveConfig() {
  fs.mkdirSync(path.dirname(CONFIG_PATH()), { recursive: true });
  fs.writeFileSync(CONFIG_PATH(), JSON.stringify(config, null, 2));
}

// ---------- helpers ----------
function run(cmd, args, timeout = 20000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, output: (stdout || '').trim().slice(0, 4000), error: err ? (stderr || err.message).trim().slice(0, 2000) : undefined });
    });
  });
}
const osa = (script) => run('osascript', ['-e', script]);

let win;
async function askPermission(category, title, detail) {
  if (config.allow[category]) return true;
  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['Allow once', 'Always allow', 'Deny'],
    defaultId: 0,
    cancelId: 2,
    title: 'JARVIS requests permission',
    message: title,
    detail,
  });
  if (response === 1) { config.allow[category] = true; saveConfig(); }
  return response !== 2;
}

// ---------- tools ----------
const TOOLS = [
  { name: 'open_app', description: 'Open (launch or focus) a macOS application by name, e.g. "Safari", "Spotify", "Visual Studio Code".',
    parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'quit_app', description: 'Quit a running macOS application by name.',
    parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'google_search', description: 'Search Google in the default browser.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'open_url', description: 'Open a URL in the default browser (e.g. YouTube, websites).',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
  { name: 'read_webpage', description: 'Fetch a webpage and return its readable text so you can answer questions about it (news, docs, weather sites).',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
  { name: 'set_volume', description: 'Set the Mac output volume, 0-100.',
    parameters: { type: 'object', properties: { level: { type: 'number' } }, required: ['level'] } },
  { name: 'media_control', description: 'Control music playback in Spotify or Music.',
    parameters: { type: 'object', properties: { app: { type: 'string', enum: ['Spotify', 'Music'] }, action: { type: 'string', enum: ['play', 'pause', 'next track', 'previous track'] } }, required: ['app', 'action'] } },
  { name: 'system_status', description: 'Get time, battery, uptime, memory and CPU info about this Mac.',
    parameters: { type: 'object', properties: {} } },
  { name: 'notify', description: 'Show a macOS notification.',
    parameters: { type: 'object', properties: { title: { type: 'string' }, message: { type: 'string' } }, required: ['message'] } },
  { name: 'run_applescript', description: 'Run an AppleScript to control the Mac (windows, Finder, apps, keystrokes via System Events, dark mode, etc.). The user is asked for permission.',
    parameters: { type: 'object', properties: { script: { type: 'string' }, purpose: { type: 'string', description: 'Short human explanation shown in the permission dialog.' } }, required: ['script', 'purpose'] } },
  { name: 'run_shell', description: 'Run a zsh shell command on the Mac. The user is asked for permission. Avoid destructive commands.',
    parameters: { type: 'object', properties: { command: { type: 'string' }, purpose: { type: 'string' } }, required: ['command', 'purpose'] } },
];

const isMac = process.platform === 'darwin';
const macOnly = () => ({ ok: false, error: 'This action only works on macOS.' });
const quote = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

async function execTool(name, a) {
  switch (name) {
    case 'open_app':
      if (!isMac) return macOnly();
      if (!(await askPermission('apps', `Open "${a.name}"?`, 'JARVIS wants to launch an application.'))) return { ok: false, error: 'User denied.' };
      return run('open', ['-a', a.name]);
    case 'quit_app':
      if (!isMac) return macOnly();
      if (!(await askPermission('apps', `Quit "${a.name}"?`, 'JARVIS wants to quit an application.'))) return { ok: false, error: 'User denied.' };
      return osa(`tell application "${quote(a.name)}" to quit`);
    case 'google_search':
      await shell.openExternal('https://www.google.com/search?q=' + encodeURIComponent(a.query));
      return { ok: true };
    case 'open_url': {
      const url = /^https?:\/\//i.test(a.url) ? a.url : 'https://' + a.url;
      await shell.openExternal(url);
      return { ok: true };
    }
    case 'read_webpage': {
      try {
        const url = /^https?:\/\//i.test(a.url) ? a.url : 'https://' + a.url;
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 JARVIS' } });
        const html = await res.text();
        const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
        return { ok: true, text: text.slice(0, 12000) };
      } catch (e) { return { ok: false, error: e.message }; }
    }
    case 'set_volume':
      if (!isMac) return macOnly();
      return osa(`set volume output volume ${Math.max(0, Math.min(100, Math.round(a.level)))}`);
    case 'media_control':
      if (!isMac) return macOnly();
      return osa(`tell application "${a.app === 'Music' ? 'Music' : 'Spotify'}" to ${a.action}`);
    case 'system_status': {
      const info = {
        time: new Date().toString(),
        host: os.hostname(),
        uptimeHours: +(os.uptime() / 3600).toFixed(1),
        memoryFreeGB: +(os.freemem() / 1e9).toFixed(1),
        memoryTotalGB: +(os.totalmem() / 1e9).toFixed(1),
        cpu: os.cpus()[0]?.model,
        load: os.loadavg().map((n) => +n.toFixed(2)),
      };
      if (isMac) info.battery = (await run('pmset', ['-g', 'batt'])).output;
      return { ok: true, ...info };
    }
    case 'notify':
      if (!isMac) return macOnly();
      return osa(`display notification "${quote(a.message)}" with title "${quote(a.title || 'JARVIS')}"`);
    case 'run_applescript':
      if (!isMac) return macOnly();
      if (!(await askPermission('applescript', a.purpose || 'Run AppleScript', a.script))) return { ok: false, error: 'User denied.' };
      return osa(a.script);
    case 'run_shell':
      if (!(await askPermission('shell', a.purpose || 'Run shell command', a.command))) return { ok: false, error: 'User denied.' };
      return run('/bin/zsh', ['-lc', a.command], 60000);
    default:
      return { ok: false, error: 'Unknown tool ' + name };
  }
}

// ---------- brain (Gemini) ----------
const SYSTEM = `You are J.A.R.V.I.S., Tony Stark's AI — now serving the user on their Mac.
Personality: calm, witty, dry British humour, unfailingly competent. Address the user as "sir" (unless told otherwise).
Your replies are SPOKEN aloud, so keep them short (1-3 sentences), natural, no markdown, no lists, no emojis.
You can act on the Mac through tools: open/quit apps, search Google, open sites, read webpages, control volume and music,
check system status, send notifications, and run AppleScript or shell commands (the user approves those).
Prefer doing over explaining. When asked to do something, call the tool, then briefly confirm. If a tool fails, say so plainly.`;

let history = [];

async function gemini(contents) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.GEMINI_MODEL}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM + `\nCurrent date/time: ${new Date().toString()}.` }] },
      contents,
      tools: [{ functionDeclarations: TOOLS }],
      generationConfig: { temperature: 0.7 },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Gemini HTTP ${res.status}`);
  return data.candidates?.[0]?.content || { role: 'model', parts: [{ text: '' }] };
}

async function chat(text, onEvent) {
  if (!config.GEMINI_API_KEY) return 'I seem to be missing my AI key, sir. Please add it in settings.';
  history.push({ role: 'user', parts: [{ text }] });
  for (let round = 0; round < 8; round++) {
    const content = await gemini(history);
    history.push({ role: 'model', parts: content.parts || [] });
    const calls = (content.parts || []).filter((p) => p.functionCall);
    if (!calls.length) {
      history = history.slice(-40);
      return (content.parts || []).map((p) => p.text || '').join('').trim() || 'Done, sir.';
    }
    const responses = [];
    for (const { functionCall } of calls) {
      onEvent({ type: 'tool', name: functionCall.name, args: functionCall.args });
      const result = await execTool(functionCall.name, functionCall.args || {});
      onEvent({ type: 'tool-result', name: functionCall.name, ok: result.ok !== false });
      responses.push({ functionResponse: { name: functionCall.name, response: result } });
    }
    history.push({ role: 'user', parts: responses });
  }
  return 'That took more steps than I expected, sir. I stopped to be safe.';
}

// ---------- voice (ElevenLabs) ----------
async function tts(text) {
  if (!config.ELEVENLABS_API_KEY) return null;
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${config.ELEVENLABS_VOICE_ID}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': config.ELEVENLABS_API_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: 'eleven_turbo_v2_5', voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.2 } }),
  });
  if (!res.ok) throw new Error(`ElevenLabs TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

async function stt(audio, mime) {
  if (!config.ELEVENLABS_API_KEY) throw new Error('Missing ElevenLabs key');
  const form = new FormData();
  form.append('model_id', 'scribe_v1');
  form.append('file', new Blob([audio], { type: mime }), 'speech.webm');
  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST', headers: { 'xi-api-key': config.ELEVENLABS_API_KEY }, body: form,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail?.message || `ElevenLabs STT ${res.status}`);
  return (data.text || '').trim();
}

// ---------- app ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 800, minWidth: 820, minHeight: 600,
    backgroundColor: '#03070d',
    titleBarStyle: 'hiddenInset',
    vibrancy: 'under-window',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}

app.whenReady().then(async () => {
  loadConfig();
  if (isMac) { try { await systemPreferences.askForMediaAccess('microphone'); } catch { /* ignore */ } }

  ipcMain.handle('chat', async (e, text) => {
    try { return { ok: true, text: await chat(text, (ev) => e.sender.send('jarvis-event', ev)) }; }
    catch (err) { history.pop(); return { ok: false, error: err.message }; }
  });
  ipcMain.handle('tts', async (_e, text) => {
    try { return { ok: true, audio: await tts(text) }; } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('stt', async (_e, audio, mime) => {
    try { return { ok: true, text: await stt(Buffer.from(audio), mime) }; } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('settings:get', () => ({
    hasEleven: !!config.ELEVENLABS_API_KEY, hasGemini: !!config.GEMINI_API_KEY,
    voiceId: config.ELEVENLABS_VOICE_ID, model: config.GEMINI_MODEL, allow: config.allow, platform: process.platform,
  }));
  ipcMain.handle('settings:set', (_e, s) => {
    if (s.eleven) config.ELEVENLABS_API_KEY = s.eleven.trim();
    if (s.gemini) config.GEMINI_API_KEY = s.gemini.trim();
    if (s.voiceId) config.ELEVENLABS_VOICE_ID = s.voiceId.trim();
    if (s.model) config.GEMINI_MODEL = s.model.trim();
    if (s.resetPermissions) config.allow = {};
    saveConfig();
    return true;
  });
  ipcMain.handle('reset', () => { history = []; return true; });

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (!isMac) app.quit(); });
