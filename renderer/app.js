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
  let fileFilterBeforeGallery = 'all';
  let fileViewBeforeGallery = 'list';
  let galleryMode = false;
  let galleryReturnToStorageRoot = true;
  let galleryReturnPath = '';
  let galleryLoadSequence = 0;
  let fileRenderSequence = 0;
  let mediaPreviewRequest = 0;
  let selectionMode = false;
  let pressTimer = null;
  let suppressFileClick = false;
  const selectedFilePaths = new Set();
  let currentContacts = [];
  let currentMessages = [];
  let notificationsLoading = false;
  let clearingNotifications = false;
  let notificationCountSerial = '';
  let storageBreakdownRequest = 0;
  let mirrorRecordingSerial = '';
  const storageCache = new Map();
  const storageBreakdownCache = new Map();
  const $ = id => document.getElementById(id);
  const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const loadingMarkup = message => `<div class="empty loading-state" role="status" aria-live="polite"><span class="loading-spinner" aria-hidden="true"></span><span>${escapeHtml(message)}</span></div>`;
  const loadingInlineMarkup = message => `<span class="loading-inline" role="status"><span class="loading-spinner loading-spinner-inline" aria-hidden="true"></span>${escapeHtml(message)}</span>`;
  let notificationCount = 0;
  function updateNotificationCount(count, serial = notificationCountSerial) {
    const safeCount = Math.max(0, Math.floor(Number(count) || 0));
    const badge = $('notificationCount');
    const button = $('notificationBell');
    notificationCountSerial = serial;
    notificationCount = safeCount;
    if (badge) {
      badge.textContent = safeCount > 99 ? '99+' : String(safeCount);
      badge.hidden = safeCount === 0;
    }
    const clearButton = $('clearNotifications');
    if (clearButton) clearButton.disabled = safeCount === 0;
    if (button) {
      button.setAttribute('aria-label', safeCount ? `${safeCount} active phone notification${safeCount === 1 ? '' : 's'}` : 'View phone notifications');
      button.title = safeCount ? `${safeCount} active notification${safeCount === 1 ? '' : 's'}` : 'Notifications';
    }
  }
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
    document.querySelector('.nav[data-page="contacts"]').insertAdjacentHTML('afterend', '<div class="nav" data-page="notifications"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>Notifications</div>');
    document.querySelectorAll('.nav[data-page="contacts"],.nav[data-page="messages"]').forEach(nav => nav.addEventListener('click', () => { navigate(nav.dataset.page); loadPersonalData(nav.dataset.page); }));
    document.querySelector('.nav[data-page="notifications"]').addEventListener('click', () => { navigate('notifications'); loadNotifications(); });
    const notificationBell = document.querySelector('.top-right .iconbtn[title="Notifications"]');
    notificationBell.id = 'notificationBell';
    notificationBell.removeAttribute('onclick');
    notificationBell.setAttribute('aria-label', 'View phone notifications');
    const notificationDot = notificationBell.querySelector('.dot');
    if (notificationDot) {
      notificationDot.id = 'notificationCount';
      notificationDot.className = 'notification-count';
      notificationDot.setAttribute('aria-hidden', 'true');
      notificationDot.hidden = true;
    }
    notificationBell.addEventListener('click', () => { navigate('notifications'); loadNotifications(); });
    document.querySelector('.nav[data-page="files"]').addEventListener('click', () => { renderFilesRoot(); loadStorage($('fileDevice').value, true); });
    document.querySelector('.nav[data-page="apps"]').addEventListener('click', () => loadApps());
    $('files').querySelector('.card.panel').innerHTML = '<div class="panel-title"><h2 id="filesHeading">Device storage</h2><span class="textlink" id="filesSubheading">Choose a storage location</span></div><div class="storage-grid files-storage-grid" id="filesStorageCards"></div><div class="files-toolbar"><select id="fileDevice" class="field"></select><button class="btn secondary" id="openGallery" title="Shows all indexed pictures; use the type filter to browse videos, audio, documents, and other files.">Show all</button><button class="btn secondary" id="refreshFiles">Refresh</button><button class="btn primary" id="uploadFiles">＋ Import files / folders</button></div><div class="file-pathbar" id="filePathbar"><button class="btn secondary" id="fileRoot" title="Return to storage locations">Storage</button><button class="btn secondary" id="fileUp" title="Go up one folder">↑</button><input class="field" id="filePath" value="/sdcard" aria-label="Android folder path"><button class="btn secondary" id="fileGo">Go</button></div><div class="file-controls"><label class="filter-label">Show<select id="fileFilter" class="field" aria-label="Filter files"><option value="all">All types</option><option value="photos">Pictures</option><option value="videos">Videos</option><option value="audio">Audio</option><option value="documents">Documents</option><option value="files">Other files</option></select></label><div class="view-toggle"><button class="btn secondary active" data-file-view="list">☰ &nbsp;List</button><button class="btn secondary" data-file-view="grid">▦ &nbsp;Grid</button></div></div><div class="file-selection-bar" id="fileSelectionBar"><span id="fileSelectionCount">0 selected</span><button class="btn secondary" id="exportSelected" disabled>↓ Export selected</button><button class="btn danger" id="deleteSelected" disabled>Delete selected</button><button class="btn secondary" id="cancelSelection">Cancel</button></div><p class="sub files-hint">Long-press a file or folder to select it. Browse shared Android storage; protected folders may be unavailable.</p><div class="file-list" id="fileList"></div>';
    $('apps').querySelector('.hello').insertAdjacentHTML('beforeend', '<div class="apps-header-actions"><button class="btn secondary" id="openSamsungNotes" title="Open Samsung Notes on the selected device">Open Samsung Notes</button><button class="btn primary" id="installApk">＋ &nbsp;Install APK</button></div>');
    $('apps').querySelector('.card.panel').innerHTML = '<div class="apps-toolbar"><select id="appDevice" class="field"></select><button class="btn secondary" id="refreshApps">Refresh apps</button></div><div class="app-list" id="appList"><div class="empty">Choose a connected device to view its apps.</div></div>';
    const statStorage = document.querySelector('.overview .stat:nth-child(2)');
    statStorage.querySelector('small').textContent = 'Internal capacity';
    statStorage.querySelector('strong').id = 'statInternal'; statStorage.querySelector('strong').textContent = '—';
    const statFree = document.querySelector('.overview .stat:nth-child(3)');
    statFree.querySelector('small').textContent = 'Free storage';
    statFree.querySelector('strong').id = 'statFree'; statFree.querySelector('strong').textContent = '—';
    document.querySelector('.overview').insertAdjacentHTML('afterend', '<div class="storage-section"><div class="section-head"><h2>Device storage</h2><span>Live capacity</span><select id="storageDevice" class="field storage-select"></select></div><div class="storage-grid" id="storageCards"><div class="card storage-card"><div class="empty">Connect a device to see its storage.</div></div></div></div>');
    document.querySelector('.storage-section').insertAdjacentHTML('beforeend', '<div class="storage-breakdown-toolbar"><button class="btn secondary" id="storageBreakdownButton">Show app and file-type usage</button><span id="storageBreakdownStatus">See space used by apps, photos, videos, audio, documents, and other files.</span></div><div class="storage-breakdown-grid" id="storageBreakdown" hidden><article class="card storage-breakdown-card"><div class="storage-breakdown-title"><h3>Shared files by type</h3><small>Android MediaStore index</small></div><div id="storageCategoryUsage" class="storage-usage-list"></div></article><article class="card storage-breakdown-card"><div class="storage-breakdown-title"><h3>Apps by storage</h3><small>App, data, and cache</small></div><div id="storageAppUsage" class="storage-app-list"></div></article></div>');
    $('storageBreakdownButton').addEventListener('click', () => loadStorageBreakdown($('storageDevice').value, true));
    const activityPanel = document.querySelector('.lower .card.panel:first-child');
    activityPanel.innerHTML = '<div class="panel-title"><h2>Device snapshot</h2><span class="textlink">Live device data</span></div><div id="deviceSnapshot" class="snapshot-empty">Connect a phone or tablet to load device details.</div>';
    const mirrorButton = document.querySelector('.mirror-panel .startmirror');
    mirrorButton.removeAttribute('onclick');
    mirrorButton.addEventListener('click', () => devices[0] ? startMirror(devices[0].serial) : notify('Connect an Android device first.'));
    const mirrorPanel = document.querySelector('#mirror .card.panel');
    mirrorPanel.addEventListener('click', event => { const button = event.target.closest('[data-mirror-action]'); if (button) runMirrorAction(button.dataset.mirrorAction); });
    const content = document.querySelector('.content');
    content.insertAdjacentHTML('beforeend', '<section class="view" id="contacts"><div class="hello"><div><p class="eyebrow">PEOPLE</p><h1>Contacts</h1><p class="sub">View phone numbers, and import or export contacts.</p></div></div><div class="card panel"><div class="data-toolbar"><select id="contactsDevice" class="field"></select><input id="contactSearch" class="field" placeholder="Search contacts or numbers"><button class="btn primary" id="loadContacts">Load contacts</button><button class="btn secondary" id="importContacts">Import vCard</button><button class="btn secondary" id="exportContacts">Export CSV</button></div><div class="data-list" id="contactsList"><div class="empty">Select a device to view its contacts.</div></div></div></section><section class="view" id="messages"><div class="hello"><div><p class="eyebrow">TEXT MESSAGES</p><h1>Messages</h1><p class="sub">Read SMS messages on a connected Android device.</p></div></div><div class="card panel"><div class="data-toolbar"><select id="messagesDevice" class="field"></select><input id="messageSearch" class="field" placeholder="Search messages or numbers"><button class="btn primary" id="loadMessages">Load messages</button></div><div class="data-list" id="messagesList"><div class="empty">Select a device to view its messages.</div></div></div></section>');
    content.insertAdjacentHTML('beforeend', '<section class="view" id="notifications"><div class="hello"><div><p class="eyebrow">DEVICE ALERTS</p><h1>Notifications</h1><p class="sub">Active notifications from your Android device. Content stays on this PC.</p></div></div><div class="card panel"><div class="data-toolbar"><select id="notificationsDevice" class="field" aria-label="Android device"></select><button class="btn secondary" id="refreshNotifications">Refresh</button></div><div class="data-list" id="notificationsList" aria-live="polite"><div class="empty">Choose a connected device to view its notifications.</div></div></div></section>');
    $('refreshNotifications').addEventListener('click', () => loadNotifications());
    $('notificationsDevice').addEventListener('change', () => loadNotifications());
    $('refreshNotifications').insertAdjacentHTML('afterend', '<button class="btn secondary" id="clearNotifications" title="Dismiss all clearable notifications on the selected device">Clear notifications</button>');
    $('clearNotifications').addEventListener('click', clearNotifications);
    document.body.insertAdjacentHTML('beforeend', '<div class="message-drawer-wrap" id="messageDrawer"><aside class="message-drawer" role="dialog" aria-modal="true" aria-labelledby="messageDrawerTitle"><div class="message-drawer-head"><div><p class="eyebrow">TEXT MESSAGE</p><h2 id="messageDrawerTitle">Message details</h2></div><button class="close" id="closeMessageDrawer" aria-label="Close message">×</button></div><div id="messageDrawerContent"></div></aside></div>');
    $('messageDrawer').addEventListener('click', event => { if (event.target === $('messageDrawer')) closeMessageDrawer(); });
    $('closeMessageDrawer').addEventListener('click', closeMessageDrawer);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeMessageDrawer();
      const modal = $('mediaPreview');
      if (!modal?.classList.contains('show')) return;
      if (event.key === 'Escape') { closeMediaPreview(); return; }
      const selector = event.key === 'ArrowLeft' ? '[data-media-step="-1"]' : event.key === 'ArrowRight' ? '[data-media-step="1"]' : '';
      if (!selector) return;
      const control = modal.querySelector(selector);
      if (control && !control.disabled) { event.preventDefault(); control.click(); }
    });
    document.body.insertAdjacentHTML('beforeend', '<div class="modal-wrap media-preview-wrap" id="mediaPreview"></div>');
    $('mediaPreview').addEventListener('click', event => { if (event.target === $('mediaPreview')) closeMediaPreview(); });
    $('fileDevice').addEventListener('change', () => { currentFilePath = '/sdcard'; atStorageRoot = true; storageCache.delete($('fileDevice').value); loadStorage($('fileDevice').value, true); renderFilesRoot(); });
    $('storageDevice').addEventListener('change', () => { const serial = $('storageDevice').value; loadStorage(serial, true); updateDeviceSnapshot(); if (!$('storageBreakdown').hidden) loadStorageBreakdown(serial); });
    $('snapshotDevice')?.addEventListener('change', updateDeviceSnapshot);
    $('openGallery').addEventListener('click', () => { if (galleryMode) exitGalleryMode(); else loadGallery(); });
    $('refreshFiles').addEventListener('click', () => { const serial = $('fileDevice').value; storageCache.delete(serial); if (galleryMode) loadGallery(); else if (atStorageRoot) loadStorage(serial, true); else loadFiles(); });
    $('fileGo').addEventListener('click', () => loadFiles($('filePath').value));
    $('filePath').addEventListener('keydown', e => { if (e.key === 'Enter') loadFiles($('filePath').value); });
    $('fileRoot').addEventListener('click', renderFilesRoot);
    $('filesStorageCards').addEventListener('click', event => { const button = event.target.closest('[data-storage-path]'); if (button) loadFiles(button.dataset.storagePath); });
    $('fileUp').addEventListener('click', () => { if (currentFilePath === '/sdcard' || currentFilePath.split('/').filter(Boolean).length <= 2 && currentFilePath.startsWith('/storage/')) return renderFilesRoot(); const parts = currentFilePath.split('/').filter(Boolean); parts.pop(); loadFiles(`/${parts.join('/')}`); });
    $('uploadFiles').addEventListener('click', async () => {
      const button = $('uploadFiles');
      button.disabled = true; button.innerHTML = loadingInlineMarkup('Importing…');
      try {
        const result = await api.uploadFiles($('fileDevice').value, currentFilePath);
        if (!result.canceled) { notify(result.message || 'File upload failed.'); if (result.ok) loadFiles(); }
      } catch (error) {
        notify(error.message || 'File import failed.');
      } finally {
        button.disabled = false; button.innerHTML = '＋ Import files / folders';
      }
    });
    $('fileFilter').addEventListener('change', () => { currentFileFilter = $('fileFilter').value; renderFileEntries(); });
    $('fileList').addEventListener('change', event => { const checkbox = event.target.closest('[data-select-file]'); if (!checkbox) return; checkbox.checked ? selectedFilePaths.add(checkbox.value) : selectedFilePaths.delete(checkbox.value); updateFileSelection(); });
    $('fileList').addEventListener('pointerdown', beginFilePress);
    for (const eventName of ['pointerup','pointercancel','pointerleave']) $('fileList').addEventListener(eventName, endFilePress);
    $('fileList').addEventListener('click', event => { if (!suppressFileClick) return; suppressFileClick = false; event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); }, true);
    $('exportSelected').addEventListener('click', exportSelectedFiles);
    $('deleteSelected').addEventListener('click', deleteSelectedFiles);
    $('cancelSelection').addEventListener('click', clearFileSelection);
    document.querySelectorAll('[data-file-view]').forEach(button => button.addEventListener('click', () => { setFileView(button.dataset.fileView); renderFileEntries(); }));
    $('appDevice').addEventListener('change', () => loadApps($('appDevice').value));
    $('refreshApps').addEventListener('click', () => loadApps($('appDevice').value));
    $('openSamsungNotes').addEventListener('click', openSamsungNotes);
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
    leaveGalleryMode();
    atStorageRoot = true;
    fileRenderSequence++;
    currentFileEntries = [];
    currentFilePath = '/sdcard'; $('filePath').value = currentFilePath;
    $('fileRoot').textContent = 'Storage';
    $('fileUp').style.display = ''; $('filePath').style.display = ''; $('fileGo').style.display = '';
    $('filesStorageCards').style.display = '';
    $('uploadFiles').style.display = '';
    $('filesHeading').textContent = 'Device storage'; $('filesSubheading').textContent = 'Choose a storage location';
    $('filePathbar').style.display = 'none';
    $('fileFilter').closest('.file-controls').style.display = 'none';
    $('fileList').style.display = 'none';
    $('files').querySelector('.files-hint').style.display = 'none';
    $('fileList').innerHTML = '';
    $('files').querySelector('.files-hint').textContent = 'Long-press a file or folder to select it. Browse shared Android storage; protected folders may be unavailable.';
    clearFileSelection();
  }

  function leaveGalleryMode() {
    if (!galleryMode) return;
    galleryMode = false;
    galleryLoadSequence++;
    $('openGallery').textContent = 'Show all';
    $('openGallery').title = 'Shows all indexed pictures; use the type filter to browse videos, audio, documents, and other files.';
    currentFileFilter = fileFilterBeforeGallery;
    $('fileFilter').value = currentFileFilter;
    setFileView(fileViewBeforeGallery);
    galleryReturnToStorageRoot = true;
    galleryReturnPath = '';
  }

  function exitGalleryMode() {
    const returnToStorageRoot = galleryReturnToStorageRoot;
    const returnPath = galleryReturnPath;
    leaveGalleryMode();
    if (returnToStorageRoot) renderFilesRoot();
    else loadFiles(returnPath || '/sdcard');
  }

  async function loadGallery() {
    const serial = $('fileDevice').value;
    if (!serial) { notify('Connect an Android device first.'); return; }
    const request = ++galleryLoadSequence;
    if (!galleryMode) {
      galleryReturnToStorageRoot = atStorageRoot;
      galleryReturnPath = atStorageRoot ? '' : currentFilePath;
      fileFilterBeforeGallery = currentFileFilter;
      fileViewBeforeGallery = currentFileView;
      currentFileFilter = 'photos';
      setFileView('grid');
    }
    galleryMode = true;
    $('openGallery').textContent = 'Exit Show all';
    $('openGallery').title = 'Return to the folder or storage view you were in before Show all.';
    atStorageRoot = false;
    clearFileSelection();
    $('fileFilter').value = currentFileFilter;
    $('filesHeading').textContent = 'Show all';
    $('filesSubheading').textContent = 'Pictures and other file types across shared storage';
    $('filesStorageCards').style.display = 'none';
    $('uploadFiles').style.display = 'none';
    $('filePathbar').style.display = 'flex';
    $('fileRoot').textContent = 'Storage';
    $('fileUp').style.display = 'none'; $('filePath').style.display = 'none'; $('fileGo').style.display = 'none';
    $('fileFilter').closest('.file-controls').style.display = '';
    $('fileList').style.display = '';
    $('files').querySelector('.files-hint').style.display = '';
    $('files').querySelector('.files-hint').textContent = 'Shows all indexed pictures by default. Choose a type to browse videos, audio, documents, and other files.';
    fileRenderSequence++;
    currentFileEntries = [];
    $('fileList').innerHTML = loadingMarkup('Scanning shared storage…');
    let result;
    try { result = await api.mediaGallery(serial); }
    catch (error) {
      if (request === galleryLoadSequence && galleryMode) $('fileList').innerHTML = `<div class="empty">${escapeHtml(error.message || 'Could not load the gallery.')}</div>`;
      return;
    }
    if (request !== galleryLoadSequence || !galleryMode || $('fileDevice').value !== serial) return;
    if (!result.ok) {
      $('fileList').innerHTML = `<div class="empty">${escapeHtml(result.message || 'Could not load the gallery.')}</div>`;
      return;
    }
    currentFileEntries = result.entries;
    if (result.message) $('files').querySelector('.files-hint').textContent = `Some storage locations could not be indexed: ${result.message}`;
    renderFileEntries();
  }

  async function loadStorage(serial = $('storageDevice')?.value, force = false) {
    const cards = $('storageCards'); if (!cards) return;
    if (!serial) { applyStorageResult(null, ''); return; }
    if (!force && storageCache.has(serial)) { applyStorageResult(storageCache.get(serial), serial); return; }
    const pending = `<div class="card storage-card">${loadingMarkup('Reading live storage information…')}</div>`;
    if ($('storageDevice').value === serial) cards.innerHTML = pending;
    if ($('fileDevice').value === serial) $('filesStorageCards').innerHTML = pending;
    let result;
    try { result = await api.storageInfo(serial); }
    catch (error) { result = { ok: false, message: error.message || 'Could not read device storage.' }; }
    storageCache.set(serial, result);
    applyStorageResult(result, serial);
  }

  async function loadStorageBreakdown(serial = $('storageDevice')?.value, force = false) {
    const request = ++storageBreakdownRequest;
    const breakdown = $('storageBreakdown');
    const status = $('storageBreakdownStatus');
    const button = $('storageBreakdownButton');
    breakdown.hidden = false;
    if (!serial) {
      button.disabled = false;
      status.textContent = 'Connect a device to view storage usage.';
      $('storageCategoryUsage').innerHTML = '<div class="storage-breakdown-message">No device selected.</div>';
      $('storageAppUsage').innerHTML = '<div class="storage-breakdown-message">No device selected.</div>';
      return;
    }
    if (!force && storageBreakdownCache.has(serial)) {
      button.disabled = false;
      renderStorageBreakdown(storageBreakdownCache.get(serial));
      return;
    }
    button.disabled = true;
    status.innerHTML = loadingInlineMarkup('Reading Android storage statistics…');
    $('storageCategoryUsage').innerHTML = `<div class="storage-breakdown-message">${loadingInlineMarkup('Reading file types…')}</div>`;
    $('storageAppUsage').innerHTML = `<div class="storage-breakdown-message">${loadingInlineMarkup('Reading app sizes…')}</div>`;
    try {
      const result = await api.storageBreakdown(serial);
      storageBreakdownCache.set(serial, result);
      if (request !== storageBreakdownRequest || $('storageDevice').value !== serial) return;
      renderStorageBreakdown(result);
    } catch (error) {
      if (request !== storageBreakdownRequest) return;
      status.textContent = error.message || 'Could not read storage usage.';
      $('storageCategoryUsage').innerHTML = `<div class="storage-breakdown-message">${escapeHtml(status.textContent)}</div>`;
      $('storageAppUsage').innerHTML = `<div class="storage-breakdown-message">${escapeHtml(status.textContent)}</div>`;
    } finally {
      if (request === storageBreakdownRequest) button.disabled = false;
    }
  }

  function renderStorageBreakdown(result) {
    const status = $('storageBreakdownStatus');
    if (result.categories) {
      const categories = [
        ['Photos', result.categories.photos],
        ['Videos', result.categories.videos],
        ['Audio', result.categories.audio],
        ['Documents', result.categories.documents],
        ['Other files', result.categories.other]
      ];
      const total = categories.reduce((sum, [, bytes]) => sum + (Number.isFinite(bytes) ? bytes : 0), 0);
      $('storageCategoryUsage').innerHTML = categories.map(([label, bytes]) => {
        const value = Number.isFinite(bytes) ? bytes : 0;
        const percent = total ? Math.round(value / total * 100) : 0;
        return `<div class="storage-usage-row"><div class="storage-usage-head"><span>${label}</span><b>${formatBytes(value)}</b></div><div class="storage-usage-bar"><i style="width:${percent}%"></i></div></div>`;
      }).join('');
    } else {
      $('storageCategoryUsage').innerHTML = `<div class="storage-breakdown-message">${escapeHtml(result.categoryError || result.message || 'File-type statistics are unavailable.')}</div>`;
    }
    if (result.apps?.length) {
      const shownApps = result.apps.slice(0, 100);
      $('storageAppUsage').innerHTML = shownApps.map(app => `<article class="storage-app-row"><div><b>${escapeHtml(app.packageName)}</b><small>App ${formatBytes(app.codeBytes)} · Data ${formatBytes(app.dataBytes)} · Cache ${formatBytes(app.cacheBytes)}</small></div><strong>${formatBytes(app.totalBytes)}</strong></article>`).join('') + (result.apps.length > shownApps.length ? `<div class="storage-breakdown-message">Showing the 100 largest apps out of ${result.apps.length}.</div>` : '');
    } else {
      $('storageAppUsage').innerHTML = `<div class="storage-breakdown-message">${escapeHtml(result.appError || result.message || 'Per-app statistics are unavailable.')}</div>`;
    }
    const errors = [result.appError, result.categoryError].filter(Boolean);
    const statusParts = errors.slice();
    if (Number.isFinite(result.sampledAt)) statusParts.push(`Read at ${new Date(result.sampledAt).toLocaleTimeString()}. Android statistics may be cached.`);
    else if (result.message) statusParts.push(result.message);
    status.textContent = statusParts.join(' · ') || 'Storage statistics loaded.';
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
    leaveGalleryMode();
    atStorageRoot = false;
    clearFileSelection();
    $('uploadFiles').style.display = '';
    $('fileUp').style.display = ''; $('filePath').style.display = ''; $('fileGo').style.display = '';
    $('fileRoot').textContent = 'Storage';
    $('filesStorageCards').style.display = 'none'; $('filePathbar').style.display = ''; $('fileFilter').closest('.file-controls').style.display = ''; $('fileList').style.display = ''; $('files').querySelector('.files-hint').style.display = '';
    $('filesHeading').textContent = 'Files'; $('filesSubheading').textContent = 'Browse folders and media';
    $('files').querySelector('.files-hint').textContent = 'Long-press a file or folder to select it. Browse shared Android storage; protected folders may be unavailable.';
    $('fileList').innerHTML = loadingMarkup('Loading Android files…');
    loadStorage(serial);
    let result;
    try { result = await api.listFiles(serial, pathValue); }
    catch (error) { $('fileList').innerHTML = `<div class="empty">${escapeHtml(error.message || 'Could not read this folder.')}</div>`; return; }
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

  function isPreviewableImage(name) {
    return ['jpg','jpeg','png','gif','webp','bmp','avif'].includes(name.split('.').pop().toLowerCase());
  }

  function renderFileEntries() {
    const renderSequence = ++fileRenderSequence;
    const shown = currentFileEntries.filter(entry => entry.directory || currentFileFilter === 'all' || mediaKind(entry.name) === currentFileFilter);
    const remotePath = entry => entry.path || `${currentFilePath.replace(/\/$/, '')}/${entry.name}`;
    const icon = entry => entry.directory ? '▰' : mediaKind(entry.name) === 'photos' ? '▧' : mediaKind(entry.name) === 'videos' ? '▶' : mediaKind(entry.name) === 'audio' ? '♫' : mediaKind(entry.name) === 'documents' ? '▧' : '▤';
    $('fileList').className = `${currentFileView === 'grid' ? 'file-list file-grid' : 'file-list'}${selectionMode ? ' selection-mode' : ''}`;
    if (!shown.length) { $('fileList').innerHTML = `<div class="empty">${galleryMode ? 'No matching files found in shared storage.' : 'No matching files in this folder.'}</div>`; updateFileSelection(); return; }
    $('fileList').innerHTML = shown.map(entry => {
      const file = remotePath(entry); const kind = mediaKind(entry.name); const isPreviewable = !entry.directory && (kind === 'photos' ? isPreviewableImage(entry.name) : ['videos','audio'].includes(kind));
      const kindLabel = ({photos:'Picture', videos:'Video', audio:'Audio', documents:'Document', files:'File'})[kind];
      const target = entry.directory ? `data-open-folder="${escapeHtml(entry.name)}"` : isPreviewable ? `data-preview="${escapeHtml(file)}"` : `data-download="${escapeHtml(file)}"`;
      const playerButton = isPreviewable && ['videos','audio'].includes(kind) ? `<button class="device-action" data-preview="${escapeHtml(file)}" aria-label="Play ${kindLabel.toLowerCase()} ${escapeHtml(entry.name)}">Play</button>` : '';
      const select = `<input class="file-select" type="checkbox" data-select-file value="${escapeHtml(file)}" aria-label="Select ${escapeHtml(entry.name)}" ${selectedFilePaths.has(file) ? 'checked' : ''}>`;
      if (currentFileView === 'grid') return `<article class="file-tile" data-file-item="${escapeHtml(file)}">${select}<button class="file-tile-open" ${target}><span class="file-tile-icon ${entry.directory ? 'folder' : kind}${isPreviewableImage(entry.name) && !entry.directory ? ' photo-loading' : ''}">${icon(entry)}${isPreviewableImage(entry.name) && !entry.directory ? `<img class="photo-thumb" data-photo-thumb="${escapeHtml(file)}" alt="">` : ''}</span><b>${escapeHtml(entry.name)}${entry.directory ? '/' : ''}</b><small>${entry.directory ? 'Folder' : kindLabel}</small></button>${playerButton}<button class="device-action" data-download="${escapeHtml(file)}" data-is-directory="${entry.directory}">Export</button></article>`;
      return `<div class="file-row" data-file-item="${escapeHtml(file)}">${select}<span class="file-type ${entry.directory ? 'folder' : kind}">${icon(entry)}</span><button class="file-name" ${target}>${escapeHtml(entry.name)}${entry.directory ? '/' : ''}</button><span class="file-kind">${entry.directory ? 'Folder' : kindLabel}</span>${isPreviewable ? `<button class="device-action" data-preview="${escapeHtml(file)}" aria-label="${['videos','audio'].includes(kind) ? 'Play' : 'View'} ${kindLabel.toLowerCase()} ${escapeHtml(entry.name)}">${['videos','audio'].includes(kind) ? 'Play' : 'View'}</button>` : ''}<button class="device-action" data-download="${escapeHtml(file)}" data-is-directory="${entry.directory}">Export</button></div>`;
    }).join('');
    $('fileList').querySelectorAll('[data-open-folder]').forEach(button => button.addEventListener('click', () => loadFiles(`${currentFilePath.replace(/\/$/, '')}/${button.dataset.openFolder}`)));
    $('fileList').querySelectorAll('[data-download]').forEach(button => button.addEventListener('click', async () => { const downloaded = await api.downloadFile($('fileDevice').value, button.dataset.download, button.dataset.isDirectory === 'true'); if (!downloaded.canceled) notify(downloaded.message || 'Export failed.'); }));
    $('fileList').querySelectorAll('[data-preview]').forEach(button => button.addEventListener('click', () => previewMedia(button.dataset.preview)));
    if (currentFileView === 'grid') {
      const photos = shown.filter(entry => !entry.directory && isPreviewableImage(entry.name));
      loadPhotoThumbnails(galleryMode ? photos : photos.slice(0, 12), renderSequence);
    }
    updateFileSelection();
  }

  function setFileView(view) {
    currentFileView = view;
    document.querySelectorAll('[data-file-view]').forEach(button => button.classList.toggle('active', button.dataset.fileView === view));
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
    selectedFilePaths.clear(); notify('Selected items deleted.'); if (galleryMode) loadGallery(); else loadFiles();
  }

  async function loadPhotoThumbnails(entries, renderSequence) {
    const serial = $('fileDevice').value;
    let next = 0;
    const workers = Array.from({ length: Math.min(4, entries.length) }, async () => {
      while (renderSequence === fileRenderSequence) {
        const entry = entries[next++];
        if (!entry) return;
        const remote = entry.path || `${currentFilePath.replace(/\/$/, '')}/${entry.name}`;
        const result = await api.previewFile(serial, remote, true);
        if (renderSequence !== fileRenderSequence) return;
        const image = [...$('fileList').querySelectorAll('[data-photo-thumb]')].find(item => item.dataset.photoThumb === remote);
        if (image && !result.ok) image.parentElement.classList.remove('photo-loading');
        if (result.ok) {
          if (image) {
            image.addEventListener('load', () => image.parentElement.classList.remove('photo-loading'), { once: true });
            image.addEventListener('error', () => image.parentElement.classList.remove('photo-loading'), { once: true });
            image.src = result.dataUrl;
          }
        }
      }
    });
    await Promise.all(workers);
  }

  async function previewMedia(remotePath) {
    const request = ++mediaPreviewRequest;
    const serial = $('fileDevice').value;
    const filename = remotePath.split('/').pop();
    const modal = $('mediaPreview');
    modal.innerHTML = `<div class="media-preview-card">${loadingMarkup(`Loading ${filename}…`)}</div>`;
    modal.classList.add('show');
    let result;
    try { result = await api.previewFile(serial, remotePath); }
    catch (error) {
      if (request === mediaPreviewRequest) {
        closeMediaPreview();
        notify(error.message || `Could not load ${filename}.`);
      }
      return;
    }
    if (request !== mediaPreviewRequest) return;
    if (!result.ok) { closeMediaPreview(); notify(result.message); return; }
    const type = result.mime.startsWith('image/') ? 'image' : result.mime.startsWith('video/') ? 'video' : 'audio';
    const content = type === 'image' ? `<img class="media-image" src="${result.dataUrl}" alt="${escapeHtml(filename)}">` : type === 'video' ? `<video class="media-video" src="${result.dataUrl}" controls autoplay preload="metadata" aria-label="Video player for ${escapeHtml(filename)}"></video>` : `<audio class="media-audio" src="${result.dataUrl}" controls autoplay preload="metadata" aria-label="Audio player for ${escapeHtml(filename)}"></audio>`;
    const imagePaths = type === 'image' ? currentFileEntries.filter(entry => !entry.directory && isPreviewableImage(entry.name)).map(entry => entry.path || `${currentFilePath.replace(/\/$/, '')}/${entry.name}`) : [];
    const imageIndex = imagePaths.indexOf(remotePath);
    const canNavigate = imageIndex >= 0 && imagePaths.length > 1;
    const navigation = canNavigate ? `<div class="media-preview-nav"><button type="button" class="btn secondary" id="mediaPrevious" data-media-step="-1" aria-label="Previous image" ${imageIndex === 0 ? 'disabled' : ''}>Previous</button><span>Image ${imageIndex + 1} of ${imagePaths.length}</span><button type="button" class="btn secondary" id="mediaNext" data-media-step="1" aria-label="Next image" ${imageIndex === imagePaths.length - 1 ? 'disabled' : ''}>Next</button></div>` : '';
    modal.innerHTML = `<div class="media-preview-card${canNavigate ? ' has-image-slider' : ''}"><div class="media-preview-head"><b>${escapeHtml(filename)}</b><button class="close" id="closeMediaPreview" aria-label="Close preview">×</button></div><div class="media-preview-content">${content}</div>${navigation}</div>`;
    modal.classList.add('show');
    $('closeMediaPreview').addEventListener('click', closeMediaPreview);
    if (canNavigate) {
      $('mediaPrevious').addEventListener('click', () => previewMedia(imagePaths[imageIndex - 1]));
      $('mediaNext').addEventListener('click', () => previewMedia(imagePaths[imageIndex + 1]));
    }
  }

  function closeMediaPreview() {
    mediaPreviewRequest++;
    const modal = $('mediaPreview');
    modal.classList.remove('show');
    modal.innerHTML = '';
  }

  async function loadApps(serial = $('appDevice')?.value) {
    if (!serial) { $('appList').innerHTML = '<div class="empty">Connect a phone or tablet first.</div>'; return; }
    $('appList').innerHTML = loadingMarkup('Loading installed apps…');
    let result;
    try { result = await api.listApps(serial); }
    catch (error) { $('appList').innerHTML = `<div class="empty">${escapeHtml(error.message || 'Could not load installed apps.')}</div>`; return; }
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
      button.disabled = true; button.innerHTML = loadingInlineMarkup('Removing…');
      try {
        const removed = await api.uninstallApp(serial, pkg); notify(removed.message || (removed.ok ? 'App uninstalled.' : 'Uninstall failed.'));
        if (removed.ok) loadApps(serial);
        else { button.disabled = false; button.textContent = 'Uninstall'; }
      } catch (error) {
        notify(error.message || `Could not uninstall ${pkg}.`);
        button.disabled = false; button.textContent = 'Uninstall';
      }
    }));
  }

  async function installApk() {
    const serial = $('appDevice').value;
    if (!serial) { notify('Connect a phone or tablet first.'); return; }
    if (!window.confirm('Choose an Android APK to install on the selected device? Android may ask you to confirm on the phone.')) return;
    const button = $('installApk');
    button.disabled = true; button.innerHTML = loadingInlineMarkup('Installing…');
    try {
      const result = await api.installApp(serial);
      if (!result.canceled) { notify(result.message || (result.ok ? 'App installed.' : 'Install failed.')); if (result.ok) loadApps(serial); }
    } catch (error) {
      notify(error.message || 'APK installation failed.');
    } finally {
      button.disabled = false; button.innerHTML = '＋ &nbsp;Install APK';
    }
  }

  async function openSamsungNotes() {
    const serial = $('appDevice').value;
    if (!serial) { notify('Connect a phone or tablet first.'); return; }
    const button = $('openSamsungNotes');
    button.disabled = true;
    button.innerHTML = loadingInlineMarkup('Opening…');
    try {
      const result = await api.openSamsungNotes(serial);
      notify(result.message || (result.ok ? 'Samsung Notes opened on the device.' : 'Could not open Samsung Notes.'));
    } catch (error) {
      notify(error.message || 'Could not open Samsung Notes.');
    } finally {
      button.disabled = false;
      button.textContent = 'Open Samsung Notes';
    }
  }

  async function loadPersonalData(section) {
    const contacts = section === 'contacts';
    const serial = $(`${section}Device`).value;
    const list = $(`${section}List`);
    if (!serial) { list.innerHTML = '<div class="empty">Connect a phone or tablet first.</div>'; if (contacts) currentContacts = []; return; }
    list.innerHTML = loadingMarkup(`Loading ${contacts ? 'contacts' : 'messages'}…`);
    let result;
    try { result = contacts ? await api.listContacts(serial) : await api.listMessages(serial); }
    catch (error) {
      list.innerHTML = `<div class="empty">${escapeHtml(error.message || `Could not load ${contacts ? 'contacts' : 'messages'}.`)}</div>`;
      if (contacts) currentContacts = [];
      return;
    }
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

  async function loadNotifications(serial = $('notificationsDevice')?.value, quiet = false) {
    const list = $('notificationsList');
    if (!list) return;
    if (!serial) {
      updateNotificationCount(0, '');
      list.innerHTML = '<div class="empty">Connect an Android device to view its notifications.</div>';
      return;
    }
    if (serial !== notificationCountSerial) updateNotificationCount(0, serial);
    if (notificationsLoading || clearingNotifications) return;
    notificationsLoading = true;
    const clearButton = $('clearNotifications');
    if (clearButton) clearButton.disabled = true;
    if (!quiet) list.innerHTML = loadingMarkup('Loading active notifications…');
    try {
      const result = await api.listNotifications(serial);
      if ($('notificationsDevice').value !== serial) return;
      if (!result.ok) {
        list.innerHTML = `<div class="empty">${escapeHtml(result.message || 'Could not read notifications.')}</div>`;
        return;
      }
      const notifications = result.notifications || [];
      updateNotificationCount(notifications.length, serial);
      list.innerHTML = notifications.length ? notifications.map(notification => {
        const title = notification.title || notification.text || notification.packageName || 'Notification';
        const text = notification.text && notification.text !== title ? notification.text : '';
        const date = Number.isFinite(notification.timestamp) && notification.timestamp > 0 ? new Date(notification.timestamp).toLocaleString() : '';
        return `<article class="message-row notification-row"><div class="message-head"><b>${escapeHtml(title)}</b><span>${escapeHtml(date)}</span></div><div class="notification-app">${escapeHtml(notification.packageName)}</div>${text ? `<p>${escapeHtml(text)}</p>` : ''}</article>`;
      }).join('') : '<div class="empty">No active notifications on this device.</div>';
    } catch (error) {
      list.innerHTML = `<div class="empty">${escapeHtml(error.message || 'Could not read notifications.')}</div>`;
    } finally {
      notificationsLoading = false;
      if (clearButton) clearButton.disabled = notificationCount === 0;
    }
  }

  async function clearNotifications() {
    const serial = $('notificationsDevice').value;
    if (!serial || notificationCount === 0) return;
    if (!window.confirm('Clear all dismissible notifications from this device?')) return;
    const button = $('clearNotifications');
    button.disabled = true;
    button.innerHTML = loadingInlineMarkup('Clearing…');
    let refresh = false;
    clearingNotifications = true;
    try {
      const result = await api.clearNotifications(serial);
      if (!result.ok) { notify(result.message || 'Could not clear notifications.'); return; }
      if ($('notificationsDevice').value === serial) {
        updateNotificationCount(0, serial);
        $('notificationsList').innerHTML = loadingMarkup('Refreshing notifications…');
      }
      notify(result.message || 'Notifications cleared.');
      refresh = true;
    } catch (error) {
      notify(error.message || 'Could not clear notifications.');
    } finally {
      clearingNotifications = false;
      button.textContent = 'Clear notifications';
      button.disabled = notificationCount === 0;
    }
    if (refresh) await loadNotifications(undefined, true);
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
    for (const id of ['fileDevice', 'appDevice', 'contactsDevice', 'messagesDevice', 'notificationsDevice', 'storageDevice']) {
      const select = $(id); if (!select) continue;
      const previous = select.value;
      const selected = devices.some(d => d.serial === previous) ? previous : devices[0]?.serial;
      select.innerHTML = selectOptions(selected);
    }
    loadNotifications(undefined, true);
    updateDeviceSnapshot();
    loadStorage($('storageDevice')?.value, true);
    if ($('fileDevice')?.value && $('fileDevice').value !== $('storageDevice')?.value) loadStorage($('fileDevice').value, true);
    $('mirror').querySelector('.card.panel').innerHTML = count ? `<div class="panel-title"><div><h2>Mirror workspace</h2><span class="textlink">Live screen · Powered by scrcpy</span></div><select class="field mirror-device-select" id="mirrorDevice" aria-label="Device to mirror">${selectOptions(devices[0].serial)}</select></div><div class="mirror-workspace"><div class="mirror-frame" id="mirrorFrame"><div class="mirror-frame-head"><span>DEVICE SCREEN</span><span class="mirror-live-dot"><i></i> READY</span></div><div class="mirror-screen-viewport"><div class="mirror-placeholder" id="mirrorPlaceholder"><span class="mirror-placeholder-icon">▯</span><b>Ready to mirror</b><small>The live scrcpy window opens when you press Start mirror.</small><button class="btn primary" data-mirror-action="start">Start mirror</button></div><img id="mirrorScreenshot" class="mirror-screenshot" alt="Latest phone screenshot" style="display:none"></div></div><div class="mirror-toolbar" aria-label="Phone mirror controls"><button class="mirror-tool" data-mirror-action="back" title="Go back on phone"><span>↶</span><small>Back</small></button><button class="mirror-tool" data-mirror-action="recents" title="Open recent apps on phone"><span>▢</span><small>Recent apps</small></button><button class="mirror-tool" data-mirror-action="vibrate" title="Vibrate phone"><span>〰</span><small>Vibrate</small></button><button class="mirror-tool" data-mirror-action="screenshot" title="Take a screenshot"><span>▣</span><small>Screenshot</small></button><button class="mirror-tool mirror-record" id="mirrorRecordButton" data-mirror-action="record-start" title="Start video capture"><span>●</span><small>Video capture</small></button><button class="mirror-tool" data-mirror-action="minimize" title="Minimize mirror frame"><span>—</span><small>Minimize</small></button><button class="mirror-tool mirror-close" data-mirror-action="close" title="Close scrcpy mirror"><span>×</span><small>Close</small></button></div></div><p class="sub mirror-status" id="mirrorStatus">Choose Start mirror for the live scrcpy window. Controls here operate the selected phone.</p>` : `<div class="panel-title"><h2>No device is ready to mirror</h2><span class="textlink">USB or Wi-Fi</span></div>${emptyDevices(message)}`;
    document.querySelectorAll('[data-refresh]').forEach(el => el.addEventListener('click', refreshDevices));
    document.querySelectorAll('[data-mirror]').forEach(el => el.addEventListener('click', () => startMirror(el.dataset.mirror)));
    document.querySelectorAll('[data-transfer]').forEach(el => el.addEventListener('click', () => transferFiles(el.dataset.transfer)));
    document.querySelectorAll('[data-apps]').forEach(el => el.addEventListener('click', () => showApps(el.dataset.apps)));
  }

  async function refreshDevices() {
    if (scanning) return;
    scanning = true;
    $('device-label').innerHTML = loadingInlineMarkup('Scanning…');
    try {
      const result = await api.listDevices();
      devices = result.devices || [];
      setDeviceViews(result.message);
    } catch (e) { setDeviceViews(`Could not query ADB: ${e.message}`); }
    finally { scanning = false; }
  }

  async function startMirror(serial) {
    const status = $('mirrorStatus');
    if (status) status.innerHTML = loadingInlineMarkup('Starting scrcpy mirror…');
    try {
      const result = await api.mirror(serial);
      notify(result.ok ? 'Mirror opened in a scrcpy window.' : result.message);
      if (status) status.textContent = result.ok ? 'The live scrcpy mirror is open. Use the controls here to operate the phone.' : result.message;
    } catch (error) {
      const message = error.message || 'Could not start the mirror.';
      notify(message);
      if (status) status.textContent = message;
    }
  }
  window.startMirror = startMirror;

  async function runMirrorAction(action) {
    const serial = $('mirrorDevice')?.value || devices[0]?.serial;
    if (!serial) { notify('Connect an Android device first.'); return; }
    const frame = $('mirrorFrame');
    if (action === 'minimize') {
      frame?.classList.toggle('minimized');
      const minimized = frame?.classList.contains('minimized');
      const button = document.querySelector('[data-mirror-action="minimize"] small');
      if (button) button.textContent = minimized ? 'Restore' : 'Minimize';
      return;
    }
    if (action === 'close' && mirrorRecordingSerial === serial) await runMirrorAction('record-stop');
    if (action === 'start') { await startMirror(serial); return; }
    const result = await api.mirrorAction(serial, action);
    if (result.canceled) { if (action === 'record-stop') resetMirrorRecordingButton(); return; }
    if (!result.ok && action === 'record-stop') resetMirrorRecordingButton();
    if (!result.ok) { notify(result.message || 'Mirror control failed.'); if ($('mirrorStatus')) $('mirrorStatus').textContent = result.message || 'Mirror control failed.'; return; }
    if (action === 'screenshot' && result.dataUrl) {
      const image = $('mirrorScreenshot'); image.src = result.dataUrl; image.style.display = 'block';
      $('mirrorPlaceholder').style.display = 'none'; frame?.classList.add('has-screenshot');
    }
    if (action === 'record-start') {
      mirrorRecordingSerial = serial;
      const button = $('mirrorRecordButton'); button.dataset.mirrorAction = 'record-stop'; button.classList.add('recording');
      button.title = 'Stop video capture and save the clip'; button.querySelector('small').textContent = 'Stop & save';
    } else if (action === 'record-stop') {
      resetMirrorRecordingButton();
    }
    if (action === 'close') $('mirrorStatus').textContent = 'Mirror window closed.';
    else if (action === 'screenshot') $('mirrorStatus').textContent = 'Screenshot saved. The latest capture is shown in this frame.';
    else $('mirrorStatus').textContent = result.message;
    notify(result.message);
  }

  function resetMirrorRecordingButton() {
    mirrorRecordingSerial = '';
    const button = $('mirrorRecordButton'); if (button) { button.dataset.mirrorAction = 'record-start'; button.classList.remove('recording'); button.title = 'Start video capture'; button.querySelector('small').textContent = 'Video capture'; }
  }

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
      const button = $('scanWifi'); button.disabled = true; button.innerHTML = loadingInlineMarkup('Searching…'); setStatus('Looking for Android devices on your Wi-Fi…');
      try {
        const result = await api.discoverWifiDevices();
        renderWifiDevices(result.devices || []);
        setStatus(result.devices?.length ? `${result.devices.length} wireless service${result.devices.length === 1 ? '' : 's'} found. Choose Pair or Connect.` : result.message, !result.ok);
      } catch (error) {
        renderWifiDevices([]);
        setStatus(error.message || 'Could not search for Android devices.', true);
      } finally {
        button.disabled = false; button.innerHTML = '⌕ &nbsp; Find nearby devices';
      }
    };
    const pairWifi = async (endpoint, button) => {
      const code = $('pairCode').value.trim();
      if (!/^\d{6}$/.test(code)) { setStatus('Enter the six-digit pairing code shown on your phone.', true); $('pairCode').focus(); return; }
      button.disabled = true; button.innerHTML = loadingInlineMarkup('Pairing…'); setStatus('Pairing with your phone…');
      let result;
      try { result = await api.pairWifiDevice(endpoint, code); }
      catch (error) { setStatus(error.message || 'Could not pair with the phone.', true); return; }
      finally { button.disabled = false; button.textContent = 'Pair'; }
      if (!result.ok) { setStatus(result.message, true); return; }
      $('pairCode').value = ''; setStatus('Paired. Finding its secure connection service…'); await scanWifi();
    };
    const connectWifi = async (endpoint, button) => {
      button.disabled = true; button.innerHTML = loadingInlineMarkup('Connecting…'); setStatus('Connecting to the selected phone…');
      let result;
      try { result = await api.connectWifiDevice(endpoint); }
      catch (error) { setStatus(error.message || 'Could not connect to the phone.', true); return; }
      finally { button.disabled = false; button.textContent = 'Connect'; }
      if (!result.ok) { setStatus(result.message, true); return; }
      closeModal('connectModal'); await refreshDevices(); notify(devices.length ? 'Phone connected over Wi-Fi.' : 'Connection requested. Refresh the device list in a moment.');
    };
    $('scanWifi').addEventListener('click', scanWifi);
  };

  createManagerWorkspace();
  setInterval(() => {
    if (devices.length) loadNotifications(undefined, true);
  }, 8000);
  window.addEventListener('DOMContentLoaded', async () => {
    const tools = await api.toolStatus();
    if (!tools.adb) notify('ADB not found. Follow the setup guide to connect a device.');
    await refreshDevices();
  });
  api.onToast(notify);
})();
