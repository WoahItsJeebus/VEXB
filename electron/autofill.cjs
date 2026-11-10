// Auto-Fill: reads an installed Unreal Engine game and looks up its store and Nexus Mods
// details. Runs in the main process; the renderer turns the result into form changes.
const fsp = require('fs/promises')
const path = require('path')

const lookupTimeout = 10000
const nexusGamesUrl = 'https://data.nexusmods.com/file/nexus-data/games.json'
const nexusCacheAge = 24 * 60 * 60 * 1000
const steamAssetHost = 'https://shared.akamai.steamstatic.com/store_item_assets/'

// Executables that ship beside Unreal games but never start the game itself.
const helperExecutable = /^(unins\d*|uninstall.*|unrealcefsubprocess|crashreportclient|ue[45]?prereqsetup.*|vc_?redist.*|dxsetup|dotnet.*|easyanticheat.*|start_protected_game|epicwebhelper|eossdk.*|steamerrorreporter.*)\.exe$/i
const shippingExecutable = /-(win64|wingdk)-shipping\.exe$/i

async function listDir(directory) {
  try {
    return await fsp.readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }
}

// Finds a child by name ignoring case and returns its real path, or '' when it's missing.
async function child(directory, name, kind = 'any') {
  if (!directory) return ''
  const entry = (await listDir(directory)).find((item) => item.name.toLowerCase() === name.toLowerCase()
    && (kind === 'any' || (kind === 'dir' ? item.isDirectory() : item.isFile())))
  return entry ? path.join(directory, entry.name) : ''
}

async function childDir(directory, ...names) {
  let current = directory
  for (const name of names) current = await child(current, name, 'dir')
  return current
}

async function filesMatching(directory, pattern) {
  return (await listDir(directory)).filter((entry) => entry.isFile() && pattern.test(entry.name)).map((entry) => entry.name)
}

async function readText(file) {
  try {
    return await fsp.readFile(file, 'utf8')
  } catch {
    return ''
  }
}

async function readJson(file) {
  try {
    return JSON.parse((await readText(file)).replace(/^\uFEFF/, ''))
  } catch {
    return null
  }
}

function relative(root, target) {
  return path.relative(root, target).split(path.sep).join('/')
}

function samePath(first, second) {
  const clean = (value) => path.resolve(value).replace(/[\\/]+$/, '').toLowerCase()
  return clean(first) === clean(second)
}

// Loose title key: "Bloodstained: Ritual of the Night™" and "bloodstained ritual of the night" match.
function titleKey(value) {
  return String(value ?? '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '')
}

// ---------------------------------------------------------------------------
// Install layout

async function findBinaries(projectDir) {
  for (const platform of ['Win64', 'WinGDK']) {
    const directory = await childDir(projectDir, 'Binaries', platform)
    if (directory) return { platform: path.basename(directory), directory }
  }
  return null
}

async function findProjects(root) {
  const projects = []
  for (const entry of await listDir(root)) {
    if (!entry.isDirectory() || entry.name.toLowerCase() === 'engine' || entry.name.startsWith('.')) continue
    const directory = path.join(root, entry.name)
    const binaries = await findBinaries(directory)
    if (!binaries) continue
    projects.push({ name: entry.name, directory, binaries, paks: await childDir(directory, 'Content', 'Paks') })
  }
  return projects
}

async function isUnrealRoot(directory) {
  return Boolean(await childDir(directory, 'Engine')) && (await findProjects(directory)).length > 0
}

// Accepts the install folder, any folder inside it (Binaries/Win64, the project folder), or a
// Game Pass folder whose game sits in Content/.
async function resolveGameRoot(picked) {
  const content = await childDir(picked, 'Content')
  if (content && await isUnrealRoot(content)) return content
  let current = path.resolve(picked)
  for (let depth = 0; depth < 5; depth += 1) {
    if (await isUnrealRoot(current)) return current
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return ''
}

async function describeOtherEngine(directory) {
  const entries = await listDir(directory)
  const names = entries.map((entry) => entry.name.toLowerCase())
  if (names.includes('unityplayer.dll') || entries.some((entry) => entry.isDirectory() && /_data$/i.test(entry.name))) {
    return 'This looks like a Unity game. Auto-Fill only reads Unreal Engine games for now.'
  }
  return ''
}

function pickProject(projects, rootExecutables) {
  if (projects.length === 1) return projects[0]
  const named = projects.find((project) => rootExecutables.some((file) => file.toLowerCase() === `${project.name.toLowerCase()}.exe`))
  return named ?? projects.find((project) => project.paks) ?? projects[0]
}

async function findShippingExecutable(project) {
  const executables = await filesMatching(project.binaries.directory, /\.exe$/i)
  const shipping = executables.filter((file) => shippingExecutable.test(file))
  const preferred = shipping.find((file) => file.toLowerCase().startsWith(`${project.name.toLowerCase()}-`)) ?? shipping[0]
  if (preferred) return path.join(project.binaries.directory, preferred)
  // Development or oddly named builds: take the largest executable that isn't a helper.
  const candidates = await Promise.all(executables.filter((file) => !helperExecutable.test(file)).map(async (file) => {
    const full = path.join(project.binaries.directory, file)
    const stats = await fsp.stat(full).catch(() => ({ size: 0 }))
    return { full, size: stats.size }
  }))
  return candidates.sort((first, second) => second.size - first.size)[0]?.full ?? ''
}

// The executable Vortex starts: normally the small launcher at the install root, which
// starts the real game from <Project>/Binaries/Win64.
function pickLauncher(rootExecutables, projectName, storeLaunchers) {
  const candidates = rootExecutables.filter((file) => !helperExecutable.test(file))
  const byProject = candidates.find((file) => file.toLowerCase() === `${projectName.toLowerCase()}.exe`)
  if (byProject) return { file: byProject, reason: 'named after the Unreal project' }
  const fromStore = candidates.find((file) => storeLaunchers.some((launcher) => launcher.toLowerCase() === file.toLowerCase()))
  if (fromStore) return { file: fromStore, reason: 'the store’s launch entry' }
  if (candidates.length === 1) return { file: candidates[0], reason: 'the only executable at the install root' }
  return null
}

async function findUe4ss(binariesDir) {
  const ue4ssFolder = await childDir(binariesDir, 'ue4ss')
  const proxies = []
  for (const name of ['dwmapi.dll', 'xinput1_3.dll']) {
    if (await child(binariesDir, name, 'file')) proxies.push(name)
  }
  if (ue4ssFolder && await child(ue4ssFolder, 'UE4SS.dll', 'file')) {
    return { installed: true, layout: 'ue4ss-folder', modsDir: path.join(ue4ssFolder, 'Mods'), proxies }
  }
  if (await child(binariesDir, 'UE4SS.dll', 'file')) {
    return { installed: true, layout: 'beside-exe', modsDir: path.join(binariesDir, 'Mods'), proxies }
  }
  // Not installed: assume the UE4SS 3.x layout, where everything lives in a ue4ss folder.
  return { installed: false, layout: '', modsDir: path.join(binariesDir, 'ue4ss', 'Mods'), proxies: [] }
}

async function findPaks(project) {
  const paksDir = project.paks || path.join(project.directory, 'Content', 'Paks')
  const entries = await listDir(paksDir)
  const nested = await Promise.all(entries.filter((entry) => entry.isDirectory())
    .map(async (entry) => (await filesMatching(path.join(paksDir, entry.name), /\.utoc$/i)).length > 0))
  return {
    directory: paksDir,
    ioStore: entries.some((entry) => entry.isFile() && /\.utoc$/i.test(entry.name)) || nested.some(Boolean),
    logicMods: await childDir(paksDir, 'LogicMods'),
    tildeMods: await childDir(paksDir, '~mods'),
  }
}

// ---------------------------------------------------------------------------
// Stores

function acfValue(text, key) {
  const match = new RegExp(`"${key}"\\s+"([^"]*)"`, 'i').exec(text)
  return match ? match[1] : ''
}

async function findSteamApp(root, binariesDir) {
  // <library>/steamapps/common/<installdir>
  let current = path.resolve(root)
  for (let depth = 0; depth < 3; depth += 1) {
    const common = path.dirname(current)
    const steamapps = path.dirname(common)
    if (path.basename(common).toLowerCase() === 'common' && path.basename(steamapps).toLowerCase() === 'steamapps') {
      const installDir = path.basename(current).toLowerCase()
      for (const manifest of await filesMatching(steamapps, /^appmanifest_\d+\.acf$/i)) {
        const text = await readText(path.join(steamapps, manifest))
        if (acfValue(text, 'installdir').toLowerCase() === installDir) {
          return { id: acfValue(text, 'appid'), name: acfValue(text, 'name'), source: `Steam library (${manifest})` }
        }
      }
    }
    if (common === current) break
    current = common
  }
  for (const directory of [root, binariesDir]) {
    const file = await child(directory, 'steam_appid.txt', 'file')
    const id = file ? (await readText(file)).trim() : ''
    if (/^\d+$/.test(id)) return { id, name: '', source: relative(root, file) }
  }
  return null
}

async function findGogGame(root) {
  const infos = await filesMatching(root, /^goggame-\d+\.info$/i)
  const parsed = (await Promise.all(infos.map(async (file) => ({ file, data: await readJson(path.join(root, file)) }))))
    .filter((info) => info.data && info.data.gameId)
  // DLC ship their own .info files; the base game is the one with a primary play task.
  const game = parsed.find((info) => Array.isArray(info.data.playTasks) && info.data.playTasks.some((task) => task.isPrimary)) ?? parsed[0]
  if (!game) return null
  const primary = game.data.playTasks?.find((task) => task.isPrimary && task.path)
  return {
    id: String(game.data.gameId),
    name: String(game.data.name ?? ''),
    launcher: primary ? path.basename(String(primary.path)) : '',
    source: game.file,
  }
}

async function findEpicGame(root) {
  const egstore = await childDir(root, '.egstore')
  let appName = ''
  for (const file of await filesMatching(egstore, /\.mancpn$/i)) {
    const data = await readJson(path.join(egstore, file))
    if (data?.AppName) {
      appName = String(data.AppName)
      break
    }
  }
  // The launcher's own manifests carry the display name and also cover installs without .egstore.
  const manifests = path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests')
  for (const file of await filesMatching(manifests, /\.item$/i)) {
    const item = await readJson(path.join(manifests, file))
    if (!item?.AppName) continue
    if ((appName && item.AppName === appName) || (item.InstallLocation && samePath(item.InstallLocation, root))) {
      return {
        id: String(item.AppName),
        name: String(item.DisplayName ?? ''),
        launcher: item.LaunchExecutable ? path.basename(String(item.LaunchExecutable)) : '',
        source: 'Epic Games Launcher manifest',
      }
    }
  }
  return appName ? { id: appName, name: '', launcher: '', source: '.egstore' } : null
}

async function findXboxGame(root) {
  for (const directory of [root, path.dirname(root)]) {
    const config = await child(directory, 'MicrosoftGame.config', 'file')
    const appx = await child(directory, 'appxmanifest.xml', 'file')
    const text = `${config ? await readText(config) : ''}\n${appx ? await readText(appx) : ''}`
    const identity = /<Identity\b[^>]*\bName="([^"]+)"/i.exec(text)
    if (!identity) continue
    const display = /DefaultDisplayName="([^"]+)"/i.exec(text) ?? /<DisplayName>([^<]+)<\/DisplayName>/i.exec(text)
    const name = display && !display[1].startsWith('ms-resource:') ? display[1] : ''
    return { id: identity[1], name, launcher: '', source: config ? 'MicrosoftGame.config' : 'appxmanifest.xml' }
  }
  return null
}

// ---------------------------------------------------------------------------
// Online lookups

function createLookups({ net, userDataPath }) {
  const nexusCacheFile = path.join(userDataPath, 'nexus-games.json')
  let nexusGames = null

  async function request(url, init) {
    const response = await net.fetch(url, { ...init, signal: AbortSignal.timeout(lookupTimeout) })
    if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}`)
    return response
  }

  async function getJson(url) {
    return (await request(url)).json()
  }

  async function loadNexusGames() {
    if (nexusGames) return nexusGames
    const cached = await readJson(nexusCacheFile)
    if (cached && Array.isArray(cached.games) && Date.now() - cached.fetchedAt < nexusCacheAge) {
      nexusGames = cached.games
      return nexusGames
    }
    try {
      const games = (await getJson(nexusGamesUrl))
        .map((game) => ({ id: game.id, name: game.name, domain: game.domain_name }))
        .filter((game) => game.name && game.domain)
      await fsp.mkdir(userDataPath, { recursive: true })
      await fsp.writeFile(nexusCacheFile, JSON.stringify({ fetchedAt: Date.now(), games }))
      nexusGames = games
    } catch (error) {
      // Offline: an old list is still better than none.
      if (!cached?.games) throw error
      nexusGames = cached.games
    }
    return nexusGames
  }

  async function findNexusGame(name) {
    const key = titleKey(name)
    if (!key) return null
    const games = await loadNexusGames()
    return games.find((game) => titleKey(game.name) === key) ?? games.find((game) => game.domain === key) ?? null
  }

  async function searchSteam(name) {
    const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(name)}&cc=us&l=en`
    const result = await getJson(url)
    const match = (result.items ?? []).find((item) => item.type === 'app' && titleKey(item.name) === titleKey(name))
    return match ? { id: String(match.id), name: match.name, source: 'Steam store search' } : null
  }

  async function searchGog(name) {
    const url = `https://catalog.gog.com/v1/catalog?query=like:${encodeURIComponent(name)}&limit=20`
    const result = await getJson(url)
    const match = (result.products ?? []).find((product) => product.productType === 'game' && titleKey(product.title) === titleKey(name))
    return match ? { id: String(match.id), name: match.title, source: 'GOG catalog search' } : null
  }

  // Steam's library hero is a wide, text-free key art image: a good base for gameart.png.
  async function getSteamDetails(appId) {
    const input = JSON.stringify({
      ids: [{ appid: Number(appId) }],
      context: { language: 'english', country_code: 'US' },
      data_request: { include_assets: true },
    })
    const result = await getJson(`https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(input)}`)
    const item = result?.response?.store_items?.[0]
    if (!item || item.success !== 1) return null
    const assets = item.assets ?? {}
    const file = assets.library_hero || assets.page_background || ''
    let artwork = null
    if (file && assets.asset_url_format) {
      const url = steamAssetHost + assets.asset_url_format.replace('${FILENAME}', file)
      const response = await request(url)
      const type = response.headers.get('content-type') || 'image/jpeg'
      const data = Buffer.from(await response.arrayBuffer())
      artwork = { dataUrl: `data:${type};base64,${data.toString('base64')}`, source: `Steam library hero (${path.basename(file)})` }
    }
    return { name: item.name ?? '', artwork }
  }

  return { findNexusGame, searchSteam, searchGog, getSteamDetails }
}

// ---------------------------------------------------------------------------

function createAutoFill({ net, userDataPath }) {
  const lookups = createLookups({ net, userDataPath })

  async function scanGame(picked) {
    if (typeof picked !== 'string' || !path.isAbsolute(picked)) throw new Error('Pick the game’s install folder.')
    const root = await resolveGameRoot(picked)
    if (!root) {
      const other = await describeOtherEngine(picked)
      throw new Error(other || `No Unreal Engine game found in ${picked}. Pick the install folder that holds the Engine folder and the game’s own folder (for example RollerSkate).`)
    }

    const notes = []
    const rootExecutables = await filesMatching(root, /\.exe$/i)
    const project = pickProject(await findProjects(root), rootExecutables)
    const shipping = await findShippingExecutable(project)
    const [steam, gog, epic, xbox] = await Promise.all([
      findSteamApp(root, project.binaries.directory), findGogGame(root), findEpicGame(root), findXboxGame(root),
    ])
    const stores = { steam, gog, epic, xbox }

    const launcher = pickLauncher(rootExecutables, project.name, [gog?.launcher, epic?.launcher].filter(Boolean))
    if (!launcher && !shipping) throw new Error(`Found ${project.name} in ${root}, but no game executable in it.`)
    if (!launcher) notes.push(`No launcher at the install root, so the game executable is ${relative(root, shipping)}.`)

    const namedBy = [steam, gog, epic, xbox].find((store) => store?.name)
    let name = namedBy ? { value: namedBy.name, source: namedBy.source } : { value: path.basename(root), source: 'install folder name' }

    // Online lookups run together and never stop the scan: each failure becomes a note.
    const attempt = async (label, task) => {
      try {
        return await task()
      } catch (error) {
        notes.push(`${label} failed: ${error instanceof Error ? error.message : String(error)}`)
        return null
      }
    }
    const [steamDetails, steamSearch, gogSearch] = await Promise.all([
      steam ? attempt('Steam artwork lookup', () => lookups.getSteamDetails(steam.id)) : null,
      steam ? null : attempt('Steam store search', () => lookups.searchSteam(name.value)),
      gog ? null : attempt('GOG catalog search', () => lookups.searchGog(name.value)),
    ])
    if (steam && !steam.name && steamDetails?.name) {
      steam.name = steamDetails.name
      if (!namedBy) name = { value: steamDetails.name, source: 'Steam store' }
    }
    let nexusChecked = false
    const nexus = await attempt('Nexus Mods game lookup', async () => {
      const game = await lookups.findNexusGame(name.value)
      nexusChecked = true
      return game
    })
    if (nexus) name = { value: nexus.name, source: 'Nexus Mods game list' }
    else if (nexusChecked) notes.push(`${name.value} isn’t on Nexus Mods’ game list yet, so the game ID is a guess. Check it once the game has a Nexus Mods page.`)

    let artwork = steamDetails?.artwork ?? null
    const looked = { steam: steamSearch, gog: gogSearch }
    if (!artwork && steamSearch) {
      const details = await attempt('Steam artwork lookup', () => lookups.getSteamDetails(steamSearch.id))
      artwork = details?.artwork ?? null
    }

    if (project.binaries.platform.toLowerCase() === 'wingdk') {
      notes.push('This is a Game Pass (WinGDK) install. Steam and Epic copies use Binaries/Win64 and their own launcher, so check the executable and required files against one of those.')
    }

    const ue4ss = await findUe4ss(project.binaries.directory)
    const paks = await findPaks(project)
    return {
      folder: root,
      engine: 'unreal',
      projectName: project.name,
      platform: project.binaries.platform,
      name,
      nexus,
      executable: launcher ? launcher.file : relative(root, shipping),
      executableReason: launcher ? launcher.reason : 'the game’s shipping executable',
      shippingExecutable: shipping ? relative(root, shipping) : '',
      binaries: relative(root, project.binaries.directory),
      paks: {
        path: relative(root, paks.directory),
        ioStore: paks.ioStore,
        logicMods: Boolean(paks.logicMods),
        tildeMods: Boolean(paks.tildeMods),
      },
      ue4ss: {
        installed: ue4ss.installed,
        layout: ue4ss.layout,
        modsPath: relative(root, ue4ss.modsDir),
        proxies: ue4ss.proxies,
      },
      stores,
      looked,
      artwork,
      notes,
    }
  }

  return { scanGame }
}

function registerAutoFillHandlers({ ipcMain, dialog, BrowserWindow, autoFill }) {
  ipcMain.handle('autofill:choose-folder', async (event) => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: 'Choose the game’s install folder',
      properties: ['openDirectory'],
    })
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0]
  })
  ipcMain.handle('autofill:scan', (_event, folder) => autoFill.scanGame(folder))
}

module.exports = { createAutoFill, registerAutoFillHandlers, titleKey }
