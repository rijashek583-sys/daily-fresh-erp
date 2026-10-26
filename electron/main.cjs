const { app, BrowserWindow, shell, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const http = require('http');
const https = require('https');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow = null;
let server = null;
let serverUrl = null;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
};

/**
 * Creates an embedded loopback HTTP server to serve the packaged SPA frontend.
 * This guarantees full compatibility with HTML5 browser routing (BrowserRouter)
 * and secure origin APIs (IndexedDB, ServiceWorker, Web Crypto) without requiring external ports.
 */
function startLocalServer(distPath) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      try {
        const parsedUrl = new URL(req.url, 'http://127.0.0.1');
        let pathname = decodeURIComponent(parsedUrl.pathname);

        // Normalize path
        if (pathname === '/' || pathname === '') {
          pathname = '/index.html';
        }

        const safeSuffix = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
        const normalizedDist = path.resolve(distPath);
        let filePath = path.resolve(distPath, '.' + path.sep + safeSuffix);

        // Security check: prevent path traversal outside distPath
        if (!filePath.startsWith(normalizedDist)) {
          res.writeHead(403, { 'Content-Type': 'text/plain' });
          res.end('Forbidden');
          return;
        }

        // Check if file exists on disk
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          const ext = path.extname(filePath).toLowerCase();
          const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
          res.writeHead(200, {
            'Content-Type': mimeType,
            'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
          });
          fs.createReadStream(filePath).pipe(res);
          return;
        }

        // SPA Fallback: serve index.html for all client-side routes (e.g. /dashboard, /login)
        const indexPath = path.join(distPath, 'index.html');
        if (fs.existsSync(indexPath)) {
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-cache',
          });
          fs.createReadStream(indexPath).pipe(res);
          return;
        }

        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error: ' + err.message);
      }
    });

    // Listen on dynamic loopback port
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      const url = `http://127.0.0.1:${port}`;
      resolve({ server: srv, url });
    });

    srv.on('error', (err) => reject(err));
  });
}

const PRODUCTION_ORIGIN = 'https://daily-fresh-billing-system.web.app';
const FIREBASE_AUTH_ORIGIN = 'https://daily-fresh-billing-system.firebaseapp.com';

const ALLOWED_INTERNAL_ORIGINS = new Set([
  PRODUCTION_ORIGIN,
  FIREBASE_AUTH_ORIGIN,
]);

/**
 * Validates whether a raw URL strictly belongs to approved internal origins.
 * Uses strict URL parsing and exact origin comparison to prevent startsWith() bypasses.
 */
function isAllowedInternalUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return false;
  try {
    const parsed = new URL(rawUrl);
    if (ALLOWED_INTERNAL_ORIGINS.has(parsed.origin)) {
      return true;
    }
    if (serverUrl) {
      const parsedServer = new URL(serverUrl);
      if (parsed.origin === parsedServer.origin) {
        return true;
      }
    }
    return false;
  } catch {
    // Malformed URLs cannot bypass checks
    return false;
  }
}

const APPROVED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/**
 * Validates and opens approved external links in the default operating system browser.
 * Rejects untrusted protocols (javascript:, file:, data:, powershell:, custom schemes).
 */
function openApprovedExternal(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return false;
  try {
    const parsed = new URL(rawUrl);
    if (!APPROVED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
      return false;
    }
    // For http and https, require a valid non-empty hostname
    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.hostname) {
      return false;
    }
    shell.openExternal(rawUrl).catch((err) => {
      console.warn('Failed to open external URL:', err.message);
    });
    return true;
  } catch {
    // Malformed URLs are denied and cannot bypass checks
    return false;
  }
}

/**
 * Validates whether an update download host is approved.
 */
function isApprovedHost(urlObj) {
  return (
    urlObj.protocol === 'https:' &&
    (urlObj.hostname === 'firebasestorage.googleapis.com' ||
     urlObj.hostname === 'storage.googleapis.com' ||
     urlObj.hostname === 'daily-fresh-billing-system.web.app' ||
     urlObj.hostname === 'github.com' ||
     urlObj.hostname.endsWith('.github.com') ||
     urlObj.hostname === 'objects.githubusercontent.com')
  );
}

/**
 * Simple SemVer comparator for update checking.
 * Returns 1 if v1 > v2, -1 if v1 < v2, and 0 if equal.
 */
function compareSemver(v1, v2) {
  const parse = (v) => String(v || '').replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const p1 = parse(v1);
  const p2 = parse(v2);
  const maxLen = Math.max(p1.length, p2.length);

  for (let i = 0; i < maxLen; i++) {
    const num1 = p1[i] || 0;
    const num2 = p2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

/**
 * Downloads a remote HTTPS file to local disk with redirect following.
 */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createWriteStream(destPath);
    const req = https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        fileStream.close();
        try { fs.unlinkSync(destPath); } catch {}
        try {
          const redirectUrl = new URL(response.headers.location, url);
          if (!isApprovedHost(redirectUrl)) {
            return reject(new Error('Redirect to untrusted update host denied: ' + redirectUrl.origin));
          }
          return downloadFile(redirectUrl.href, destPath).then(resolve).catch(reject);
        } catch (redirErr) {
          return reject(new Error('Invalid redirect location: ' + redirErr.message));
        }
      }
      if (response.statusCode !== 200) {
        fileStream.close();
        try { fs.unlinkSync(destPath); } catch {}
        return reject(new Error(`Download failed with status ${response.statusCode}`));
      }
      response.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close(() => resolve(destPath));
      });
    });
    req.on('error', (err) => {
      fileStream.close();
      try { fs.unlinkSync(destPath); } catch {}
      reject(err);
    });
  });
}

/**
 * Downloads and launches the verified Windows update installer.
 * Ensures the running application is cleanly exited so the installer
 * does not encounter file lock warnings or process conflict errors.
 */
async function startWindowsUpdate(downloadUrl) {
  try {
    if (typeof downloadUrl !== 'string' || !downloadUrl.trim()) {
      throw new Error('Invalid download URL');
    }

    const parsed = new URL(downloadUrl);
    const decodedPath = decodeURIComponent(parsed.pathname).toLowerCase();
    if (!isApprovedHost(parsed) || (!parsed.pathname.toLowerCase().endsWith('.exe') && !decodedPath.endsWith('.exe'))) {
      throw new Error('Untrusted update URL: ' + downloadUrl);
    }

    const tempDir = app.getPath('temp');
    const targetFile = path.join(tempDir, 'DailyFresh-Setup-Update.exe');

    // Notify user download is starting
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Downloading Update',
        message: 'Downloading Daily Fresh ERP update...',
        detail: 'The update package is downloading in the background. Once complete, you will be prompted to close the app and complete installation.',
        buttons: ['OK'],
      }).catch(() => {});
    }

    await downloadFile(downloadUrl, targetFile);

    // Verify downloaded file integrity
    if (!fs.existsSync(targetFile)) {
      throw new Error('Downloaded installer file not found on disk.');
    }
    const stat = fs.statSync(targetFile);
    if (stat.size < 10 * 1024 * 1024) {
      throw new Error(`Downloaded installer appears corrupted or incomplete (size: ${stat.size} bytes).`);
    }

    // Prompt user to close app and install now
    let shouldProceed = true;
    if (mainWindow && !mainWindow.isDestroyed()) {
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        title: 'Update Ready to Install',
        message: 'Daily Fresh ERP update has been downloaded.',
        detail: 'Daily Fresh ERP must close now so the installer can replace files cleanly.\n\nClick "Close and Install Now" to begin.',
        buttons: ['Close and Install Now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      });
      shouldProceed = (response === 0);
    }

    if (!shouldProceed) {
      return { success: false, message: 'Update installation deferred by user.' };
    }

    // Safe Handoff to Installer:
    // 1. Spawn installer detached in its own process group
    const child = spawn(targetFile, [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();

    // 2. Immediately close and destroy main window to drop rendering and file handles
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.hide();
      mainWindow.destroy();
    }

    // 3. Close the local loopback server if running
    if (server) {
      try {
        server.close();
      } catch {}
    }

    // 4. Terminate the Electron process immediately
    // app.exit(0) terminates synchronously without waiting for event loop
    // so NSIS will never encounter "Daily Fresh ERP is running"
    setTimeout(() => {
      app.exit(0);
    }, 150);

    return { success: true, message: 'Installer launched. Exiting application...' };
  } catch (err) {
    console.error('Failed to start update:', err);
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Update Failed',
        message: 'Could not complete the update download.',
        detail: `Error: ${err.message}\n\nWould you like to open the download page in your browser instead?`,
        buttons: ['Open Download Page', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
      }).then(({ response }) => {
        if (response === 0) {
          shell.openExternal(downloadUrl);
        }
      }).catch(() => {});
    } else {
      shell.openExternal(downloadUrl);
    }
    return { success: false, message: err.message };
  }
}

/**
 * Checks https://daily-fresh-billing-system.web.app/version.json for newer releases.
 * Displays "You’re up to date.", "Update Now", or network error dialog.
 */
async function checkForUpdates(interactive = true) {
  try {
    const manifestUrl = 'https://daily-fresh-billing-system.web.app/version.json?t=' + Date.now();

    const manifest = await new Promise((resolve, reject) => {
      const req = https.get(
        manifestUrl,
        {
          headers: { 'Cache-Control': 'no-cache' },
          timeout: 10000,
        },
        (res) => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`Server returned HTTP ${res.statusCode}`));
          }
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch {
              reject(new Error('Invalid manifest JSON format'));
            }
          });
        }
      );
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Connection timed out'));
      });
      req.on('error', (err) => {
        reject(new Error(err.message || 'Network connection error'));
      });
    });

    const currentVersion = app.getVersion();
    const windowsPlatform = manifest?.platforms?.windows;
    const latestVersion = windowsPlatform?.version || manifest?.version;
    const downloadUrl = windowsPlatform?.downloadUrl;

    if (!windowsPlatform || !downloadUrl) {
      throw new Error('Windows release information not found in version manifest');
    }

    const hasUpdate = compareSemver(latestVersion, currentVersion) > 0;

    if (hasUpdate) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const { response } = await dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'Update Available',
          message: 'A newer version of Daily Fresh ERP is available.',
          detail: `Installed Version: v${currentVersion}\nLatest Version: v${latestVersion}\n\nWould you like to download and install the update now?`,
          buttons: ['Update Now', 'Later'],
          defaultId: 0,
          cancelId: 1,
        });

        if (response === 0) {
          await startWindowsUpdate(downloadUrl);
        }
      }
    } else {
      if (interactive && mainWindow && !mainWindow.isDestroyed()) {
        await dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'Check for Updates',
          message: "You’re up to date.",
          detail: `Daily Fresh ERP v${currentVersion} is currently the newest version available.`,
          buttons: ['OK'],
        });
      }
    }
  } catch (err) {
    console.warn('Update check failed:', err.message);
    if (interactive && mainWindow && !mainWindow.isDestroyed()) {
      await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Check for Updates',
        message: 'Unable to check for updates.',
        detail: `Could not connect to the update server.\n\nError: ${err.message}\n\nPlease check your internet connection and try again.`,
        buttons: ['OK'],
      });
    }
  }
}

/**
 * Builds and sets the permanent application menu.
 */
function setupAppMenu() {
  const isMac = process.platform === 'darwin';
  const menuTemplate = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Print Active Document / Bill',
          accelerator: 'CmdOrCtrl+P',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.print();
          },
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Check for Updates',
          click: async () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('app:trigger-update-check');
            }
            await checkForUpdates(true);
          },
        },
        {
          label: 'Daily Fresh ERP Online',
          click: async () => {
            await shell.openExternal('https://daily-fresh-billing-system.web.app');
          },
        },
        { type: 'separator' },
        {
          label: `About Daily Fresh ERP (v${app.getVersion()})`,
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'About Daily Fresh ERP',
                message: `Daily Fresh ERP — v${app.getVersion()}`,
                detail: 'Food production operations, client ledger, and billing system.\nPublished by Daily Fresh Operations.\n\nRunning in Electron Desktop environment.',
                buttons: ['OK'],
              });
            }
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
  return menu;
}

function createMainWindow(targetUrl = PRODUCTION_ORIGIN) {
  const iconPath = path.join(__dirname, '../public/icon-512x512.png');
  const fallbackIconPath = path.join(__dirname, '../public/favicon.ico');

  mainWindow = new BrowserWindow({
    title: 'Daily Fresh ERP',
    width: 1366,
    height: 850,
    minWidth: 1024,
    minHeight: 680,
    icon: fs.existsSync(iconPath) ? iconPath : (fs.existsSync(fallbackIconPath) ? fallbackIconPath : undefined),
    show: false,
    backgroundColor: '#FAFAFA',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  // Permanently ensure menu visibility on Windows
  mainWindow.setMenuBarVisibility(true);
  mainWindow.autoHideMenuBar = false;

  // Ensure application menu is attached
  setupAppMenu();

  // Graceful show on ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Handle new window requests: keep internal origins in-window, open approved external links in system browser, deny everything else
  mainWindow.webContents.setWindowOpenHandler(({ url: openUrl }) => {
    if (isAllowedInternalUrl(openUrl)) {
      return { action: 'allow' };
    }

    if (openApprovedExternal(openUrl)) {
      return { action: 'deny' };
    }

    // Deny all other untrusted schemes, file access, and malformed URLs
    return { action: 'deny' };
  });

  // Prevent in-window navigation away from allowed origins
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    if (isAllowedInternalUrl(navigationUrl)) {
      return;
    }
    event.preventDefault();
    openApprovedExternal(navigationUrl);
  });

  // Prevent HTTP redirects from navigating the window to untrusted external domains
  mainWindow.webContents.on('will-redirect', (event, navigationUrl) => {
    if (isAllowedInternalUrl(navigationUrl)) {
      return;
    }
    event.preventDefault();
    openApprovedExternal(navigationUrl);
  });

  // Load production origin with graceful fallback to local bundled SPA
  mainWindow.loadURL(targetUrl).catch((err) => {
    console.warn(`Could not load primary origin (${targetUrl}): ${err.message}. Loading local packaged frontend.`);
    if (serverUrl && targetUrl !== serverUrl) {
      mainWindow.loadURL(serverUrl);
    }
  });

  // Handle network disconnection or initial load failure
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    let isProdOrigin = false;
    try {
      const parsed = new URL(validatedURL);
      isProdOrigin = (parsed.origin === new URL(PRODUCTION_ORIGIN).origin);
    } catch {
      isProdOrigin = false;
    }

    if (isProdOrigin && serverUrl) {
      console.warn(`Failed loading ${validatedURL} (${errorCode}: ${errorDescription}), falling back to local bundle at ${serverUrl}`);
      mainWindow.loadURL(serverUrl);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC Handlers for Version Discovery & Windows In-App Updates
ipcMain.handle('app:get-version', () => app.getVersion());

ipcMain.handle('app:start-update', async (event, downloadUrl) => {
  return await startWindowsUpdate(downloadUrl);
});

ipcMain.handle('app:check-for-updates', async () => {
  await checkForUpdates(true);
  return { success: true };
});

// Enforce single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      setupAppMenu();

      const distPath = path.join(__dirname, '../dist');
      if (fs.existsSync(distPath)) {
        try {
          const localInstance = await startLocalServer(distPath);
          server = localInstance.server;
          serverUrl = localInstance.url;
        } catch (serverErr) {
          console.warn('Local fallback server could not be started:', serverErr);
        }
      }

      createMainWindow(PRODUCTION_ORIGIN);
    } catch (err) {
      console.error('Failed to initialize Daily Fresh ERP desktop application:', err);
      app.quit();
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow(PRODUCTION_ORIGIN);
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      if (server) {
        try {
          server.close();
        } catch {
          // ignore
        }
      }
      app.quit();
    }
  });
}
