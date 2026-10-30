const { contextBridge, ipcRenderer } = require('electron');
// Deliberately expose individual operations, never IPC or arbitrary filesystem access.
contextBridge.exposeInMainWorld('drawaiDesktop', {
  initial: ipcRenderer.sendSync('drawai:bootstrap'),
  initialize: entries => ipcRenderer.invoke('drawai:initialize', entries),
  changed: entry => ipcRenderer.invoke('drawai:changed', entry),
  save: (id, saveAs = false) => ipcRenderer.invoke('drawai:save', { id, saveAs }),
  exportFile: id => ipcRenderer.invoke('drawai:export', { id }),
  open: () => ipcRenderer.invoke('drawai:open'),
  close: () => ipcRenderer.invoke('drawai:close'),
  onCommand: callback => { ipcRenderer.on('drawai:command', (_event, command) => callback(command)); },
});
