export type DeploymentTarget = {
  uid: string
  id: string
  name: string
  path: string
  markers: string
  requiredArchivePath: string
  priority: string
  createPath: boolean
  keepArchiveLayout: boolean
}

export type SignatureFile = { name: string; content: string }

export type FormState = {
  gameName: string
  gameId: string
  author: string
  version: string
  description: string
  executable: string
  modPath: string
  storeIds: string
  steamId: string
  launchThroughSteam: boolean
  gogId: string
  requiredFiles: string
  mergeMods: boolean
  mixedArchiveSupport: boolean
  keepExtraFiles: boolean
  createModPath: boolean
  maintainDeploymentDirectories: boolean
  targetLocations: DeploymentTarget[]
  installerEnabled: boolean
  installerExtension: string
  installerPriority: string
  toolEnabled: boolean
  toolName: string
  toolExecutable: string
  bundleSignatures: boolean
  signaturesPath: string
  signatureFiles: SignatureFile[]
}

export type StoredImage = { dataUrl: string; name: string; type: string }

// 'vexb' projects were created here or saved by VEXB; 'imported' ones were read from a
// hand-written extension and only carry the settings that could be recognized.
export type ProjectSource = 'vexb' | 'imported'

export type ProjectMeta = {
  pluginFolder: string
  source: ProjectSource
  importNotes: string[]
}

export type ProjectRecord = ProjectMeta & {
  id: string
  form: FormState
  artwork: StoredImage | null
  sidebarIcon: StoredImage | null
  updatedAt: number
  openedAt: number
}

export type ProjectSummary = ProjectMeta & {
  id: string
  gameName: string
  gameId: string
  version: string
  updatedAt: number
  openedAt: number
}

export const signatureFolderName = 'UE4SS_Signatures'
export const projectFileName = 'vexb.json'

export const defaultForm: FormState = {
  gameName: '', gameId: '', author: '', version: '0.2.0', description: '',
  executable: '', modPath: 'Mods', storeIds: '', steamId: '', launchThroughSteam: false, gogId: '',
  requiredFiles: '', mergeMods: true, mixedArchiveSupport: true, keepExtraFiles: true, createModPath: true, maintainDeploymentDirectories: true, targetLocations: [],
  installerEnabled: false, installerExtension: '.pak', installerPriority: '25',
  toolEnabled: false, toolName: '', toolExecutable: '',
  bundleSignatures: false, signaturesPath: '', signatureFiles: [],
}

export const defaultMeta: ProjectMeta = { pluginFolder: '', source: 'vexb', importNotes: [] }

export function newProjectId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function makeUid(id: string) {
  return `${id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

// Fills in anything an older draft or a vexb.json from an earlier version is missing.
export function normalizeForm(parsed: Partial<FormState>): FormState {
  return {
    ...defaultForm,
    ...parsed,
    // Drafts saved before this option existed keep generating the same output.
    maintainDeploymentDirectories: typeof parsed.maintainDeploymentDirectories === 'boolean'
      ? parsed.maintainDeploymentDirectories
      : false,
    launchThroughSteam: parsed.launchThroughSteam === true,
    mixedArchiveSupport: parsed.mixedArchiveSupport === true,
    keepExtraFiles: parsed.keepExtraFiles === true,
    bundleSignatures: parsed.bundleSignatures === true,
    signaturesPath: typeof parsed.signaturesPath === 'string' ? parsed.signaturesPath : '',
    signatureFiles: Array.isArray(parsed.signatureFiles)
      ? parsed.signatureFiles.filter((file) => typeof file?.name === 'string' && typeof file?.content === 'string')
      : [],
    targetLocations: Array.isArray(parsed.targetLocations)
      ? parsed.targetLocations.map((target) => ({
        ...target,
        uid: typeof target.uid === 'string' && target.uid ? target.uid : makeUid(target.id || 'target'),
        requiredArchivePath: typeof target.requiredArchivePath === 'string' ? target.requiredArchivePath : '',
      }))
      : [],
  }
}

export function normalizeMeta(parsed: Partial<ProjectMeta> | null | undefined): ProjectMeta {
  return {
    pluginFolder: typeof parsed?.pluginFolder === 'string' ? parsed.pluginFolder : '',
    source: parsed?.source === 'imported' ? 'imported' : 'vexb',
    importNotes: Array.isArray(parsed?.importNotes) ? parsed.importNotes.filter((note) => typeof note === 'string') : [],
  }
}

export function isBlankForm(form: FormState) {
  return JSON.stringify({ ...form, targetLocations: form.targetLocations.length }) === JSON.stringify({ ...defaultForm, targetLocations: 0 })
}

export function projectTitle(project: { gameName: string }) {
  return project.gameName.trim() || 'Untitled project'
}

const relativeTime = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const timeUnits: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60],
]

export function timeAgo(timestamp: number, now = Date.now()) {
  const seconds = Math.round((timestamp - now) / 1000)
  const unit = timeUnits.find(([, size]) => Math.abs(seconds) >= size)
  return unit ? relativeTime.format(Math.round(seconds / unit[1]), unit[0]) : 'just now'
}
