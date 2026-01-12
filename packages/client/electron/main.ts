import {promises as fs} from 'node:fs';
import {extname, join, resolve} from 'node:path';
import {electronApp, is, optimizer} from '@electron-toolkit/utils';
import {app, BrowserWindow, ipcMain, nativeImage, protocol, shell} from 'electron';
import {getElectronProtocolScheme} from './protocol';
import {cleanupSqlite, registerSqliteHandlers} from './sqlite/handler';

declare const __APP_VERSION__: string;

let mainWindow: BrowserWindow | null = null;

const protocolScheme = getElectronProtocolScheme(is.dev);

function getIconPath(): string {
  // In dev: __dirname is .../out/main, so ../../build/icons
  // In prod: __dirname is .../app.asar/out/main, so ../../build/icons
  const iconsDir = resolve(__dirname, '../../build/icons');
  // Use squircle PNG on macOS for proper dock icon with rounded corners
  if (process.platform === 'darwin') {
    return resolve(iconsDir, 'icon-macos.png');
  }
  return resolve(iconsDir, 'icon.png');
}

function getContentType(filePath: string): string {
  const ext = extname(filePath).substring(1).toLowerCase();
  const types: Record<string, string> = {
    html: 'text/html',
    js: 'application/javascript',
    mjs: 'application/javascript',
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
    wasm: 'application/wasm',
  };
  return types[ext || ''] || 'application/octet-stream';
}

function createWindow(): void {
  const iconPath = getIconPath();

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 375,
    minHeight: 667,
    show: false,
    autoHideMenuBar: true,
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Set dock icon on macOS
  if (process.platform === 'darwin' && app.dock) {
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) {
      app.dock.setIcon(icon);
    }
  }

  mainWindow.on('ready-to-show', () => {
    if (mainWindow) {
      const title = `Tearleads v${__APP_VERSION__}`;
      mainWindow.setTitle(title);
      mainWindow.webContents.executeJavaScript(`document.title = ${JSON.stringify(title)}`);
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
    mainWindow.loadURL(`${protocolScheme}://app/`);
  }
}

// Handle IPC request to open external URLs
ipcMain.handle('open-external', async (_event, url: string) => {
  try {
    const parsedUrl = new URL(url);
    const allowedProtocols = ['https:', 'mailto:'];
    if (allowedProtocols.includes(parsedUrl.protocol)) {
      await shell.openExternal(url);
    } else {
      console.error(`Blocked attempt to open URL with disallowed protocol: ${url}`);
    }
  } catch {
    console.error(`Blocked attempt to open invalid URL: ${url}`);
  }
});

// Register custom protocol schemes before app is ready
// Note: bypassCSP and stream may help with OPFS persistence
protocol.registerSchemesAsPrivileged([
  {
    scheme: protocolScheme,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      allowServiceWorkers: true,
      stream: true,
      bypassCSP: true,
    },
  },
]);

app.whenReady().then(() => {
  // Register SQLite IPC handlers
  registerSqliteHandlers();

  // Register the protocol to serve local files
  protocol.handle(protocolScheme, async request => {
    const urlPrefix = `${protocolScheme}://app/`;
    const filePath = request.url.slice(urlPrefix.length) || 'index.html';
    const rendererDir = resolve(__dirname, '../renderer');
    const fullPath = resolve(rendererDir, filePath);

    // Security: Prevent path traversal
    if (!fullPath.startsWith(rendererDir)) {
      console.error(`Blocked path traversal attempt: ${filePath}`);
      return new Response('Forbidden', {status: 403});
    }

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
  cleanupSqlite();
  if (process.platform !== 'darwin') app.quit();
});
