const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('vexb', {
  listProjects: () => ipcRenderer.invoke('projects:list'),
  readProject: (id) => ipcRenderer.invoke('projects:read', id),
  saveProject: (project) => ipcRenderer.invoke('projects:save', project),
  saveProjectNow: (project) => ipcRenderer.sendSync('projects:save-now', project),
  deleteProject: (id) => ipcRenderer.invoke('projects:delete', id),
  listExtensions: () => ipcRenderer.invoke('extensions:list'),
  choosePluginsFolder: () => ipcRenderer.invoke('extensions:choose-folder'),
  readExtension: (folder) => ipcRenderer.invoke('extensions:read', folder),
  writeExtension: (folder, files, previousFolder) => ipcRenderer.invoke('extensions:write', folder, files, previousFolder),
  openExtensionFolder: (folder) => ipcRenderer.invoke('extensions:open-folder', folder),
  chooseGameFolder: () => ipcRenderer.invoke('autofill:choose-folder'),
  scanGame: (folder) => ipcRenderer.invoke('autofill:scan', folder),
})
