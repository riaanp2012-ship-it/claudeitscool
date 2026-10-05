const { app, BrowserWindow, ipcMain, dialog, systemPreferences } = require('electron');
const path = require('path');
const core = require('./core');

const isMac = process.platform === 'darwin';
let win;

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
  core.init({
    configFile: path.join(app.getPath('userData'), 'config.json'),
    askFn: async (title, detail) => (await dialog.showMessageBox(win, {
      type: 'question', buttons: ['Allow once', 'Always allow', 'Deny'], defaultId: 0, cancelId: 2,
      title: 'JARVIS requests permission', message: title, detail,
    })).response,
  });
  if (isMac) { try { await systemPreferences.askForMediaAccess('microphone'); } catch { /* ignore */ } }

  ipcMain.handle('chat', async (e, text) => {
    try { return { ok: true, text: await core.chat(text, (ev) => e.sender.send('jarvis-event', ev)) }; }
    catch (err) { core.dropLastTurn(); return { ok: false, error: err.message }; }
  });
  ipcMain.handle('tts', async (_e, text) => {
    try { return { ok: true, audio: await core.tts(text) }; } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('stt', async (_e, audio, mime) => {
    try { return { ok: true, text: await core.stt(Buffer.from(audio), mime) }; } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('settings:get', () => core.settingsView());
  ipcMain.handle('settings:set', (_e, s) => core.updateSettings(s));
  ipcMain.handle('reset', () => { core.resetHistory(); return true; });

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (!isMac) app.quit(); });
