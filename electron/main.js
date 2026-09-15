/**
 * Electron 主进程。
 *
 * 只做"宿主"该做的事：窗口、原生菜单、文件对话框、真实文件读写、最近文件。
 * 编辑器核心（src/core、src/markdown）完全不知道 Electron 的存在 ——
 * 它通过 FileSystemAdapter 拿到内容，因此同一份代码也能跑在浏览器里。
 */

import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startServer } from '../scripts/serve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, '../build/supernatural/app');
const RECENT_FILE = path.join(app.getPath('userData'), 'recent-files.json');

const MARKDOWN_FILTERS = [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'txt'] }];

let mainWindow = null;
let server = null;

/** 最近文件：主进程持有，避免每个窗口各自维护一份。 */
async function readRecent() {
  try {
    const raw = await fs.readFile(RECENT_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, 10) : [];
  } catch {
    return [];
  }
}

async function writeRecent(entries) {
  await fs.mkdir(path.dirname(RECENT_FILE), { recursive: true });
  await fs.writeFile(RECENT_FILE, JSON.stringify(entries.slice(0, 10)), 'utf8');
}

async function addRecent(entry) {
  const entries = (await readRecent()).filter((item) => item.path !== entry.path);
  entries.unshift({ name: entry.name, path: entry.path, updatedAt: Date.now() });
  await writeRecent(entries);
  refreshMenu();
}

async function readFileByPath(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return { name: path.basename(filePath), path: filePath, content };
}

/** 从命令行参数里挑出第一个 Markdown 文件（.desktop 用 %F / %U 传进来的路径）。 */
const MD_EXT = ['.md', '.markdown', '.mdown', '.txt'];
function fileArgFromArgv(argv) {
  for (const raw of argv || []) {
    if (typeof raw !== 'string' || raw.length === 0) continue;
    // 文件关联可能以 file:// URL 传入（.desktop 的 %U 且路径含中文会被 URL 编码），需还原成真实路径
    let candidate = raw;
    if (candidate.startsWith('file://')) {
      try {
        candidate = fileURLToPath(candidate);
      } catch {
        continue;
      }
    }
    if (MD_EXT.includes(path.extname(candidate).toLowerCase())) return candidate;
  }
  return undefined;
}

/** 读取并加载某个文件：加入最近文件、通知渲染进程打开。 */
async function openFileAt(filePath) {
  try {
    const doc = await readFileByPath(filePath);
    await addRecent({ name: doc.name, path: doc.path });
    mainWindow?.webContents.send('md-editer:opened', doc);
  } catch {
    dialog.showErrorBox('打开失败', `无法读取：${filePath}`);
  }
}

function sendAction(action) {
  mainWindow?.webContents.send('md-editer:action', action);
}

function commandItem(label, id, accelerator) {
  return {
    label,
    accelerator,
    click: () => sendAction({ type: 'command', id }),
  };
}

function appItem(label, id, accelerator) {
  return {
    label,
    accelerator,
    click: () => sendAction({ type: 'app', id }),
  };
}

async function buildRecentMenu() {
  const entries = await readRecent();
  if (entries.length === 0) return [{ label: '暂无最近文件', enabled: false }];
  return entries.map((entry) => ({
    label: entry.name,
    click: async () => {
      try {
        const doc = await readFileByPath(entry.path);
        mainWindow?.webContents.send('md-editer:opened', doc);
      } catch {
        dialog.showErrorBox('打开失败', `无法读取：${entry.path}`);
      }
    },
  }));
}

async function buildTemplate() {
  return [
    {
      label: '文件',
      submenu: [
        appItem('新建', 'new', 'CmdOrCtrl+N'),
        appItem('打开…', 'open', 'CmdOrCtrl+O'),
        { type: 'separator' },
        appItem('保存', 'save', 'CmdOrCtrl+S'),
        appItem('另存为…', 'saveAs', 'CmdOrCtrl+Shift+S'),
        { type: 'separator' },
        { label: '最近文件', submenu: await buildRecentMenu() },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        commandItem('撤销', 'history.undo', 'CmdOrCtrl+Z'),
        commandItem('重做', 'history.redo', 'CmdOrCtrl+Shift+Z'),
        { type: 'separator' },
        appItem('查找', 'find', 'CmdOrCtrl+F'),
        appItem('替换', 'replace', 'CmdOrCtrl+H'),
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '格式',
      submenu: [
        commandItem('粗体', 'format.strong', 'CmdOrCtrl+B'),
        commandItem('斜体', 'format.em', 'CmdOrCtrl+I'),
        commandItem('行内代码', 'format.code', 'CmdOrCtrl+E'),
        commandItem('链接', 'format.link', 'CmdOrCtrl+K'),
        { type: 'separator' },
        commandItem('标题 1', 'format.heading1', 'CmdOrCtrl+1'),
        commandItem('标题 2', 'format.heading2', 'CmdOrCtrl+2'),
        commandItem('标题 3', 'format.heading3', 'CmdOrCtrl+3'),
        commandItem('正文', 'format.paragraph', 'CmdOrCtrl+0'),
        { type: 'separator' },
        commandItem('无序列表', 'format.bulletList', 'CmdOrCtrl+Shift+8'),
        commandItem('有序列表', 'format.orderedList', 'CmdOrCtrl+Shift+9'),
        commandItem('引用', 'format.blockquote', 'CmdOrCtrl+Shift+Q'),
        commandItem('代码块', 'format.codeBlock', 'CmdOrCtrl+Alt+C'),
      ],
    },
    {
      label: '插入',
      submenu: [
        commandItem('图片', 'insert.image', 'CmdOrCtrl+Alt+I'),
        commandItem('表格', 'insert.table', 'CmdOrCtrl+Alt+T'),
        commandItem('数学公式', 'insert.math', 'CmdOrCtrl+Alt+M'),
        commandItem('分割线', 'insert.horizontalRule'),
      ],
    },
    {
      label: '视图',
      submenu: [
        appItem('放大', 'zoomIn', 'CmdOrCtrl+='),
        appItem('缩小', 'zoomOut', 'CmdOrCtrl+-'),
        appItem('重置缩放', 'zoomReset', 'CmdOrCtrl+0'),
        { type: 'separator' },
        appItem('切换深色 / 浅色', 'toggleTheme'),
        { type: 'separator' },
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        appItem('快捷键', 'shortcuts'),
        appItem('载入示例文档', 'loadDemo'),
        { type: 'separator' },
        {
          label: '关于 Supernatural',
          click: () =>
            dialog.showMessageBox({
              type: 'info',
              title: 'Supernatural',
              message: 'Supernatural',
              detail: 'Typora 风格的 Markdown 编辑器\nTypeScript + ProseMirror，无 Rust / WASM',
            }),
        },
      ],
    },
  ];
}

async function refreshMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate(await buildTemplate()));
}

function registerIpc() {
  ipcMain.handle('file:open', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: MARKDOWN_FILTERS,
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const doc = await readFileByPath(result.filePaths[0]);
    await addRecent({ name: doc.name, path: doc.path });
    return doc;
  });

  ipcMain.handle('file:openPath', async (_event, filePath) => {
    try {
      return await readFileByPath(filePath);
    } catch {
      return null;
    }
  });

  ipcMain.handle('file:save', async (_event, content, filePath) => {
    const target =
      typeof filePath === 'string' && filePath.length > 0
        ? filePath
        : await promptSavePath('未命名.md');
    if (target === null) return null;
    await fs.writeFile(target, content, 'utf8');
    await addRecent({ name: path.basename(target), path: target });
    return { name: path.basename(target), path: target };
  });

  ipcMain.handle('file:saveAs', async (_event, content, suggestedName) => {
    const target = await promptSavePath(suggestedName ?? '未命名.md');
    if (target === null) return null;
    await fs.writeFile(target, content, 'utf8');
    await addRecent({ name: path.basename(target), path: target });
    return { name: path.basename(target), path: target };
  });

  ipcMain.handle('recent:list', () => readRecent());
}

async function promptSavePath(suggestedName) {
  const result = await dialog.showSaveDialog({
    defaultPath: suggestedName,
    filters: MARKDOWN_FILTERS,
  });
  return result.canceled || result.filePath.length === 0 ? null : result.filePath;
}

/** listen() 是异步的：必须等 'listening' 才能拿到系统分配的端口。 */
function startServerAsync(directory) {
  return new Promise((resolve, reject) => {
    const instance = startServer(directory, 0);
    instance.once('listening', () => resolve(instance));
    instance.once('error', reject);
  });
}

async function createWindow() {
  server = await startServerAsync(APP_DIR);
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 480,
    minHeight: 360,
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      preload: path.join(HERE, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  // 等渲染进程就绪（注册好 onOpened 监听）后再投递启动文件，
  // 否则 md-editer:opened 会早于监听器注册被发出并丢失，导致双击 .md 仍显示草稿
  let startupDelivered = false;
  const deliverStartupFile = () => {
    if (startupDelivered) return;
    startupDelivered = true;
    const startupFile = fileArgFromArgv(process.argv);
    if (startupFile) void openFileAt(startupFile);
  };
  ipcMain.once('renderer:ready', deliverStartupFile);
  // 兜底：若渲染进程未发出就绪信号，3s 后照常投递，避免卡死
  const startupFallback = setTimeout(deliverStartupFile, 3000);

  await mainWindow.loadURL(`http://127.0.0.1:${port}/`);
  mainWindow.show();

  mainWindow.on('closed', () => {
    clearTimeout(startupFallback);
    mainWindow = null;
    server?.close();
    server = null;
  });

  // 外部链接交给系统浏览器，不在应用里打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (mainWindow === null) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    // 已运行时再双击文件：把新文件交给当前窗口打开
    const fileArg = fileArgFromArgv(argv);
    if (fileArg) void openFileAt(fileArg);
  });

  // macOS：系统通过 open-file 事件传文件路径
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    if (mainWindow === null) return;
    void openFileAt(filePath);
  });

  void app.whenReady().then(async () => {
    registerIpc();
    await refreshMenu();
    await createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
