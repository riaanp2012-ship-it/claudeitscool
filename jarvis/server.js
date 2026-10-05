// Web mode: serves JARVIS at http://localhost:3000 (no Electron needed).
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const core = require('./core');

const PORT = Number(process.env.PORT) || 3000;
const dir = path.join(os.homedir(), '.jarvis');
fs.mkdirSync(dir, { recursive: true });
core.init({ configFile: path.join(dir, 'config.json') });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const body = (req) => new Promise((resolve) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => resolve(Buffer.concat(c))); });
const json = (res, obj, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/chat') {
      const { text } = JSON.parse(await body(req));
      const events = [];
      try { json(res, { ok: true, text: await core.chat(text, (ev) => events.push(ev)), events }); }
      catch (err) { core.dropLastTurn(); json(res, { ok: false, error: err.message, events }); }
      return;
    }
    if (url.pathname === '/api/tts') {
      const { text } = JSON.parse(await body(req));
      try {
        const audio = await core.tts(text);
        if (!audio) return json(res, { ok: true, audio: null });
        res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); return res.end(audio);
      } catch (err) { return json(res, { ok: false, error: err.message }); }
    }
    if (url.pathname === '/api/stt') {
      const audio = await body(req);
      try { return json(res, { ok: true, text: await core.stt(audio, req.headers['content-type'] || 'audio/webm') }); }
      catch (err) { return json(res, { ok: false, error: err.message }); }
    }
    if (url.pathname === '/api/settings') {
      if (req.method === 'POST') return json(res, core.updateSettings(JSON.parse(await body(req))));
      return json(res, core.settingsView());
    }
    if (url.pathname === '/api/reset') { core.resetHistory(); return json(res, true); }

    const file = path.join(__dirname, 'src', url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(path.join(__dirname, 'src')) || !fs.existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (err) { json(res, { ok: false, error: err.message }, 500); }
});

// Bind to localhost only: this server can control the Mac.
server.listen(PORT, '127.0.0.1', () => {
  const link = `http://localhost:${PORT}`;
  console.info(`\n  J.A.R.V.I.S. online →  ${link}\n`);
  if (process.platform === 'darwin' && !process.env.NO_OPEN) execFile('open', [link]);
});
