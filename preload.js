const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mobiDesk', {
  listDevices: () => ipcRenderer.invoke('devices:list'),
  discoverWifiDevices: () => ipcRenderer.invoke('device:wifi-discover'),
  pairWifiDevice: (address, code) => ipcRenderer.invoke('device:wifi-pair', address, code),
  connectWifiDevice: address => ipcRenderer.invoke('device:wifi-connect', address),
  toolStatus: () => ipcRenderer.invoke('tools:status'),
  mirror: serial => ipcRenderer.invoke('device:mirror', serial),
  transferFiles: serial => ipcRenderer.invoke('device:files', serial),
  listApps: serial => ipcRenderer.invoke('device:apps', serial),
  installApp: serial => ipcRenderer.invoke('device:app-install', serial),
  uninstallApp: (serial, packageName) => ipcRenderer.invoke('device:app-uninstall', serial, packageName),
  listContacts: serial => ipcRenderer.invoke('device:contacts', serial),
  importContacts: serial => ipcRenderer.invoke('device:contacts-import', serial),
  exportContacts: contacts => ipcRenderer.invoke('device:contacts-export', contacts),
  listMessages: serial => ipcRenderer.invoke('device:messages', serial),
  listFiles: (serial, path) => ipcRenderer.invoke('device:files-list', serial, path),
  storageInfo: serial => ipcRenderer.invoke('device:storage', serial),
  previewFile: (serial, path, thumbnail = false) => ipcRenderer.invoke('device:file-preview', serial, path, thumbnail),
  downloadFile: (serial, path, directory = false) => ipcRenderer.invoke('device:file-download', serial, path, directory),
  deleteFile: (serial, path) => ipcRenderer.invoke('device:file-delete', serial, path),
  uploadFiles: (serial, path) => ipcRenderer.invoke('device:file-upload', serial, path),
  openExternal: url => ipcRenderer.invoke('app:open-external', url),
  onToast: callback => ipcRenderer.on('app:toast', (_event, message) => callback(message))
});
