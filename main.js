const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, screen } = require('electron');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { isIP } = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const os = require('node:os');
const execFileAsync = promisify(execFile);

let win;
const mirrorProcesses = new Map();
const mirrorRecordings = new Map();
const mirrorControlWindows = new Map();
const mirrorWindowTitles = new Map();
const mirrorWindowHandles = new Map();
const mirrorWindowAspects = new Map();
const mirrorWindowDimensions = new Map();
const mirrorAudioDestinations = new Map();
const mirrorReconnectTimers = new Map();
const mirrorReconnectAttempts = new Map();
const mirrorStates = new Map();
const mirrorStarting = new Set();
const mirrorCloseRequested = new Set();
const maxMirrorReconnectAttempts = 5;

function candidates(name) {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  const roots = [
    path.join(process.resourcesPath || '', 'platform-tools', exe),
    path.join(process.resourcesPath || '', 'tools', exe),
    path.join(__dirname, 'tools', exe),
    path.join(__dirname, 'platform-tools', exe)
  ];
  return roots.find(p => fs.existsSync(p)) || exe;
}

async function resolveTool(name) {
  const local = candidates(name);
  if (path.isAbsolute(local) && fs.existsSync(local)) return local;
  try {
    const finder = process.platform === 'win32' ? 'where.exe' : 'which';
    const { stdout } = await execFileAsync(finder, [name], { timeout: 3000, windowsHide: true });
    const first = stdout.split(/\r?\n/).map(s => s.trim()).find(Boolean);
    if (first) return first;
  } catch {}
  return null;
}

async function run(tool, args, timeout = 12000, maxBuffer = 2 * 1024 * 1024) {
  return execFileAsync(tool, args, { timeout, windowsHide: true, maxBuffer });
}

function validSerial(serial) { return typeof serial === 'string' && serial.length > 0 && serial.length < 256 && !/[\0\r\n]/.test(serial); }
function shellQuote(value) { return `'${value.replace(/'/g, "'\\''")}'`; }
function androidPath(value) {
  if (typeof value !== 'string' || value.length > 1024 || !value.startsWith('/') || /[\0\r\n]/.test(value)) return null;
  return value.replace(/\/+/g, '/') || '/';
}
function contentRows(stdout) { return stdout.split(/\r?\n/).filter(line => /^Row:\s*\d+\s/.test(line)); }
function parseMediaGallery(stdout) {
  const entries = [];
  for (const row of contentRows(stdout)) {
    const match = row.match(/^Row:\s*\d+\s+_data=(.*)$/);
    const filePath = match?.[1]?.trim();
    if (!filePath || filePath === 'null' || !filePath.startsWith('/') || /[\0\r\n]/.test(filePath)) continue;
    const name = filePath.slice(filePath.lastIndexOf('/') + 1);
    if (name) entries.push({ name, path: filePath, directory: false });
  }
  return entries;
}
function diskStatsArray(stdout, label) {
  const match = stdout.match(new RegExp(`^${label}:\\s*(\\[[^\\r\\n]*\\])\\s*$`, 'm'));
  if (!match) return null;
  const serialized = match[1];
  try {
    const value = JSON.parse(serialized);
    return Array.isArray(value) ? value : null;
  } catch {
    const values = serialized.slice(1, -1).trim();
    return values ? values.split(',').map(value => value.trim()) : [];
  }
}
function parseDiskStatsApps(stdout) {
  const packages = diskStatsArray(stdout, 'Package Names');
  const codeSizes = diskStatsArray(stdout, 'App Sizes');
  const dataSizes = diskStatsArray(stdout, 'App Data Sizes');
  const cacheSizes = diskStatsArray(stdout, 'Cache Sizes');
  if (!packages || !codeSizes || !dataSizes || !cacheSizes || packages.length !== codeSizes.length || packages.length !== dataSizes.length || packages.length !== cacheSizes.length) return null;
  return packages.map((packageName, index) => {
    const codeBytes = Number(codeSizes[index]);
    const dataBytes = Number(dataSizes[index]);
    const cacheBytes = Number(cacheSizes[index]);
    if (typeof packageName !== 'string' || ![codeBytes, dataBytes, cacheBytes].every(value => Number.isFinite(value) && value >= 0)) return null;
    return { packageName, codeBytes, dataBytes, cacheBytes, totalBytes: codeBytes + dataBytes + cacheBytes };
  }).filter(Boolean).sort((a, b) => b.totalBytes - a.totalBytes);
}
function parseMediaFileUsage(stdout) {
  const categories = { photos: 0, videos: 0, audio: 0, documents: 0, other: 0 };
  for (const row of contentRows(stdout)) {
    const size = Number((row.match(/\b_size=(\d+)/) || [])[1]);
    if (!Number.isFinite(size) || size <= 0) continue;
    const mime = ((row.match(/\bmime_type=([^,\r\n]*)/) || [])[1] || '').trim().toLowerCase();
    if (mime.startsWith('image/')) categories.photos += size;
    else if (mime.startsWith('video/')) categories.videos += size;
    else if (mime.startsWith('audio/')) categories.audio += size;
    else if (mime.startsWith('text/') || mime === 'application/pdf' || mime === 'application/rtf' || mime === 'application/msword' || mime === 'application/epub+zip' || mime.startsWith('application/vnd.openxmlformats-officedocument.') || mime.startsWith('application/vnd.oasis.opendocument.') || /^application\/vnd\.ms-(?:excel|word|powerpoint)/.test(mime)) categories.documents += size;
    else categories.other += size;
  }
  return categories;
}
function notificationExtra(record, name) {
  const marker = `${name}=`;
  const start = record.indexOf(marker);
  if (start < 0) return '';
  const value = record.slice(start + marker.length);
  const end = value.search(/,\s*android\.[\w.]+=|\r?\n\s*android\.[\w.]+=|\r?\n\s*\}|\}\]|\]\}/);
  const text = (end < 0 ? value : value.slice(0, end)).trim();
  const wrapped = text.match(/^String\s*\(([\s\S]*)\)$/);
  return (wrapped ? wrapped[1] : text).slice(0, 5000);
}
function parseActiveNotifications(stdout) {
  const starts = [...stdout.matchAll(/NotificationRecord\(/g)];
  return starts.map((match, index) => {
    const record = stdout.slice(match.index, starts[index + 1]?.index ?? stdout.length);
    const packageName = (record.match(/\bpkg=([A-Za-z0-9._-]+)/) || [])[1];
    if (!packageName) return null;
    const title = notificationExtra(record, 'android.title') || notificationExtra(record, 'android.titleBig');
    const text = notificationExtra(record, 'android.bigText') || notificationExtra(record, 'android.text') || notificationExtra(record, 'android.subText') || notificationExtra(record, 'android.summaryText');
    const rawTime = Number((record.match(/\bpostTime=(\d+)/) || [])[1]);
    const timestamp = Number.isFinite(rawTime) && rawTime > 0 ? rawTime : 0;
    const key = (record.match(/\bkey=([^\r\n,]+)/) || [])[1]?.trim();
    return { id: key || `${packageName}:${index}`, packageName, title, text, timestamp };
  }).filter(Boolean).sort((a, b) => b.timestamp - a.timestamp).slice(0, 100);
}

function parseIpEndpoint(value) {
  if (typeof value !== 'string') return null;
  const input = value.trim();
  let host; let portText;
  const ipv6 = input.match(/^\[([0-9a-fA-F:]+)\]:(\d{1,5})$/);
  const ipv4 = input.match(/^((?:\d{1,3}\.){3}\d{1,3}):(\d{1,5})$/);
  if (ipv6 && isIP(ipv6[1]) === 6) { host = `[${ipv6[1]}]`; portText = ipv6[2]; }
  else if (ipv4 && isIP(ipv4[1]) === 4) { host = ipv4[1]; portText = ipv4[2]; }
  else return null;
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { endpoint: `${host}:${port}`, host, port };
}

async function getDevices() {
  const adb = await resolveTool('adb');
  if (!adb) return { available: false, message: 'Android Platform Tools (ADB) were not found. Install them, add platform-tools to PATH, then refresh.', devices: [] };
  try {
    const { stdout } = await run(adb, ['devices', '-l']);
    const rows = stdout.split(/\r?\n/).slice(1).map(line => line.trim()).filter(Boolean);
    const devices = [];
    for (const row of rows) {
      const parts = row.split(/\s+/);
      if (parts.length < 2 || parts[1] !== 'device') continue;
      const serial = parts[0];
      const modelTag = (row.match(/\bmodel:([^\s]+)/) || [])[1];
      let model = modelTag ? modelTag.replace(/_/g, ' ') : serial;
      let android = 'Android device';
      try {
        const { stdout: prop } = await run(adb, ['-s', serial, 'shell', 'getprop', 'ro.product.model'], 5000);
        model = prop.trim() || model;
        const { stdout: version } = await run(adb, ['-s', serial, 'shell', 'getprop', 'ro.build.version.release'], 5000);
        if (version.trim()) android = `Android ${version.trim()}`;
      } catch {}
      let battery = null;
      try {
        const { stdout: dump } = await run(adb, ['-s', serial, 'shell', 'dumpsys', 'battery'], 5000);
        const level = (dump.match(/level:\s*(\d+)/) || [])[1];
        if (level) battery = Number(level);
      } catch {}
      const tablet = /tab|tablet|pad/i.test(model);
      devices.push({ serial, model, android, kind: tablet ? 'Tablet' : 'Phone', transport: /transport_id/.test(row) ? 'USB or Wi-Fi' : 'Connected', battery });
    }
    return { available: true, message: devices.length ? '' : 'No authorized Android devices found. Connect by USB, unlock the device, and allow USB debugging. For Wi-Fi, pair it in Android Wireless debugging first.', devices };
  } catch (error) {
    return { available: false, message: `ADB could not list devices: ${error.message}`, devices: [] };
  }
}

function sendToast(message) { if (win && !win.isDestroyed()) win.webContents.send('app:toast', message); }

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 960, minWidth: 920, minHeight: 680,
    icon: path.join(__dirname, 'assets', 'mobidesk.ico'),
    backgroundColor: '#f5f6f8',
    title: 'MobiDesk',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function openMirrorControlWindow(serial) {
  const existing = mirrorControlWindows.get(serial);
  if (existing && !existing.isDestroyed()) { existing.show(); existing.focus(); return existing; }
  const controlWindow = new BrowserWindow({
    width: 420, height: 720, minWidth: 300, minHeight: 334,
    frame: false, transparent: true, hasShadow: false, title: 'MobiDesk Mirror', icon: path.join(__dirname, 'assets', 'mobidesk.ico'), backgroundColor: '#00000000', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  mirrorControlWindows.set(serial, controlWindow);
  controlWindow.webContents.on('did-finish-load', () => {
    const state = mirrorStates.get(serial);
    if (state && !controlWindow.isDestroyed()) controlWindow.webContents.send('device:mirror-state', state);
  });
  controlWindow.on('closed', () => {
    if (mirrorControlWindows.get(serial) === controlWindow) mirrorControlWindows.delete(serial);
    mirrorCloseRequested.add(serial);
    clearTimeout(mirrorReconnectTimers.get(serial));
    mirrorReconnectTimers.delete(serial);
    const mirror = mirrorProcesses.get(serial);
    if (mirror) { mirrorProcesses.delete(serial); mirror.kill(); }
    mirrorReconnectAttempts.delete(serial);
    mirrorStates.delete(serial);
    mirrorWindowTitles.delete(serial);
    mirrorWindowHandles.delete(serial);
    mirrorWindowAspects.delete(serial);
    mirrorWindowDimensions.delete(serial);
    mirrorAudioDestinations.delete(serial);
  });
  controlWindow.loadFile(path.join(__dirname, 'renderer', 'mirror-controls.html'), { query: { serial } });
  return controlWindow;
}

function sendMirrorState(serial, state) {
  const updatedState = { ...state, audioDestination: mirrorAudioDestinations.get(serial) || 'pc' };
  mirrorStates.set(serial, updatedState);
  const controlWindow = mirrorControlWindows.get(serial);
  if (controlWindow && !controlWindow.isDestroyed()) controlWindow.webContents.send('device:mirror-state', updatedState);
}

function clearMirrorReconnectTimer(serial) {
  const timer = mirrorReconnectTimers.get(serial);
  if (timer) clearTimeout(timer);
  mirrorReconnectTimers.delete(serial);
}

function scheduleMirrorReconnect(serial, code, signal) {
  if (mirrorCloseRequested.has(serial) || !mirrorControlWindows.has(serial)) return;
  const attempt = (mirrorReconnectAttempts.get(serial) || 0) + 1;
  const reason = code === 0 ? 'scrcpy closed.' : `scrcpy stopped (${signal || `exit code ${code}`}).`;
  if (attempt > maxMirrorReconnectAttempts) {
    sendMirrorState(serial, { state: 'disconnected', message: `${reason} Automatic reconnect stopped. Click the app control to retry.` });
    return;
  }
  mirrorReconnectAttempts.set(serial, attempt);
  const delay = Math.min(1000 * (2 ** (attempt - 1)), 15000);
  sendMirrorState(serial, { state: 'reconnecting', attempt, maxAttempts: maxMirrorReconnectAttempts, delay, message: `${reason} Reconnecting (${attempt}/${maxMirrorReconnectAttempts})…` });
  const timer = setTimeout(async () => {
    mirrorReconnectTimers.delete(serial);
    if (mirrorCloseRequested.has(serial) || !mirrorControlWindows.has(serial)) return;
    const result = await startMirrorProcess(serial);
    if (!result.ok) sendMirrorState(serial, { state: 'disconnected', message: result.message || 'Could not restart scrcpy. Click the app control to retry.' });
  }, delay);
  mirrorReconnectTimers.set(serial, timer);
}

async function startMirrorProcess(serial) {
  if (mirrorProcesses.has(serial) || mirrorStarting.has(serial)) return { ok: true, alreadyRunning: true };
  if (mirrorCloseRequested.has(serial) || !mirrorControlWindows.has(serial)) return { ok: false, message: 'The mirror window is closed.' };
  mirrorStarting.add(serial);
  try {
    const scrcpy = await resolveTool('scrcpy');
    if (!scrcpy) {
      const message = 'scrcpy was not found. Install scrcpy and add it to PATH, then try again.';
      sendMirrorState(serial, { state: 'disconnected', message });
      return { ok: false, message };
    }
    if (mirrorCloseRequested.has(serial) || !mirrorControlWindows.has(serial)) return { ok: false, message: 'The mirror window is closed.' };
    const title = `MobiDesk Mirror - ${serial} - ${Date.now()}`;
    mirrorWindowTitles.set(serial, { title });
    // Keep scrcpy off-screen until the native-window helper embeds it in the mirror.
    const args = ['--serial', serial, '--window-title', title, '--window-x=-32000', '--window-y=-32000', '--no-window-aspect-ratio-lock', '--render-fit=letterbox', '--keyboard=uhid', '--push-target=/sdcard/Download'];
    if (mirrorAudioDestinations.get(serial) === 'phone') args.push('--no-audio');
    const child = spawn(scrcpy, args, { windowsHide: true, stdio: 'ignore' });
    mirrorProcesses.set(serial, child);
    child.once('exit', (code, signal) => {
      if (mirrorProcesses.get(serial) !== child) return;
      mirrorProcesses.delete(serial);
      mirrorWindowHandles.delete(serial);
      mirrorWindowAspects.delete(serial);
      mirrorWindowDimensions.delete(serial);
      scheduleMirrorReconnect(serial, code, signal);
    });
    child.once('error', error => {
      if (mirrorProcesses.get(serial) !== child) return;
      mirrorProcesses.delete(serial);
      mirrorWindowHandles.delete(serial);
      mirrorWindowAspects.delete(serial);
      mirrorWindowDimensions.delete(serial);
      sendMirrorState(serial, { state: 'disconnected', message: `Could not start scrcpy: ${error.message}` });
    });
    sendMirrorState(serial, { state: 'starting', message: 'Starting scrcpy…' });
    return { ok: true };
  } catch (error) {
    const message = `Could not start scrcpy: ${error.message}`;
    sendMirrorState(serial, { state: 'disconnected', message });
    return { ok: false, message };
  } finally {
    mirrorStarting.delete(serial);
  }
}

ipcMain.handle('devices:list', getDevices);
ipcMain.handle('device:wifi-discover', async () => {
  const adb = await resolveTool('adb');
  if (!adb) return { ok: false, message: 'ADB is unavailable. Reinstall the MobiDesk bundle.', devices: [] };
  try {
    const { stdout } = await run(adb, ['mdns', 'services'], 10000);
    const devices = [];
    for (const line of stdout.split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/).filter(Boolean);
      const serviceIndex = parts.findIndex(part => /_adb-tls-(pairing|connect)\._tcp\.?$/.test(part));
      if (serviceIndex < 1) continue;
      const endpoint = parseIpEndpoint(parts[serviceIndex + 1] || parts[parts.length - 1]);
      if (!endpoint) continue;
      const type = /pairing/.test(parts[serviceIndex]) ? 'pair' : 'connect';
      const instance = parts.slice(0, serviceIndex).join(' ').replace(/\.$/, '');
      devices.push({ id: `${type}:${endpoint.endpoint}`, type, endpoint: endpoint.endpoint, name: instance || 'Android device' });
    }
    const unique = [...new Map(devices.map(device => [device.id, device])).values()];
    return { ok: true, devices: unique, message: unique.length ? '' : 'No Android devices found. Keep Wireless debugging open; for pairing, leave “Pair device with pairing code” open, then scan again.' };
  } catch (error) {
    return { ok: false, message: error.stdout?.trim() || error.message, devices: [] };
  }
});
ipcMain.handle('device:wifi-pair', async (_event, address, code) => {
  const endpoint = parseIpEndpoint(address);
  if (!endpoint) return { ok: false, message: 'Enter the pairing IP address and port shown on your phone.' };
  if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) return { ok: false, message: 'Enter the six-digit pairing code shown on your phone.' };
  const adb = await resolveTool('adb');
  if (!adb) return { ok: false, message: 'ADB is unavailable. Reinstall the MobiDesk bundle.' };
  try {
    const { stdout, stderr } = await run(adb, ['pair', endpoint.endpoint, code.trim()], 30000);
    const output = `${stdout}\n${stderr}`.trim();
    if (/failed|error/i.test(output)) return { ok: false, message: output || 'ADB pairing failed. Check the address, port, and pairing code.' };
    return { ok: true, message: output || 'Phone paired. Now enter its Wireless debugging connection port.' , host: endpoint.host };
  } catch (error) {
    return { ok: false, message: error.stderr?.trim() || error.stdout?.trim() || error.message };
  }
});
ipcMain.handle('device:wifi-connect', async (_event, address) => {
  const endpoint = parseIpEndpoint(address);
  if (!endpoint) return { ok: false, message: 'Enter the phone IP address and connection port shown on its Wireless debugging screen.' };
  const adb = await resolveTool('adb');
  if (!adb) return { ok: false, message: 'ADB is unavailable. Reinstall the MobiDesk bundle.' };
  try {
    const { stdout, stderr } = await run(adb, ['connect', endpoint.endpoint], 15000);
    const output = `${stdout}\n${stderr}`.trim();
    if (/failed to connect|unable to connect|error:/i.test(output)) return { ok: false, message: output };
    return { ok: true, message: output || `Connected to ${endpoint.endpoint}.` };
  } catch (error) {
    return { ok: false, message: error.stderr?.trim() || error.stdout?.trim() || error.message };
  }
});
ipcMain.handle('tools:status', async () => {
  const [adb, scrcpy] = await Promise.all([resolveTool('adb'), resolveTool('scrcpy')]);
  return { adb: Boolean(adb), scrcpy: Boolean(scrcpy), adbPath: adb, scrcpyPath: scrcpy };
});
ipcMain.handle('device:mirror', async (_event, serial) => {
  if (typeof serial !== 'string' || !serial.trim()) return { ok: false, message: 'Choose a connected device first.' };
  if (mirrorProcesses.has(serial) || mirrorStarting.has(serial)) {
    openMirrorControlWindow(serial);
    return { ok: true, alreadyRunning: true };
  }
  mirrorCloseRequested.delete(serial);
  clearMirrorReconnectTimer(serial);
  mirrorReconnectAttempts.delete(serial);
  openMirrorControlWindow(serial);
  sendMirrorState(serial, { state: 'starting', message: 'Starting scrcpy…' });
  return startMirrorProcess(serial);
});
ipcMain.handle('device:mirror-action', async (_event, serial, action) => {
  if (!validSerial(serial)) return { ok: false, message: 'Choose a connected device first.' };
  const dialogWindow = BrowserWindow.fromWebContents(_event.sender) || win;
  const allowed = new Set(['back', 'home', 'recents', 'volume-up', 'volume-down', 'power', 'vibrate', 'screenshot', 'record-start', 'record-stop', 'keyboard-toggle', 'audio-toggle', 'minimize', 'close', 'reconnect']);
  if (!allowed.has(action)) return { ok: false, message: 'Unknown mirror action.' };
  if (action === 'close') {
    mirrorCloseRequested.add(serial);
    clearMirrorReconnectTimer(serial);
    const mirror = mirrorProcesses.get(serial);
    if (mirror) { mirrorProcesses.delete(serial); mirror.kill(); }
    const controls = mirrorControlWindows.get(serial); if (controls && !controls.isDestroyed()) controls.close();
    mirrorControlWindows.delete(serial); mirrorWindowTitles.delete(serial); mirrorWindowHandles.delete(serial); mirrorWindowAspects.delete(serial); mirrorWindowDimensions.delete(serial);
    mirrorAudioDestinations.delete(serial); mirrorReconnectAttempts.delete(serial); mirrorStates.delete(serial);
    return { ok: true, message: mirror ? 'Mirror window closed.' : 'Mirror window is already closed.' };
  }
  if (action === 'minimize') {
    const mirrorWindow = mirrorControlWindows.get(serial);
    if (!mirrorWindow || mirrorWindow.isDestroyed()) return { ok: false, message: 'Start the mirror before minimizing it.' };
    mirrorWindow.minimize();
    return { ok: true, message: 'Mirror window minimized.' };
  }
  if (action === 'reconnect') {
    const host = BrowserWindow.fromWebContents(_event.sender);
    if (!host || host.isDestroyed() || mirrorControlWindows.get(serial) !== host) return { ok: false, message: 'The mirror control window is not available.' };
    mirrorCloseRequested.delete(serial);
    clearMirrorReconnectTimer(serial);
    mirrorReconnectAttempts.delete(serial);
    const mirror = mirrorProcesses.get(serial);
    if (mirror) { mirrorProcesses.delete(serial); mirror.kill(); }
    mirrorWindowHandles.delete(serial); mirrorWindowAspects.delete(serial); mirrorWindowDimensions.delete(serial);
    sendMirrorState(serial, { state: 'starting', message: 'Reconnecting to scrcpy…' });
    return startMirrorProcess(serial);
  }
  if (action === 'audio-toggle') {
    const host = BrowserWindow.fromWebContents(_event.sender);
    if (!host || host.isDestroyed() || mirrorControlWindows.get(serial) !== host) return { ok: false, message: 'The mirror control window is not available.' };
    const currentDestination = mirrorAudioDestinations.get(serial) || 'pc';
    const audioDestination = currentDestination === 'pc' ? 'phone' : 'pc';
    if (mirrorStarting.has(serial)) return { ok: false, audioDestination: currentDestination, message: 'Wait for scrcpy to connect before changing audio output.' };
    if (mirrorRecordings.has(serial)) return { ok: false, audioDestination: currentDestination, message: 'Stop video capture before changing audio output.' };
    mirrorAudioDestinations.set(serial, audioDestination);
    clearMirrorReconnectTimer(serial);
    mirrorReconnectAttempts.delete(serial);
    const mirror = mirrorProcesses.get(serial);
    if (mirror) { mirrorProcesses.delete(serial); mirror.kill(); }
    mirrorWindowHandles.delete(serial); mirrorWindowAspects.delete(serial); mirrorWindowDimensions.delete(serial);
    const message = `Switching audio to ${audioDestination === 'pc' ? 'your PC' : 'your phone'}…`;
    sendMirrorState(serial, { state: 'starting', message });
    const result = await startMirrorProcess(serial);
    return { ...result, audioDestination, message: result.ok ? message : result.message };
  }
  const adb = await resolveTool('adb');
  if (!adb) return { ok: false, message: 'ADB is unavailable.' };
  if (action === 'keyboard-toggle') {
    try {
      const { stdout } = await run(adb, ['-s', serial, 'shell', 'settings', 'get', 'secure', 'show_ime_with_hard_keyboard']);
      const visible = stdout.trim() !== '1';
      await run(adb, ['-s', serial, 'shell', 'settings', 'put', 'secure', 'show_ime_with_hard_keyboard', visible ? '1' : '0']);
      return { ok: true, visible, message: `On-screen keyboard ${visible ? 'enabled' : 'hidden'} for PC keyboard input.` };
    } catch (error) { return { ok: false, message: error.stderr?.trim() || error.message }; }
  }
  if (['back', 'home', 'recents', 'volume-up', 'volume-down', 'power'].includes(action)) {
    const keycode = { back: '4', home: '3', recents: '187', 'volume-up': '24', 'volume-down': '25', power: '26' }[action];
    const label = { back: 'Back', home: 'Home', recents: 'Recent apps', 'volume-up': 'Volume up', 'volume-down': 'Volume down', power: 'Power' }[action];
    try { await run(adb, ['-s', serial, 'shell', 'input', 'keyevent', keycode]); return { ok: true, message: action === 'recents' ? 'Recent apps opened on the phone.' : `${label} sent to the phone.` }; }
    catch (error) { return { ok: false, message: error.stderr?.trim() || error.message }; }
  }
  if (action === 'vibrate') {
    try {
      try { await run(adb, ['-s', serial, 'shell', 'cmd', 'vibrator', 'vibrate', '180', 'MobiDesk']); }
      catch { await run(adb, ['-s', serial, 'shell', 'cmd', 'vibrator_manager', 'vibrate', '180', 'MobiDesk']); }
      return { ok: true, message: 'Phone vibrated.' };
    } catch (error) { return { ok: false, message: error.stderr?.trim() || 'This Android version does not allow vibration through ADB.' }; }
  }
  if (action === 'screenshot') {
    try {
      const { stdout } = await execFileAsync(adb, ['-s', serial, 'exec-out', 'screencap', '-p'], { encoding: 'buffer', timeout: 30000, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
      const { canceled, filePath } = await dialog.showSaveDialog(dialogWindow, { title: 'Save phone screenshot', defaultPath: `MobiDesk-Screenshot-${Date.now()}.png`, filters: [{ name: 'PNG image', extensions: ['png'] }] });
      if (canceled || !filePath) return { ok: false, canceled: true };
      await fsPromises.writeFile(filePath, stdout);
      return { ok: true, message: 'Screenshot saved.', dataUrl: `data:image/png;base64,${stdout.toString('base64')}` };
    } catch (error) { return { ok: false, message: error.stderr?.trim() || error.message }; }
  }
  if (action === 'record-start') {
    if (mirrorRecordings.has(serial)) return { ok: false, message: 'Video capture is already running.' };
    const remotePath = `/sdcard/Movies/MobiDesk-Capture-${Date.now()}.mp4`;
    try {
      await run(adb, ['-s', serial, 'shell', 'mkdir', '-p', '/sdcard/Movies']);
      const child = spawn(adb, ['-s', serial, 'shell', 'screenrecord', '--time-limit', '180', remotePath], { windowsHide: true, stdio: 'ignore' });
      const recording = { child, remotePath };
      mirrorRecordings.set(serial, recording);
      child.on('exit', () => { if (mirrorRecordings.get(serial) === recording) mirrorRecordings.delete(serial); });
      child.on('error', () => mirrorRecordings.delete(serial));
      return { ok: true, message: 'Video capture started. Android screen recording is limited to 3 minutes per clip.' };
    } catch (error) { mirrorRecordings.delete(serial); return { ok: false, message: error.stderr?.trim() || error.message }; }
  }
  if (action === 'record-stop') {
    const recording = mirrorRecordings.get(serial);
    if (!recording) return { ok: false, message: 'There is no video capture running.' };
    try { await run(adb, ['-s', serial, 'shell', 'pkill', '-INT', 'screenrecord'], 10000); }
    catch {
      try {
        const { stdout } = await run(adb, ['-s', serial, 'shell', 'pidof', 'screenrecord'], 10000);
        for (const pid of stdout.trim().split(/\s+/).filter(value => /^\d+$/.test(value))) await run(adb, ['-s', serial, 'shell', 'kill', '-2', pid], 10000);
      } catch {}
    }
    await new Promise(resolve => setTimeout(resolve, 900));
    recording.child.kill(); mirrorRecordings.delete(serial);
    const { canceled, filePath } = await dialog.showSaveDialog(dialogWindow, { title: 'Save phone video capture', defaultPath: path.basename(recording.remotePath), filters: [{ name: 'MP4 video', extensions: ['mp4'] }] });
    if (canceled || !filePath) return { ok: false, canceled: true };
    try {
      await run(adb, ['-s', serial, 'pull', recording.remotePath, filePath], 180000);
      await run(adb, ['-s', serial, 'shell', 'rm', '-f', recording.remotePath]).catch(() => {});
      return { ok: true, message: 'Video capture saved.' };
    } catch (error) { return { ok: false, message: error.stderr?.trim() || 'Could not copy the recording from Android.' }; }
  }
  return { ok: false, message: 'Mirror action failed.' };
});
ipcMain.handle('device:keyboard-state', async (_event, serial) => {
  if (!validSerial(serial)) return { ok: false, message: 'Choose a connected device first.' };
  const adb = await resolveTool('adb');
  if (!adb) return { ok: false, message: 'ADB is unavailable.' };
  try {
    const { stdout } = await run(adb, ['-s', serial, 'shell', 'settings', 'get', 'secure', 'show_ime_with_hard_keyboard']);
    return { ok: true, visible: stdout.trim() === '1' };
  } catch (error) { return { ok: false, message: error.stderr?.trim() || error.message }; }
});
ipcMain.handle('device:keyboard-type', async (event, serial, text) => {
  const host = BrowserWindow.fromWebContents(event.sender);
  if (!validSerial(serial) || !host || host.isDestroyed() || mirrorControlWindows.get(serial) !== host || !mirrorProcesses.has(serial)) {
    return { ok: false, message: 'The mirror is not ready for keyboard input.' };
  }
  if (typeof text !== 'string' || !text.length || text.length > 256 || /[\0-\x1f\x7f]/.test(text)) return { ok: false, message: 'Keyboard text is invalid or too long.' };
  const adb = await resolveTool('adb');
  if (!adb) return { ok: false, message: 'ADB is unavailable.' };
  try {
    for (const part of text.split(/(%s)/g)) {
      if (!part) continue;
      if (part === '%s') {
        await run(adb, ['-s', serial, 'shell', `input text ${shellQuote('%')}`]);
        await run(adb, ['-s', serial, 'shell', `input text ${shellQuote('s')}`]);
      } else {
        await run(adb, ['-s', serial, 'shell', `input text ${shellQuote(part.replace(/ /g, '%s'))}`]);
      }
    }
    return { ok: true };
  } catch (error) { return { ok: false, message: error.stderr?.trim() || error.message }; }
});
ipcMain.handle('device:keyboard-key', async (event, serial, key) => {
  const host = BrowserWindow.fromWebContents(event.sender);
  if (!validSerial(serial) || !host || host.isDestroyed() || mirrorControlWindows.get(serial) !== host || !mirrorProcesses.has(serial)) {
    return { ok: false, message: 'The mirror is not ready for keyboard input.' };
  }
  const keycodes = { Backspace: '67', Delete: '112', Enter: '66', Tab: '61', Escape: '111', ArrowUp: '19', ArrowDown: '20', ArrowLeft: '21', ArrowRight: '22', Home: '122', End: '123', PageUp: '92', PageDown: '93' };
  if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(keycodes, key)) return { ok: false, message: 'Unsupported keyboard key.' };
  const adb = await resolveTool('adb');
  if (!adb) return { ok: false, message: 'ADB is unavailable.' };
  try {
    await run(adb, ['-s', serial, 'shell', 'input', 'keyevent', keycodes[key]]);
    return { ok: true };
  } catch (error) { return { ok: false, message: error.stderr?.trim() || error.message }; }
});
ipcMain.handle('device:mirror-embed', async (event, serial, bounds) => {
  if (process.platform !== 'win32') return { ok: false, waiting: false, message: 'Embedded scrcpy is currently supported on Windows.' };
  const host = BrowserWindow.fromWebContents(event.sender);
  const mirrorHost = mirrorControlWindows.get(serial);
  const title = mirrorWindowTitles.get(serial)?.title;
  if (!validSerial(serial) || !host || host.isDestroyed() || mirrorHost !== host) return { ok: false, waiting: false, message: 'The scrcpy mirror is not running.' };
  if (!title || (!mirrorProcesses.has(serial) && !mirrorStarting.has(serial))) return { ok: false, waiting: true, message: 'Waiting for scrcpy to reconnect…' };
  if (!bounds || !['x','y','width','height'].every(key => Number.isFinite(bounds[key])) || bounds.width < 100 || bounds.height < 100 || bounds.width > 12000 || bounds.height > 12000) return { ok: false, waiting: false, message: 'Invalid mirror frame size.' };
  const native = host.getNativeWindowHandle();
  let parentHandle = 0n;
  for (let i = 0; i < native.length; i++) parentHandle |= BigInt(native[i]) << BigInt(i * 8);
  const helper = path.join(__dirname, 'tools', 'embed-scrcpy-window.ps1');
  const mirrorProcess = mirrorProcesses.get(serial);
  if (!mirrorProcess?.pid) return { ok: false, waiting: true, message: 'Waiting for scrcpy to start…' };
  const childHandle = mirrorWindowHandles.get(serial);
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-WindowTitle', title, '-ScrcpyProcessId', String(mirrorProcess.pid), '-ParentHandle', parentHandle.toString(16), '-X', String(Math.round(bounds.x)), '-Y', String(Math.round(bounds.y)), '-Width', String(Math.round(bounds.width)), '-Height', String(Math.round(bounds.height))];
  if (childHandle) args.push('-ChildHandle', childHandle);
  const savedAspect = mirrorWindowAspects.get(serial);
  if (savedAspect) args.push('-AspectRatio', String(savedAspect));
  const savedDimensions = mirrorWindowDimensions.get(serial);
  if (savedDimensions) args.push('-SourceWidth', String(savedDimensions.width), '-SourceHeight', String(savedDimensions.height));
  try {
    const { stdout } = await execFileAsync('powershell.exe', args, { timeout: 12000, windowsHide: true });
    const attachedHandle = stdout.match(/MOBIDESK_HWND=([0-9a-f]+)/i)?.[1];
    const aspect = Number(stdout.match(/MOBIDESK_ASPECT=([0-9.]+)/i)?.[1]);
    const sourceWidth = Number(stdout.match(/MOBIDESK_WIDTH=(\d+)/i)?.[1]);
    const sourceHeight = Number(stdout.match(/MOBIDESK_HEIGHT=(\d+)/i)?.[1]);
    if (attachedHandle) mirrorWindowHandles.set(serial, attachedHandle);
    if (!savedAspect && Number.isFinite(aspect) && aspect > 0.2 && aspect < 4) mirrorWindowAspects.set(serial, aspect);
    if (!savedDimensions && Number.isInteger(sourceWidth) && sourceWidth > 0 && sourceWidth <= 12000 && Number.isInteger(sourceHeight) && sourceHeight > 0 && sourceHeight <= 12000) {
      mirrorWindowDimensions.set(serial, { width: sourceWidth, height: sourceHeight });
    }
    if (mirrorStates.get(serial)?.state !== 'connected') {
      mirrorReconnectAttempts.delete(serial);
      sendMirrorState(serial, { state: 'connected', message: 'Mirror connected.' });
    }
    return { ok: true, waiting: false, aspect: mirrorWindowAspects.get(serial) || 9 / 19 };
  } catch (error) {
    const code = Number(error.code);
    if (code === 3) return { ok: false, waiting: true, message: 'Waiting for the scrcpy screen window…' };
    if (error.code === 'ETIMEDOUT' || error.killed) return { ok: false, waiting: true, message: 'Windows is taking longer to attach the mirror. Retrying…' };
    const details = [error.stderr, error.stdout, error.message].filter(Boolean).join('\n').trim();
    return { ok: false, waiting: false, message: details || 'Could not attach the scrcpy screen to its MobiDesk window.' };
  }
});
ipcMain.handle('device:mirror-fit-window', async (event, serial, aspect) => {
  const host = BrowserWindow.fromWebContents(event.sender);
  if (!validSerial(serial) || !host || host.isDestroyed() || mirrorControlWindows.get(serial) !== host || !Number.isFinite(aspect) || aspect < 0.2 || aspect > 4) return { ok: false };
  const display = screen.getDisplayMatching(host.getBounds());
  const workArea = display.workAreaSize;
  const sourceDimensions = mirrorWindowDimensions.get(serial);
  let width;
  let height;
  if (sourceDimensions) {
    const scaleFactor = display.scaleFactor || 1;
    const sourceWidth = sourceDimensions.width / scaleFactor;
    const sourceHeight = sourceDimensions.height / scaleFactor;
    const scale = Math.min(1, workArea.width / sourceWidth, workArea.height / sourceHeight);
    width = Math.floor(sourceWidth * scale);
    height = Math.floor(sourceHeight * scale);
  } else {
    const horizontalChrome = 91;
    const verticalChrome = 10;
    const preferredHeight = host.getContentSize()[1] - verticalChrome;
    const screenHeight = Math.max(334, Math.min(620, workArea.height - verticalChrome, preferredHeight > 334 ? preferredHeight : 620, (workArea.width - horizontalChrome) / aspect));
    width = Math.max(300, Math.ceil(screenHeight * aspect + horizontalChrome));
    height = Math.ceil(screenHeight + verticalChrome);
  }
  width = Math.max(300, width);
  height = Math.max(334, height);
  host.setMinimumSize(Math.min(width, 300), 334);
  host.setMaximumSize(workArea.width, workArea.height);
  host.setAspectRatio(width / height);
  host.setContentSize(width, height);
  return { ok: true, width, height };
});
ipcMain.handle('device:foreground-app', async (_event, serial) => {
  if (!validSerial(serial)) return { ok: false, message: 'Choose a connected device first.' };
  const adb = await resolveTool('adb');
  if (!adb) return { ok: false, message: 'ADB is unavailable.' };
  try {
    let aspect;
    try {
      const { stdout } = await run(adb, ['-s', serial, 'shell', 'dumpsys', 'window', 'displays'], 5000);
      const dimensions = stdout.match(/\bcur=(\d+)x(\d+)\b/i)
        || stdout.match(/\bapp(?:=|\s+)(\d+)\s*x\s*(\d+)\b/i)
        || stdout.match(/\bDisplayFrames\s+w=(\d+)\s+h=(\d+)\b/i);
      if (dimensions) {
        const width = Number(dimensions[1]), height = Number(dimensions[2]);
        if (width > 0 && height > 0) aspect = width / height;
      }
    } catch {}
    let output = '';
    try { output = (await run(adb, ['-s', serial, 'shell', 'dumpsys', 'activity', 'activities'], 8000)).stdout; } catch {}
    let match = output.match(/\b(?:topResumedActivity|mResumedActivity|mFocusedActivity|ResumedActivity)\b[^\r\n]*?([A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+)/);
    if (!match) {
      try { output = (await run(adb, ['-s', serial, 'shell', 'dumpsys', 'window', 'windows'], 8000)).stdout; } catch {}
      match = output.match(/\bmCurrentFocus\b[^\r\n]*?([A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+)/);
    }
    if (!match) return { ok: true, packageName: '', activity: '', label: 'No active app detected', aspect };
    const [packageName, activity] = match[1].split('/', 2);
    return { ok: true, packageName, activity, label: packageName, aspect };
  } catch (error) { return { ok: false, message: error.stderr?.trim() || error.message }; }
});
ipcMain.handle('device:files', async (event, serial) => {
  if (!validSerial(serial)) return { ok: false, message: 'Choose a connected device first.' };
  const adb = await resolveTool('adb');
  if (!adb) return { ok: false, message: 'ADB is unavailable.' };
  const dialogWindow = BrowserWindow.fromWebContents(event.sender) || win;
  const choice = await dialog.showMessageBox(dialogWindow, {
    type: 'question',
    message: 'What would you like to import?',
    detail: 'Choose files or a folder to copy to Android.',
    buttons: ['Choose files', 'Choose folder', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  });
  if (choice.response === 2) return { ok: false, canceled: true };
  const isFolder = choice.response === 1;
  const { canceled, filePaths } = await dialog.showOpenDialog(dialogWindow, {
    title: isFolder ? 'Choose folders to copy to Android' : 'Choose files to copy to Android',
    properties: isFolder ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections']
  });
  if (canceled || !filePaths.length) return { ok: false, canceled: true };
  const sendProgress = update => {
    if (!event.sender.isDestroyed()) event.sender.send('device:file-transfer-progress', update);
  };
  let copied = 0;
  let installed = 0;
  for (const [index, file] of filePaths.entries()) {
    const item = index + 1;
    const name = path.basename(file);
    let installApk = false;
    if (!isFolder && path.extname(file).toLowerCase() === '.apk') {
      const answer = await dialog.showMessageBox(dialogWindow, {
        type: 'question',
        message: 'This file is an APK. Would you like to install it?',
        detail: `${name} can also be copied to Downloads without installing.`,
        buttons: ['Install APK', 'Copy to Downloads'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      });
      installApk = answer.response === 0;
    }
    const operation = installApk ? 'install' : 'copy';
    sendProgress({ state: 'transferring', item, total: filePaths.length, completed: copied + installed, name, operation });
    try {
      if (installApk) {
        await run(adb, ['-s', serial, 'install', '-r', file], 180000);
        installed++;
      } else {
        await run(adb, ['-s', serial, 'push', file, '/sdcard/Download/'], 120000);
        copied++;
      }
      sendProgress({ state: 'item-complete', item, total: filePaths.length, completed: copied + installed, name, operation });
    } catch (error) {
      const message = error.stderr?.trim() || error.stdout?.trim() || error.message;
      sendProgress({ state: 'error', item, total: filePaths.length, completed: copied + installed, name, operation, message });
      return { ok: false, message: `Import stopped: ${message}`, copied, installed };
    }
  }
  sendProgress({ state: 'complete', total: filePaths.length, completed: copied + installed });
  const summary = [];
  if (copied) summary.push(`${copied} item${copied === 1 ? '' : 's'} copied to Downloads`);
  if (installed) summary.push(`${installed} APK${installed === 1 ? '' : 's'} installed`);
  return { ok: true, message: `${summary.join('; ')}.` };
});
ipcMain.handle('device:apps', async (_event, serial) => {
  const adb = await resolveTool('adb');
  if (!adb) return { ok: false, message: 'ADB is unavailable.', apps: [] };
  try {
    const { stdout } = await run(adb, ['-s', serial, 'shell', 'pm', 'list', 'packages', '-3'], 20000);
    return { ok: true, apps: stdout.split(/\r?\n/).map(s => s.replace(/^package:/, '').trim()).filter(Boolean).sort() };
  } catch (e) { return { ok: false, message: e.message, apps: [] }; }
});
ipcMain.handle('device:app-install', async (_event, serial) => {
  if (!validSerial(serial)) return { ok: false, message: 'Choose a connected device first.' };
  const adb = await resolveTool('adb');
  if (!adb) return { ok: false, message: 'ADB is unavailable.' };
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { title: 'Choose an Android APK to install', properties: ['openFile'], filters: [{ name: 'Android apps', extensions: ['apk'] }] });
  if (canceled || !filePaths.length) return { ok: false, canceled: true };
  try {
    const { stdout } = await run(adb, ['-s', serial, 'install', '-r', filePaths[0]], 180000);
    return { ok: true, message: stdout.trim() || 'App installed.' };
  } catch (error) { return { ok: false, message: error.stderr?.trim() || error.stdout?.trim() || error.message }; }
});
ipcMain.handle('device:open-samsung-notes', async (_event, serial) => {
  if (!validSerial(serial)) return { ok: false, message: 'Choose a connected device first.' };
  const adb = await resolveTool('adb');
  if (!adb) return { ok: false, message: 'ADB is unavailable.' };
  const packageName = 'com.samsung.android.app.notes';
  try {
    const installed = await run(adb, ['-s', serial, 'shell', 'pm', 'path', packageName], 10000);
    if (!/^package:/m.test(installed.stdout)) return { ok: false, message: 'Samsung Notes is not installed on the selected device.' };
    const { stdout, stderr } = await run(adb, ['-s', serial, 'shell', 'monkey', '-p', packageName, '1'], 20000);
    if (/no activities found|monkey aborted/i.test(`${stdout}\n${stderr}`)) return { ok: false, message: 'Samsung Notes is installed, but Android could not launch it.' };
    return { ok: true, message: 'Samsung Notes opened on the selected Android device.' };
  } catch (error) {
    return { ok: false, message: error.stderr?.trim() || error.stdout?.trim() || error.message };
  }
});
ipcMain.handle('device:app-uninstall', async (_event, serial, packageName) => {
  if (!validSerial(serial) || typeof packageName !== 'string' || !/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(packageName)) return { ok: false, message: 'Invalid device or app.' };
  const adb = await resolveTool('adb');
  if (!adb) return { ok: false, message: 'ADB is unavailable.' };
  try {
    const { stdout } = await run(adb, ['-s', serial, 'uninstall', packageName], 60000);
    return { ok: true, message: stdout.trim() || 'App uninstalled.' };
  } catch (error) { return { ok: false, message: error.stderr?.trim() || error.stdout?.trim() || error.message }; }
});
ipcMain.handle('device:contacts', async (_event, serial) => {
  if (!validSerial(serial)) return { ok: false, message: 'Choose a connected device first.', contacts: [] };
  const adb = await resolveTool('adb');
  if (!adb) return { ok: false, message: 'ADB is unavailable.', contacts: [] };
  try {
    const parseContacts = stdout => contentRows(stdout).flatMap(row => {
      const match = row.match(/(?:display_name|name)=(.*?),\s*(?:data1|number)=(.*)$/);
      if (!match) return [];
      const name = match[1].trim() || 'Unnamed contact';
      const number = match[2].split(/,\s*(?:data\d+|type|is_primary|label)=/i)[0].trim();
      return number ? [{ name, number }] : [];
    });
    let contacts = [];
    try {
      const result = await run(adb, ['-s', serial, 'shell', 'content', 'query', '--uri', 'content://com.android.contacts/data/phones', '--projection', 'display_name:data1'], 30000, 8 * 1024 * 1024);
      contacts = parseContacts(result.stdout);
    } catch {}
    if (!contacts.length) {
      const result = await run(adb, ['-s', serial, 'shell', 'content', 'query', '--uri', 'content://contacts/phones', '--projection', 'name:number'], 30000, 8 * 1024 * 1024);
      contacts = parseContacts(result.stdout);
    }
    return { ok: true, contacts };
  } catch (error) { return { ok: false, message: error.stderr?.trim() || error.stdout?.trim() || 'Android did not allow reading contacts.', contacts: [] }; }
});
ipcMain.handle('device:contacts-export', async (_event, contacts) => {
  if (!Array.isArray(contacts) || contacts.length > 10000) return { ok: false, message: 'There are no contacts to export.' };
  const csvCell = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = ['Name,Phone number', ...contacts.map(contact => `${csvCell(contact.name)},${csvCell(contact.number)}`)].join('\r\n');
  const { canceled, filePath } = await dialog.showSaveDialog(win, { title: 'Export Android contacts', defaultPath: 'MobiDesk-Contacts.csv', filters: [{ name: 'CSV contact list', extensions: ['csv'] }] });
  if (canceled || !filePath) return { ok: false, canceled: true };
  try { await fsPromises.writeFile(filePath, `\uFEFF${csv}`, 'utf8'); return { ok: true, message: 'Contacts exported to CSV.' }; }
  catch (error) { return { ok: false, message: error.message }; }
});
ipcMain.handle('device:contacts-import', async (_event, serial) => {
  if (!validSerial(serial)) return { ok: false, message: 'Choose a connected device first.' };
  const adb = await resolveTool('adb');
  if (!adb) return { ok: false, message: 'ADB is unavailable.' };
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { title: 'Choose a vCard contacts file', properties: ['openFile'], filters: [{ name: 'vCard contacts', extensions: ['vcf', 'vcard'] }] });
  if (canceled || !filePaths.length) return { ok: false, canceled: true };
  const remotePath = `/sdcard/Download/MobiDesk-Contacts-${Date.now()}.vcf`;
  try {
    await run(adb, ['-s', serial, 'shell', 'mkdir', '-p', '/sdcard/Download']);
    await run(adb, ['-s', serial, 'push', filePaths[0], remotePath], 120000);
    await run(adb, ['-s', serial, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-t', 'text/x-vcard', '-d', `file://${remotePath}`], 30000);
    return { ok: true, message: 'The contacts import screen opened on your Android device. Review and save the contacts there.' };
  } catch (error) { return { ok: false, message: error.stderr?.trim() || error.stdout?.trim() || error.message }; }
});
ipcMain.handle('device:messages', async (_event, serial) => {
  if (!validSerial(serial)) return { ok: false, message: 'Choose a connected device first.', messages: [] };
  const adb = await resolveTool('adb');
  if (!adb) return { ok: false, message: 'ADB is unavailable.', messages: [] };
  try {
    const { stdout } = await run(adb, ['-s', serial, 'shell', 'content', 'query', '--uri', 'content://sms', '--projection', '_id:address:date:type:body'], 45000, 16 * 1024 * 1024);
    const messages = [];
    for (const row of contentRows(stdout)) {
      const match = row.match(/^Row:\s*\d+\s+_id=(\d+), address=(.*?), date=(\d+), type=(\d+), body=([\s\S]*)$/);
      if (match) messages.push({ id: match[1], address: match[2], date: Number(match[3]), type: Number(match[4]), body: match[5] });
    }
    messages.sort((a, b) => b.date - a.date);
    return { ok: true, messages: messages.slice(0, 500) };
  } catch (error) { return { ok: false, message: error.stderr?.trim() || error.stdout?.trim() || 'Android did not allow reading text messages.', messages: [] }; }
});
ipcMain.handle('device:notifications', async (_event, serial) => {
  if (!validSerial(serial)) return { ok: false, message: 'Choose a connected device first.', notifications: [] };
  const adb = await resolveTool('adb');
  if (!adb) return { ok: false, message: 'ADB is unavailable.', notifications: [] };
  try {
    const { stdout } = await run(adb, ['-s', serial, 'shell', 'dumpsys', 'notification', '--noredact'], 15000, 16 * 1024 * 1024);
    if (/permission denial|not allowed to dump|unknown (?:option|argument).*noredact/i.test(stdout)) {
      return { ok: false, message: 'Android did not allow reading active notifications over ADB.', notifications: [] };
    }
    return { ok: true, notifications: parseActiveNotifications(stdout) };
  } catch (error) {
    return { ok: false, message: error.stderr?.trim() || error.stdout?.trim() || 'Android did not allow reading active notifications over ADB.', notifications: [] };
  }
});
ipcMain.handle('device:notifications-clear', async (_event, serial) => {
  if (!validSerial(serial)) return { ok: false, message: 'Choose a connected device first.' };
  const adb = await resolveTool('adb');
  if (!adb) return { ok: false, message: 'ADB is unavailable.' };
  try {
    await run(adb, ['-s', serial, 'shell', 'cmd', 'notification', 'cancel_all'], 15000);
    return { ok: true, message: 'Clear notifications command sent to the device.' };
  } catch (error) {
    return { ok: false, message: error.stderr?.trim() || error.stdout?.trim() || 'Could not clear notifications on the device.' };
  }
});
ipcMain.handle('device:files-list', async (_event, serial, requestedPath) => {
  if (!validSerial(serial)) return { ok: false, message: 'Choose a connected device first.', entries: [] };
  const folder = androidPath(requestedPath);
  if (!folder) return { ok: false, message: 'Enter a valid absolute Android folder path.', entries: [] };
  const adb = await resolveTool('adb');
  if (!adb) return { ok: false, message: 'ADB is unavailable.', entries: [] };
  try {
    const { stdout } = await run(adb, ['-s', serial, 'shell', 'ls', '-1Ap', folder], 20000, 4 * 1024 * 1024);
    const entries = stdout.split(/\r?\n/).map(name => name.trimEnd()).filter(name => name && name !== './' && name !== '../').map(name => ({ name: name.replace(/\/$/, ''), directory: name.endsWith('/') }));
    return { ok: true, path: folder, entries };
  } catch (error) { return { ok: false, message: error.stderr?.trim() || error.stdout?.trim() || 'Could not read this folder. Android restricts some system and app-private paths.', entries: [] }; }
});
ipcMain.handle('device:media-gallery', async (_event, serial) => {
  if (!validSerial(serial)) return { ok: false, message: 'Choose a connected device first.', entries: [] };
  const adb = await resolveTool('adb');
  if (!adb) return { ok: false, message: 'ADB is unavailable.', entries: [] };
  const volumes = new Set(['external']);
  const errors = [];
  try {
    const { stdout } = await run(adb, ['-s', serial, 'shell', 'ls', '-1', '/storage'], 10000, 1024 * 1024);
    for (const volume of stdout.split(/\r?\n/).map(line => line.trim())) {
      if (/^[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}$/.test(volume)) volumes.add(volume);
    }
  } catch (error) {
    errors.push(error.stderr?.trim() || error.stdout?.trim() || error.message);
  }
  const entriesByPath = new Map();
  let successfulVolumes = 0;
  for (const volume of volumes) {
    try {
      const { stdout } = await run(adb, ['-s', serial, 'shell', 'content', 'query', '--uri', `content://media/${volume}/file`, '--projection', '_data'], 90000, 64 * 1024 * 1024);
      successfulVolumes++;
      for (const entry of parseMediaGallery(stdout)) entriesByPath.set(entry.path, entry);
    } catch (error) {
      errors.push(`${volume}: ${error.stderr?.trim() || error.stdout?.trim() || error.message}`);
    }
  }
  const entries = [...entriesByPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  return {
    ok: successfulVolumes > 0,
    message: errors.join(' '),
    entries
  };
});
ipcMain.handle('device:storage', async (_event, serial) => {
  if (!validSerial(serial)) return { ok: false, message: 'Choose a connected device first.', internal: null, sdCard: null };
  const adb = await resolveTool('adb');
  if (!adb) return { ok: false, message: 'ADB is unavailable.', internal: null, sdCard: null };
  const readVolume = async pathValue => {
    const { stdout } = await run(adb, ['-s', serial, 'shell', 'df', '-k', pathValue], 12000);
    const line = stdout.split(/\r?\n/).map(item => item.trim()).filter(Boolean).slice(1).find(item => /\d/.test(item));
    if (!line) return null;
    const fields = line.split(/\s+/);
    if (fields.length < 5) return null;
    const totalKb = Number(fields[1]); const usedKb = Number(fields[2]); const freeKb = Number(fields[3]);
    if (![totalKb, usedKb, freeKb].every(Number.isFinite) || totalKb <= 0) return null;
    return { totalBytes: totalKb * 1024, usedBytes: usedKb * 1024, freeBytes: freeKb * 1024 };
  };
  try {
    let internal = await readVolume('/storage/emulated/0');
    if (!internal) internal = await readVolume('/data');
    if (!internal) return { ok: false, message: 'Could not read internal storage capacity from this device.', internal: null, sdCard: null };
    let sdCard = null;
    const candidates = new Set();
    try {
      const { stdout } = await run(adb, ['-s', serial, 'shell', 'sm', 'list-volumes', 'all'], 10000);
      for (const line of stdout.split(/\r?\n/)) {
        const match = line.match(/^public:\S+\s+mounted\s+([0-9A-Fa-f]{4}-[0-9A-Fa-f]{4})\s*$/);
        if (match) candidates.add(match[1]);
      }
    } catch {}
    try {
      const { stdout } = await run(adb, ['-s', serial, 'shell', 'ls', '-1', '/storage'], 8000);
      for (const line of stdout.split(/\r?\n/)) if (/^[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}$/.test(line.trim())) candidates.add(line.trim());
    } catch {}
    for (const volumeId of candidates) {
      try { sdCard = await readVolume(`/storage/${volumeId}`); if (sdCard) { sdCard.rootPath = `/storage/${volumeId}`; break; } } catch {}
    }
    return { ok: true, internal, sdCard };
  } catch (error) {
    return { ok: false, message: error.stderr?.trim() || error.message || 'Could not read device storage.', internal: null, sdCard: null };
  }
});
ipcMain.handle('device:storage-breakdown', async (_event, serial) => {
  if (!validSerial(serial)) return { ok: false, message: 'Choose a connected device first.', apps: [], categories: null };
  const adb = await resolveTool('adb');
  if (!adb) return { ok: false, message: 'ADB is unavailable.', apps: [], categories: null };
  let apps = [];
  let appError = '';
  try {
    const { stdout } = await run(adb, ['-s', serial, 'shell', 'dumpsys', 'diskstats'], 30000, 32 * 1024 * 1024);
    apps = parseDiskStatsApps(stdout);
    if (!apps) appError = 'Android did not return per-app storage statistics.';
  } catch (error) {
    appError = error.stderr?.trim() || error.stdout?.trim() || error.message;
  }
  let categories = null;
  let categoryError = '';
  try {
    const { stdout } = await run(adb, ['-s', serial, 'shell', 'content', 'query', '--uri', 'content://media/external/file', '--projection', '_size:mime_type'], 45000, 32 * 1024 * 1024);
    categories = parseMediaFileUsage(stdout);
  } catch (error) {
    categoryError = error.stderr?.trim() || error.stdout?.trim() || error.message;
  }
  const ok = !appError || !categoryError;
  return {
    ok,
    message: ok ? '' : 'Android could not provide app or file-type storage statistics.',
    apps: apps || [],
    categories,
    appError,
    categoryError,
    sampledAt: Date.now()
  };
});
ipcMain.handle('device:file-preview', async (_event, serial, requestedPath, thumbnail = false) => {
  if (!validSerial(serial)) return { ok: false, message: 'Choose a connected device first.' };
  const remotePath = androidPath(requestedPath);
  if (!remotePath || remotePath === '/') return { ok: false, message: 'Choose a photo, video, or audio file.' };
  const ext = path.posix.extname(remotePath).toLowerCase();
  const mimeByExt = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.avif': 'image/avif',
    '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.3gp': 'video/3gpp', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
    '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac'
  };
  const mime = mimeByExt[ext];
  if (!mime) return { ok: false, message: 'Preview is available for photos, videos, and audio files.' };
  const adb = await resolveTool('adb');
  if (!adb) return { ok: false, message: 'ADB is unavailable.' };
  const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'mobidesk-preview-'));
  try {
    const { stdout: sizeOutput } = await run(adb, ['-s', serial, 'shell', 'stat', '-c', '%s', remotePath], 8000);
    const size = Number(sizeOutput.trim());
    if (!Number.isFinite(size) || size < 0) return { ok: false, message: 'Could not read the media file size.' };
    const maxSize = thumbnail ? 3 * 1024 * 1024 : 25 * 1024 * 1024;
    if (size > maxSize) return { ok: false, message: thumbnail ? '' : 'This file is over 25 MB. Download it to your PC to view it.' };
    const localPath = path.join(tempDir, 'preview' + ext);
    await run(adb, ['-s', serial, 'pull', remotePath, localPath], 60000, 2 * 1024 * 1024);
    const data = await fsPromises.readFile(localPath);
    if (thumbnail) {
      try {
        const image = nativeImage.createFromBuffer(data);
        if (!image.isEmpty()) {
          const thumb = image.resize({ width: 220, height: 150, quality: 'good' }).toJPEG(78);
          return { ok: true, mime: 'image/jpeg', dataUrl: `data:image/jpeg;base64,${thumb.toString('base64')}` };
        }
      } catch {}
    }
    return { ok: true, mime, dataUrl: `data:${mime};base64,${data.toString('base64')}` };
  } catch (error) {
    return { ok: false, message: error.stderr?.trim() || error.stdout?.trim() || error.message };
  } finally { await fsPromises.rm(tempDir, { recursive: true, force: true }).catch(() => {}); }
});
ipcMain.handle('device:file-download', async (_event, serial, requestedPath, directory = false) => {
  if (!validSerial(serial)) return { ok: false, message: 'Choose a connected device first.' };
  const remotePath = androidPath(requestedPath);
  if (!remotePath || remotePath === '/') return { ok: false, message: 'Choose a file to download.' };
  const adb = await resolveTool('adb');
  if (!adb) return { ok: false, message: 'ADB is unavailable.' };
  const leaf = remotePath.split('/').pop() || 'android-file';
  let filePath;
  if (directory) {
    const result = await dialog.showOpenDialog(win, { title: 'Choose where to export this Android folder', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    filePath = result.filePaths[0];
  } else {
    const result = await dialog.showSaveDialog(win, { title: 'Save file from Android', defaultPath: leaf });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    filePath = result.filePath;
  }
  try { await run(adb, ['-s', serial, 'pull', remotePath, filePath], 180000); return { ok: true, message: directory ? 'Folder exported to this PC.' : 'File saved to this PC.' }; }
  catch (error) { return { ok: false, message: error.stderr?.trim() || error.message }; }
});
ipcMain.handle('device:file-upload', async (_event, serial, requestedPath) => {
  if (!validSerial(serial)) return { ok: false, message: 'Choose a connected device first.' };
  const folder = androidPath(requestedPath);
  if (!folder) return { ok: false, message: 'Enter a valid Android folder path.' };
  const adb = await resolveTool('adb');
  if (!adb) return { ok: false, message: 'ADB is unavailable.' };
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { title: 'Choose files or folders to copy to Android', properties: ['openFile', 'openDirectory', 'multiSelections'] });
  if (canceled || !filePaths.length) return { ok: false, canceled: true };
  let sent = 0;
  for (const file of filePaths) {
    try { await run(adb, ['-s', serial, 'push', file, folder], 120000); sent++; }
    catch (error) { return { ok: false, message: error.stderr?.trim() || error.message, sent }; }
  }
  return { ok: true, message: `${sent} item${sent === 1 ? '' : 's'} copied to ${folder}.` };
});
ipcMain.handle('device:file-delete', async (_event, serial, requestedPath) => {
  if (!validSerial(serial)) return { ok: false, message: 'Choose a connected device first.' };
  const remotePath = androidPath(requestedPath);
  const protectedRoots = ['/sdcard', '/storage/emulated', '/storage/emulated/0', '/storage', '/mnt/sdcard'];
  if (!remotePath || remotePath === '/' || protectedRoots.includes(remotePath) || /^\/storage\/[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}$/.test(remotePath)) return { ok: false, message: 'This storage location cannot be deleted.' };
  const adb = await resolveTool('adb');
  if (!adb) return { ok: false, message: 'ADB is unavailable.' };
  try { await run(adb, ['-s', serial, 'shell', 'rm', '-r', '--', remotePath], 120000); return { ok: true, message: 'Selected item deleted.' }; }
  catch (error) { return { ok: false, message: error.stderr?.trim() || error.stdout?.trim() || error.message }; }
});
ipcMain.handle('app:open-external', (_event, url) => {
  if (url === 'https://developer.android.com/tools/releases/platform-tools' || url === 'https://github.com/Genymobile/scrcpy/releases') return shell.openExternal(url);
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { for (const proc of mirrorProcesses.values()) proc.kill(); if (process.platform !== 'darwin') app.quit(); });
