const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  print: () => window.print(),
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  startUpdate: (downloadUrl) => ipcRenderer.invoke('app:start-update', downloadUrl),
  checkForUpdates: () => ipcRenderer.invoke('app:check-for-updates'),
  onTriggerUpdateCheck: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const subscription = () => callback();
    ipcRenderer.on('app:trigger-update-check', subscription);
    return () => {
      ipcRenderer.removeListener('app:trigger-update-check', subscription);
    };
  },
});

// Forward native menu trigger to renderer DOM event for seamless UI integration
ipcRenderer.on('app:trigger-update-check', () => {
  window.dispatchEvent(new CustomEvent('app:trigger-update-check'));
});

