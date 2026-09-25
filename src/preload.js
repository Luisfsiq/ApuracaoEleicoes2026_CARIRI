const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electionAPI', {
  loadDefault: () => ipcRenderer.invoke('election:load-default'),
  openWorkbook: () => ipcRenderer.invoke('election:open-workbook'),
  exportWorkbook: (payload) => ipcRenderer.invoke('election:export-workbook', payload),
});
