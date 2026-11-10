// Project storage and access to Vortex's plugins folder for the renderer.
// Everything here runs in the main process; the renderer reaches it through preload.cjs.
const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')

const imageTypes = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}
const artworkNames = ['gameart.png', 'gameart.jpg', 'gameart.jpeg', 'gameart.webp']
const signatureFolder = 'UE4SS_Signatures'
const projectFile = 'vexb.json'

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}

async function readText(file) {
  try {
    return await fsp.readFile(file, 'utf8')
  } catch {
    return ''
  }
}

async function writeFileSafely(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  await fsp.writeFile(temporary, data)
  await fsp.rename(temporary, file)
}

function writeFileSafelySync(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, data)
  fs.renameSync(temporary, file)
}

function isProjectId(id) {
  return typeof id === 'string' && /^[a-z0-9-]{1,64}$/i.test(id)
}

function summarize(project) {
  const form = project.form ?? {}
  return {
    id: project.id,
    gameName: String(form.gameName ?? ''),
    gameId: String(form.gameId ?? ''),
    version: String(form.version ?? ''),
    pluginFolder: String(project.pluginFolder ?? ''),
    source: project.source === 'imported' ? 'imported' : 'vexb',
    importNotes: Array.isArray(project.importNotes) ? project.importNotes : [],
    updatedAt: Number(project.updatedAt) || 0,
    openedAt: Number(project.openedAt) || 0,
  }
}

function findGameId(code) {
  const constant = /const\s+GAME_ID\s*=\s*(['"])([^'"]+)\1/.exec(code)
  if (constant) return constant[2]
  const registered = /registerGame\(\s*\{\s*id\s*:\s*(['"])([^'"]+)\1/.exec(code)
  return registered ? registered[2] : ''
}

async function readImage(file) {
  try {
    const data = await fsp.readFile(file)
    const type = imageTypes[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
    return { dataUrl: `data:${type};base64,${data.toString('base64')}`, name: path.basename(file), type }
  } catch {
    return null
  }
}

function createLibrary({ userDataPath, defaultPluginsFolder }) {
  const projectsFolder = path.join(userDataPath, 'projects')
  const indexFile = path.join(projectsFolder, 'index.json')
  const settingsFile = path.join(userDataPath, 'settings.json')
  const backupsFolder = path.join(userDataPath, 'backups')
  let queue = Promise.resolve()

  // Project saves arrive quickly while typing; run them one at a time so the index
  // is never rewritten from a stale copy.
  function enqueue(task) {
    const run = queue.then(task, task)
    queue = run.catch(() => {})
    return run
  }

  function projectPath(id) {
    if (!isProjectId(id)) throw new Error(`Invalid project id: ${id}`)
    return path.join(projectsFolder, `${id}.json`)
  }

  function readIndexSync() {
    try {
      const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'))
      return Array.isArray(index) ? index : []
    } catch {
      return []
    }
  }

  async function readIndex() {
    const index = await readJson(indexFile, [])
    return Array.isArray(index) ? index : []
  }

  function withSummary(index, project) {
    return [...index.filter((entry) => entry.id !== project.id), summarize(project)]
  }

  async function listProjects() {
    await queue
    return readIndex()
  }

  async function readProject(id) {
    return readJson(projectPath(id), null)
  }

  function saveProject(project) {
    return enqueue(async () => {
      await writeFileSafely(projectPath(project.id), JSON.stringify(project))
      await writeFileSafely(indexFile, JSON.stringify(withSummary(await readIndex(), project), null, 2))
    })
  }

  function saveProjectSync(project) {
    writeFileSafelySync(projectPath(project.id), JSON.stringify(project))
    writeFileSafelySync(indexFile, JSON.stringify(withSummary(readIndexSync(), project), null, 2))
  }

  function deleteProject(id) {
    return enqueue(async () => {
      await fsp.rm(projectPath(id), { force: true })
      await writeFileSafely(indexFile, JSON.stringify((await readIndex()).filter((entry) => entry.id !== id), null, 2))
    })
  }

  async function getPluginsFolder() {
    const settings = await readJson(settingsFile, {})
    return typeof settings.pluginsFolder === 'string' && settings.pluginsFolder ? settings.pluginsFolder : defaultPluginsFolder
  }

  async function setPluginsFolder(folder) {
    const settings = await readJson(settingsFile, {})
    await writeFileSafely(settingsFile, JSON.stringify({ ...settings, pluginsFolder: folder }, null, 2))
  }

  // Only a plain folder name directly inside the plugins folder is accepted.
  async function extensionPath(folder) {
    if (typeof folder !== 'string' || !folder.trim() || folder !== path.basename(folder)
      || folder === '.' || folder === '..' || /[<>:"/\\|?*]/.test(folder)) {
      throw new Error(`Invalid extension folder name: ${folder}`)
    }
    return path.join(await getPluginsFolder(), folder)
  }

  async function listExtensions() {
    const pluginsFolder = await getPluginsFolder()
    let entries
    try {
      entries = await fsp.readdir(pluginsFolder, { withFileTypes: true })
    } catch {
      return { pluginsFolder, exists: false, extensions: [] }
    }
    const extensions = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      const folder = path.join(pluginsFolder, entry.name)
      const info = await readJson(path.join(folder, 'info.json'), null)
      const code = await readText(path.join(folder, 'index.js'))
      if (!info && !code) return null
      const stats = await fsp.stat(path.join(folder, 'index.js')).catch(() => fsp.stat(folder))
      const text = (key) => (info && typeof info[key] === 'string' ? info[key] : '')
      return {
        folder: entry.name,
        name: text('name') || entry.name,
        author: text('author'),
        version: text('version'),
        description: text('description'),
        gameId: findGameId(code),
        isGame: /registerGame\s*\(/.test(code) || text('type') === 'game',
        hasProjectFile: fs.existsSync(path.join(folder, projectFile)),
        looksLikeVexb: code.includes('module.exports = {\n  default: main,\n};') && code.includes("logo: 'gameart.png',"),
        modifiedAt: stats.mtimeMs,
      }
    }))
    return {
      pluginsFolder,
      exists: true,
      extensions: extensions.filter(Boolean).sort((first, second) => first.name.localeCompare(second.name)),
    }
  }

  async function readExtension(folder) {
    const directory = await extensionPath(folder)
    const artwork = artworkNames.map((name) => path.join(directory, name)).find((file) => fs.existsSync(file))
    const signatureDirectory = path.join(directory, signatureFolder)
    const signatureNames = await fsp.readdir(signatureDirectory).catch(() => [])
    const signatureFiles = await Promise.all(signatureNames
      .filter((name) => /\.lua$/i.test(name))
      .map(async (name) => ({ name, content: await readText(path.join(signatureDirectory, name)) })))
    return {
      folder,
      info: await readJson(path.join(directory, 'info.json'), {}),
      indexJs: await readText(path.join(directory, 'index.js')),
      projectFile: await readJson(path.join(directory, projectFile), null),
      gameart: artwork ? await readImage(artwork) : null,
      gameicon: await readImage(path.join(directory, 'gameicon.png')),
      signatureFiles,
    }
  }

  // Writes the package into the plugins folder. Files that would be replaced are copied
  // to backups/<folder>/<time>/ first, and Vortex's own info.json fields (modId, path,
  // type, ...) are kept so update checks keep working.
  async function writeExtension(folder, files, previousFolder) {
    const directory = await extensionPath(folder)
    // A folder named after the old version is renamed before writing, so Vortex never
    // sees two copies of the extension.
    if (previousFolder && previousFolder !== folder) {
      const previous = await extensionPath(previousFolder)
      if (fs.existsSync(directory)) throw new Error(`Can't rename ${previousFolder} to ${folder}: a folder with that name already exists.`)
      await fsp.rename(previous, directory)
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backup = path.join(backupsFolder, folder, stamp)
    let backedUp = false
    const resolved = files.map((file) => {
      const target = path.resolve(directory, String(file.path))
      if (!target.startsWith(directory + path.sep)) throw new Error(`Refusing to write outside the extension folder: ${file.path}`)
      return { ...file, target }
    })

    for (const file of resolved) {
      if (!fs.existsSync(file.target)) continue
      const copy = path.join(backup, path.relative(directory, file.target))
      await fsp.mkdir(path.dirname(copy), { recursive: true })
      await fsp.copyFile(file.target, copy)
      backedUp = true
    }

    await fsp.mkdir(directory, { recursive: true })
    for (const file of resolved) {
      let data = typeof file.data === 'string' ? file.data : Buffer.from(file.data)
      if (file.path === 'info.json') {
        const existing = await readJson(file.target, {})
        data = JSON.stringify({ ...existing, ...JSON.parse(String(data)) }, null, 2)
      }
      await writeFileSafely(file.target, data)
    }
    return { folder, path: directory, backup: backedUp ? backup : '' }
  }

  return {
    listProjects, readProject, saveProject, saveProjectSync, deleteProject,
    getPluginsFolder, setPluginsFolder, extensionPath, listExtensions, readExtension, writeExtension,
  }
}

function registerLibraryHandlers({ ipcMain, dialog, shell, BrowserWindow, library }) {
  ipcMain.handle('projects:list', () => library.listProjects())
  ipcMain.handle('projects:read', (_event, id) => library.readProject(id))
  ipcMain.handle('projects:save', (_event, project) => library.saveProject(project))
  ipcMain.handle('projects:delete', (_event, id) => library.deleteProject(id))
  ipcMain.on('projects:save-now', (event, project) => {
    try {
      library.saveProjectSync(project)
    } catch (error) {
      console.error('Could not save project on close', error)
    }
    event.returnValue = null
  })

  ipcMain.handle('extensions:list', () => library.listExtensions())
  ipcMain.handle('extensions:read', (_event, folder) => library.readExtension(folder))
  ipcMain.handle('extensions:write', (_event, folder, files, previousFolder) => library.writeExtension(folder, files, previousFolder))
  ipcMain.handle('extensions:choose-folder', async (event) => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: 'Choose the Vortex plugins folder',
      defaultPath: await library.getPluginsFolder(),
      properties: ['openDirectory'],
    })
    if (result.canceled || !result.filePaths[0]) return null
    await library.setPluginsFolder(result.filePaths[0])
    return library.listExtensions()
  })
  ipcMain.handle('extensions:open-folder', async (_event, folder) => {
    const target = folder ? await library.extensionPath(folder) : await library.getPluginsFolder()
    const error = await shell.openPath(target)
    if (error) throw new Error(error)
  })
}

module.exports = { createLibrary, registerLibraryHandlers }
