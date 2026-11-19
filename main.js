const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } = require('electron');
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
function androidPath(value) {
  if (typeof value !== 'string' || value.length > 1024 || !value.startsWith('/') || /[\0\r\n]/.test(value)) return null;
  return value.replace(/\/+/g, '/') || '/';
}
function contentRows(stdout) { return stdout.split(/\r?\n/).filter(line => /^Row:\s*\d+\s/.test(line)); }

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
  if (mirrorProcesses.has(serial)) return { ok: true, alreadyRunning: true };
  const scrcpy = await resolveTool('scrcpy');
  if (!scrcpy) return { ok: false, message: 'scrcpy was not found. Install scrcpy and add it to PATH, then try again.' };
  const child = spawn(scrcpy, ['--serial', serial], { windowsHide: false, stdio: 'ignore' });
  mirrorProcesses.set(serial, child);
  child.on('exit', () => mirrorProcesses.delete(serial));
  child.on('error', err => { mirrorProcesses.delete(serial); sendToast(`Could not start scrcpy: ${err.message}`); });
  return { ok: true };
});
ipcMain.handle('device:files', async (_event, serial) => {
  const adb = await resolveTool('adb');
  if (!adb) return { ok: false, message: 'ADB is unavailable.' };
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { title: 'Choose files to copy to Android', properties: ['openFile', 'openDirectory', 'multiSelections'] });
  if (canceled || !filePaths.length) return { ok: false, canceled: true };
  let sent = 0;
  for (const file of filePaths) {
    try { await run(adb, ['-s', serial, 'push', file, '/sdcard/Download/'], 120000); sent++; }
    catch (e) { return { ok: false, message: `Transfer stopped: ${e.message}`, sent }; }
  }
  return { ok: true, message: `${sent} item${sent === 1 ? '' : 's'} copied to Downloads.` };
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
