import { app, BrowserWindow, Menu, Tray, dialog, shell, nativeImage } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { registerIpc } from './ipc'
import { runtime } from './runtime'
import { loadApiKey } from './secrets'
import { ensureConfigFile } from './config'
import { catalog } from './openrouter/catalog'
import { redactSecrets } from './openrouter/client'
import { bus } from './engine/bus'

/**
 * Directory of the built main bundle (out/main).
 *
 * Named `currentDir` rather than `__dirname`: the bundler injects its own
 * `__dirname` shim for the ESM node target, and redeclaring it is a
 * duplicate-declaration error at module load.
 */
const currentDir = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

/** Route console output through the secret scrubber. */
function safeLog(...args: unknown[]): void {
  const text = args
    .map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.message : String(a)))
    .map((s) => redactSecrets(s))
    .join(' ')
  console.log(`[codex-local] ${text}`)
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 700,
    show: false,
    backgroundColor: '#0b0d12',
    title: 'Codex Local',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(currentDir, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // The preload is an ES module (electron-vite emits .mjs) and Electron
      // cannot load ESM preload scripts in a sandboxed renderer.
      // contextIsolation + nodeIntegration:false are the real protections.
      sandbox: false,
      webSecurity: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devServerUrl = process.env.ELECTRON_RENDERER_URL
  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl)
  } else {
    await mainWindow.loadFile(path.join(currentDir, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

/** Build the application menu (File / View / Help). */
function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Workspace Folder...',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => mainWindow?.webContents.send('menu:pick-workspace')
        },
        { type: 'separator' },
        {
          label: 'Export Run Report',
          accelerator: 'CmdOrCtrl+E',
          click: () => mainWindow?.webContents.send('menu:export-report')
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
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
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Command Palette',
          accelerator: 'CmdOrCtrl+K',
          click: () => mainWindow?.webContents.send('menu:command-palette')
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Codex Local',
          click: () => {
            void dialog.showMessageBox(mainWindow!, {
              type: 'info',
              title: 'Codex Local',
              message: 'Codex Local',
              detail:
                'A local, offline-first multi-agent coding workspace.\nOnly free-tier OpenRouter models are ever called.'
            })
          }
        }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/**
 * Resolve the tray icon.
 *
 * In development the resources folder sits next to the project root; in a
 * packaged build it is copied next to the app resources. Either way the tray
 * is optional, so a missing file is not fatal.
 */
function trayIconPath(): string {
  const candidates = [
    path.join(app.getAppPath(), 'resources', 'tray.png'),
    path.join(process.resourcesPath ?? '', 'tray.png')
  ]
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate
  }
  return candidates[0]
}

/** Create the tray icon (falls back gracefully when the icon is missing). */
function createTray(): void {
  try {
    const image = nativeImage.createFromPath(trayIconPath())
    const trayImage = image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: 16, height: 16 })
    tray = new Tray(trayImage)
    tray.setToolTip('Codex Local')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Show Codex Local', click: () => mainWindow?.show() },
        {
          label: 'Stop Current Run',
          click: () => mainWindow?.webContents.send('menu:stop-run')
        },
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() }
      ])
    )
    tray.on('click', () => mainWindow?.show())
  } catch {
    // A tray is optional; the app works without it.
  }
}

app.whenReady().then(async () => {
  // Seed the per-user config on first launch (packaged builds only).
  await ensureConfigFile()

  // Load the key first so the catalog probe can authenticate if needed.
  await loadApiKey()
  await runtime.load()

  // Warm the free-model catalog in the background. Failure is not fatal.
  void catalog
    .refresh()
    .then((models) => {
      safeLog(`free-model catalog: ${models.length} model(s)`)
      runtime.recompute()
    })
    .catch((err: unknown) => {
      safeLog('catalog fetch failed:', err instanceof Error ? err.message : String(err))
    })

  registerIpc()
  await createWindow()
  buildMenu()
  createTray()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  bus.clear()
})

// Surface engine errors in the UI rather than silently dying.
process.on('uncaughtException', (err) => {
  safeLog('uncaught:', err.message)
})
process.on('unhandledRejection', (reason) => {
  safeLog('unhandled rejection:', reason instanceof Error ? reason.message : String(reason))
})
