const path = require('path')
const { app, BrowserWindow, dialog, ipcMain, net, shell } = require('electron')
const { createLibrary, registerLibraryHandlers } = require('./library.cjs')
const { createAutoFill, registerAutoFillHandlers } = require('./autofill.cjs')

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
      preload: path.join(__dirname, 'preload.cjs'),
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
      new Promise((resolve) => {
        const targetStep = Array.from(document.querySelectorAll('button'))
          .find((button) => button.textContent.includes('Deployment targets'));
        targetStep?.click();
        setTimeout(() => {
          const ue4ssPreset = Array.from(document.querySelectorAll('button'))
            .find((button) => button.textContent.includes('UE4SS loader'));
          ue4ssPreset?.click();
          setTimeout(() => {
            const output = document.querySelector('.preview-panel pre code')?.textContent ?? '';
            const targetSection = document.querySelector('.targets-section');
            const formFooter = document.querySelector('.form-footer');
            const footerIsNearContent = targetSection !== null && formFooter !== null
              && Math.abs(formFooter.getBoundingClientRect().top - targetSection.getBoundingClientRect().bottom) < 2;
            let outputParses = false;
            try { new Function('require', output); outputParses = true; } catch { /* smoke-test only */ }
            resolve(Boolean(
              document.querySelector('.target-card')
              && output.includes('context.registerModType')
              && output.includes('ue4ss-loader')
              && outputParses
              && footerIsNearContent
              && document.body.innerText.includes('Draft autosaved locally'),
            ));
          }, 80);
        }, 80);
      })
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
  const library = createLibrary({
    userDataPath: app.getPath('userData'),
    defaultPluginsFolder: path.join(app.getPath('appData'), 'Vortex', 'plugins'),
  })
  registerLibraryHandlers({ ipcMain, dialog, shell, BrowserWindow, library })
  const autoFill = createAutoFill({ net, userDataPath: app.getPath('userData') })
  registerAutoFillHandlers({ ipcMain, dialog, BrowserWindow, autoFill })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
