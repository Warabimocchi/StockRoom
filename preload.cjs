const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
    getVideos: () => ipcRenderer.invoke('get-videos'),
    getSettings: () => ipcRenderer.invoke('get-settings'),
    getPathForFile: (file) => {
        return (typeof webUtils !== 'undefined' && webUtils.getPathForFile) 
            ? webUtils.getPathForFile(file) 
            : file.path;
    },
    analyze: (paths) => ipcRenderer.send('analyze-videos', paths),
    updateTags: (data) => ipcRenderer.invoke('update-tags', data),
    getAllTags: () => ipcRenderer.invoke('get-all-tags'),
    generatePreview: (path) => ipcRenderer.invoke('generate-preview', path),
    deletePreview: (path) => ipcRenderer.invoke('delete-preview', path),
    openSettings: () => ipcRenderer.send('open-settings'),
    onProgress: (callback) => {
        ipcRenderer.removeAllListeners('progress');
        ipcRenderer.on('progress', (event, data) => callback(data));
    },
    // プリセット管理
    loadPresets: () => ipcRenderer.invoke('load-presets'),
    savePreset: (preset) => ipcRenderer.invoke('save-preset', preset),
    deletePreset: (presetId) => ipcRenderer.invoke('delete-preset', presetId),
    
    // Export機能
    selectExportDirectory: () => ipcRenderer.invoke('select-export-directory'),
    exportFiles: (data) => ipcRenderer.invoke('export-files', data),

});
