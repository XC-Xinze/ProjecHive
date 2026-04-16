const { app, BrowserWindow, ipcMain, shell, session } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')

const isDev = !app.isPackaged

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  if (isDev) {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools({ mode: 'bottom' })
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // Clear stale auth data from old store keys
  win.webContents.on('did-finish-load', () => {
    win.webContents.executeJavaScript(`
      localStorage.removeItem('gitsync-panel-auth');
    `)
  })
}

// ── IPC ──
ipcMain.handle('open-external', (_event, url) => {
  shell.openExternal(url)
})

// Save base64 file to temp dir and open with system default app
ipcMain.handle('open-file', async (_event, base64Content, fileName) => {
  const tmpDir = path.join(os.tmpdir(), 'projecthive')
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })
  const filePath = path.join(tmpDir, fileName)
  const buffer = Buffer.from(base64Content, 'base64')
  fs.writeFileSync(filePath, buffer)
  await shell.openPath(filePath)
  return { ok: true, path: filePath }
})

// GitHub OAuth Device Flow — must go through main process (no CORS on github.com/login/*)
ipcMain.handle('github:device-code', async (_event, clientId, scope) => {
  const res = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: clientId, scope }),
  })
  return res.json()
})

ipcMain.handle('github:poll-token', async (_event, clientId, deviceCode, interval) => {
  const maxAttempts = 60
  let wait = interval
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, wait * 1000))
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    })
    const data = await res.json()
    if (data.access_token) return { ok: true, token: data.access_token }
    if (data.error === 'authorization_pending') continue
    if (data.error === 'slow_down') { wait = (data.interval || wait) + 1; continue }
    return { ok: false, error: data.error_description || data.error }
  }
  return { ok: false, error: 'Timed out.' }
})

// ── App lifecycle ──
app.whenReady().then(() => {
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
