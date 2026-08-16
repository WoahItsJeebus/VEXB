const path = require('path')
const { app, BrowserWindow, shell } = require('electron')

async function createWindow() {
  const smokeTest = process.argv.includes('--smoke-test')
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 760,
    minHeight: 620,
    backgroundColor: '#f2f4f5',
    title: 'VEXB - Vortex Extension Builder',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  let loaded = true
  try {
    await window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  } catch (error) {
    loaded = false
    const message = String(error).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character])
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
      <main style="font:16px sans-serif;padding:32px;color:#20262b">
        <h1>VEXB could not start</h1>
        <p>${message}</p>
      </main>
    `)}`)
  }

  if (smokeTest) {
    const rendered = loaded && await window.webContents.executeJavaScript(`
      Boolean(document.querySelector('.app-shell') && document.body.innerText.includes('Game details'))
    `)
    app.exit(rendered ? 0 : 2)
    return
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) {
      event.preventDefault()
      if (url.startsWith('https://')) shell.openExternal(url)
    }
  })
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})