import { defaultForm, makeUid } from './project'
import type { DeploymentTarget, FormState, StoredImage } from './project'

type StoreEntry = { id: string; name: string; source: string; launcher?: string }

// What the main process found in the game folder and online (electron/autofill.cjs).
export type GameScan = {
  folder: string
  engine: 'unreal'
  projectName: string
  platform: string
  name: { value: string; source: string }
  nexus: { id: number; name: string; domain: string } | null
  executable: string
  executableReason: string
  shippingExecutable: string
  binaries: string
  paks: { path: string; ioStore: boolean; logicMods: boolean; tildeMods: boolean }
  ue4ss: { installed: boolean; layout: '' | 'ue4ss-folder' | 'beside-exe'; modsPath: string; proxies: string[] }
  stores: { steam: StoreEntry | null; gog: StoreEntry | null; epic: StoreEntry | null; xbox: StoreEntry | null }
  looked: { steam: StoreEntry | null; gog: StoreEntry | null }
  artwork: { dataUrl: string; source: string } | null
  notes: string[]
}

export type AutoFillChange = {
  key: string
  label: string
  value: string
  source: string
  current: string
  selected: boolean
  apply: (form: FormState) => FormState
}

export type AutoFillArtwork = { image: StoredImage; source: string; selected: boolean; replaces: boolean }

const artworkWidth = 640
const artworkHeight = 360
const maxArtworkBytes = 1024 * 1024

function unique(values: string[]) {
  return values.filter((value, index) => value && values.findIndex((other) => other.toLowerCase() === value.toLowerCase()) === index)
}

function sameText(first: string, second: string) {
  return first.trim().toLowerCase() === second.trim().toLowerCase()
}

// Nexus Mods game IDs are the domain in the game's URL: lowercase letters and digits.
function guessGameId(name: string) {
  return name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '')
}

// The Unreal baseline: UE4SS runtime and mods, PAK files, and LogicMods for BPModLoader.
export function unrealTargets(scan: GameScan): Omit<DeploymentTarget, 'uid'>[] {
  const pakMarkers = scan.paks.ioStore ? '*.pak\n*.utoc\n*.ucas' : '*.pak'
  const loaderMarkers = unique(['dwmapi.dll', ...scan.ue4ss.proxies, 'ue4ss.dll'])
  return [
    {
      id: 'ue4ss-loader', name: 'UE4SS Runtime', path: scan.binaries, markers: loaderMarkers.join('\n'),
      requiredArchivePath: '', priority: '10', createPath: true, keepArchiveLayout: false,
    },
    {
      id: 'ue4ss-mods', name: 'UE4SS Mods', path: scan.ue4ss.modsPath, markers: '**/Scripts/*.lua\n**/dlls/*.dll',
      requiredArchivePath: '', priority: '20', createPath: true, keepArchiveLayout: true,
    },
    {
      id: 'pak-mods', name: 'PAK Mods', path: scan.paks.path, markers: pakMarkers,
      requiredArchivePath: '', priority: '20', createPath: true, keepArchiveLayout: false,
    },
    {
      id: 'logic-mods', name: 'Logic Mods', path: `${scan.paks.path}/LogicMods`, markers: pakMarkers,
      requiredArchivePath: 'LogicMods/**', priority: '19', createPath: true, keepArchiveLayout: false,
    },
  ]
}

// Targets with the same ID are replaced in place; any other targets are kept.
function mergeTargets(current: DeploymentTarget[], found: Omit<DeploymentTarget, 'uid'>[]) {
  const merged = current.map((target) => {
    const replacement = found.find((item) => item.id === target.id)
    return replacement ? { ...replacement, uid: target.uid } : target
  })
  const added = found.filter((item) => !current.some((target) => target.id === item.id))
    .map((item) => ({ ...item, uid: makeUid(item.id) }))
  return [...merged, ...added]
}

function describeTargets(targets: { name: string; path: string }[]) {
  return targets.map((target) => `${target.name} → ${target.path}`).join('\n')
}

export function storeIdsFromScan(scan: GameScan) {
  const { steam, gog, epic, xbox } = scan.stores
  return unique([
    steam?.id ?? scan.looked.steam?.id ?? '',
    gog?.id ?? scan.looked.gog?.id ?? '',
    epic?.id ?? '',
    xbox?.id ?? '',
  ])
}

export function buildChanges(scan: GameScan, form: FormState): AutoFillChange[] {
  const changes: AutoFillChange[] = []
  // A field that is still empty or at its default is filled without asking.
  const add = (change: Omit<AutoFillChange, 'selected'>, untouched: boolean) => {
    changes.push({ ...change, current: sameText(change.current, change.value) ? '' : change.current, selected: untouched || sameText(change.current, change.value) })
  }

  const name = scan.name.value
  add({
    key: 'gameName', label: 'Game name', value: name, source: scan.name.source, current: form.gameName,
    // The default description follows the name, as it does when the name is typed in.
    apply: (next) => ({
      ...next,
      gameName: name,
      description: !next.description.trim() || next.description === `Vortex extension for ${next.gameName}`
        ? `Vortex extension for ${name}` : next.description,
    }),
  }, !form.gameName.trim())

  const gameId = scan.nexus?.domain ?? guessGameId(name)
  add({
    key: 'gameId', label: 'Nexus game ID', value: gameId,
    source: scan.nexus ? 'Nexus Mods game list' : 'Guessed from the name (not on Nexus Mods yet)', current: form.gameId,
    apply: (next) => ({ ...next, gameId }),
  }, !form.gameId.trim())

  add({
    key: 'executable', label: 'Game executable', value: scan.executable, source: `Install root, ${scan.executableReason}`, current: form.executable,
    apply: (next) => ({ ...next, executable: scan.executable }),
  }, !form.executable.trim())

  add({
    key: 'modPath', label: 'Primary mod destination', value: '.', source: 'Unreal baseline: archives are routed by the deployment targets',
    current: form.modPath, apply: (next) => ({ ...next, modPath: '.' }),
  }, !form.modPath.trim() || form.modPath === defaultForm.modPath)

  const requiredFiles = unique([scan.executable, scan.shippingExecutable]).join('\n')
  add({
    key: 'requiredFiles', label: 'Required files', value: requiredFiles, source: 'Launcher and shipping executable found in the install',
    current: form.requiredFiles, apply: (next) => ({ ...next, requiredFiles }),
  }, !form.requiredFiles.trim())

  const storeIds = storeIdsFromScan(scan)
  if (storeIds.length) {
    const sources = [
      scan.stores.steam && `Steam: ${scan.stores.steam.source}`,
      !scan.stores.steam && scan.looked.steam && `Steam: ${scan.looked.steam.source}`,
      scan.stores.gog && `GOG: ${scan.stores.gog.source}`,
      !scan.stores.gog && scan.looked.gog && `GOG: ${scan.looked.gog.source}`,
      scan.stores.epic && `Epic: ${scan.stores.epic.source}`,
      scan.stores.xbox && `Xbox: ${scan.stores.xbox.source}`,
    ].filter(Boolean).join(' · ')
    add({
      key: 'storeIds', label: 'Game store application IDs', value: storeIds.join(', '), source: sources, current: form.storeIds,
      apply: (next) => ({ ...next, storeIds: storeIds.join(', ') }),
    }, !form.storeIds.trim())
  }

  const steam = scan.stores.steam ?? scan.looked.steam
  if (steam) {
    add({
      key: 'steamId', label: 'Steam App ID', value: steam.id, source: `${steam.source}; Launch through Steam turned on`, current: form.steamId,
      apply: (next) => ({ ...next, steamId: steam.id, launchThroughSteam: true }),
    }, !form.steamId.trim())
  }

  const gog = scan.stores.gog ?? scan.looked.gog
  if (gog) {
    add({
      key: 'gogId', label: 'GOG App ID', value: gog.id, source: gog.source, current: form.gogId,
      apply: (next) => ({ ...next, gogId: gog.id }),
    }, !form.gogId.trim())
  }

  const targets = unrealTargets(scan)
  const targetNotes = [
    scan.ue4ss.installed ? `UE4SS found (${scan.ue4ss.layout === 'beside-exe' ? 'beside the executable' : 'ue4ss folder layout'})` : 'UE4SS not installed, so its 3.x layout is assumed',
    scan.paks.ioStore ? 'IoStore containers (.utoc/.ucas) in use' : 'plain .pak files',
  ].filter(Boolean).join(' · ')
  const currentTargets = form.targetLocations.filter((target) => targets.some((item) => item.id === target.id))
  add({
    key: 'targets', label: 'Deployment targets', value: describeTargets(targets), source: targetNotes,
    current: describeTargets(currentTargets),
    apply: (next) => ({ ...next, targetLocations: mergeTargets(next.targetLocations, targets) }),
  }, form.targetLocations.length === 0)

  const behavior = {
    installerEnabled: true, installerExtension: '.pak', installerPriority: '25',
    mergeMods: true, mixedArchiveSupport: true, keepExtraFiles: true, createModPath: true, maintainDeploymentDirectories: true,
  } satisfies Partial<FormState>
  const behaviorLabels: Record<keyof typeof behavior, string> = {
    installerEnabled: '.pak normalizing', installerExtension: '.pak normalizing', installerPriority: '.pak normalizing',
    mergeMods: 'merging', mixedArchiveSupport: 'mixed archives', keepExtraFiles: 'unclaimed files',
    createModPath: 'folder creation', maintainDeploymentDirectories: 'folder upkeep',
  }
  const behaviorKeys = Object.keys(behavior) as (keyof typeof behavior)[]
  const differing = unique(behaviorKeys.filter((key) => form[key] !== behavior[key]).map((key) => behaviorLabels[key]))
  const behaviorText = 'Normalize .pak archives (priority 25)\nSupport mixed mod archives and keep unclaimed files\nCreate and maintain deployment folders'
  add({
    key: 'behavior', label: 'Install behavior', value: behaviorText, source: 'Unreal baseline',
    current: differing.length ? `differs for ${differing.join(', ')}` : behaviorText,
    apply: (next) => ({ ...next, ...behavior }),
  }, behaviorKeys.every((key) => form[key] === defaultForm[key]))

  return changes
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('The artwork image could not be read.'))
    image.src = source
  })
}

// Crops the middle of the store artwork to 16:9 and saves it as the 640 × 360 PNG Vortex wants.
export async function prepareArtwork(dataUrl: string): Promise<StoredImage | null> {
  const image = await loadImage(dataUrl)
  const scale = Math.max(artworkWidth / image.naturalWidth, artworkHeight / image.naturalHeight)
  const width = artworkWidth / scale
  const height = artworkHeight / scale
  const canvas = document.createElement('canvas')
  canvas.width = artworkWidth
  canvas.height = artworkHeight
  const context = canvas.getContext('2d')
  if (!context) return null
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, (image.naturalWidth - width) / 2, (image.naturalHeight - height) / 2, width, height, 0, 0, artworkWidth, artworkHeight)
  const png = canvas.toDataURL('image/png')
  const bytes = Math.floor(((png.length - png.indexOf(',') - 1) * 3) / 4)
  if (bytes > maxArtworkBytes) return null
  return { dataUrl: png, name: 'gameart.png', type: 'image/png' }
}
