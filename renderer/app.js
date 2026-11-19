(() => {
  const api = window.mobiDesk;
  if (!api) return;
  let devices = [];
  let scanning = false;
  let currentFilePath = '/sdcard';
  let atStorageRoot = true;
  let currentFileEntries = [];
  let currentFileView = 'list';
  let currentFileFilter = 'all';
  let fileRenderSequence = 0;
  let selectionMode = false;
  let pressTimer = null;
  let suppressFileClick = false;
  const selectedFilePaths = new Set();
  let currentContacts = [];
  let currentMessages = [];
  const storageCache = new Map();
  const $ = id => document.getElementById(id);
  const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  $('device-list').innerHTML = '';
  $('device-list2').innerHTML = '';
  $('navcount').textContent = '0';
  $('statdevices').textContent = '0 devices';
  $('device-label').textContent = '0 connected';

  function notify(message) { window.toast(message); }

  function selectOptions(selected) {
    if (!devices.length) return '<option value="">Connect an Android device first</option>';
    return devices.map(d => `<option value="${escapeHtml(d.serial)}" ${d.serial === selected ? 'selected' : ''}>${escapeHtml(d.model)} · ${d.kind}</option>`).join('');
  }

  function createManagerWorkspace() {
    const appsNav = document.querySelector('.nav[data-page="apps"]');
    appsNav.insertAdjacentHTML('afterend', '<div class="nav" data-page="messages"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5h16v12H8l-4 4z"/><path d="M8 9h8M8 13h5"/></svg>Messages</div><div class="nav" data-page="contacts"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3"/><path d="M3 20v-1a6 6 0 0 1 12 0v1zM16 5a3 3 0 0 1 0 6m2 3a4 4 0 0 1 3 4v2h-4"/></svg>Contacts</div>');
    document.querySelectorAll('.nav[data-page="contacts"],.nav[data-page="messages"]').forEach(nav => nav.addEventListener('click', () => { navigate(nav.dataset.page); loadPersonalData(nav.dataset.page); }));
    document.querySelector('.nav[data-page="files"]').addEventListener('click', () => { renderFilesRoot(); loadStorage($('fileDevice').value, true); });
    document.querySelector('.nav[data-page="apps"]').addEventListener('click', () => loadApps());
    $('files').querySelector('.card.panel').innerHTML = '<div class="panel-title"><h2 id="filesHeading">Device storage</h2><span class="textlink" id="filesSubheading">Choose a storage location</span></div><div class="storage-grid files-storage-grid" id="filesStorageCards"></div><div class="files-toolbar"><select id="fileDevice" class="field"></select><button class="btn secondary" id="refreshFiles">Refresh</button><button class="btn primary" id="uploadFiles">＋ Import files / folders</button></div><div class="file-pathbar" id="filePathbar"><button class="btn secondary" id="fileRoot" title="Return to storage locations">Storage</button><button class="btn secondary" id="fileUp" title="Go up one folder">↑</button><input class="field" id="filePath" value="/sdcard" aria-label="Android folder path"><button class="btn secondary" id="fileGo">Go</button></div><div class="file-controls"><label class="filter-label">Show<select id="fileFilter" class="field" aria-label="Filter files"><option value="all">All types</option><option value="photos">Pictures</option><option value="audio">Audio</option><option value="documents">Documents</option><option value="videos">Videos</option></select></label><div class="view-toggle"><button class="btn secondary active" data-file-view="list">☰ &nbsp;List</button><button class="btn secondary" data-file-view="grid">▦ &nbsp;Grid</button></div></div><div class="file-selection-bar" id="fileSelectionBar"><span id="fileSelectionCount">0 selected</span><button class="btn secondary" id="exportSelected" disabled>↓ Export selected</button><button class="btn danger" id="deleteSelected" disabled>Delete selected</button><button class="btn secondary" id="cancelSelection">Cancel</button></div><p class="sub files-hint">Long-press a file or folder to select it. Browse shared Android storage; protected folders may be unavailable.</p><div class="file-list" id="fileList"></div>';
    $('apps').querySelector('.hello').insertAdjacentHTML('beforeend', '<button class="btn primary" id="installApk">＋ &nbsp;Install APK</button>');
    $('apps').querySelector('.card.panel').innerHTML = '<div class="apps-toolbar"><select id="appDevice" class="field"></select><button class="btn secondary" id="refreshApps">Refresh apps</button></div><div class="app-list" id="appList"><div class="empty">Choose a connected device to view its apps.</div></div>';
    const statStorage = document.querySelector('.overview .stat:nth-child(2)');
    statStorage.querySelector('small').textContent = 'Internal capacity';
    statStorage.querySelector('strong').id = 'statInternal'; statStorage.querySelector('strong').textContent = '—';
    const statFree = document.querySelector('.overview .stat:nth-child(3)');
    statFree.querySelector('small').textContent = 'Free storage';
    statFree.querySelector('strong').id = 'statFree'; statFree.querySelector('strong').textContent = '—';
    document.querySelector('.overview').insertAdjacentHTML('afterend', '<div class="storage-section"><div class="section-head"><h2>Device storage</h2><span>Live capacity</span><select id="storageDevice" class="field storage-select"></select></div><div class="storage-grid" id="storageCards"><div class="card storage-card"><div class="empty">Connect a device to see its storage.</div></div></div></div>');
    const activityPanel = document.querySelector('.lower .card.panel:first-child');
    activityPanel.innerHTML = '<div class="panel-title"><h2>Device snapshot</h2><span class="textlink">Live device data</span></div><div id="deviceSnapshot" class="snapshot-empty">Connect a phone or tablet to load device details.</div>';
    const mirrorButton = document.querySelector('.mirror-panel .startmirror');
    mirrorButton.removeAttribute('onclick');
    mirrorButton.addEventListener('click', () => devices[0] ? startMirror(devices[0].serial) : notify('Connect an Android device first.'));
    const content = document.querySelector('.content');
    content.insertAdjacentHTML('beforeend', '<section class="view" id="contacts"><div class="hello"><div><p class="eyebrow">PEOPLE</p><h1>Contacts</h1><p class="sub">View phone numbers, and import or export contacts.</p></div></div><div class="card panel"><div class="data-toolbar"><select id="contactsDevice" class="field"></select><input id="contactSearch" class="field" placeholder="Search contacts or numbers"><button class="btn primary" id="loadContacts">Load contacts</button><button class="btn secondary" id="importContacts">Import vCard</button><button class="btn secondary" id="exportContacts">Export CSV</button></div><div class="data-list" id="contactsList"><div class="empty">Select a device to view its contacts.</div></div></div></section><section class="view" id="messages"><div class="hello"><div><p class="eyebrow">TEXT MESSAGES</p><h1>Messages</h1><p class="sub">Read SMS messages on a connected Android device.</p></div></div><div class="card panel"><div class="data-toolbar"><select id="messagesDevice" class="field"></select><input id="messageSearch" class="field" placeholder="Search messages or numbers"><button class="btn primary" id="loadMessages">Load messages</button></div><div class="data-list" id="messagesList"><div class="empty">Select a device to view its messages.</div></div></div></section>');
    document.body.insertAdjacentHTML('beforeend', '<div class="message-drawer-wrap" id="messageDrawer"><aside class="message-drawer" role="dialog" aria-modal="true" aria-labelledby="messageDrawerTitle"><div class="message-drawer-head"><div><p class="eyebrow">TEXT MESSAGE</p><h2 id="messageDrawerTitle">Message details</h2></div><button class="close" id="closeMessageDrawer" aria-label="Close message">×</button></div><div id="messageDrawerContent"></div></aside></div>');
    $('messageDrawer').addEventListener('click', event => { if (event.target === $('messageDrawer')) closeMessageDrawer(); });
    $('closeMessageDrawer').addEventListener('click', closeMessageDrawer);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMessageDrawer(); });
    document.body.insertAdjacentHTML('beforeend', '<div class="modal-wrap media-preview-wrap" id="mediaPreview"></div>');
    $('mediaPreview').addEventListener('click', event => { if (event.target === $('mediaPreview')) { $('mediaPreview').classList.remove('show'); $('mediaPreview').innerHTML = ''; } });
    $('fileDevice').addEventListener('change', () => { currentFilePath = '/sdcard'; atStorageRoot = true; storageCache.delete($('fileDevice').value); loadStorage($('fileDevice').value, true); renderFilesRoot(); });
    $('storageDevice').addEventListener('change', () => { loadStorage($('storageDevice').value, true); updateDeviceSnapshot(); });
    $('snapshotDevice')?.addEventListener('change', updateDeviceSnapshot);
    $('refreshFiles').addEventListener('click', () => { const serial = $('fileDevice').value; storageCache.delete(serial); if (atStorageRoot) loadStorage(serial, true); else loadFiles(); });
    $('fileGo').addEventListener('click', () => loadFiles($('filePath').value));
    $('filePath').addEventListener('keydown', e => { if (e.key === 'Enter') loadFiles($('filePath').value); });
    $('fileRoot').addEventListener('click', renderFilesRoot);
    $('filesStorageCards').addEventListener('click', event => { const button = event.target.closest('[data-storage-path]'); if (button) loadFiles(button.dataset.storagePath); });
    $('fileUp').addEventListener('click', () => { if (currentFilePath === '/sdcard' || currentFilePath.split('/').filter(Boolean).length <= 2 && currentFilePath.startsWith('/storage/')) return renderFilesRoot(); const parts = currentFilePath.split('/').filter(Boolean); parts.pop(); loadFiles(`/${parts.join('/')}`); });
    $('uploadFiles').addEventListener('click', async () => { const result = await api.uploadFiles($('fileDevice').value, currentFilePath); if (!result.canceled) { notify(result.message || 'File upload failed.'); if (result.ok) loadFiles(); } });
    $('fileFilter').addEventListener('change', () => { currentFileFilter = $('fileFilter').value; renderFileEntries(); });
    $('fileList').addEventListener('change', event => { const checkbox = event.target.closest('[data-select-file]'); if (!checkbox) return; checkbox.checked ? selectedFilePaths.add(checkbox.value) : selectedFilePaths.delete(checkbox.value); updateFileSelection(); });
    $('fileList').addEventListener('pointerdown', beginFilePress);
    for (const eventName of ['pointerup','pointercancel','pointerleave']) $('fileList').addEventListener(eventName, endFilePress);
    $('fileList').addEventListener('click', event => { if (!suppressFileClick) return; suppressFileClick = false; event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); }, true);
    $('exportSelected').addEventListener('click', exportSelectedFiles);
    $('deleteSelected').addEventListener('click', deleteSelectedFiles);
    $('cancelSelection').addEventListener('click', clearFileSelection);
    document.querySelectorAll('[data-file-view]').forEach(button => button.addEventListener('click', () => { currentFileView = button.dataset.fileView; document.querySelectorAll('[data-file-view]').forEach(item => item.classList.toggle('active', item === button)); renderFileEntries(); }));
    $('appDevice').addEventListener('change', () => loadApps($('appDevice').value));
    $('refreshApps').addEventListener('click', () => loadApps($('appDevice').value));
    $('installApk').addEventListener('click', installApk);
    $('loadContacts').addEventListener('click', () => loadPersonalData('contacts'));
    $('importContacts').addEventListener('click', importContacts);
    $('exportContacts').addEventListener('click', exportContacts);
    $('loadMessages').addEventListener('click', () => loadPersonalData('messages'));
    $('contactSearch').addEventListener('input', () => filterRows('contactsList', $('contactSearch').value));
    $('messageSearch').addEventListener('input', () => filterRows('messagesList', $('messageSearch').value));
    setDeviceViews('Connect an Android phone or tablet to see live device information.');
    renderFilesRoot();
  }

  function filterRows(containerId, term) {
    const q = term.trim().toLocaleLowerCase();
    document.querySelectorAll(`#${containerId} [data-search]`).forEach(row => { row.style.display = row.dataset.search.includes(q) ? '' : 'none'; });
  }

  function formatBytes(value) {
    if (!Number.isFinite(value) || value < 0) return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB']; let amount = value; let index = 0;
    while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index++; }
    return `${amount.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
  }

  function storageCard(title, data, message) {
    if (!data) return `<article class="card storage-card"><div class="storage-head"><span class="storage-icon">▤</span><div><b>${title}</b><small>${escapeHtml(message || 'Not detected')}</small></div></div></article>`;
    const percent = Math.max(0, Math.min(100, Math.round(data.usedBytes / data.totalBytes * 100)));
    return `<article class="card storage-card"><div class="storage-head"><span class="storage-icon">▤</span><div><b>${title}</b><small>Total capacity · ${formatBytes(data.totalBytes)}</small></div></div><div class="storage-bar"><i style="width:${percent}%"></i></div><div class="storage-numbers"><span><b>${formatBytes(data.freeBytes)}</b><small>Free</small></span><span><b>${formatBytes(data.usedBytes)}</b><small>Used</small></span><span><b>${percent}%</b><small>Full</small></span></div></article>`;
  }

  function applyStorageResult(result, serial) {
    const cards = $('storageCards');
    const filesCards = $('filesStorageCards');
    const dashSelected = serial && $('storageDevice').value === serial;
    const filesSelected = serial && $('fileDevice').value === serial;
    const dashMarkup = !result?.ok ? storageCard('Internal storage', null, result?.message || 'Connect a device to view capacity') + storageCard('SD card', null, 'Not available') : storageCard('Internal storage', result.internal) + storageCard('SD card', result.sdCard, result.sdCard ? '' : 'No mounted SD card detected');
    if (dashSelected || !serial) cards.innerHTML = dashMarkup;
    if (filesSelected || !serial) { filesCards.innerHTML = filesStorageMarkup(result); if (atStorageRoot) renderFilesRoot(); }
    if (!dashSelected && serial) return;
    if (!result?.ok) {
      $('statInternal').textContent = '—'; $('statFree').textContent = '—'; return;
    }
    $('statInternal').textContent = formatBytes(result.internal.totalBytes);
    $('statFree').textContent = `${formatBytes(result.internal.freeBytes)} free`;
  }

  function filesStorageMarkup(result) {
    const internal = storageCard('Internal storage', result?.internal, result?.ok ? '' : result?.message || 'Connect a device to view capacity').replace('</article>', '<button class="btn secondary storage-open" data-storage-path="/sdcard">Browse storage →</button></article>');
    const external = storageCard('SD card', result?.sdCard, result?.sdCard ? '' : 'No mounted SD card detected');
    return internal + (result?.sdCard ? external.replace('</article>', `<button class="btn secondary storage-open" data-storage-path="${escapeHtml(result.sdCard.rootPath || '/storage')}">Browse storage →</button></article>`) : external);
  }

  function renderFilesRoot() {
    atStorageRoot = true;
    currentFilePath = '/sdcard'; $('filePath').value = currentFilePath;
    $('filesStorageCards').style.display = '';
    $('uploadFiles').style.display = '';
    $('filesHeading').textContent = 'Device storage'; $('filesSubheading').textContent = 'Choose a storage location';
    $('filePathbar').style.display = 'none';
    $('fileFilter').closest('.file-controls').style.display = 'none';
    $('fileList').style.display = 'none';
    $('files').querySelector('.files-hint').style.display = 'none';
    $('fileList').innerHTML = '';
    clearFileSelection();
  }

  async function loadStorage(serial = $('storageDevice')?.value, force = false) {
    const cards = $('storageCards'); if (!cards) return;
    if (!serial) { applyStorageResult(null, ''); return; }
    if (!force && storageCache.has(serial)) { applyStorageResult(storageCache.get(serial), serial); return; }
    const pending = '<div class="card storage-card"><div class="empty">Reading live storage information…</div></div>';
    if ($('storageDevice').value === serial) cards.innerHTML = pending;
    if ($('fileDevice').value === serial) $('filesStorageCards').innerHTML = pending;
    const result = await api.storageInfo(serial);
    storageCache.set(serial, result);
    applyStorageResult(result, serial);
  }

  function updateDeviceSnapshot() {
    const serial = $('storageDevice')?.value;
    const device = devices.find(d => d.serial === serial);
    const target = $('deviceSnapshot'); if (!target) return;
    target.innerHTML = device ? `<div class="snapshot-row"><span>Device</span><b>${escapeHtml(device.model)}</b></div><div class="snapshot-row"><span>Android</span><b>${escapeHtml(device.android)}</b></div><div class="snapshot-row"><span>Device type</span><b>${device.kind}</b></div><div class="snapshot-row"><span>Connection</span><b>${escapeHtml(device.transport)}</b></div><div class="snapshot-row"><span>Battery</span><b>${device.battery == null ? 'Unavailable' : `${device.battery}%`}</b></div><div class="snapshot-row"><span>Device ID</span><b>${escapeHtml(device.serial)}</b></div>` : '<div class="snapshot-empty">No live device data yet.</div>';
  }

  async function loadFiles(pathValue = currentFilePath) {
    const serial = $('fileDevice').value;
    if (!serial) { $('fileList').innerHTML = '<div class="empty">Connect a phone or tablet first.</div>'; return; }
    atStorageRoot = false;
    clearFileSelection();
    $('uploadFiles').style.display = '';
    $('filesStorageCards').style.display = 'none'; $('filePathbar').style.display = ''; $('fileFilter').closest('.file-controls').style.display = ''; $('fileList').style.display = ''; $('files').querySelector('.files-hint').style.display = '';
    $('filesHeading').textContent = 'Files'; $('filesSubheading').textContent = 'Browse folders and media';
    $('fileList').innerHTML = '<div class="empty">Loading Android files…</div>';
    loadStorage(serial);
    const result = await api.listFiles(serial, pathValue);
    if (!result.ok) { $('fileList').innerHTML = `<div class="empty">${escapeHtml(result.message)}</div>`; return; }
    currentFilePath = result.path; $('filePath').value = result.path;
    currentFileEntries = result.entries;
    renderFileEntries();
  }

  function mediaKind(name) {
    const ext = name.split('.').pop().toLowerCase();
    if (['jpg','jpeg','png','gif','webp','bmp','avif','heic'].includes(ext)) return 'photos';
    if (['mp4','m4v','webm','3gp','mov','mkv'].includes(ext)) return 'videos';
    if (['mp3','m4a','aac','wav','ogg','flac'].includes(ext)) return 'audio';
    if (['pdf','txt','doc','docx','xls','xlsx','ppt','pptx','csv','rtf','odt','ods','odp','epub'].includes(ext)) return 'documents';
    return 'files';
  }

  function renderFileEntries() {
    const renderSequence = ++fileRenderSequence;
    const shown = currentFileEntries.filter(entry => entry.directory || currentFileFilter === 'all' || mediaKind(entry.name) === currentFileFilter);
    const remotePath = name => `${currentFilePath.replace(/\/$/, '')}/${name}`;
    const icon = entry => entry.directory ? '▰' : mediaKind(entry.name) === 'photos' ? '▧' : mediaKind(entry.name) === 'videos' ? '▶' : mediaKind(entry.name) === 'audio' ? '♫' : mediaKind(entry.name) === 'documents' ? '▧' : '▤';
    $('fileList').className = `${currentFileView === 'grid' ? 'file-list file-grid' : 'file-list'}${selectionMode ? ' selection-mode' : ''}`;
    if (!shown.length) { $('fileList').innerHTML = '<div class="empty">No matching files in this folder.</div>'; updateFileSelection(); return; }
    $('fileList').innerHTML = shown.map(entry => {
      const file = remotePath(entry.name); const kind = mediaKind(entry.name); const isPreviewable = !entry.directory && ['photos','videos','audio'].includes(kind);
      const kindLabel = ({photos:'Picture', videos:'Video', audio:'Audio', documents:'Document', files:'File'})[kind];
      const target = entry.directory ? `data-open-folder="${escapeHtml(entry.name)}"` : isPreviewable ? `data-preview="${escapeHtml(file)}"` : `data-download="${escapeHtml(file)}"`;
      const select = `<input class="file-select" type="checkbox" data-select-file value="${escapeHtml(file)}" aria-label="Select ${escapeHtml(entry.name)}" ${selectedFilePaths.has(file) ? 'checked' : ''}>`;
      if (currentFileView === 'grid') return `<article class="file-tile" data-file-item="${escapeHtml(file)}">${select}<button class="file-tile-open" ${target}><span class="file-tile-icon ${entry.directory ? 'folder' : kind}">${icon(entry)}${kind === 'photos' && !entry.directory ? `<img class="photo-thumb" data-photo-thumb="${escapeHtml(file)}" alt="">` : ''}</span><b>${escapeHtml(entry.name)}${entry.directory ? '/' : ''}</b><small>${entry.directory ? 'Folder' : kindLabel}</small></button><button class="device-action" data-download="${escapeHtml(file)}" data-is-directory="${entry.directory}">Export</button></article>`;
      return `<div class="file-row" data-file-item="${escapeHtml(file)}">${select}<span class="file-type ${entry.directory ? 'folder' : kind}">${icon(entry)}</span><button class="file-name" ${target}>${escapeHtml(entry.name)}${entry.directory ? '/' : ''}</button><span class="file-kind">${entry.directory ? 'Folder' : kindLabel}</span>${isPreviewable ? `<button class="device-action" data-preview="${escapeHtml(file)}">View</button>` : ''}<button class="device-action" data-download="${escapeHtml(file)}" data-is-directory="${entry.directory}">Export</button></div>`;
    }).join('');
    $('fileList').querySelectorAll('[data-open-folder]').forEach(button => button.addEventListener('click', () => loadFiles(`${currentFilePath.replace(/\/$/, '')}/${button.dataset.openFolder}`)));
    $('fileList').querySelectorAll('[data-download]').forEach(button => button.addEventListener('click', async () => { const downloaded = await api.downloadFile($('fileDevice').value, button.dataset.download, button.dataset.isDirectory === 'true'); if (!downloaded.canceled) notify(downloaded.message || 'Export failed.'); }));
    $('fileList').querySelectorAll('[data-preview]').forEach(button => button.addEventListener('click', () => previewMedia(button.dataset.preview)));
    if (currentFileView === 'grid') loadPhotoThumbnails(shown.filter(entry => !entry.directory && mediaKind(entry.name) === 'photos').slice(0, 12), renderSequence);
    updateFileSelection();
  }

  function updateFileSelection() {
    const count = selectedFilePaths.size;
    if (!$('fileSelectionCount')) return;
    $('fileSelectionCount').textContent = `${count} selected`;
    if ($('fileList')) $('fileList').classList.toggle('selection-mode', selectionMode);
    $('fileSelectionBar').style.display = selectionMode ? 'flex' : 'none';
    $('exportSelected').disabled = count === 0;
    $('deleteSelected').disabled = count === 0;
  }

  function clearFileSelection() {
    selectionMode = false; selectedFilePaths.clear();
    if ($('fileList')) $('fileList').querySelectorAll('[data-select-file]').forEach(box => { box.checked = false; });
    updateFileSelection();
  }

  function beginFilePress(event) {
    if (selectionMode || event.target.closest('[data-select-file]')) return;
    const item = event.target.closest('[data-file-item]');
    if (!item || event.button > 0) return;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      selectionMode = true;
      selectedFilePaths.add(item.dataset.fileItem);
      suppressFileClick = true;
      renderFileEntries();
      setTimeout(() => { suppressFileClick = false; }, 900);
    }, 550);
  }

  function endFilePress() { clearTimeout(pressTimer); pressTimer = null; }

  function selectedEntry(path) {
    const name = path.slice(path.lastIndexOf('/') + 1);
    return { path, name, directory: !!currentFileEntries.find(entry => entry.name === name && entry.directory) };
  }

  async function exportSelectedFiles() {
    const serial = $('fileDevice').value;
    for (const path of [...selectedFilePaths]) {
      const item = selectedEntry(path);
      const result = await api.downloadFile(serial, path, item.directory);
      if (result.canceled) break;
      if (!result.ok) { notify(result.message || `Could not export ${item.name}.`); break; }
      notify(result.message || `${item.name} exported.`);
    }
  }

  async function deleteSelectedFiles() {
    const items = [...selectedFilePaths].map(selectedEntry);
    if (!items.length || !window.confirm(`Delete ${items.length} selected item${items.length === 1 ? '' : 's'} from the Android device? Folders and their contents will be removed.`)) return;
    for (const item of items) {
      const result = await api.deleteFile($('fileDevice').value, item.path);
      if (!result.ok) { notify(result.message || `Could not delete ${item.name}.`); return; }
    }
    selectedFilePaths.clear(); notify('Selected items deleted.'); loadFiles();
  }

  async function loadPhotoThumbnails(entries, renderSequence) {
    const serial = $('fileDevice').value;
    for (const entry of entries) {
      if (renderSequence !== fileRenderSequence) return;
      const remote = `${currentFilePath.replace(/\/$/, '')}/${entry.name}`;
      const result = await api.previewFile(serial, remote, true);
      if (renderSequence !== fileRenderSequence) return;
      if (result.ok) {
        const image = [...$('fileList').querySelectorAll('[data-photo-thumb]')].find(item => item.dataset.photoThumb === remote);
        if (image) image.src = result.dataUrl;
      }
    }
  }

  async function previewMedia(remotePath) {
    const serial = $('fileDevice').value;
    const filename = remotePath.split('/').pop();
    const result = await api.previewFile(serial, remotePath);
    if (!result.ok) { notify(result.message); return; }
    const modal = $('mediaPreview'); const type = result.mime.startsWith('image/') ? 'image' : result.mime.startsWith('video/') ? 'video' : 'audio';
    const content = type === 'image' ? `<img class="media-image" src="${result.dataUrl}" alt="${escapeHtml(filename)}">` : type === 'video' ? `<video class="media-video" src="${result.dataUrl}" controls autoplay></video>` : `<audio class="media-audio" src="${result.dataUrl}" controls autoplay></audio>`;
    modal.innerHTML = `<div class="media-preview-card"><div class="media-preview-head"><b>${escapeHtml(filename)}</b><button class="close" id="closeMediaPreview">×</button></div><div class="media-preview-content">${content}</div></div>`;
    modal.classList.add('show');
    $('closeMediaPreview').addEventListener('click', () => { modal.classList.remove('show'); modal.innerHTML = ''; });
  }

  async function loadApps(serial = $('appDevice')?.value) {
    if (!serial) { $('appList').innerHTML = '<div class="empty">Connect a phone or tablet first.</div>'; return; }
    $('appList').innerHTML = '<div class="empty">Loading installed apps…</div>';
    const result = await api.listApps(serial);
    if (!result.ok) { $('appList').innerHTML = `<div class="empty">${escapeHtml(result.message)}</div>`; return; }
    $('appList').innerHTML = result.apps.length ? result.apps.map(pkg => {
      const name = pkg.split('.').filter(Boolean).pop() || pkg;
      const letter = name.slice(0, 1).toUpperCase();
      const color = `icon-tone-${(name.charCodeAt(0) || 65) % 6}`;
      return `<article class="app-row"><span class="app-icon ${color}">${escapeHtml(letter)}</span><div class="app-copy"><b>${escapeHtml(name)}</b><small>${escapeHtml(pkg)}</small></div><button class="btn secondary app-remove" data-uninstall="${escapeHtml(pkg)}">Uninstall</button></article>`;
    }).join('') : '<div class="empty">No third-party apps were found.</div>';
    $('appList').querySelectorAll('[data-uninstall]').forEach(button => button.addEventListener('click', async () => {
      const pkg = button.dataset.uninstall;
      if (!window.confirm(`Uninstall ${pkg} from this Android device?`)) return;
      button.disabled = true; button.textContent = 'Removing…';
      const removed = await api.uninstallApp(serial, pkg); notify(removed.message || (removed.ok ? 'App uninstalled.' : 'Uninstall failed.'));
      if (removed.ok) loadApps(serial); else { button.disabled = false; button.textContent = 'Uninstall'; }
    }));
  }

  async function installApk() {
    const serial = $('appDevice').value;
    if (!serial) { notify('Connect a phone or tablet first.'); return; }
    if (!window.confirm('Choose an Android APK to install on the selected device? Android may ask you to confirm on the phone.')) return;
    const result = await api.installApp(serial);
    if (!result.canceled) { notify(result.message || (result.ok ? 'App installed.' : 'Install failed.')); if (result.ok) loadApps(serial); }
  }

  async function loadPersonalData(section) {
    const contacts = section === 'contacts';
    const serial = $(`${section}Device`).value;
    const list = $(`${section}List`);
    if (!serial) { list.innerHTML = '<div class="empty">Connect a phone or tablet first.</div>'; if (contacts) currentContacts = []; return; }
    list.innerHTML = `<div class="empty">Loading ${contacts ? 'contacts' : 'messages'}…</div>`;
    const result = contacts ? await api.listContacts(serial) : await api.listMessages(serial);
    if (!result.ok) { list.innerHTML = `<div class="empty">${escapeHtml(result.message)}<br><br>Android device software may restrict this data.</div>`; if (contacts) currentContacts = []; return; }
    if (contacts) {
      currentContacts = result.contacts || [];
      list.innerHTML = currentContacts.length ? currentContacts.map(contact => `<div class="contact-row" data-search="${escapeHtml(`${contact.name} ${contact.number}`.toLocaleLowerCase())}"><span class="contact-avatar">${escapeHtml(contact.name.trim().slice(0, 1).toUpperCase() || '?')}</span><div><b>${escapeHtml(contact.name || 'Unnamed contact')}</b><small><span class="contact-phone-label">Phone</span> ${escapeHtml(contact.number || 'No number')}</small></div></div>`).join('') : '<div class="empty">No phone contacts were returned. Check that contacts are saved on this device, then refresh.</div>';
    } else {
      currentMessages = result.messages || [];
      list.innerHTML = currentMessages.length ? currentMessages.map((message, index) => {
        const direction = message.type === 2 ? 'Sent' : message.type === 1 ? 'Received' : 'Message';
        const date = Number.isFinite(message.date) ? new Date(message.date).toLocaleString() : '';
        return `<article class="message-row" data-search="${escapeHtml(`${message.address} ${message.body}`.toLocaleLowerCase())}"><div class="message-head"><b>${escapeHtml(message.address || 'Unknown sender')}</b><span>${escapeHtml(direction)} · ${escapeHtml(date)}</span></div><p>${escapeHtml(message.body)}</p><button class="device-action message-open" data-open-message="${index}">Open message →</button></article>`;
      }).join('') : '<div class="empty">No text messages found.</div>';
      list.querySelectorAll('[data-open-message]').forEach(button => button.addEventListener('click', () => openMessageAside(currentMessages[Number(button.dataset.openMessage)])));
    }
    filterRows(`${section}List`, $(`${contacts ? 'contact' : 'message'}Search`).value);
  }

  function openMessageAside(message) {
    if (!message) return;
    const direction = message.type === 2 ? 'Sent' : message.type === 1 ? 'Received' : 'Message';
    const date = Number.isFinite(message.date) ? new Date(message.date).toLocaleString() : 'Date unavailable';
    $('messageDrawerContent').innerHTML = `<div class="message-detail-meta"><span>From / number</span><b>${escapeHtml(message.address || 'Unknown sender')}</b></div><div class="message-detail-meta"><span>Direction</span><b>${escapeHtml(direction)}</b></div><div class="message-detail-meta"><span>Date</span><b>${escapeHtml(date)}</b></div><section class="message-detail-body"><span>Message</span><p>${escapeHtml(message.body || '')}</p></section>`;
    const drawer = $('messageDrawer');
    drawer.style.display = 'flex'; drawer.style.visibility = 'visible'; drawer.style.opacity = '1';
    drawer.classList.add('show');
    const panel = drawer.querySelector('.message-drawer');
    if (panel) panel.style.transform = 'translateY(0)';
  }

  function closeMessageDrawer() {
    const drawer = $('messageDrawer'); if (!drawer) return;
    drawer.classList.remove('show');
    drawer.style.opacity = '0';
    const panel = drawer.querySelector('.message-drawer'); if (panel) panel.style.transform = 'translateY(14px)';
    setTimeout(() => { if (!drawer.classList.contains('show')) { drawer.style.visibility = 'hidden'; drawer.style.display = 'none'; } }, 260);
  }

  async function importContacts() {
    const serial = $('contactsDevice').value;
    if (!serial) { notify('Connect a phone or tablet first.'); return; }
    const result = await api.importContacts(serial);
    if (!result.canceled) notify(result.message || (result.ok ? 'Contact import started on Android.' : 'Contact import failed.'));
  }

  async function exportContacts() {
    if (!currentContacts.length) await loadPersonalData('contacts');
    if (!currentContacts.length) { notify('Load contacts from the selected device before exporting.'); return; }
    const result = await api.exportContacts(currentContacts);
    if (!result.canceled) notify(result.message || (result.ok ? 'Contacts exported.' : 'Contact export failed.'));
  }

  function deviceCard(device) {
    const isTab = device.kind === 'Tablet';
    const art = isTab ? '<div class="tablet"><div class="screen"></div></div>' : '<div class="phone"><div class="screen"></div></div>';
    const battery = device.battery == null ? '' : `<span>Battery</span><div class="battery"><i style="width:${device.battery}%;${device.battery < 25 ? 'background:#e87865' : ''}"></i></div><b style="font-size:10px;color:#536070">${device.battery}%</b>`;
    return `<article class="card device"><div class="device-top"><div class="device-art">${art}</div><div><div class="device-title">${escapeHtml(device.model)}</div><div class="device-meta">${escapeHtml(device.android)} · ${device.kind}</div><div class="connected"><i></i>Connected · ${escapeHtml(device.transport)}</div></div></div><div class="device-foot">${battery}<span class="spacer"></span><button class="device-action" data-mirror="${escapeHtml(device.serial)}">Mirror screen ↗</button></div><div class="device-extras"><span class="device-serial">${escapeHtml(device.serial)}</span><button class="device-action" data-transfer="${escapeHtml(device.serial)}">Send files</button><button class="device-action" data-apps="${escapeHtml(device.serial)}">Installed apps</button></div></article>`;
  }

  function emptyDevices(message) {
    return `<div class="card panel device-empty"><div class="empty"><div class="stat-icon" style="margin:0 auto 14px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M10 18h4"/></svg></div><b style="color:#455164">No Android devices connected</b><p>${escapeHtml(message || 'Connect a phone or tablet by USB and allow USB debugging on the device.')}</p><button class="btn secondary" data-refresh>Refresh device list</button></div></div>`;
  }

  function setDeviceViews(message) {
    const count = devices.length;
    $('navcount').textContent = String(count);
    $('device-label').textContent = `${count} connected`;
    $('statdevices').textContent = `${count} device${count === 1 ? '' : 's'}`;
    document.querySelector('.overview .stat:first-child .hint').textContent = count ? `${devices.filter(d => d.kind === 'Phone').length} phone · ${devices.filter(d => d.kind === 'Tablet').length} tablet` : 'Connect an Android device';
    const cards = count ? devices.map(deviceCard).join('') : emptyDevices(message);
    $('device-list').innerHTML = cards;
    $('device-list2').innerHTML = cards;
    for (const id of ['fileDevice', 'appDevice', 'contactsDevice', 'messagesDevice', 'storageDevice']) {
      const select = $(id); if (!select) continue;
      const previous = select.value;
      const selected = devices.some(d => d.serial === previous) ? previous : devices[0]?.serial;
      select.innerHTML = selectOptions(selected);
    }
    updateDeviceSnapshot();
    loadStorage($('storageDevice')?.value, true);
    if ($('fileDevice')?.value && $('fileDevice').value !== $('storageDevice')?.value) loadStorage($('fileDevice').value, true);
    $('mirror').querySelector('.card.panel').innerHTML = `<div class="panel-title"><h2>${count ? 'Choose a device to mirror' : 'No device is ready to mirror'}</h2><span class="textlink">Powered by scrcpy</span></div>${count ? `<div class="devices" style="grid-template-columns:1fr 1fr">${devices.map(d => `<div class="step"><div class="stepnum">${d.kind === 'Tablet' ? '▭' : '▯'}</div><div><b>${escapeHtml(d.model)}</b><small>${escapeHtml(d.android)} · Ready to mirror</small></div><button class="device-action" data-mirror="${escapeHtml(d.serial)}">Start →</button></div>`).join('')}</div><p class="sub" style="margin-top:20px;font-size:11px">Mirroring opens in a separate scrcpy window. USB usually gives the most responsive experience.</p>` : `${emptyDevices(message)}<p class="sub" style="margin:12px 0 0">Install ADB and scrcpy to use device controls. See the setup guide.</p>`}`;
    document.querySelectorAll('[data-refresh]').forEach(el => el.addEventListener('click', refreshDevices));
    document.querySelectorAll('[data-mirror]').forEach(el => el.addEventListener('click', () => startMirror(el.dataset.mirror)));
    document.querySelectorAll('[data-transfer]').forEach(el => el.addEventListener('click', () => transferFiles(el.dataset.transfer)));
    document.querySelectorAll('[data-apps]').forEach(el => el.addEventListener('click', () => showApps(el.dataset.apps)));
  }

  async function refreshDevices() {
    if (scanning) return;
    scanning = true;
    $('device-label').textContent = 'Scanning…';
    try {
      const result = await api.listDevices();
      devices = result.devices || [];
      setDeviceViews(result.message);
    } catch (e) { setDeviceViews(`Could not query ADB: ${e.message}`); }
    finally { scanning = false; }
  }

  async function startMirror(serial) {
    const result = await api.mirror(serial);
    notify(result.ok ? 'Mirror opened in a scrcpy window.' : result.message);
  }
  window.startMirror = startMirror;

  async function transferFiles(serial) {
    const result = await api.transferFiles(serial);
    if (!result.canceled) notify(result.message || (result.ok ? 'Transfer complete.' : 'File transfer failed.'));
  }

  async function showApps(serial) {
    $('appDevice').value = serial;
    window.navigate('apps');
    await loadApps(serial);
  }

  window.openConnect = () => {
    $('connectModal').classList.add('show');
    $('connectModal').querySelector('h3').textContent = 'Connect an Android device';
    $('connectModal').querySelector('.modal-head p').textContent = 'Connect a phone or tablet by USB or over the same Wi-Fi network.';
    $('connectModal').querySelector('.steps').innerHTML = `<div class="connect-tabs"><button class="connect-tab active" id="usbTab">USB cable</button><button class="connect-tab" id="wifiTab">Wi-Fi</button></div><div id="usbConnectPanel"><div class="step"><div class="stepnum">1</div><div><b>Plug in and authorize</b><small>Enable USB debugging, connect the unlocked phone, and accept its prompt.</small></div></div><div class="step"><div class="stepnum">2</div><div><b>Refresh this list</b><small>MobiDesk will show your phone or tablet when authorized.</small></div></div><button class="btn primary connect-action" id="usbRefresh">Refresh device list</button></div><div id="wifiConnectPanel" style="display:none"><div class="step"><div class="stepnum">1</div><div><b>Prepare your phone</b><small>Connect both devices to the same Wi-Fi and turn on Developer options → Wireless debugging.</small></div></div><div class="step"><div class="stepnum">2</div><div><b>Show the pairing device</b><small>For first-time pairing, open “Pair device with pairing code.” Keep that screen open while scanning.</small></div></div><label class="wifi-label" for="pairCode">Pairing code from your phone</label><input class="field wifi-field" id="pairCode" placeholder="Six-digit code" inputmode="numeric" maxlength="6" autocomplete="one-time-code"><button class="btn secondary connect-action" id="scanWifi">⌕ &nbsp; Find nearby devices</button><div class="wifi-status" id="wifiStatus" role="status" aria-live="polite">Scan to find phones on this Wi-Fi network.</div><div class="wifi-device-list" id="wifiDevices"></div></div>`;
    $('deviceName').style.display = 'none';
    const buttons = $('connectModal').querySelector('.modal-actions');
    buttons.innerHTML = '<button class="btn secondary" onclick="closeModal(\'connectModal\')">Close</button>';
    const setStatus = (message, error = false) => { $('wifiStatus').textContent = message; $('wifiStatus').classList.toggle('error', error); };
    const switchMethod = wifi => {
      $('usbTab').classList.toggle('active', !wifi); $('wifiTab').classList.toggle('active', wifi);
      $('usbConnectPanel').style.display = wifi ? 'none' : 'block'; $('wifiConnectPanel').style.display = wifi ? 'block' : 'none';
    };
    $('usbTab').addEventListener('click', () => switchMethod(false));
    $('wifiTab').addEventListener('click', () => switchMethod(true));
    $('usbRefresh').addEventListener('click', async () => { closeModal('connectModal'); await refreshDevices(); notify(devices.length ? `${devices.length} device${devices.length === 1 ? '' : 's'} found.` : 'No authorized devices found. Check the USB debugging prompt.'); });
    const renderWifiDevices = found => {
      $('wifiDevices').innerHTML = found.map(device => {
        const kind = device.type === 'pair' ? 'Ready to pair' : 'Paired device';
        const suffix = device.name.startsWith('adb-') ? ` · ${device.name.slice(-6)}` : '';
        const action = device.type === 'pair' ? `<button class="btn primary wifi-device-action" data-pair="${escapeHtml(device.endpoint)}">Pair</button>` : `<button class="btn primary wifi-device-action" data-wificonnect="${escapeHtml(device.endpoint)}">Connect</button>`;
        return `<article class="wifi-device"><div class="wifi-device-icon">${device.type === 'pair' ? '＋' : '✓'}</div><div class="wifi-device-info"><b>Android device${suffix}</b><small>${kind} · ${escapeHtml(device.endpoint)}</small></div>${action}</article>`;
      }).join('');
      $('wifiDevices').querySelectorAll('[data-pair]').forEach(button => button.addEventListener('click', () => pairWifi(button.dataset.pair, button)));
      $('wifiDevices').querySelectorAll('[data-wificonnect]').forEach(button => button.addEventListener('click', () => connectWifi(button.dataset.wificonnect, button)));
    };
    const scanWifi = async () => {
      const button = $('scanWifi'); button.disabled = true; button.textContent = 'Searching…'; setStatus('Looking for Android devices on your Wi-Fi…');
      const result = await api.discoverWifiDevices();
      button.disabled = false; button.innerHTML = '⌕ &nbsp; Find nearby devices'; renderWifiDevices(result.devices || []);
      setStatus(result.devices?.length ? `${result.devices.length} wireless service${result.devices.length === 1 ? '' : 's'} found. Choose Pair or Connect.` : result.message, !result.ok);
    };
    const pairWifi = async (endpoint, button) => {
      const code = $('pairCode').value.trim();
      if (!/^\d{6}$/.test(code)) { setStatus('Enter the six-digit pairing code shown on your phone.', true); $('pairCode').focus(); return; }
      button.disabled = true; button.textContent = 'Pairing…'; setStatus('Pairing with your phone…');
      const result = await api.pairWifiDevice(endpoint, code);
      button.disabled = false; button.textContent = 'Pair';
      if (!result.ok) { setStatus(result.message, true); return; }
      $('pairCode').value = ''; setStatus('Paired. Finding its secure connection service…'); await scanWifi();
    };
    const connectWifi = async (endpoint, button) => {
      button.disabled = true; button.textContent = 'Connecting…'; setStatus('Connecting to the selected phone…');
      const result = await api.connectWifiDevice(endpoint);
      button.disabled = false; button.textContent = 'Connect';
      if (!result.ok) { setStatus(result.message, true); return; }
      closeModal('connectModal'); await refreshDevices(); notify(devices.length ? 'Phone connected over Wi-Fi.' : 'Connection requested. Refresh the device list in a moment.');
    };
    $('scanWifi').addEventListener('click', scanWifi);
  };

  createManagerWorkspace();
  window.addEventListener('DOMContentLoaded', async () => {
    const tools = await api.toolStatus();
    if (!tools.adb) notify('ADB not found. Follow the setup guide to connect a device.');
    await refreshDevices();
  });
  api.onToast(notify);
})();
