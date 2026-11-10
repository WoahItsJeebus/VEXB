import type { DeploymentTarget, FormState } from './project'

// Where the game's own files live, worked out from paths already in the project.
export type GameLayout = {
  engine: 'unreal' | 'unity' | ''
  // Unreal project folder beside Engine, e.g. RollerSkate in RollerSkate/Binaries/Win64.
  mainFolder: string
  platform: string
  source: string
}

export type TargetKind =
  | 'ue4ss-loader' | 'ue4ss-mods' | 'pak-mods' | 'logic-mods'
  | 'bepinex-loader' | 'bepinex-plugins' | 'bepinex-patchers' | 'game-root'

export type PathSuggestion =
  | { path: string; note: string }
  | { path: ''; note: string }

const unrealBinaries = /^(?:\.[\\/])?([^\\/]+)[\\/]Binaries[\\/](Win64|WinGDK)(?:[\\/]|$)/i
const unrealPaks = /^(?:\.[\\/])?([^\\/]+)[\\/]Content[\\/]Paks(?:[\\/]|$)/i
const unityFiles = /(^|[\\/])(UnityPlayer\.dll|GameAssembly\.dll|UnityCrashHandler(32|64)\.exe|[^\\/]+_Data)([\\/]|$)/i
const unrealKinds: TargetKind[] = ['ue4ss-loader', 'ue4ss-mods', 'pak-mods', 'logic-mods']

function lines(value: string) {
  return value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean)
}

function samePath(first: string, second: string) {
  const clean = (value: string) => value.trim().replace(/\\/g, '/').replace(/^\.\/(?=.)/, '').replace(/\/+$/, '').toLowerCase()
  return clean(first) === clean(second)
}

export function detectLayout(form: FormState): GameLayout {
  const sources: [string, string[]][] = [
    ['required files', lines(form.requiredFiles)],
    ['game executable', [form.executable]],
    ['deployment targets', form.targetLocations.map((target) => target.path)],
    ['bundled tool', [form.toolExecutable]],
    ['signatures folder', [form.signaturesPath]],
  ]
  for (const [source, paths] of sources) {
    for (const value of paths) {
      const match = unrealBinaries.exec(value.trim()) ?? unrealPaks.exec(value.trim())
      if (match && match[1].toLowerCase() !== 'engine') {
        const platform = /wingdk/i.test(value) ? 'WinGDK' : 'Win64'
        return { engine: 'unreal', mainFolder: match[1], platform, source }
      }
    }
  }
  const allPaths = sources.flatMap(([, paths]) => paths)
  const hasBepInEx = form.targetLocations.some((target) => /bepinex/i.test(`${target.id} ${target.path}`))
  if (allPaths.some((value) => unityFiles.test(value.trim())) || hasBepInEx) {
    return { engine: 'unity', mainFolder: '', platform: '', source: 'Unity files in the project' }
  }
  // Unreal launchers at the install root are almost always named after the project.
  const launcher = /^([^\\/]+)\.exe$/i.exec(form.executable.trim())
  if (launcher && form.targetLocations.some((target) => unrealKinds.includes(targetKind(target) as TargetKind))) {
    return { engine: 'unreal', mainFolder: launcher[1], platform: 'Win64', source: 'guessed from the executable name' }
  }
  return { engine: '', mainFolder: '', platform: '', source: '' }
}

// Known targets are recognized by ID first, then by words in the ID or name.
export function targetKind(target: Pick<DeploymentTarget, 'id' | 'name'>): TargetKind | null {
  const id = target.id.trim().toLowerCase()
  const known: Record<string, TargetKind> = {
    'ue4ss-loader': 'ue4ss-loader', 'ue4ss-mods': 'ue4ss-mods', 'pak-mods': 'pak-mods', 'logic-mods': 'logic-mods',
    'bepinex': 'bepinex-loader', 'bepinex-loader': 'bepinex-loader', 'bepinex-plugins': 'bepinex-plugins',
    'bepinex-patchers': 'bepinex-patchers', 'game-root': 'game-root',
  }
  if (known[id]) return known[id]
  const words = `${id} ${target.name}`.toLowerCase()
  if (/logic/.test(words)) return 'logic-mods'
  if (/ue4ss/.test(words)) return /mod/.test(words) ? 'ue4ss-mods' : 'ue4ss-loader'
  if (/\bpaks?\b|pak-|-pak/.test(words)) return 'pak-mods'
  if (/bepinex/.test(words)) {
    if (/patcher/.test(words)) return 'bepinex-patchers'
    if (/plugin/.test(words)) return 'bepinex-plugins'
    return 'bepinex-loader'
  }
  if (/game.?root/.test(words)) return 'game-root'
  return null
}

const missingMainFolder = 'Needs the game’s main folder: add the shipping executable (Game/Binaries/Win64/Game-Win64-Shipping.exe) to Required files, or use Auto-Fill.'

export function suggestTargetPath(kind: TargetKind | null, layout: GameLayout): PathSuggestion | null {
  if (!kind) return null
  const main = layout.mainFolder
  const binaries = `${main}/Binaries/${layout.platform || 'Win64'}`
  const from = main ? ` (main folder ${main}, ${layout.source})` : ''
  switch (kind) {
    case 'ue4ss-loader':
      return main ? { path: binaries, note: `Beside the real game executable${from}.` } : { path: '', note: missingMainFolder }
    case 'ue4ss-mods':
      return main
        ? { path: `${binaries}/ue4ss/Mods`, note: `UE4SS 3.x layout${from}. Older UE4SS builds keep Mods beside the executable.` }
        : { path: '', note: missingMainFolder }
    case 'pak-mods':
      return main ? { path: `${main}/Content/Paks`, note: `The game’s Paks folder${from}.` } : { path: '', note: missingMainFolder }
    case 'logic-mods':
      return main
        ? { path: `${main}/Content/Paks/LogicMods`, note: `Blueprint mods loaded by BPModLoader${from}.` }
        : { path: '', note: missingMainFolder }
    case 'bepinex-loader':
      return { path: '.', note: 'BepInEx installs beside the game executable (winhttp.dll, doorstop_config.ini, BepInEx/).' }
    case 'bepinex-plugins':
      return { path: 'BepInEx/plugins', note: 'Standard BepInEx plugins folder.' }
    case 'bepinex-patchers':
      return { path: 'BepInEx/patchers', note: 'Standard BepInEx preloader patchers folder.' }
    case 'game-root':
      return { path: '.', note: 'The installation root.' }
  }
}

export function suggestModPath(layout: GameLayout): PathSuggestion | null {
  if (layout.engine !== 'unreal') return null
  return { path: '.', note: 'Unreal games route archives through deployment targets, so the primary destination is the game folder.' }
}

export function matchesSuggestion(value: string, suggestion: PathSuggestion | null) {
  return suggestion ? suggestion.path !== '' && samePath(value, suggestion.path) : false
}
