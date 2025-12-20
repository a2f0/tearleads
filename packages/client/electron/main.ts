import {promises as fs} from 'node:fs';
import {extname, join} from 'node:path';
import {electronApp, is, optimizer} from '@electron-toolkit/utils';
import {app, BrowserWindow, ipcMain, protocol, shell} from 'electron';
import {getElectronProtocolScheme} from './protocol';

let mainWindow: BrowserWindow | null = null;

const protocolScheme = getElectronProtocolScheme(is.dev);

function getContentType(filePath: string): string {
  const ext = extname(filePath).substring(1).toLowerCase();
  const types: Record<string, string> = {
    html: 'text/html',
    js: 'application/javascript',
    css: 'text/css',
    json: 'application/json',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
  };
  return types[ext || ''] || 'application/octet-stream';
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on('ready-to-show', () => {
    if (mainWindow) {
      mainWindow.show();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(details => {
    shell.openExternal(details.url);
    return {action: 'deny'};
  });

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadURL(`${protocolScheme}://app/index.html`);
  }
}

// Handle IPC request to open external URLs (HTTPS only)
ipcMain.handle('open-external', async (_event, url: string) => {
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol === 'https:') {
      await shell.openExternal(url);
    } else {
      console.error(`Blocked attempt to open non-https URL: ${url}`);
    }
  } catch {
    console.error(`Blocked attempt to open invalid URL: ${url}`);
  }
});

// Register custom protocol schemes before app is ready
protocol.registerSchemesAsPrivileged([
  {
    scheme: protocolScheme,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      allowServiceWorkers: true,
    },
  },
]);

app.whenReady().then(() => {
  // Register the protocol to serve local files
  protocol.handle(protocolScheme, async request => {
    const urlPrefix = `${protocolScheme}://app/`;
    const filePath = request.url.slice(urlPrefix.length);
    const fullPath = join(__dirname, '../renderer', filePath || 'index.html');
    try {
      const data = await fs.readFile(fullPath);
      return new Response(data, {
        headers: {
          'Content-Type': getContentType(fullPath),
        },
      });
    } catch (error) {
      console.error(`Failed to read file: ${fullPath}`, error);
      return new Response('Not Found', {status: 404});
    }
  });

  electronApp.setAppUserModelId('com.rapid.app');

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
