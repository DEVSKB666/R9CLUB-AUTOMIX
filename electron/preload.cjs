const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('beatBlend', {
  chooseAudio: () => ipcRenderer.invoke('audio:choose'),
  analyzeSilence: (path, threshold, duration) =>
    ipcRenderer.invoke('audio:analyze-silence', { path, threshold, duration }),
  exportMix: (payload) => ipcRenderer.invoke('audio:export', payload),
  cancelExport: () => ipcRenderer.invoke('audio:cancel-export'),
  getAudioCapabilities: (sampleRate, asioDriver) => ipcRenderer.invoke('audio:capabilities', { sampleRate, asioDriver }),
  startExclusivePlayback: (payload) => ipcRenderer.invoke('audio:exclusive-start', payload),
  startAsioPlayback: (payload) => ipcRenderer.invoke('audio:asio-start', payload),
  stopExclusivePlayback: () => ipcRenderer.invoke('audio:exclusive-stop'),
  revealFile: (filePath) => ipcRenderer.invoke('file:reveal', filePath),
  saveProject: (project) => ipcRenderer.invoke('project:save', project),
  openProject: () => ipcRenderer.invoke('project:open'),
  autosaveProject: (project) => ipcRenderer.invoke('project:autosave', project),
  loadAutosave: () => ipcRenderer.invoke('project:load-autosave'),
  clearAutosave: () => ipcRenderer.invoke('project:clear-autosave'),
  onExportProgress: (callback) => {
    const handler = (_event, value) => callback(value);
    ipcRenderer.on('audio:export-progress', handler);
    return () => ipcRenderer.removeListener('audio:export-progress', handler);
  },
  onExportState: (callback) => {
    const handler = (_event, value) => callback(value);
    ipcRenderer.on('audio:export-state', handler);
    return () => ipcRenderer.removeListener('audio:export-state', handler);
  },
  onAudioEngineState: (callback) => {
    const handler = (_event, value) => callback(value);
    ipcRenderer.on('audio:engine-state', handler);
    return () => ipcRenderer.removeListener('audio:engine-state', handler);
  },
});
