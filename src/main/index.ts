// First: no program may be found in a repository folder (see the module).
import './programSearch'
import { join } from 'node:path'
import { BrowserWindow, Menu, app, nativeTheme, screen, shell } from 'electron'
import { initAccounts } from './accounts'
import { disposeAskpass, initAskpass } from './askpass'
import { launchFolder, offerLaunchFolder, windowLoading } from './cli'
import { registerIpc, sendOpenFolder, startUpdates } from './ipc'
import { loadSettings, saveSettings } from './settings'
import { unwatchAll } from './watcher'

const isDev = !app.isPackaged

// Lets contributors and automated tests run with an isolated profile.
if (process.env.LEVIATHAN_USER_DATA) app.setPath('userData', process.env.LEVIATHAN_USER_DATA)

// One window per profile: `leviathan <folder>` while it runs opens the folder there, in a new tab.
const primary = app.requestSingleInstanceLock()
if (!primary) app.quit()
const startFolder = launchFolder(process.argv, process.cwd(), !!process.defaultApp)
if (startFolder) offerLaunchFolder(startFolder)
app.on('second-instance', (_event, argv, workingDirectory) => {
  const win = BrowserWindow.getAllWindows()[0]
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  } else {
    // macOS keeps running without windows.
    createWindow()
  }
  const folder = launchFolder(argv, workingDirectory, !!process.defaultApp)
  // Until the window has restored its tabs, the folder waits for the window to ask for it.
  if (folder && offerLaunchFolder(folder) === 'send') sendOpenFolder(folder)
})

function restoreBounds(): Electron.Rectangle | { width: number; height: number } {
  const saved = loadSettings().window
  if (!saved) return { width: 1400, height: 880 }
  if (saved.x !== undefined && saved.y !== undefined) {
    // Only reuse the position if it is still on a connected display.
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea
      return saved.x! >= a.x - 50 && saved.y! >= a.y - 50 && saved.x! < a.x + a.width && saved.y! < a.y + a.height
    })
    if (visible) return { x: saved.x, y: saved.y, width: saved.width, height: saved.height }
  }
  return { width: saved.width, height: saved.height }
}

function prefersDark(): boolean {
  const theme = loadSettings().theme
  return theme === 'dark' || (theme !== 'light' && nativeTheme.shouldUseDarkColors)
}

function createWindow(): void {
  windowLoading()
  const win = new BrowserWindow({
    ...restoreBounds(),
    minWidth: 900,
    minHeight: 560,
    show: false,
    backgroundColor: prefersDark() ? '#1b1e24' : '#ffffff',
    title: 'Leviathan',
    autoHideMenuBar: true,
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  if (loadSettings().window?.maximized) win.maximize()
  win.once('ready-to-show', () => win.show())
  // A reload restores the tabs again: folders from the command line wait for it.
  win.webContents.on('did-start-loading', windowLoading)

  // Never navigate the app window away; send links to the browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })

  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type !== 'keyDown') return
    const devtools = input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')
    if (devtools) win.webContents.toggleDevTools()
  })

  win.on('close', () => {
    const bounds = win.getNormalBounds()
    saveSettings({ window: { ...bounds, maximized: win.isMaximized() } })
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

// A second instance only hands its folder to the first one (`second-instance`) and quits.
if (primary)
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null)
    registerIpc()
    await initAskpass()
    initAccounts()
    createWindow()
    startUpdates()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

app.on('window-all-closed', () => {
  unwatchAll()
  if (process.platform !== 'darwin') app.quit()
})

// Not on window-all-closed: on macOS the app keeps running and windows can be reopened.
app.on('will-quit', () => void disposeAskpass())
