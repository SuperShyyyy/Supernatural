/**
 * 预加载脚本：只暴露一个窄接口给渲染进程（contextIsolation: true）。
 *
 * 渲染进程拿不到 require / fs / path，只能调用这里列出的能力 —— 这是 Electron
 * 安全基线，也让编辑器核心始终只依赖 FileSystemAdapter 抽象。
 *
 * 注意：Electron 的沙箱化 preload 只支持 CommonJS，不能用 ES module 的 import。
 * 即使 package.json 声明了 "type": "module"，preload 也必须用 .cjs / require，
 * 否则会报 "Cannot use import statement outside a module" 而整脚本加载失败，
 * 导致 window.mdEditor 未暴露、isElectron() === false、双击 .md 打不开文件。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mdEditor', {
  isElectron: true,

  openFile: () => ipcRenderer.invoke('file:open'),
  openPath: (filePath) => ipcRenderer.invoke('file:openPath', filePath),
  saveFile: (content, filePath) => ipcRenderer.invoke('file:save', content, filePath),
  saveFileAs: (content, suggestedName) => ipcRenderer.invoke('file:saveAs', content, suggestedName),
  listRecent: () => ipcRenderer.invoke('recent:list'),

  /** 原生菜单动作 / 主进程主动打开的文件 */
  onAction: (listener) => {
    const handler = (_event, action) => listener(action);
    ipcRenderer.on('md-editer:action', handler);
    return () => ipcRenderer.removeListener('md-editer:action', handler);
  },
  onOpened: (listener) => {
    const handler = (_event, doc) => listener(doc);
    ipcRenderer.on('md-editer:opened', handler);
    return () => ipcRenderer.removeListener('md-editer:opened', handler);
  },
  /** 初始化完成、监听器已注册后通知主进程，可安全投递启动文件 */
  ready: () => ipcRenderer.send('renderer:ready'),
});