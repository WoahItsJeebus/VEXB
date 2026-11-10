import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode, RefObject } from 'react'
import JSZip from 'jszip'
import {
  AlertTriangle, Check, ChevronDown, ChevronLeft, ChevronRight, Download, ExternalLink,
  FileCode2, FolderOpen, Gamepad2, HardDriveDownload, Image as ImageIcon, Info, Library as LibraryIcon,
  PackageCheck, Plus, Rocket, Save, Settings2, ShieldAlert, Sparkles, Trash2, Upload, WandSparkles, Wrench, X,
} from 'lucide-react'
import AutoFillDialog from './AutoFillDialog'
import type { AutoFillState } from './AutoFillDialog'
import Library from './Library'
import { buildChanges, prepareArtwork } from './autoFill'
import { detectLayout, matchesSuggestion, suggestModPath, suggestTargetPath, targetKind } from './suggestions'
import type { PathSuggestion } from './suggestions'
import type { AutoFillArtwork } from './autoFill'
import { importExtension } from './importExtension'
import {
  defaultForm, defaultMeta, isBlankForm, makeUid, newProjectId, normalizeForm, normalizeMeta,
  projectFileName, projectTitle, signatureFolderName, timeAgo,
} from './project'
import type { DeploymentTarget, FormState, ProjectMeta, ProjectRecord, ProjectSummary, StoredImage } from './project'
import {
  deleteProject, desktop, isDesktop, listProjects, readProject, saveProject, saveProjectNow, toSummary,
} from './storage'
import type { ExtensionContents, ExtensionFile, ExtensionList, InstalledExtension } from './storage'

type Artwork = { file: File; url: string; width: number; height: number; dataUrl: string }
type TargetPreset = Omit<DeploymentTarget, 'uid'> & { label: string; description: string }
type Session = { projectId: string; openedAt: number; updatedAt: number; meta: ProjectMeta }
type VortexStatus = { kind: 'success' | 'error'; message: string; folder?: string } | null

const draftKey = 'vexb-draft'
const sessionKey = 'vexb-session'
const artworkDraftKey = 'vexb-artwork'
const iconDraftKey = 'vexb-sidebar-icon'
const sidebarIconFile = 'gameicon.png'
const minIconSize = 128
const maxSignatureBytes = 256 * 1024
const recentMenuSize = 8

const targetPresets: TargetPreset[] = [
  {
    label: 'UE4SS loader', description: 'Routes the UE4SS runtime beside the real game executable.',
    id: 'ue4ss-loader', name: 'UE4SS Runtime', path: '', markers: 'dwmapi.dll\nxinput1_3.dll\nue4ss.dll', requiredArchivePath: '',
    priority: '10', createPath: true, keepArchiveLayout: false,
  },
  {
    label: 'UE4SS mods', description: 'Routes UE4SS Lua and C++ mod folders to its working Mods directory.',
    id: 'ue4ss-mods', name: 'UE4SS Mods', path: '', markers: '**/Scripts/*.lua\n**/dlls/*.dll', requiredArchivePath: '',
    priority: '20', createPath: true, keepArchiveLayout: true,
  },
  {
    label: 'PAK files', description: 'Unreal Engine PAK, UTOC and UCAS files in the game’s Content/Paks folder.',
    id: 'pak-mods', name: 'PAK Mods', path: '', markers: '*.pak\n*.utoc\n*.ucas', requiredArchivePath: '',
    priority: '20', createPath: true, keepArchiveLayout: false,
  },
  {
    label: 'LogicMods', description: 'Blueprint mods packed under a LogicMods folder, loaded by BPModLoader.',
    id: 'logic-mods', name: 'Logic Mods', path: '', markers: '*.pak\n*.utoc\n*.ucas', requiredArchivePath: 'LogicMods/**',
    priority: '19', createPath: true, keepArchiveLayout: false,
  },
  {
    label: 'Lua scripts', description: 'Routes standalone Lua archives to the location you specify.',
    id: 'lua-mods', name: 'Lua Mods', path: '', markers: '*.lua', requiredArchivePath: '',
    priority: '20', createPath: true, keepArchiveLayout: false,
  },
  {
    label: 'BepInEx loader', description: 'Installs BepInEx itself (winhttp.dll, doorstop_config.ini) beside the Unity game.',
    id: 'bepinex', name: 'BepInEx', path: '.', markers: 'winhttp.dll\ndoorstop_config.ini', requiredArchivePath: '',
    priority: '10', createPath: false, keepArchiveLayout: false,
  },
  {
    label: 'BepInEx plugins', description: 'Deploys managed plugins into BepInEx/plugins.',
    id: 'bepinex-plugins', name: 'BepInEx Plugins', path: 'BepInEx/plugins', markers: '*.dll', requiredArchivePath: '',
    priority: '20', createPath: true, keepArchiveLayout: false,
  },
  {
    label: 'BepInEx patchers', description: 'Preloader patchers packed under a patchers folder go to BepInEx/patchers.',
    id: 'bepinex-patchers', name: 'BepInEx Patchers', path: 'BepInEx/patchers', markers: '*.dll', requiredArchivePath: 'patchers/**',
    priority: '19', createPath: true, keepArchiveLayout: false,
  },
  {
    label: 'Game root', description: 'For loaders, DLLs, and other files that belong beside the game executable.',
    id: 'game-root', name: 'Game Root Files', path: '.', markers: '', requiredArchivePath: '',
    priority: '30', createPath: false, keepArchiveLayout: true,
  },
]

const steps = [
  { label: 'Game details', icon: Gamepad2 },
  { label: 'Detection & paths', icon: Settings2 },
  { label: 'Deployment targets', icon: Wrench },
  { label: 'Install behavior', icon: Wrench },
  { label: 'Game artwork', icon: ImageIcon },
  { label: 'Review & export', icon: PackageCheck },
]

const docs = {
  guide: 'https://github.com/Nexus-Mods/Vortex/wiki/MODDINGWIKI-Developers-General-Creating-a-game-extension',
  testing: 'https://github.com/Nexus-Mods/Vortex/wiki/How-to-test-a-game-extension',
  packaging: 'https://github.com/Nexus-Mods/Vortex/wiki/How-to-package-a-game-extension',
  upload: 'https://github.com/Nexus-Mods/Vortex/wiki/How-to-upload-an-extension-to-nexus',
  review: 'https://github.com/Nexus-Mods/Vortex/issues/new?assignees=&labels=extension+%3Agear%3A&projects=&template=review-extension.yaml&title=Review%3A+Game+Name',
}

function lines(value: string) {
  return value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean)
}

function js(value: string) {
  return JSON.stringify(value)
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function isAbsolutePath(value: string) {
  return /^[a-zA-Z]:[\\/]|^[\\/]{1,2}/.test(value.trim())
}

function hasTraversal(value: string) {
  return value.split(/[\\/]+/).filter(Boolean).includes('..')
}

function pathSegments(value: string) {
  return value.trim() === '.' ? [] : value.split(/[\\/]+/).map((part) => part.trim()).filter(Boolean)
}

function relativePathKey(segments: string[]) {
  return segments.filter((part) => part !== '.').join('/').toLowerCase()
}

function normalizeArchiveRule(value: string) {
  const rule = value.trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/\/{2,}/g, '/').replace(/\/+$/, '')
  return rule === '.' ? '' : rule
}

function defaultSignaturesPath(targets: DeploymentTarget[]) {
  const loader = targets.find((target) => target.id === 'ue4ss-loader' && target.path.trim())
  if (!loader) return ''
  const loaderPath = pathSegments(loader.path).join('/')
  return loaderPath ? `${loaderPath}/ue4ss/${signatureFolderName}` : `ue4ss/${signatureFolderName}`
}

function resolveSignaturesPath(form: FormState) {
  return form.signaturesPath.trim() || defaultSignaturesPath(form.targetLocations)
}

function isSteamAppId(value: string) {
  return /^\d+$/.test(value.trim())
}

function normalizeMarker(value: string) {
  const marker = value.replace(/\\/g, '/').replace(/^\.\//, '').trim()
  return /^\.[a-z0-9]+$/i.test(marker) ? `*${marker}` : marker
}


function makeTarget(preset: TargetPreset): DeploymentTarget {
  return { ...preset, uid: makeUid(preset.id) }
}

function loadDraft(): FormState {
  try {
    const stored = localStorage.getItem(draftKey)
    return stored ? normalizeForm(JSON.parse(stored) as Partial<FormState>) : defaultForm
  } catch {
    return defaultForm
  }
}

function loadSession(): Session {
  try {
    const stored = JSON.parse(localStorage.getItem(sessionKey) ?? 'null') as Partial<Session> | null
    if (stored && typeof stored.projectId === 'string' && stored.projectId) {
      return {
        projectId: stored.projectId,
        openedAt: Number(stored.openedAt) || Date.now(),
        updatedAt: Number(stored.updatedAt) || Date.now(),
        meta: normalizeMeta(stored.meta),
      }
    }
  } catch { /* start a fresh session below */ }
  // Drafts from before projects existed become the first project.
  return { projectId: newProjectId(), openedAt: Date.now(), updatedAt: Date.now(), meta: defaultMeta }
}

function storeLocally(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

function loadStoredImage(key: string): StoredImage | null {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? 'null') as StoredImage | null
    return stored?.dataUrl && stored.name && stored.type ? stored : null
  } catch {
    return null
  }
}

function dataUrlToFile(dataUrl: string, name: string, type: string) {
  const encoded = dataUrl.split(',', 2)[1]
  const binary = atob(encoded ?? '')
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new File([bytes], name, { type })
}

function decodeImage(stored: StoredImage | null): Promise<Artwork | null> {
  if (!stored) return Promise.resolve(null)
  return new Promise((resolve) => {
    try {
      const file = dataUrlToFile(stored.dataUrl, stored.name, stored.type)
      const url = URL.createObjectURL(file)
      const image = new Image()
      image.onload = () => resolve({ file, url, width: image.naturalWidth, height: image.naturalHeight, dataUrl: stored.dataUrl })
      image.onerror = () => {
        URL.revokeObjectURL(url)
        resolve(null)
      }
      image.src = url
    } catch {
      resolve(null)
    }
  })
}

function toStoredImage(image: Artwork | null): StoredImage | null {
  return image ? { dataUrl: image.dataUrl, name: image.file.name, type: image.file.type } : null
}

function isValidSidebarIcon(icon: Artwork) {
  return icon.width === icon.height && icon.width >= minIconSize
    && icon.file.size <= 1024 * 1024 && icon.file.type === 'image/png'
}

function generateInfo(form: FormState) {
  return JSON.stringify({
    name: form.gameName,
    author: form.author,
    version: form.version,
    description: form.description,
  }, null, 2)
}

function generateIndex(form: FormState, { sidebarIcon = false } = {}) {
  const storeIds = lines(form.storeIds)
  const requiredFiles = lines(form.requiredFiles)
  const modSegments = pathSegments(form.modPath)
  const toolId = slug(form.toolName) || 'game-tool'
  const installerId = `${form.gameId || 'game'}-mod`
  const extension = form.installerExtension.startsWith('.')
    ? form.installerExtension.toLowerCase()
    : `.${form.installerExtension.toLowerCase()}`
  const steamAppId = form.steamId.trim()
  const launchThroughSteam = form.launchThroughSteam && isSteamAppId(steamAppId)
  const targets = form.targetLocations.map((target) => {
    const targetId = slug(target.id) || 'target'
    const requiredArchivePath = normalizeArchiveRule(target.requiredArchivePath ?? '')
    return {
      id: targetId,
      installerId: `${form.gameId || 'game'}-${targetId}`,
      modType: `${form.gameId || 'game'}-${targetId}`,
      name: target.name.trim() || targetId,
      path: pathSegments(target.path),
      markers: lines(target.markers).map(normalizeMarker),
      ...(requiredArchivePath ? { requiredArchivePath } : {}),
      priority: Number(target.priority) || 20,
      keepArchiveLayout: target.keepArchiveLayout,
    }
  })
  // Every folder registered with Vortex as a deployment destination: the primary mod path
  // plus each target. Root destinations are left out because the game folder already exists.
  const signatureFiles = form.bundleSignatures ? form.signatureFiles.map((file) => file.name) : []
  const bundleSignatures = signatureFiles.length > 0
  const hasArchivePathRules = targets.some((target) => target.requiredArchivePath)
  const routedTargets = targets.filter((target) => target.markers.length > 0)
  // Mixed archives only mean something once two targets can recognize archive content.
  const mixedArchives = form.mixedArchiveSupport && routedTargets.length >= 2
  const keepExtraFiles = mixedArchives && form.keepExtraFiles
  // Keep archive layout needs to find the mod's own folder from the marker that matched.
  const keepsModFolders = mixedArchives || routedTargets.some((target) => target.keepArchiveLayout)
  const useTargetMatcher = hasArchivePathRules || keepsModFolders
  const mixedInstallerPriority = Math.min(
    ...routedTargets.map((target) => target.priority),
    ...(form.installerEnabled ? [Number(form.installerPriority) || 25] : []),
  ) - 1
  const deploymentKeys = new Set(form.maintainDeploymentDirectories
    ? [modSegments, ...targets.map((target) => target.path)].map(relativePathKey).filter(Boolean)
    : [])
  const maintainDirectories = deploymentKeys.size > 0
  const setupPaths = [
    ...(form.createModPath ? [modSegments] : []),
    ...form.targetLocations.filter((target) => target.createPath).map((target) => pathSegments(target.path)),
  ].filter((segments) => segments.length > 0 && !deploymentKeys.has(relativePathKey(segments)))
  const apiImports = [
    'fs', 'util',
    ...(targets.length || maintainDirectories || bundleSignatures || sidebarIcon ? ['selectors'] : []),
    ...(sidebarIcon ? ['actions'] : []),
    ...(maintainDirectories || bundleSignatures ? ['log'] : []),
  ]
  const constants = [
    'const path = require(\'path\');',
    ...(keepExtraFiles ? ['const { existsSync } = require(\'fs\');'] : []),
    `const { ${apiImports.join(', ')} } = require('vortex-api');`,
    '',
    `const GAME_ID = ${js(form.gameId)};`,
    ...(maintainDirectories ? [`const MOD_PATH = ${js(form.modPath)};`] : []),
    ...(launchThroughSteam ? [`const STEAM_APP_ID = ${js(steamAppId)};`] : []),
    ...(sidebarIcon ? [`const SIDEBAR_ICON = ${js(sidebarIconFile)};`] : []),
    ...(mixedArchives ? [
      `const MIXED_MOD_TYPE = ${js(`${form.gameId || 'game'}-mixed`)};`,
      `const MIXED_INSTALLER_PRIORITY = ${mixedInstallerPriority};`,
    ] : []),
    ...(bundleSignatures ? [
      `const SIGNATURES_PATH = ${JSON.stringify(pathSegments(resolveSignaturesPath(form)))};`,
      `const SIGNATURE_FILES = ${JSON.stringify(signatureFiles)};`,
    ] : []),
    storeIds.length ? `const STORE_IDS = ${JSON.stringify(storeIds)};` : '',
    form.installerEnabled ? `const MOD_FILE_EXT = ${js(extension)};` : '',
    targets.length ? `const DEPLOYMENT_TARGETS = ${JSON.stringify(targets, null, 2)};` : '',
    setupPaths.length ? `const MOD_DIRECTORIES = ${JSON.stringify(setupPaths)};` : '',
  ].filter((line, index, all) => line !== '' || all[index - 1] !== '').join('\n')
  const tool = form.toolEnabled && form.toolName && form.toolExecutable
    ? `\nconst moddingTools = [{\n  id: ${js(toolId)},\n  name: ${js(form.toolName)},\n  executable: () => ${js(form.toolExecutable)},\n  requiredFiles: [${js(form.toolExecutable)}],\n  relative: true,\n}];\n`
    : ''
  const detection = storeIds.length
    ? `\nfunction findGame() {\n  return util.GameStoreHelper.findByAppId(STORE_IDS)\n    .then((game) => game.gamePath);\n}\n`
    : ''
  const steamLauncher = launchThroughSteam
    ? String.raw`
function normalizeGamePath(value) {
  return path.resolve(value).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function requiresLauncher(gamePath, store) {
  const steamLaunch = { launcher: 'steam', addInfo: STEAM_APP_ID };
  if (store === 'steam') return Promise.resolve(steamLaunch);
  // Another store owns this copy, so Vortex should start it the usual way.
  if (store) return Promise.resolve(undefined);

  return util.GameStoreHelper.findByAppId([STEAM_APP_ID], 'steam')
    .then((game) => (normalizeGamePath(game.gamePath) === normalizeGamePath(gamePath) ? steamLaunch : undefined))
    .catch(() => undefined);
}
`
    : ''
  const setupSteps = [
    setupPaths.length
      ? 'Promise.all(MOD_DIRECTORIES.map((segments) =>\n    fs.ensureDirWritableAsync(path.join(discovery.path, ...segments))))'
      : '',
    maintainDirectories ? 'ensureDeploymentDirectories(discovery.path)' : '',
    bundleSignatures ? 'installSignatureFiles(discovery.path)' : '',
  ].filter(Boolean)
  const setup = setupSteps.length === 1
    ? `\nfunction prepareForModding(discovery) {\n  return ${setupSteps[0]};\n}\n`
    : setupSteps.length > 1
      ? `\nasync function prepareForModding(discovery) {\n${setupSteps.map((step) => `  await ${step};\n`).join('')}}\n`
      : ''
  const deploymentDirectoryHelpers = maintainDirectories
    ? String.raw`
function pathKey(value) {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

function getDeploymentDirectories(gamePath) {
  const gameRoot = path.resolve(gamePath);
  const directories = new Map();
  [
    path.resolve(gameRoot, MOD_PATH),${targets.length ? `
    ...DEPLOYMENT_TARGETS.map((target) => path.resolve(gameRoot, ...target.path)),` : ''}
  ].forEach((directory) => {
    // Root destinations are the game folder itself, which never needs creating.
    if (pathKey(directory) !== pathKey(gameRoot)) directories.set(pathKey(directory), directory);
  });
  return Array.from(directories.values());
}

function ensureDeploymentDirectories(gamePath) {
  return Promise.all(getDeploymentDirectories(gamePath)
    .map((directory) => fs.ensureDirWritableAsync(directory)));
}

function restoreDeploymentDirectories(api, profileId) {
  const profile = selectors.profileById(api.getState(), profileId);
  const gamePath = profile?.gameId === GAME_ID ? getGamePath(api) : undefined;
  if (gamePath === undefined) return Promise.resolve();

  return Promise.all(getDeploymentDirectories(gamePath).map((directory) =>
    fs.ensureDirWritableAsync(directory).catch((err) => {
      log('warn', 'Could not restore deployment directory after purge', {
        gameId: GAME_ID,
        path: directory,
        error: err?.message ?? String(err),
      });
    })));
}
`
    : ''
  const archiveHelpers = form.installerEnabled || targets.some((target) => target.markers.length > 0)
    ? String.raw`
function isFileInInstallRoot(file, rootPath) {
  if (!rootPath || rootPath === '.') return true;
  const relative = path.relative(rootPath, file);
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith('..' + path.sep)
    && !path.isAbsolute(relative);
}

function destinationFromInstallRoot(file, rootPath) {
  return !rootPath || rootPath === '.' ? file : path.relative(rootPath, file);
}
`
    : ''
  const installer = form.installerEnabled
    ? `\nfunction testSupportedContent(files, gameId) {\n  const supported = gameId === GAME_ID\n    && files.some((file) => path.extname(file).toLowerCase() === MOD_FILE_EXT);\n\n  return Promise.resolve({ supported, requiredFiles: [] });\n}\n\nfunction installContent(files) {\n  const modFile = files.find((file) => path.extname(file).toLowerCase() === MOD_FILE_EXT);\n  const rootPath = path.dirname(modFile);\n  const instructions = files\n    .filter((file) => !file.endsWith(path.sep) && isFileInInstallRoot(file, rootPath))\n    .map((file) => ({\n      type: 'copy',\n      source: file,\n      destination: destinationFromInstallRoot(file, rootPath),\n    }));\n\n  return Promise.resolve({ instructions });\n}\n`
    : ''
  const targetHelpers = targets.length
    ? String.raw`
function normalizeArchivePath(value) {
  return String(value).toLowerCase().replace(/\\/g, '/').replace(/^\.\//, '');
}

function matchesArchiveMarker(file, marker) {
  const normalizedFile = normalizeArchivePath(file);
  const normalizedMarker = normalizeArchivePath(marker);
  if (!normalizedMarker) return false;
  if (!normalizedMarker.includes('*')) {
    return normalizedFile === normalizedMarker || normalizedFile.endsWith('/' + normalizedMarker);
  }

${useTargetMatcher ? String.raw`  return new RegExp('(^|/)' + archiveGlobPattern(normalizedMarker) + '$', 'i').test(normalizedFile);
}

function archiveGlobPattern(value) {
  return value
    .replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    .replace(/\*\*/g, '@@DOUBLE_STAR@@')
    .replace(/\*/g, '[^/]*')
    .replace(/@@DOUBLE_STAR@@/g, '.*');
}

// Returns the archive folder matched by a required archive path, '' when the rule
// has no folder part, or undefined when the file sits outside the required path.
// A rule without wildcards is treated as a folder, so "LogicMods" means "LogicMods/**".
function getArchivePathRoot(file, requiredPath) {
  // Rules already match below any wrapper folder, so a leading "**/" adds nothing.
  const trimmed = requiredPath.replace(/^(\*\*\/)+/, '');
  const rule = trimmed.includes('*') ? trimmed : trimmed + '/**';
  const split = rule.endsWith('/**') ? rule.length - 3 : rule.lastIndexOf('/');
  const folder = split > 0 ? rule.slice(0, split) : '';
  const rest = split > 0 ? rule.slice(split + 1) : rule;
  const expression = folder
    ? '^((?:.*?/)?' + archiveGlobPattern(normalizeArchivePath(folder)) + ')/'
    : '^()(?:.*/)?';
  const match = new RegExp(expression + archiveGlobPattern(normalizeArchivePath(rest)) + '$', 'i')
    .exec(String(file).replace(/\\/g, '/').replace(/^\.\//, ''));
  return match ? match[1] : undefined;
}

function matchesTarget(file, target) {
  return target.markers.some((marker) => matchesArchiveMarker(file, marker))
    && (!target.requiredArchivePath || getArchivePathRoot(file, target.requiredArchivePath) !== undefined);
}

function findTargetMarker(files, target) {
  return files.find((file) => matchesTarget(file, target));
}

function getInstallRoot(marker, target) {
  const requiredRoot = target.requiredArchivePath ? getArchivePathRoot(marker, target.requiredArchivePath) : '';
  if (target.keepArchiveLayout) {${keepsModFolders ? `
    // Keep the mod's own folder and everything in it, dropping wrapper folders above it,
    // so "Game/.../Mods/MyMod/Scripts/main.lua" and "MyMod/Scripts/main.lua" install alike.
    const markerPattern = target.markers.find((candidate) => matchesArchiveMarker(marker, candidate));
    return parentFolder(requiredRoot || getMarkerFolder(toArchivePath(marker), markerPattern));` : `
    return '';`}
  }
  return requiredRoot || path.dirname(marker);
}
` : String.raw`  const expression = normalizedMarker
    .replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    .replace(/\*\*/g, '@@DOUBLE_STAR@@')
    .replace(/\*/g, '[^/]*')
    .replace(/@@DOUBLE_STAR@@/g, '.*');
  return new RegExp('(^|/)' + expression + '$', 'i').test(normalizedFile);
}

function findTargetMarker(files, target) {
  return files.find((file) => target.markers.some((marker) => matchesArchiveMarker(file, marker)));
}
`}
function testTargetContent(files, gameId, target) {
  return Promise.resolve({
    supported: gameId === GAME_ID && findTargetMarker(files, target) !== undefined,
    requiredFiles: [],
  });
}

function installTargetContent(files, target) {
  const marker = findTargetMarker(files, target);
  const rootPath = ${useTargetMatcher ? 'getInstallRoot(marker, target)' : "target.keepArchiveLayout ? '' : path.dirname(marker)"};
  const instructions = [
    { type: 'setmodtype', value: target.modType },
    ...files
      .filter((file) => !file.endsWith(path.sep) && isFileInInstallRoot(file, rootPath))
      .map((file) => ({
        type: 'copy',
        source: file,
        destination: destinationFromInstallRoot(file, rootPath),
      })),
  ];
  return Promise.resolve({ instructions });
}

function testTargetModType(instructions, target) {
  const supported = instructions.some((instruction) => {
    if (instruction.type === 'setmodtype') return instruction.value === target.modType;
    if (instruction.type !== 'copy') return false;
    const file = instruction.destination || instruction.source || '';
    return ${useTargetMatcher ? 'matchesTarget(file, target)' : 'target.markers.some((marker) => matchesArchiveMarker(file, marker))'};
  });
  return Promise.resolve(supported);
}
`
    : ''
  const signatureHelpers = bundleSignatures
    ? String.raw`
// Signature files ship inside this extension and are copied next to UE4SS.
// Vortex doesn't manage them, so they're refreshed after every deployment.
function installSignatureFiles(gamePath) {
  const sourceDir = path.join(__dirname, '${signatureFolderName}');
  const targetDir = path.join(gamePath, ...SIGNATURES_PATH);
  return fs.ensureDirWritableAsync(targetDir)
    .then(() => Promise.all(SIGNATURE_FILES.map((fileName) =>
      fs.copyAsync(path.join(sourceDir, fileName), path.join(targetDir, fileName)))));
}

function refreshSignatureFiles(api, profileId) {
  const profile = selectors.profileById(api.getState(), profileId);
  const gamePath = profile?.gameId === GAME_ID ? getGamePath(api) : undefined;
  if (gamePath === undefined) return Promise.resolve();

  return installSignatureFiles(gamePath).catch((err) => {
    log('warn', 'Could not copy UE4SS signature files after deployment', {
      gameId: GAME_ID,
      path: path.join(gamePath, ...SIGNATURES_PATH),
      error: err?.message ?? String(err),
    });
  });
}
`
    : ''
  const sidebarIconHelper = sidebarIcon
    ? String.raw`
// Vortex's game sidebar prefers a logo stored on the game's discovery entry over
// the registered logo, so the square icon goes there and gameart.png stays on tiles.
function applySidebarIcon(api) {
  const discovery = selectors.discoveryByGame(api.getState(), GAME_ID);
  if (discovery?.path !== undefined && discovery.logo !== SIDEBAR_ICON) {
    api.store.dispatch(actions.setGameParameters(GAME_ID, { logo: SIDEBAR_ICON }));
  }
}
`
    : ''
  const folderHelpers = keepsModFolders
    ? String.raw`
function toArchivePath(value) {
  return String(value).replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/\/+$/, '');
}

function parentFolder(archivePath) {
  const index = archivePath.lastIndexOf('/');
  return index === -1 ? '' : archivePath.slice(0, index);
}

// The folder a marker hit lives in, measured above the marker's own folder parts,
// so "Scripts/*.lua" on "Pack/MyMod/Scripts/main.lua" gives "Pack/MyMod".
function getMarkerFolder(archivePath, marker) {
  const trimmed = normalizeArchivePath(marker).replace(/^(\*\*\/)+/, '');
  const match = new RegExp('^(?:(.*)/)?' + archiveGlobPattern(trimmed) + '$', 'i').exec(archivePath);
  return match?.[1] ?? '';
}
`
    : ''
  const mixedHelpers = mixedArchives
    ? String.raw`
// Mixed archives: one download holding content for several deployment targets.
// Vortex gives a mod a single mod type, so these archives are staged relative to
// the game folder under MIXED_MOD_TYPE, with every file placed by its own target.

// Targets that can recognize archive content, lowest priority number first.
const ROUTED_TARGETS = DEPLOYMENT_TARGETS
  .filter((target) => target.markers.length > 0)
  .sort((first, second) => first.priority - second.priority);

function isInFolder(archivePath, folder) {
  return folder === '' || archivePath.toLowerCase().startsWith(folder.toLowerCase() + '/');
}

function baseName(archivePath) {
  return archivePath.slice(archivePath.lastIndexOf('/') + 1).replace(/\.[^.]*$/, '').toLowerCase();
}

// A marker naming a file or folder layout ("enabled.txt", "Scripts/*.lua") identifies a
// mod folder, so everything in that folder belongs to the target. A bare file type such
// as "*.pak" only claims matching files and their same-named companions.
function isFolderMarker(marker) {
  const trimmed = marker.replace(/^(\*\*\/)+/, '');
  return trimmed.includes('/') || !trimmed.includes('*');
}

function findTargetRegions(entries, target) {
  const regions = new Map();
  entries.forEach((entry) => {
    if (!matchesTarget(entry.source, target)) return;
    const marker = target.markers.find((candidate) => matchesArchiveMarker(entry.source, candidate));
    const ruleRoot = target.requiredArchivePath ? getArchivePathRoot(entry.source, target.requiredArchivePath) : '';
    const wholeFolder = Boolean(ruleRoot) || isFolderMarker(marker);
    const folder = ruleRoot || (wholeFolder ? getMarkerFolder(entry.archivePath, marker) : parentFolder(entry.archivePath));
    const key = (wholeFolder ? 'folder:' : 'files:') + folder.toLowerCase();
    if (!regions.has(key)) regions.set(key, { target, folder, wholeFolder, marker: entry.source });
  });
  // Outer folders first, so a mod folder isn't split by a match nested inside it.
  const depth = (region) => (region.folder === '' ? 0 : region.folder.split('/').length);
  return Array.from(regions.values()).sort((first, second) => depth(first) - depth(second));
}

function getRegionEntries(region, entries, claimed) {
  const available = entries.filter((entry) => !claimed.has(entry.source));
  if (region.wholeFolder) return available.filter((entry) => isInFolder(entry.archivePath, region.folder));

  const inFolder = available.filter((entry) => parentFolder(entry.archivePath).toLowerCase() === region.folder.toLowerCase());
  const matched = inFolder.filter((entry) => matchesTarget(entry.source, region.target));
  const names = new Set(matched.map((entry) => baseName(entry.archivePath)));
  return inFolder.filter((entry) => matched.includes(entry)
    || (names.has(baseName(entry.archivePath))
      && region.target.markers.some((marker) => matchesArchiveMarker(entry.source, marker))));
}

// Splits an archive into target regions. Higher-priority targets claim files first and a
// claimed file is never routed twice. Files outside every region are left out.
function classifyArchive(files) {
  const entries = files
    .filter((file) => !/[\\/]$/.test(file))
    .map((source) => ({ source, archivePath: toArchivePath(source) }));
  const claimed = new Set();
  const groups = [];
  ROUTED_TARGETS.forEach((target) => {
    findTargetRegions(entries, target).forEach((region) => {
      const regionEntries = getRegionEntries(region, entries, claimed);
      if (regionEntries.length === 0) return;
      regionEntries.forEach((entry) => claimed.add(entry.source));
      groups.push({ ...region, entries: regionEntries });
    });
  });
  return groups;
}

// Strips the same root a single-target install of this target would.
function getGroupStripRoot(group) {
  const root = toArchivePath(getInstallRoot(group.marker, group.target));
  return root === '.' ? '' : root;
}

function toGamePath(segments) {
  const parts = segments.filter((part) => part !== '' && part !== '.');
  if (parts.some((part) => part === '..' || part.includes(':'))) {
    throw new Error('Refusing to install outside the game folder: ' + parts.join('/'));
  }
  return parts.join(path.sep);
}

function buildTargetCopyInstructions(group) {
  const stripRoot = getGroupStripRoot(group);
  return group.entries
    .filter((entry) => isInFolder(entry.archivePath, stripRoot))
    .map((entry) => {
      if (/^([a-z]:|\/)/i.test(entry.archivePath) || entry.archivePath.split('/').includes('..')) {
        throw new Error('Refusing to install an unsafe archive path: ' + entry.source);
      }
      const relative = stripRoot ? entry.archivePath.slice(stripRoot.length + 1) : entry.archivePath;
      return {
        type: 'copy',
        source: entry.source,
        destination: toGamePath([...group.target.path, ...relative.split('/')]),
      };
    });
}

` + (keepExtraFiles ? String.raw`// Loose documentation at the top of an archive isn't game content.
const DOCUMENT_FILE = /^(readme|changelog|changes|license|licence|credits)([ ._-][^/]*)?$|\.(url|md|pdf)$/i;

// Files no target claimed. Files sitting directly beside a claimed file (a pak's readme,
// for example) belong to that mod and stay out, as they would in a single-target install.
function findExtraEntries(files, groups) {
  const claimed = new Set(groups.flatMap((group) => group.entries.map((entry) => entry.source)));
  return files
    .filter((file) => !/[\\/]$/.test(file) && !claimed.has(file))
    .map((source) => ({ source, archivePath: toArchivePath(source) }))
    .filter((entry) => !groups.some((group) => (group.wholeFolder
      ? isInFolder(entry.archivePath, group.folder)
      : parentFolder(entry.archivePath).toLowerCase() === group.folder.toLowerCase())));
}

// A single folder wrapping the whole archive ("MyMod-v1.2/...") is dropped, unless the
// game has a folder of that name, in which case the archive is laid out like the game.
function findWrapperFolder(files, gamePath) {
  const paths = files.filter((file) => !/[\\/]$/.test(file)).map(toArchivePath);
  const tops = new Set(paths.map((archivePath) => archivePath.split('/')[0].toLowerCase()));
  if (gamePath === undefined || tops.size !== 1 || paths.some((archivePath) => !archivePath.includes('/'))) return '';
  const wrapper = paths[0].split('/')[0];
  return existsSync(path.join(gamePath, wrapper)) ? '' : wrapper;
}

// Extra files keep the archive's own layout, relative to the game folder.
function buildExtraCopyInstructions(files, groups, gamePath) {
  const wrapper = findWrapperFolder(files, gamePath);
  return findExtraEntries(files, groups)
    .filter((entry) => isInFolder(entry.archivePath, wrapper))
    .map((entry) => ({ entry, relative: wrapper ? entry.archivePath.slice(wrapper.length + 1) : entry.archivePath }))
    .filter(({ relative }) => relative.includes('/') || !DOCUMENT_FILE.test(relative))
    .map(({ entry, relative }) => {
      if (/^([a-z]:|\/)/i.test(entry.archivePath) || entry.archivePath.split('/').includes('..')) {
        throw new Error('Refusing to install an unsafe archive path: ' + entry.source);
      }
      return { type: 'copy', source: entry.source, destination: toGamePath(relative.split('/')) };
    });
}

// One plan shared by the installer test and the install itself.
function planMixedInstall(files, gamePath) {
  const groups = classifyArchive(files);
  const targetIds = new Set();
  const destinations = new Map();
  const copies = [];
  let extraCount = 0;
  let error;
  const addCopy = (copy) => {
    const key = copy.destination.toLowerCase();
    if (destinations.has(key)) {
      throw new Error('Multiple archive files resolve to the same deployment destination: ' + copy.destination);
    }
    destinations.set(key, copy.source);
    copies.push(copy);
  };
  try {
    groups.forEach((group) => {
      const groupCopies = buildTargetCopyInstructions(group);
      if (groupCopies.length > 0) targetIds.add(group.target.id);
      groupCopies.forEach(addCopy);
    });
    const extraCopies = buildExtraCopyInstructions(files, groups, gamePath);
    extraCount = extraCopies.length;
    extraCopies.forEach(addCopy);
  } catch (err) {
    error = err;
  }
  return { targetIds, copies, extraCount, error };
}

// Two targets, or one target plus files a single-target install would leave behind.
function testMixedContent(files, gameId, gamePath) {
  const { targetIds, extraCount } = planMixedInstall(files, gamePath);
  const supported = gameId === GAME_ID && (targetIds.size >= 2 || (targetIds.size === 1 && extraCount > 0));
  return Promise.resolve({ supported, requiredFiles: [] });
}

function installMixedContent(files, gamePath) {
  const { copies, error } = planMixedInstall(files, gamePath);
  if (error !== undefined) return Promise.reject(error);
  return Promise.resolve({
    instructions: [{ type: 'setmodtype', value: MIXED_MOD_TYPE }, ...copies],
  });
}
` : String.raw`// One plan shared by the installer test and the install itself.
function planMixedInstall(files) {
  const groups = classifyArchive(files);
  const targetIds = new Set();
  const destinations = new Map();
  const copies = [];
  let error;
  try {
    groups.forEach((group) => {
      const groupCopies = buildTargetCopyInstructions(group);
      if (groupCopies.length > 0) targetIds.add(group.target.id);
      groupCopies.forEach((copy) => {
        const key = copy.destination.toLowerCase();
        if (destinations.has(key)) {
          throw new Error('Multiple archive files resolve to the same deployment destination: ' + copy.destination);
        }
        destinations.set(key, copy.source);
        copies.push(copy);
      });
    });
  } catch (err) {
    error = err;
  }
  return { targetIds, copies, error };
}

function testMixedContent(files, gameId) {
  const supported = gameId === GAME_ID && planMixedInstall(files).targetIds.size >= 2;
  return Promise.resolve({ supported, requiredFiles: [] });
}

function installMixedContent(files) {
  const { copies, error } = planMixedInstall(files);
  if (error !== undefined) return Promise.reject(error);
  return Promise.resolve({
    instructions: [{ type: 'setmodtype', value: MIXED_MOD_TYPE }, ...copies],
  });
}
`)
    : ''
  const gamePathHelper = targets.length || maintainDirectories || bundleSignatures
    ? String.raw`
function getGamePath(api) {
  return selectors.discoveryByGame(api.getState(), GAME_ID)?.path;
}
`
    : ''

  const properties = [
    '    id: GAME_ID,',
    `    name: ${js(form.gameName)},`,
    `    mergeMods: ${form.mergeMods},`,
    storeIds.length ? '    queryPath: findGame,' : '',
    form.toolEnabled ? '    supportedTools: moddingTools,' : '    supportedTools: [],',
    `    queryModPath: () => ${maintainDirectories ? 'MOD_PATH' : js(form.modPath)},`,
    "    logo: 'gameart.png',",
    `    executable: () => ${js(form.executable)},`,
    launchThroughSteam ? '    requiresLauncher,' : '',
    `    requiredFiles: ${JSON.stringify(requiredFiles, null, 2).replace(/\n/g, '\n    ')},`,
    setupSteps.length ? '    setup: prepareForModding,' : '',
    form.steamId ? `    environment: { SteamAPPId: ${launchThroughSteam ? 'STEAM_APP_ID' : js(form.steamId)} },` : '',
    (form.steamId || form.gogId)
      ? `    details: {${form.steamId ? ` steamAppId: ${launchThroughSteam ? 'STEAM_APP_ID' : js(form.steamId)},` : ''}${form.gogId ? ` gogAppId: ${js(form.gogId)},` : ''} },`
      : '',
  ].filter(Boolean).join('\n')
  const targetRegistrations = targets.length
    ? String.raw`
  DEPLOYMENT_TARGETS.forEach((target) => {
    context.registerModType(
      target.modType,
      target.priority,
      (gameId) => gameId === GAME_ID,
      () => {
        const gamePath = getGamePath(context.api);
        return gamePath === undefined ? undefined : path.join(gamePath, ...target.path);
      },
      (instructions) => testTargetModType(instructions, target),
      { name: target.name },
    );

    if (target.markers.length > 0) {
      context.registerInstaller(
        target.installerId,
        target.priority,
        (files, gameId) => testTargetContent(files, gameId, target),
        (files) => installTargetContent(files, target),
      );
    }
  });`
    : ''
  const mixedRegistration = mixedArchives
    ? String.raw`

  // Mixed archives deploy from the game folder; the installer sets this type explicitly,
  // so the type never claims mods by inspecting their files.
  context.registerModType(
    MIXED_MOD_TYPE,
    100,
    (gameId) => gameId === GAME_ID,
    () => getGamePath(context.api),
    () => Promise.resolve(false),
    { name: 'Mixed Content' },
  );
  context.registerInstaller(MIXED_MOD_TYPE, MIXED_INSTALLER_PRIORITY, ${keepExtraFiles
    ? '(files, gameId) => testMixedContent(files, gameId, getGamePath(context.api)),\n    (files) => installMixedContent(files, getGamePath(context.api))'
    : 'testMixedContent, installMixedContent'});`
    : ''
  const installerRegistration = form.installerEnabled
    ? `\n  context.registerInstaller(${js(installerId)}, ${Number(form.installerPriority) || 25}, testSupportedContent, installContent);`
    : ''
  const eventHandlers = [
    ...(sidebarIcon ? [
      '    applySidebarIcon(context.api);',
      "    context.api.onStateChange(['settings', 'gameMode', 'discovered', GAME_ID], () => applySidebarIcon(context.api));",
    ] : []),
    maintainDirectories ? "    context.api.onAsync('did-purge', (profileId) => restoreDeploymentDirectories(context.api, profileId));" : '',
    bundleSignatures ? "    context.api.onAsync('did-deploy', (profileId) => refreshSignatureFiles(context.api, profileId));" : '',
  ].filter(Boolean)
  const purgeRegistration = eventHandlers.length
    ? `\n\n  context.once(() => {\n${eventHandlers.join('\n')}\n  });`
    : ''
  return `${constants}${tool}${detection}${steamLauncher}${setup}${deploymentDirectoryHelpers}${archiveHelpers}${installer}${signatureHelpers}${sidebarIconHelper}${targetHelpers}${folderHelpers}${mixedHelpers}${gamePathHelper}\nfunction main(context) {\n  context.registerGame({\n${properties}\n  });${targetRegistrations}${mixedRegistration}${installerRegistration}${purgeRegistration}\n\n  return true;\n}\n\nmodule.exports = {\n  default: main,\n};\n`
}

// Saved next to index.js so VEXB can reopen the exact settings later.
function generateProjectFile(form: FormState) {
  return JSON.stringify({
    format: 1,
    savedAt: new Date().toISOString(),
    form: { ...form, signatureFiles: [] },
    signatureFiles: form.signatureFiles.map((file) => file.name),
  }, null, 2)
}

// Folders named after the extension's version follow it: game-x-0.2.0 becomes game-x-0.2.1.
function versionedFolder(folder: string, oldVersion: string, newVersion: string) {
  const suffix = `-${oldVersion}`
  if (!oldVersion || oldVersion === newVersion || !folder.toLowerCase().endsWith(suffix.toLowerCase())) return folder
  return `${folder.slice(0, -suffix.length)}-${newVersion}`
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  // Errors thrown in the main process arrive wrapped in Electron's IPC prefix.
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}

// Event handlers stamp projects through this so the timestamp isn't read during render.
function currentTime() {
  return Date.now()
}

function hasContent(record: ProjectRecord) {
  return !isBlankForm(record.form) || record.artwork !== null || record.sidebarIcon !== null || record.pluginFolder !== ''
}

function Builder() {
  const [session] = useState(loadSession)
  const [projectId, setProjectId] = useState(session.projectId)
  const [meta, setMeta] = useState<ProjectMeta>(session.meta)
  const openedAt = useRef(session.openedAt)
  const updatedAt = useRef(session.updatedAt)
  const [form, setForm] = useState<FormState>(loadDraft)
  const [view, setView] = useState<'builder' | 'library'>('builder')
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const switcher = useRef<HTMLDivElement>(null)
  const [extensionList, setExtensionList] = useState<ExtensionList | null>(null)
  const [extensionsLoading, setExtensionsLoading] = useState(false)
  const [libraryError, setLibraryError] = useState('')
  const [vortexStatus, setVortexStatus] = useState<VortexStatus>(null)
  const [installing, setInstalling] = useState(false)
  const imageLoad = useRef(0)
  const [activeStep, setActiveStep] = useState(0)
  const [artwork, setArtwork] = useState<Artwork | null>(null)
  const [previewFile, setPreviewFile] = useState<'index.js' | 'info.json'>('index.js')
  const [exporting, setExporting] = useState(false)
  const [saved, setSaved] = useState(false)
  const [artworkAutosaveIssue, setArtworkAutosaveIssue] = useState(false)
  const [sidebarIcon, setSidebarIcon] = useState<Artwork | null>(null)
  const [iconAutosaveIssue, setIconAutosaveIssue] = useState(false)
  const iconInput = useRef<HTMLInputElement>(null)
  const [signatureIssue, setSignatureIssue] = useState('')
  const [autoFill, setAutoFill] = useState<AutoFillState | null>(null)
  const autoFillRun = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const signatureInput = useRef<HTMLInputElement>(null)

  const currentRecord = useCallback((): ProjectRecord => ({
    id: projectId,
    form,
    artwork: toStoredImage(artwork),
    sidebarIcon: toStoredImage(sidebarIcon),
    ...meta,
    updatedAt: updatedAt.current,
    openedAt: openedAt.current,
  }), [projectId, form, artwork, sidebarIcon, meta])

  const rememberProject = useCallback((record: ProjectRecord) => {
    setProjects((current) => [toSummary(record), ...current.filter((project) => project.id !== record.id)])
  }, [])

  useEffect(() => { storeLocally(draftKey, form) }, [form])

  useEffect(() => {
    storeLocally(sessionKey, { projectId, openedAt: openedAt.current, updatedAt: updatedAt.current, meta })
  }, [projectId, meta, form])

  // The local draft keeps the open project safe between keystrokes; the project store
  // gets a copy once typing settles so it can be reopened from the recent list.
  useEffect(() => {
    const record = currentRecord()
    if (!hasContent(record)) return
    const timer = setTimeout(() => {
      saveProject(record).then(() => rememberProject(record)).catch(() => { /* retried on the next change */ })
    }, 400)
    return () => clearTimeout(timer)
  }, [currentRecord, rememberProject])

  useEffect(() => {
    const persistOnClose = () => {
      storeLocally(draftKey, form)
      const record = currentRecord()
      if (!hasContent(record)) return
      try { saveProjectNow(record) } catch { /* the local draft still has it */ }
    }
    window.addEventListener('pagehide', persistOnClose)
    return () => window.removeEventListener('pagehide', persistOnClose)
  }, [form, currentRecord])

  useEffect(() => {
    listProjects().then(setProjects).catch(() => setProjects([]))
    Promise.all([decodeImage(loadStoredImage(artworkDraftKey)), decodeImage(loadStoredImage(iconDraftKey))])
      .then(([storedArtwork, storedIcon]) => {
        // A project opened while these were decoding brings its own images.
        if (imageLoad.current !== 0) return
        if (storedArtwork) setArtwork(storedArtwork)
        if (storedIcon) setSidebarIcon(storedIcon)
      })
  }, [])

  useEffect(() => {
    if (!switcherOpen) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!switcher.current?.contains(event.target as Node)) setSwitcherOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setSwitcherOpen(false) }
    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [switcherOpen])

  const requiredFiles = lines(form.requiredFiles)
  const targetErrors = form.targetLocations.flatMap((target, index) => {
    const label = target.name.trim() || `Target ${index + 1}`
    return [
      !target.name.trim() && `Name target ${index + 1}.`,
      !/^[a-z0-9][a-z0-9-]*$/.test(target.id) && `${label}: use a lowercase target ID with no spaces.`,
      !target.path.trim() && `${label}: add a relative destination.`,
      isAbsolutePath(target.path) && `${label}: the destination must be relative to the game folder.`,
      hasTraversal(target.path) && `${label}: the destination cannot traverse outside the game folder.`,
      !/^\d+$/.test(target.priority) && `${label}: use a whole-number installer priority.`,
      isAbsolutePath(target.requiredArchivePath ?? '') && `${label}: the required archive path must be relative to the archive.`,
      hasTraversal(target.requiredArchivePath ?? '') && `${label}: the required archive path cannot contain "..".`,
      normalizeArchiveRule(target.requiredArchivePath ?? '') && !lines(target.markers).length && `${label}: add archive markers to use a required archive path.`,
    ].filter(Boolean) as string[]
  })
  const targetIds = form.targetLocations.map((target) => target.id).filter(Boolean)
  if (form.mixedArchiveSupport && targetIds.includes('mixed')) targetErrors.push('The target ID "mixed" is reserved for mixed archives. Rename that target or turn off mixed archive support.')
  if (new Set(targetIds).size !== targetIds.length) targetErrors.push('Every deployment target needs a unique target ID.')
  const baseErrors = [
    !form.gameName.trim() && 'Add the game name.',
    !/^[a-z0-9][a-z0-9-]*$/.test(form.gameId) && 'Use a lowercase Nexus game ID with no spaces.',
    !form.author.trim() && 'Add an author name.',
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(form.version) && 'Use a semantic version such as 0.2.0.',
    !form.description.trim() && 'Add an extension description.',
    !form.executable.trim() && 'Add the game executable.',
    isAbsolutePath(form.executable) && 'The game executable must be a relative path.',
    !form.modPath.trim() && 'Add the primary mod destination.',
    isAbsolutePath(form.modPath) && 'The primary mod destination must be relative to the game folder.',
    hasTraversal(form.modPath) && 'The primary mod destination cannot traverse outside the game folder.',
    requiredFiles.length === 0 && 'Add at least one required game file.',
    requiredFiles.some(isAbsolutePath) && 'Required files must use relative paths.',
    form.steamId.trim() !== '' && !isSteamAppId(form.steamId) && 'The Steam App ID must contain digits only.',
    form.installerEnabled && !form.installerExtension.trim() && 'Add the installer file extension.',
    form.toolEnabled && !form.toolName.trim() && 'Add the bundled tool name.',
    form.toolEnabled && !form.toolExecutable.trim() && 'Add the bundled tool executable.',
    form.toolEnabled && isAbsolutePath(form.toolExecutable) && 'The tool executable must be a relative path.',
    form.bundleSignatures && form.signatureFiles.length === 0 && 'Add at least one UE4SS signature file, or turn off signature bundling.',
    form.bundleSignatures && !resolveSignaturesPath(form) && 'Add the UE4SS signatures folder, or add a UE4SS loader target to use its default.',
    form.bundleSignatures && isAbsolutePath(form.signaturesPath) && 'The UE4SS signatures folder must be relative to the game folder.',
    form.bundleSignatures && hasTraversal(form.signaturesPath) && 'The UE4SS signatures folder cannot traverse outside the game folder.',
    ...targetErrors,
  ].filter(Boolean) as string[]
  const steamIdValid = isSteamAppId(form.steamId)
  const gameLayout = detectLayout(form)
  const modPathSuggestion = suggestModPath(gameLayout)
  const targetSuggestions = new Map(form.targetLocations.map((target) => [target.uid, suggestTargetPath(targetKind(target), gameLayout)]))
  const pendingSuggestions = form.targetLocations.filter((target) => {
    const suggestion = targetSuggestions.get(target.uid)
    return suggestion?.path && !matchesSuggestion(target.path, suggestion)
  }).length
  const routedTargetCount = form.targetLocations.filter((target) => lines(target.markers).length > 0).length
  const mixedArchiveNote = form.mixedArchiveSupport && routedTargetCount < 2
    ? 'Mixed archive support has no effect until at least two Deployment Targets have archive markers.'
    : ''
  const routingWarnings = form.targetLocations.flatMap((target) => {
    if (!normalizeArchiveRule(target.requiredArchivePath ?? '')) return []
    const markers = lines(target.markers).map(normalizeMarker).map((marker) => marker.toLowerCase())
    return form.targetLocations
      .filter((other) => other.uid !== target.uid && !normalizeArchiveRule(other.requiredArchivePath ?? '')
        && Number(other.priority) <= Number(target.priority)
        && lines(other.markers).map(normalizeMarker).some((marker) => markers.includes(marker.toLowerCase())))
      .map((other) => `${other.name.trim() || other.id} shares markers with ${target.name.trim() || target.id} and is tried at the same time or earlier, so it can claim archives meant for ${target.name.trim() || target.id}. Give ${target.name.trim() || target.id} a lower priority number.`)
  })
  const artworkValid = artwork?.width === 640 && artwork.height === 360
    && artwork.file.size <= 1024 * 1024 && artwork.file.type === 'image/png'
  const iconValid = sidebarIcon === null || isValidSidebarIcon(sidebarIcon)
  if (!iconValid) baseErrors.push(`Use a square PNG of at least ${minIconSize} × ${minIconSize} px under 1 MB for the sidebar icon, or remove it.`)
  const exportReady = baseErrors.length === 0 && artworkValid
  const indexCode = generateIndex(form, { sidebarIcon: sidebarIcon !== null })
  const infoCode = generateInfo(form)
  const recentProjects = [...projects]
    .filter((project) => project.id !== projectId)
    .sort((first, second) => second.openedAt - first.openedAt)
    .slice(0, recentMenuSize)
  const vortexFolder = meta.pluginFolder || `game-${form.gameId || '…'}-${form.version}`
  const importWarning = meta.source === 'imported'
    ? `This project was imported from ${meta.pluginFolder || 'an extension'} that wasn’t built with VEXB, so only the settings VEXB recognizes came across. Updating it in Vortex replaces its index.js with the generated one.`
    : ''

  function touch() {
    updatedAt.current = currentTime()
    setSaved(false)
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
    touch()
  }

  function updateName(value: string) {
    const previousSlug = slug(form.gameName)
    setForm((current) => ({
      ...current,
      gameName: value,
      gameId: current.gameId && current.gameId !== previousSlug ? current.gameId : slug(value),
      description: current.description && current.description !== `Vortex extension for ${current.gameName}`
        ? current.description : `Vortex extension for ${value}`,
    }))
    touch()
  }

  function updateSteamId(value: string) {
    setForm((current) => ({ ...current, steamId: value, launchThroughSteam: value.trim() ? current.launchThroughSteam : false }))
    touch()
  }

  function updateTarget(uid: string, key: keyof Omit<DeploymentTarget, 'uid'>, value: string | boolean) {
    setForm((current) => ({
      ...current,
      targetLocations: current.targetLocations.map((target) => target.uid === uid ? { ...target, [key]: value } : target),
    }))
    touch()
  }

  function addTarget(preset: TargetPreset) {
    setForm((current) => {
      // A preset without a fixed folder starts at the suggested one when it's known.
      const suggested = preset.path ? null : suggestTargetPath(targetKind(preset), detectLayout(current))
      const target = makeTarget({ ...preset, path: preset.path || suggested?.path || '' })
      return { ...current, targetLocations: [...current.targetLocations, target] }
    })
    touch()
  }

  function applySuggestedPaths() {
    setForm((current) => {
      const layout = detectLayout(current)
      return {
        ...current,
        targetLocations: current.targetLocations.map((target) => {
          const suggestion = suggestTargetPath(targetKind(target), layout)
          return suggestion?.path ? { ...target, path: suggestion.path } : target
        }),
      }
    })
    touch()
  }

  function addCustomTarget() {
    const index = form.targetLocations.length + 1
    addTarget({
      label: 'Custom target', description: '', id: `custom-target-${index}`, name: `Custom Target ${index}`,
      path: '', markers: '', requiredArchivePath: '', priority: '20', createPath: true, keepArchiveLayout: false,
    })
  }

  function removeTarget(uid: string) {
    setForm((current) => ({ ...current, targetLocations: current.targetLocations.filter((target) => target.uid !== uid) }))
    touch()
  }

  async function addSignatureFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? [])
    event.target.value = ''
    const skipped = selected.filter((file) => !/\.lua$/i.test(file.name) || file.size > maxSignatureBytes)
    const accepted = await Promise.all(selected.filter((file) => !skipped.includes(file))
      .map(async (file) => ({ name: file.name, content: await file.text() })))
    setSignatureIssue(skipped.length ? `Skipped ${skipped.map((file) => file.name).join(', ')}: signature files must be .lua files under 256 KB.` : '')
    if (!accepted.length) return
    // A file with the same name replaces the earlier copy, matching how it lands on disk.
    setForm((current) => ({
      ...current,
      signatureFiles: [
        ...current.signatureFiles.filter((file) => !accepted.some((added) => added.name.toLowerCase() === file.name.toLowerCase())),
        ...accepted,
      ].sort((first, second) => first.name.localeCompare(second.name)),
    }))
    touch()
  }

  function removeSignatureFile(name: string) {
    setForm((current) => ({ ...current, signatureFiles: current.signatureFiles.filter((file) => file.name !== name) }))
    touch()
  }

  function selectImage(file: File | undefined, key: string, current: Artwork | null, setImage: (image: Artwork) => void, setIssue: (issue: boolean) => void) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : null
      if (!dataUrl) return
      setIssue(!storeLocally(key, { dataUrl, name: file.name, type: file.type }))
      const url = URL.createObjectURL(file)
      const image = new Image()
      image.onload = () => {
        if (current) URL.revokeObjectURL(current.url)
        setImage({ file, url, width: image.naturalWidth, height: image.naturalHeight, dataUrl })
        touch()
      }
      image.src = url
    }
    reader.readAsDataURL(file)
  }

  function clearImage(key: string, current: Artwork | null, setImage: (image: null) => void, setIssue: (issue: boolean) => void, input: RefObject<HTMLInputElement | null>) {
    if (current) URL.revokeObjectURL(current.url)
    setImage(null)
    setIssue(false)
    localStorage.removeItem(key)
    if (input.current) input.current.value = ''
    touch()
  }

  function handleArtwork(event: ChangeEvent<HTMLInputElement>) {
    selectImage(event.target.files?.[0], artworkDraftKey, artwork, setArtwork, setArtworkAutosaveIssue)
  }

  function clearArtwork() {
    clearImage(artworkDraftKey, artwork, setArtwork, setArtworkAutosaveIssue, fileInput)
  }

  function handleSidebarIcon(event: ChangeEvent<HTMLInputElement>) {
    selectImage(event.target.files?.[0], iconDraftKey, sidebarIcon, setSidebarIcon, setIconAutosaveIssue)
  }

  function clearSidebarIcon() {
    clearImage(iconDraftKey, sidebarIcon, setSidebarIcon, setIconAutosaveIssue, iconInput)
  }

  // Swaps in another project's images. Decoding is async, so a newer switch wins.
  function showImages(nextArtwork: StoredImage | null, nextIcon: StoredImage | null) {
    const load = imageLoad.current + 1
    imageLoad.current = load
    if (artwork) URL.revokeObjectURL(artwork.url)
    if (sidebarIcon) URL.revokeObjectURL(sidebarIcon.url)
    setArtwork(null)
    setSidebarIcon(null)
    setArtworkAutosaveIssue(!storeLocally(artworkDraftKey, nextArtwork))
    setIconAutosaveIssue(!storeLocally(iconDraftKey, nextIcon))
    if (fileInput.current) fileInput.current.value = ''
    if (iconInput.current) iconInput.current.value = ''
    Promise.all([decodeImage(nextArtwork), decodeImage(nextIcon)]).then(([decodedArtwork, decodedIcon]) => {
      if (imageLoad.current !== load) {
        if (decodedArtwork) URL.revokeObjectURL(decodedArtwork.url)
        if (decodedIcon) URL.revokeObjectURL(decodedIcon.url)
        return
      }
      setArtwork(decodedArtwork)
      setSidebarIcon(decodedIcon)
    })
  }

  function showProject(record: ProjectRecord) {
    openedAt.current = record.openedAt
    updatedAt.current = record.updatedAt
    setProjectId(record.id)
    setForm(normalizeForm(record.form))
    setMeta(normalizeMeta(record))
    showImages(record.artwork, record.sidebarIcon)
    setActiveStep(0)
    setView('builder')
    setSwitcherOpen(false)
    setVortexStatus(null)
    setSignatureIssue('')
    setSaved(false)
  }

  async function saveCurrentProject() {
    const record = currentRecord()
    if (!hasContent(record)) return
    await saveProject(record)
    rememberProject(record)
  }

  async function openProject(id: string) {
    setSwitcherOpen(false)
    if (id === projectId) {
      setView('builder')
      return
    }
    try {
      await saveCurrentProject()
      const record = await readProject(id)
      if (!record) {
        setProjects((current) => current.filter((project) => project.id !== id))
        setLibraryError('That project’s file is missing, so it was taken off the list.')
        return
      }
      const opened = { ...record, ...normalizeMeta(record), openedAt: currentTime() }
      showProject(opened)
      rememberProject(opened)
      setLibraryError('')
    } catch (error) {
      setLibraryError(`Couldn’t open that project: ${errorMessage(error)}`)
    }
  }

  async function startNewProject() {
    try { await saveCurrentProject() } catch { /* the draft below is replaced either way */ }
    const now = currentTime()
    showProject({
      id: newProjectId(), form: defaultForm, artwork: null, sidebarIcon: null,
      ...defaultMeta, updatedAt: now, openedAt: now,
    })
  }

  async function removeProject(id: string) {
    const project = projects.find((item) => item.id === id)
    if (!project || id === projectId) return
    if (!window.confirm(`Remove “${projectTitle(project)}” from VEXB?${project.pluginFolder ? ` The installed extension in ${project.pluginFolder} stays in Vortex.` : ''}`)) return
    try {
      await deleteProject(id)
      setProjects((current) => current.filter((item) => item.id !== id))
    } catch (error) {
      setLibraryError(`Couldn’t remove that project: ${errorMessage(error)}`)
    }
  }

  async function refreshExtensions() {
    if (!desktop) return
    setExtensionsLoading(true)
    try {
      setExtensionList(await desktop.listExtensions())
      setLibraryError('')
    } catch (error) {
      setLibraryError(`Couldn’t read the plugins folder: ${errorMessage(error)}`)
    } finally {
      setExtensionsLoading(false)
    }
  }

  function openLibrary() {
    setView('library')
    setSwitcherOpen(false)
    if (!extensionList && !extensionsLoading) void refreshExtensions()
  }

  async function choosePluginsFolder() {
    if (!desktop) return
    try {
      const list = await desktop.choosePluginsFolder()
      if (list) setExtensionList(list)
    } catch (error) {
      setLibraryError(errorMessage(error))
    }
  }

  async function openFolder(folder?: string) {
    try {
      await desktop?.openExtensionFolder(folder)
    } catch (error) {
      setLibraryError(`Couldn’t open the folder: ${errorMessage(error)}`)
    }
  }

  // Reads an installed extension into a project. With a project ID, that project is
  // replaced by what's on disk; otherwise a new project is created and linked.
  async function loadFromVortex(folder: string, existingId?: string) {
    if (!desktop) return
    try {
      const contents: ExtensionContents = await desktop.readExtension(folder)
      const imported = importExtension(contents)
      await saveCurrentProject()
      const now = currentTime()
      const record: ProjectRecord = {
        id: existingId ?? newProjectId(),
        form: imported.form,
        artwork: contents.gameart,
        sidebarIcon: contents.gameicon,
        pluginFolder: folder,
        source: imported.source,
        importNotes: imported.notes,
        updatedAt: now,
        openedAt: now,
      }
      await saveProject(record)
      rememberProject(record)
      showProject(record)
      setLibraryError('')
    } catch (error) {
      setLibraryError(`Couldn’t load ${folder}: ${errorMessage(error)}`)
    }
  }

  function editExtension(extension: InstalledExtension) {
    const linked = projects.find((project) => project.pluginFolder.toLowerCase() === extension.folder.toLowerCase())
    if (linked) void openProject(linked.id)
    else void loadFromVortex(extension.folder)
  }

  function reloadExtension(extension: InstalledExtension, linkedId: string) {
    const project = projects.find((item) => item.id === linkedId)
    if (!window.confirm(`Replace “${project ? projectTitle(project) : extension.name}” with what’s installed in ${extension.folder}? Changes that haven’t been written to Vortex are lost.`)) return
    void loadFromVortex(extension.folder, linkedId)
  }

  async function packageFiles(): Promise<ExtensionFile[]> {
    if (!artwork) return []
    return [
      { path: 'info.json', data: infoCode },
      { path: 'index.js', data: indexCode },
      { path: projectFileName, data: generateProjectFile(form) },
      { path: 'gameart.png', data: new Uint8Array(await artwork.file.arrayBuffer()) },
      ...(sidebarIcon ? [{ path: sidebarIconFile, data: new Uint8Array(await sidebarIcon.file.arrayBuffer()) }] : []),
      ...(form.bundleSignatures
        ? form.signatureFiles.map((file) => ({ path: `${signatureFolderName}/${file.name}`, data: file.content }))
        : []),
    ]
  }

  async function exportZip() {
    if (!exportReady || !artwork) return
    setExporting(true)
    try {
      const zip = new JSZip()
      ;(await packageFiles()).forEach((file) => zip.file(file.path, file.data))
      const archive = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 9 } })
      const url = URL.createObjectURL(archive)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `game-${form.gameId}-${form.version}.zip`
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } finally { setExporting(false) }
  }

  async function installInVortex() {
    if (!desktop || !exportReady || !artwork) return
    setInstalling(true)
    setVortexStatus(null)
    try {
      const list = await desktop.listExtensions()
      setExtensionList(list)
      if (!list.exists) throw new Error(`The plugins folder ${list.pluginsFolder} doesn’t exist. Pick the right one under Projects & extensions.`)
      const byFolder = (name: string) => list.extensions.find((extension) => extension.folder.toLowerCase() === name.toLowerCase())
      let current = meta.pluginFolder ? byFolder(meta.pluginFolder) : undefined
      // The linked folder was renamed or replaced by hand (a ZIP extracted under a new name):
      // follow the VEXB-built copy of this game instead of recreating the old folder.
      if (meta.pluginFolder && !current) {
        const candidates = list.extensions.filter((extension) => extension.gameId === form.gameId
          && (extension.hasProjectFile || extension.looksLikeVexb))
        if (candidates.length === 1 && window.confirm(`${meta.pluginFolder} is no longer in the plugins folder, but ${candidates[0].folder} holds ${candidates[0].name} v${candidates[0].version}. Update that folder instead?`)) {
          current = candidates[0]
        }
      }
      const folder = current
        ? versionedFolder(current.folder, current.version, form.version)
        : `game-${form.gameId}-${form.version}`
      const renamedFrom = current && current.folder !== folder ? current.folder : undefined
      const existing = byFolder(folder)
      const sameGame = list.extensions.filter((extension) => extension.gameId === form.gameId
        && extension !== current && extension !== existing)
      const warnings = [
        !current && existing && `There’s already a “${folder}” folder in plugins (${existing.name}). Its files will be replaced.`,
        meta.source === 'imported' && `${current?.folder ?? folder} wasn’t built with VEXB. Its index.js will be replaced with the generated one, so any custom logic in it is lost.`,
        sameGame.length > 0 && `${sameGame.map((extension) => `${extension.name} (${extension.folder})`).join(', ')} also register${sameGame.length === 1 ? 's' : ''} the game ID “${form.gameId}”. Keep only one of them in the plugins folder.`,
      ].filter(Boolean)
      if (warnings.length && !window.confirm(`${warnings.join('\n\n')}\n\nWrite the extension anyway? Replaced files are backed up first.`)) return
      const result = await desktop.writeExtension(folder, await packageFiles(), renamedFrom)
      setMeta((currentMeta) => ({ ...currentMeta, pluginFolder: result.folder, source: 'vexb', importNotes: [] }))
      setVortexStatus({
        kind: 'success',
        folder: result.folder,
        message: `${renamedFrom ? `Updated ${renamedFrom} and renamed it to ${result.folder}` : `${current || existing ? 'Updated' : 'Installed'} ${result.folder}`} (v${form.version}). Restart Vortex to load it.${result.backup ? ' The previous files were backed up.' : ''}`,
      })
      setExtensionList(await desktop.listExtensions())
    } catch (error) {
      setVortexStatus({ kind: 'error', message: errorMessage(error) })
    } finally {
      setInstalling(false)
    }
  }

  // Auto-Fill: pick an installed game, review what was found, then apply the checked rows.
  async function startAutoFill() {
    if (!desktop) return
    const folder = await desktop.chooseGameFolder()
    if (!folder) return
    const run = autoFillRun.current + 1
    autoFillRun.current = run
    setAutoFill({ status: 'scanning', folder })
    try {
      const scan = await desktop.scanGame(folder)
      const notes = [...scan.notes]
      let foundArtwork: AutoFillArtwork | null = null
      if (scan.artwork) {
        const image = await prepareArtwork(scan.artwork.dataUrl).catch(() => null)
        if (image) foundArtwork = { image, source: scan.artwork.source, selected: artwork === null, replaces: artwork !== null }
        else notes.push('The Steam artwork couldn’t be turned into a 640 × 360 PNG under 1 MB, so it was left out.')
      } else if (!scan.stores.steam && !scan.looked.steam) {
        notes.push('No Steam App ID was found, so there’s no store artwork to use.')
      }
      if (autoFillRun.current !== run) return
      setAutoFill({ status: 'review', scan, changes: buildChanges(scan, form), artwork: foundArtwork, notes })
    } catch (error) {
      if (autoFillRun.current === run) setAutoFill({ status: 'error', folder, message: errorMessage(error) })
    }
  }

  const closeAutoFill = useCallback(() => {
    autoFillRun.current += 1
    setAutoFill(null)
  }, [])

  function chooseAutoFillFolder() {
    closeAutoFill()
    void startAutoFill()
  }

  function toggleAutoFillChange(key: string) {
    setAutoFill((current) => current?.status === 'review'
      ? { ...current, changes: current.changes.map((change) => change.key === key ? { ...change, selected: !change.selected } : change) }
      : current)
  }

  function toggleAllAutoFill(selected: boolean) {
    setAutoFill((current) => current?.status === 'review'
      ? {
        ...current,
        changes: current.changes.map((change) => ({ ...change, selected })),
        artwork: current.artwork && { ...current.artwork, selected },
      }
      : current)
  }

  function toggleAutoFillArtwork() {
    setAutoFill((current) => current?.status === 'review' && current.artwork
      ? { ...current, artwork: { ...current.artwork, selected: !current.artwork.selected } }
      : current)
  }

  function applyFoundArtwork(image: StoredImage) {
    const load = imageLoad.current
    setArtworkAutosaveIssue(!storeLocally(artworkDraftKey, image))
    if (fileInput.current) fileInput.current.value = ''
    decodeImage(image).then((decoded) => {
      // Another project was opened while the image decoded.
      if (!decoded || imageLoad.current !== load) return
      setArtwork((current) => {
        if (current) URL.revokeObjectURL(current.url)
        return decoded
      })
    })
  }

  function applyAutoFill() {
    if (autoFill?.status !== 'review') return
    const selected = autoFill.changes.filter((change) => change.selected)
    if (selected.length) setForm((current) => selected.reduce((next, change) => change.apply(next), current))
    if (autoFill.artwork?.selected) applyFoundArtwork(autoFill.artwork.image)
    touch()
    closeAutoFill()
  }

  function saveDraft() {
    storeLocally(draftKey, form)
    saveCurrentProject().catch(() => { /* the local draft is still current */ })
    setSaved(true)
    setTimeout(() => setSaved(false), 1800)
  }

  function showStep(index: number) {
    setActiveStep(index)
    setView('builder')
  }

  const field = (key: Exclude<keyof FormState, 'targetLocations' | 'signatureFiles'>, label: string, hint?: string, placeholder?: string, type = 'text') => (
    <label className="field">
      <span>{label}</span>
      <input type={type} value={String(form[key])} placeholder={placeholder} onChange={(event) => update(key, event.target.value as never)} />
      {hint && <small>{hint}</small>}
    </label>
  )

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-mark"><span>V</span></div>
        <div className="brand-copy"><strong>VEXB</strong><span>Vortex Extension Builder</span></div>
        <div className="project-switcher" ref={switcher}>
          <button className="switcher-button" aria-haspopup="menu" aria-expanded={switcherOpen} onClick={() => setSwitcherOpen((open) => !open)}>
            <span><small>PROJECT</small><strong>{projectTitle(form)}</strong></span><ChevronDown size={15} />
          </button>
          {switcherOpen && <div className="switcher-menu" role="menu">
            <div className="switcher-label">Recent projects</div>
            {recentProjects.length === 0 && <p className="switcher-empty">Nothing else yet. New projects and opened extensions show up here.</p>}
            {recentProjects.map((project) => <button key={project.id} role="menuitem" className="switcher-item" onClick={() => openProject(project.id)}>
              <strong>{projectTitle(project)}</strong>
              <span>{[project.gameId, project.version && `v${project.version}`, `edited ${timeAgo(project.updatedAt)}`].filter(Boolean).join(' · ')}</span>
            </button>)}
            <div className="switcher-actions">
              <button role="menuitem" onClick={startNewProject}><Plus size={15} />New project</button>
              <button role="menuitem" onClick={openLibrary}><LibraryIcon size={15} />All projects &amp; extensions</button>
            </div>
          </div>}
        </div>
        <div className="top-actions">
          <button className="text-button" onClick={startNewProject}>New project</button>
          {isDesktop && <button className="secondary-button" onClick={startAutoFill}><WandSparkles size={16} />Auto-Fill</button>}
          <button className="secondary-button" onClick={saveDraft}>{saved ? <Check size={16} /> : <Save size={16} />}{saved ? 'Saved' : 'Save draft'}</button>
        </div>
      </header>

      <aside className="sidebar">
        <div className="project-label">PROJECT WORKFLOW</div>
        <nav aria-label="Builder steps">
          {steps.map((step, index) => {
            const Icon = step.icon
            return <button key={step.label} className={`step-button ${view === 'builder' && activeStep === index ? 'active' : ''}`} onClick={() => showStep(index)}>
              <span className="step-icon">{index < activeStep ? <Check size={16} /> : <Icon size={17} />}</span>
              <span><small>0{index + 1}</small>{step.label}</span>
            </button>
          })}
        </nav>
        <button className={`library-button ${view === 'library' ? 'active' : ''}`} onClick={openLibrary}><LibraryIcon size={17} /><span>Projects &amp; extensions</span></button>
        <a className="docs-link" href={docs.guide} target="_blank" rel="noreferrer"><FileCode2 size={17} /> Official guide <ExternalLink size={14} /></a>
      </aside>

      <main className="workspace">
        {view === 'library' && <Library
          projects={projects}
          currentProjectId={projectId}
          extensionList={extensionList}
          extensionsLoading={extensionsLoading}
          error={libraryError}
          onOpenProject={openProject}
          onRemoveProject={removeProject}
          onNewProject={startNewProject}
          onRefreshExtensions={refreshExtensions}
          onChooseFolder={choosePluginsFolder}
          onEditExtension={editExtension}
          onReloadExtension={reloadExtension}
          onOpenFolder={openFolder}
        />}

        {view === 'builder' && <>
        <div className="workspace-heading">
          <div><span className="eyebrow">STEP {activeStep + 1} OF {steps.length}</span><h1>{steps[activeStep].label}</h1><p>{[
            'Define the identity Vortex and Nexus Mods will display.',
            'Tell Vortex how to find, verify, and launch the game.',
            'Register every extra folder Vortex can deploy to, with optional archive routing.',
            'Choose how archives, tools, and the default destination behave.',
            'Add the exact artwork required by the Vortex package format.',
            'Resolve any checks, inspect the output, and build the extension archive.',
          ][activeStep]}</p></div>
          <div className="completion"><strong>{Math.round(((activeStep + 1) / steps.length) * 100)}%</strong><span>workflow</span></div>
        </div>

        <div className="content-grid">
          <section className="form-surface">
            {activeStep === 0 && <div className="form-section">
              {(importWarning || meta.importNotes.length > 0) && <div className="notice warning import-notice"><ShieldAlert size={18} /><div><strong>Imported from Vortex</strong>{importWarning && <p>{importWarning}</p>}{meta.importNotes.map((note) => <p key={note}>{note}</p>)}</div></div>}
              {isDesktop && !form.executable.trim() && <div className="autofill-callout"><WandSparkles size={18} /><div><strong>Start from an installed game</strong><p>Pick an Unreal Engine game’s install folder to fill in its name, Nexus game ID, executable, required files, store IDs, deployment targets, and artwork. You review every value before it’s applied.</p></div><button className="secondary-button" onClick={startAutoFill}>Auto-Fill</button></div>}
              <div className="two-column">
                <label className="field"><span>Game name</span><input value={form.gameName} placeholder="Bloodstained: Ritual of the Night" onChange={(event) => updateName(event.target.value)} /><small>Match the name displayed on Nexus Mods.</small></label>
                {field('gameId', 'Nexus game ID', 'The lowercase part of the Nexus Mods URL.', 'bloodstainedritualofthenight')}
              </div>
              <div className="two-column">{field('author', 'Author', undefined, 'Your Nexus Mods name')}{field('version', 'Version', 'Semantic versioning is required. Start at 0.2.0.', '0.2.0')}</div>
              <label className="field"><span>Description</span><textarea value={form.description} rows={4} onChange={(event) => update('description', event.target.value)} /></label>
              <div className="notice"><AlertTriangle size={18} /><div><strong>Version contract</strong><p>The version here must exactly match the version uploaded to Nexus Mods. Every re-upload needs a new version.</p></div></div>
            </div>}

            {activeStep === 1 && <div className="form-section">
              <div className="two-column">{field('executable', 'Game executable', 'Relative to the game installation.', 'Game.exe')}<SuggestedPathField label="Primary mod destination" value={form.modPath} placeholder="Game/Content/Mods" hint="Default target; commonly the game’s PAK or Mods folder." suggestion={modPathSuggestion} onChange={(value) => update('modPath', value)} /></div>
              <label className="field"><span>Required files</span><textarea value={form.requiredFiles} rows={4} placeholder={'Game.exe\nGame/Binaries/Win64/Game-Win64-Shipping.exe'} onChange={(event) => update('requiredFiles', event.target.value)} /><small>One relative path per line. Vortex checks all of them to verify the installation.</small></label>
              <div className="section-divider"><span>Deployment folders</span></div>
              <Toggle label="Maintain deployment directories" detail="Keep every registered deployment folder present and writable. Missing folders are recreated when the game is set up and after a Vortex purge, so a deleted folder can’t make a deployment method unavailable." value={form.maintainDeploymentDirectories} onChange={(value) => update('maintainDeploymentDirectories', value)} />
              <div className="section-divider"><span>Automatic discovery</span></div>
              <label className="field"><span>Game store application IDs</span><input value={form.storeIds} placeholder="692850, 1133514031" onChange={(event) => update('storeIds', event.target.value)} /><small>Steam, GOG, Epic, EA, Ubisoft, or Xbox IDs accepted by GameStoreHelper. Separate multiple IDs with commas.</small></label>
              <div className="two-column"><label className="field"><span>Steam App ID</span><input value={form.steamId} placeholder="692850" onChange={(event) => updateSteamId(event.target.value)} /><small>The game’s Steam application ID. Used for Steam integration and optional Steam-client launching.</small></label>{field('gogId', 'GOG App ID', 'Stored in the extension details.', '1133514031')}</div>
              <Toggle label="Launch through Steam" detail={steamIdValid ? 'Have Vortex ask the Steam client to launch Steam copies instead of starting the executable directly. Useful for Steam Input, controller support, Overlay, DRM, and other Steam services.' : 'Add a numeric Steam App ID to let Vortex launch the game through the Steam client.'} value={form.launchThroughSteam && steamIdValid} disabled={!steamIdValid} onChange={(value) => update('launchThroughSteam', value)} />
              {!lines(form.storeIds).length && <div className="notice warning"><ShieldAlert size={18} /><div><strong>Manual discovery needed</strong><p>Without a store ID, users must locate the game manually in Vortex.</p></div></div>}
            </div>}

            {activeStep === 2 && <div className="form-section targets-section">
              <div className="target-intro"><div><strong>Additional deployment targets</strong><p>The primary destination is configured in Detection &amp; paths. Add only locations that need their own Vortex mod type, such as the game root, UE4SS’s executable/Mods directories, or BepInEx/plugins.</p></div><div className="target-intro-actions">{pendingSuggestions > 0 && <button className="secondary-button" onClick={applySuggestedPaths}><Sparkles size={16} />Use suggested paths ({pendingSuggestions})</button>}<button className="secondary-button" onClick={addCustomTarget}><Plus size={16} />Custom target</button></div></div>
              <div className="layout-note"><FolderOpen size={15} />{gameLayout.mainFolder
                ? <span>Main game folder <code>{gameLayout.mainFolder}</code> ({gameLayout.source}). Suggested paths are built from it.</span>
                : gameLayout.engine === 'unity'
                  ? <span>Unity game: BepInEx targets suggest the standard BepInEx folders.</span>
                  : <span>Main game folder not found yet. Add the shipping executable (<code>Game/Binaries/Win64/Game-Win64-Shipping.exe</code>) to Required files or use Auto-Fill, and Unreal targets will suggest their folders.</span>}</div>
              <div className="preset-grid" aria-label="Target quick starts">
                {targetPresets.map((preset) => {
                  const alreadyAdded = form.targetLocations.some((target) => target.id === preset.id)
                  return <button key={preset.id} className="preset-button" disabled={alreadyAdded} title={preset.description} onClick={() => addTarget(preset)}><strong>{preset.label}</strong><span>{alreadyAdded ? 'Added' : preset.description}</span></button>
                })}
              </div>
              <div className="target-list">
                {form.targetLocations.length === 0 && <div className="empty-targets"><Info size={18} /><div><strong>No additional locations yet</strong><p>Use a quick start or create a custom target. The default mod destination remains available even without an extra target.</p></div></div>}
                {form.targetLocations.map((target, index) => <section className="target-card" key={target.uid}>
                  <div className="target-card-heading"><div><span>TARGET {String(index + 1).padStart(2, '0')}</span><strong>{target.name || 'Unnamed target'}</strong></div><button className="icon-button remove-target" aria-label={`Remove ${target.name || 'target'}`} title="Remove target" onClick={() => removeTarget(target.uid)}><Trash2 size={16} /></button></div>
                  <div className="two-column">
                    <label className="field"><span>Target name</span><input value={target.name} placeholder="UE4SS Mods" onChange={(event) => updateTarget(target.uid, 'name', event.target.value)} /><small>Shown in Vortex’s mod-type selector.</small></label>
                    <label className="field"><span>Target ID</span><input value={target.id} placeholder="ue4ss-mods" onChange={(event) => updateTarget(target.uid, 'id', event.target.value)} /><small>Lowercase, unique, and stable after release.</small></label>
                  </div>
                    <SuggestedPathField label="Destination relative to game" value={target.path} placeholder="Chronos/Binaries/Win64 or . for the installation root" suggestion={targetSuggestions.get(target.uid) ?? null} onChange={(value) => updateTarget(target.uid, 'path', value)} hint={<>Use <code>.</code> for the installation root. For UE4SS, enter the real executable directory (usually <code>Game/Binaries/Win64</code>) and its <code>Mods</code> child for UE4SS mods.</>} />
                  <div className="two-column">
                    <label className="field"><span>Archive markers <em>optional</em></span><textarea value={target.markers} rows={3} placeholder={'xinput1_3.dll\n**/Scripts/*.lua\n*.pak'} onChange={(event) => updateTarget(target.uid, 'markers', event.target.value)} /><small>One marker or glob per line. Blank means users choose this target manually in Vortex.</small></label>
                    <div>
                    <label className="field"><span>Required archive path / folder <em>optional</em></span><input value={target.requiredArchivePath} placeholder="LogicMods/*" onChange={(event) => updateTarget(target.uid, 'requiredArchivePath', event.target.value)} /><small>Optional. Restrict this target to markers found under a specific path inside the archive. Leave blank to match anywhere.</small></label>
                    <label className="field"><span>Installer priority</span><input type="number" min="1" value={target.priority} onChange={(event) => updateTarget(target.uid, 'priority', event.target.value)} /><small>Lower priorities are tried first. Use a lower value for specific routes.</small></label>
                    </div>
                  </div>
                  <div className="target-options">
                    <Toggle label="Create this folder" detail="Prepare the destination before Vortex manages the game." value={target.createPath} onChange={(value) => updateTarget(target.uid, 'createPath', value)} />
                    <Toggle label="Keep archive layout" detail="Keep the mod’s own folder and everything inside it; wrapper folders above it (including a full game path) are dropped. Turn this off to strip down to the marker’s folder, or to the required archive path when one is set." value={target.keepArchiveLayout} onChange={(value) => updateTarget(target.uid, 'keepArchiveLayout', value)} />
                  </div>
                </section>)}
              </div>
              {routingWarnings.map((warning) => <div className="notice warning" key={warning}><ShieldAlert size={18} /><div><strong>Overlapping archive routes</strong><p>{warning}</p></div></div>)}
              <p className="manual-note"><strong>Routing is intentionally explicit.</strong> A marker automatically assigns a matching archive to this target. A target without markers is still registered, but its mod type must be chosen in Vortex so unrelated files are not routed by guesswork.</p>
            </div>}

            {activeStep === 3 && <div className="form-section">
              <Toggle label="Merge deployed mods" detail="Install files from all mods into the same destination tree." value={form.mergeMods} onChange={(value) => update('mergeMods', value)} />
              <Toggle label="Create the primary mod folder" detail="Ensure the default destination exists before Vortex manages the game." value={form.createModPath} onChange={(value) => update('createModPath', value)} />
              <Toggle label="Support mixed mod archives" detail="Allows one archive to contain files for multiple Deployment Targets. Matching files are routed to their respective game directories while remaining one mod in Vortex." value={form.mixedArchiveSupport} onChange={(value) => update('mixedArchiveSupport', value)} />
              {form.mixedArchiveSupport && <Toggle label="Keep files no target claims" detail="Files no Deployment Target recognizes are installed relative to the game folder in the author’s own layout (a CustomMusic folder lands at the game root) instead of being left out, including when only one target matches. A lone wrapper folder the game doesn’t have is dropped, and top-level readme and license files are skipped." value={form.keepExtraFiles} onChange={(value) => update('keepExtraFiles', value)} />}
              {mixedArchiveNote && <div className="notice"><Info size={18} /><div><strong>Not active yet</strong><p>{mixedArchiveNote}</p></div></div>}
              <Toggle label="Normalize primary mod archives" detail="Find a primary file type inside wrapper folders before deploying to the default destination." value={form.installerEnabled} onChange={(value) => update('installerEnabled', value)} />
              {form.installerEnabled && <div className="nested-fields two-column">{field('installerExtension', 'Primary mod file type', undefined, '.pak')}{field('installerPriority', 'Installer priority', 'Lower values run first.', '25', 'number')}</div>}
              <Toggle label="Add a bundled game tool" detail="Expose a tool or alternate launcher from Vortex." value={form.toolEnabled} onChange={(value) => update('toolEnabled', value)} />
              {form.toolEnabled && <div className="nested-fields two-column">{field('toolName', 'Tool name', undefined, 'Script Extender')}{field('toolExecutable', 'Tool executable', undefined, 'tool_loader.exe')}</div>}
              <Toggle label="Bundle UE4SS signature files" detail="Ship custom AOB signature scripts with the extension and copy them into UE4SS_Signatures when the game is set up and after every deployment." value={form.bundleSignatures} onChange={(value) => update('bundleSignatures', value)} />
              {form.bundleSignatures && <div className="nested-fields">
                <label className="field"><span>Signatures folder relative to game</span><input value={form.signaturesPath} placeholder={defaultSignaturesPath(form.targetLocations) || 'Game/Binaries/Win64/ue4ss/UE4SS_Signatures'} onChange={(event) => update('signaturesPath', event.target.value)} /><small>{defaultSignaturesPath(form.targetLocations) ? 'Leave blank to use the placeholder folder, based on the UE4SS loader target (UE4SS 3.x layout). Older UE4SS builds keep UE4SS_Signatures beside UE4SS.dll.' : 'Add a UE4SS loader target to fill this in automatically, or enter the folder that contains UE4SS.dll followed by UE4SS_Signatures.'}</small></label>
                <input ref={signatureInput} className="hidden-input" type="file" accept=".lua" multiple onChange={addSignatureFiles} />
                <div className="field"><span>Signature files</span>
                  <div className="signature-list">
                    {form.signatureFiles.map((file) => <div className="signature-row" key={file.name}><FileCode2 size={15} /><span>{file.name}</span><small>{(new Blob([file.content]).size / 1024).toFixed(1)} KB</small><button className="icon-button" aria-label={`Remove ${file.name}`} title="Remove file" onClick={() => removeSignatureFile(file.name)}><Trash2 size={14} /></button></div>)}
                    <button className="secondary-button" onClick={() => signatureInput.current?.click()}><Plus size={16} />Add .lua files</button>
                  </div>
                  <small>{signatureIssue || 'For example GUObjectArray.lua or FName_ToString.lua. Files are packed into UE4SS_Signatures inside the extension ZIP.'}</small>
                </div>
              </div>}
            </div>}

            {activeStep === 4 && <div className="form-section artwork-section">
              <input ref={fileInput} className="hidden-input" type="file" accept="image/png" onChange={handleArtwork} />
              {!artwork
                ? <button className="drop-zone" onClick={() => fileInput.current?.click()}><span className="upload-icon"><Upload size={24} /></span><strong>Choose gameart.png</strong><p>PNG only, exactly 640 × 360 px, maximum 1 MB</p></button>
                : <div className="artwork-preview"><img src={artwork.url} alt="Selected game artwork" /><button className="icon-button remove-art" aria-label="Remove artwork" title="Remove artwork" onClick={clearArtwork}><X size={18} /></button><div className="artwork-stats"><span className={artwork.width === 640 && artwork.height === 360 ? 'pass' : 'fail'}>{artwork.width} × {artwork.height} px</span><span className={artwork.file.size <= 1024 * 1024 ? 'pass' : 'fail'}>{(artwork.file.size / 1024).toFixed(0)} KB</span><span>{artwork.file.name}</span></div></div>}
              <div className="art-rules"><div><Check size={17} /><span>PNG, 640 × 360 px, under 1 MB</span></div><div><Info size={17} /><span>Landscape 16:9 composition</span></div><div><Info size={17} /><span>No text or game title — manual review</span></div></div>
              <p className="manual-note"><strong>There is no text/title detector.</strong> VEXB only verifies the image type, dimensions, and size. The text/title rule is shown as a neutral manual-review item, not a failed check. {artwork && !artworkAutosaveIssue && 'Your selected artwork is saved with the local draft.'}{artworkAutosaveIssue && 'This artwork could not be saved locally; the rest of the draft is still protected.'}</p>
              <div className="section-divider"><span>Sidebar icon</span></div>
              <input ref={iconInput} className="hidden-input" type="file" accept="image/png" onChange={handleSidebarIcon} />
              <div className="icon-picker">
                {!sidebarIcon
                  ? <button className="drop-zone icon-drop" onClick={() => iconInput.current?.click()}><span className="upload-icon"><Upload size={20} /></span><strong>Choose icon</strong><p>Square PNG</p></button>
                  : <div className="artwork-preview icon-preview"><img src={sidebarIcon.url} alt="Selected sidebar icon" /><button className="icon-button remove-art" aria-label="Remove sidebar icon" title="Remove sidebar icon" onClick={clearSidebarIcon}><X size={16} /></button></div>}
                <div className="icon-details">
                  <p><strong>Optional.</strong> Shown in Vortex’s game sidebar instead of a crop of gameart.png. Game tiles and profiles keep using gameart.png. Use a square PNG, at least {minIconSize} × {minIconSize} px (256 × 256 recommended), under 1 MB. If Nexus Mods has its own thumbnail for the game, Vortex may show that instead.</p>
                  {sidebarIcon && <div className="artwork-stats"><span className={sidebarIcon.width === sidebarIcon.height && sidebarIcon.width >= minIconSize ? 'pass' : 'fail'}>{sidebarIcon.width} × {sidebarIcon.height} px</span><span className={sidebarIcon.file.size <= 1024 * 1024 ? 'pass' : 'fail'}>{(sidebarIcon.file.size / 1024).toFixed(0)} KB</span><span>{sidebarIcon.file.name}</span></div>}
                  {iconAutosaveIssue && <p>This icon could not be saved locally; the rest of the draft is still protected.</p>}
                </div>
              </div>
            </div>}

            {activeStep === 5 && <div className="form-section review-section">
              <div className={`readiness ${exportReady ? 'ready' : ''}`}><span>{exportReady ? <Check size={24} /> : <AlertTriangle size={24} />}</span><div><strong>{exportReady ? 'Package ready' : 'Action required'}</strong><p>{exportReady ? 'All automated package checks pass.' : `${baseErrors.length + (artworkValid ? 0 : 1)} checks remaining before export.`}</p></div></div>
              <div className="check-list">
                {baseErrors.map((error) => <div className="check-row fail" key={error}><X size={16} /><span>{error}</span></div>)}
                {mixedArchiveNote && <div className="check-row info"><Info size={16} /><span>{mixedArchiveNote}</span></div>}
                {importWarning && <div className="check-row info"><Info size={16} /><span>{importWarning}</span></div>}
                {!artworkValid && <div className="check-row fail"><X size={16} /><span>Add a valid 640 × 360 PNG under 1 MB.</span></div>}
                {exportReady && ['Metadata and semantic version are valid.', 'Game paths are relative and safe.', 'Deployment targets are registered and unique.', 'Artwork format and dimensions are valid.'].map((message) => <div className="check-row pass" key={message}><Check size={16} /><span>{message}</span></div>)}
              </div>
              <div className="export-actions">
                <button className="export-button" disabled={!exportReady || exporting} onClick={exportZip}>{exporting ? <PackageCheck size={18} /> : <Download size={18} />}{exporting ? 'Building package…' : 'Build Vortex extension ZIP'}</button>
                {isDesktop && <button className="vortex-button" disabled={!exportReady || installing} onClick={installInVortex}><HardDriveDownload size={18} />{installing ? 'Writing to Vortex…' : meta.pluginFolder ? 'Update in Vortex' : 'Install in Vortex'}</button>}
              </div>
              {isDesktop && <p className="vortex-note">{meta.pluginFolder ? 'Updates' : 'Installs'} straight into <code>plugins\{vortexFolder}</code>, so there’s nothing to extract. A folder named after the version (like <code>game-x-0.2.0</code>) is renamed to match the new one, and replaced files are backed up first. Restart Vortex afterwards to load the change.</p>}
              {vortexStatus && <div className={`vortex-status ${vortexStatus.kind}`}>{vortexStatus.kind === 'success' ? <Check size={16} /> : <AlertTriangle size={16} />}<span>{vortexStatus.message}</span>{vortexStatus.folder && <button className="text-link" onClick={() => openFolder(vortexStatus.folder)}><FolderOpen size={14} />Open folder</button>}</div>}
              <div className="section-divider"><span>After export</span></div>
              <div className="manual-grid">
                <a href={docs.testing} target="_blank" rel="noreferrer"><span>1</span><div><strong>Test in Vortex</strong><p>Extract into <code>%APPDATA%\Vortex\Plugins</code>, restart Vortex, test clean installs and each target location.</p></div><ExternalLink size={15} /></a>
                <a href={docs.upload} target="_blank" rel="noreferrer"><span>2</span><div><strong>Upload to Nexus Mods</strong><p>Sign in, use Vortex &gt; Extensions, and keep exactly one Main File.</p></div><ExternalLink size={15} /></a>
                <a href={docs.review} target="_blank" rel="noreferrer"><span>3</span><div><strong>Request human review</strong><p>Submit the GitHub issue form. Nexus Mods performs the safety and functionality review.</p></div><ExternalLink size={15} /></a>
              </div>
            </div>}

            <div className="form-footer">
              <button className="secondary-button" disabled={activeStep === 0} onClick={() => setActiveStep((step) => step - 1)}><ChevronLeft size={17} />Back</button>
              {activeStep < steps.length - 1 && <button className="primary-button" onClick={() => setActiveStep((step) => step + 1)}>Continue<ChevronRight size={17} /></button>}
            </div>
          </section>

          <aside className="preview-panel">
            <div className="preview-heading"><div><span className="status-dot" />LIVE OUTPUT</div><span>{previewFile}</span></div>
            <div className="file-tabs"><button className={previewFile === 'index.js' ? 'active' : ''} onClick={() => setPreviewFile('index.js')}>index.js</button><button className={previewFile === 'info.json' ? 'active' : ''} onClick={() => setPreviewFile('info.json')}>info.json</button></div>
            <pre><code>{previewFile === 'index.js' ? indexCode : infoCode}</code></pre>
            <div className="package-files"><strong>PACKAGE ROOT</strong><span><Check size={14} /> index.js</span><span><Check size={14} /> info.json</span><span className={artworkValid ? '' : 'missing'}>{artworkValid ? <Check size={14} /> : <AlertTriangle size={14} />} gameart.png</span><span><Check size={14} /> {projectFileName}</span>{sidebarIcon && <span className={iconValid ? '' : 'missing'}>{iconValid ? <Check size={14} /> : <AlertTriangle size={14} />} {sidebarIconFile}</span>}{form.bundleSignatures && <span className={form.signatureFiles.length ? '' : 'missing'}>{form.signatureFiles.length ? <Check size={14} /> : <AlertTriangle size={14} />} UE4SS_Signatures/ ({form.signatureFiles.length})</span>}</div>
          </aside>
        </div>
        </>}
      </main>

      {autoFill && <AutoFillDialog
        state={autoFill}
        onToggle={toggleAutoFillChange}
        onToggleAll={toggleAllAutoFill}
        onToggleArtwork={toggleAutoFillArtwork}
        onApply={applyAutoFill}
        onChooseAgain={chooseAutoFillFolder}
        onClose={closeAutoFill}
      />}

      <footer className="statusbar"><span><span className="online-dot" /> Draft autosaved locally</span>{meta.pluginFolder ? <span title={meta.pluginFolder}><HardDriveDownload size={14} /> Linked to plugins\{meta.pluginFolder}</span> : <span><Rocket size={14} /> Generates Vortex JavaScript extensions</span>}<a href={docs.packaging} target="_blank" rel="noreferrer">Packaging specification <ExternalLink size={12} /></a></footer>
    </div>
  )
}

function SuggestedPathField({ label, value, placeholder, hint, suggestion, onChange }: {
  label: string
  value: string
  placeholder: string
  hint: ReactNode
  suggestion: PathSuggestion | null
  onChange: (value: string) => void
}) {
  const matches = matchesSuggestion(value, suggestion)
  return <div className="field">
    <span>{label}</span>
    <div className="suggested-input">
      <input value={value} placeholder={placeholder} aria-label={label} onChange={(event) => onChange(event.target.value)} />
      {suggestion?.path && !matches && <button className="suggest-button" title={`Use ${suggestion.path}`} onClick={() => onChange(suggestion.path)}><Sparkles size={14} />Use suggested</button>}
    </div>
    {suggestion && (suggestion.path
      ? <small className={`suggestion ${matches ? 'matches' : ''}`}>{matches ? <Check size={12} /> : null}{matches ? 'Matches the suggested folder.' : <>Suggested: <code>{suggestion.path}</code></>} {suggestion.note}</small>
      : <small className="suggestion missing">{suggestion.note}</small>)}
    <small>{hint}</small>
  </div>
}

function Toggle({ label, detail, value, onChange, disabled = false }: { label: string; detail: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <div className="toggle-row"><div><strong>{label}</strong><p>{detail}</p></div><button className={`switch ${value ? 'on' : ''}`} role="switch" aria-label={label} aria-checked={value} disabled={disabled} onClick={() => onChange(!value)}><span /></button></div>
}

export default Builder
