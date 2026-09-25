const fs = require('node:fs/promises');
const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const { parseElectionWorkbook, exportElectionWorkbook } = require('./data-service');

let mainWindow;
let currentSourcePath;

// Mantém o app estável também em computadores sem aceleração gráfica disponível.
app.disableHardwareAcceleration();

function defaultWorkbookPath() {
  return path.join(app.getAppPath(), 'data', 'apuracaocaririocidental.xlsx');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: '#f4f1ea',
    show: true,
    title: 'Apuração Cariri Ocidental',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const screenshotPage = process.env.APP_SCREENSHOT_PAGE;
  const loadOptions = screenshotPage ? { query: { page: screenshotPage } } : undefined;
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'), loadOptions);
  if (process.env.APP_SCREENSHOT_PATH) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const image = await mainWindow.webContents.capturePage();
        await fs.writeFile(process.env.APP_SCREENSHOT_PATH, image.toPNG());
        app.quit();
      }, 1200);
    });
  }
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
}

function registerIpc() {
  ipcMain.handle('election:load-default', async () => {
    currentSourcePath = defaultWorkbookPath();
    return parseElectionWorkbook(currentSourcePath);
  });

  ipcMain.handle('election:open-workbook', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Selecionar planilha de apuração',
      properties: ['openFile'],
      filters: [{ name: 'Planilhas do Excel', extensions: ['xlsx', 'xls'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    currentSourcePath = result.filePaths[0];
    return parseElectionWorkbook(currentSourcePath);
  });

  ipcMain.handle('election:export-workbook', async (_event, payload) => {
    if (!currentSourcePath) throw new Error('Nenhuma planilha foi carregada.');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Salvar cópia atualizada',
      defaultPath: path.join(path.dirname(currentSourcePath), 'apuracao-cariri-ocidental-atualizada.xlsx'),
      filters: [{ name: 'Planilha do Excel', extensions: ['xlsx'] }],
    });
    if (result.canceled || !result.filePath) return null;
    exportElectionWorkbook(currentSourcePath, result.filePath, payload.edits || [], payload.candidates || []);
    return { path: result.filePath, name: path.basename(result.filePath) };
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
