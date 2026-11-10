import type { GameScan } from './autoFill'
import type { ProjectRecord, ProjectSummary, StoredImage } from './project'

export type InstalledExtension = {
  folder: string
  name: string
  author: string
  version: string
  description: string
  gameId: string
  isGame: boolean
  hasProjectFile: boolean
  looksLikeVexb: boolean
  modifiedAt: number
}

export type ExtensionList = {
  pluginsFolder: string
  exists: boolean
  extensions: InstalledExtension[]
}

export type ExtensionContents = {
  folder: string
  info: Record<string, unknown>
  indexJs: string
  projectFile: unknown
  gameart: StoredImage | null
  gameicon: StoredImage | null
  signatureFiles: { name: string; content: string }[]
}

export type ExtensionFile = { path: string; data: string | Uint8Array }

export type WriteResult = { folder: string; path: string; backup: string }

type DesktopBridge = {
  listProjects: () => Promise<ProjectSummary[]>
  readProject: (id: string) => Promise<ProjectRecord | null>
  saveProject: (project: ProjectRecord) => Promise<void>
  saveProjectNow: (project: ProjectRecord) => void
  deleteProject: (id: string) => Promise<void>
  listExtensions: () => Promise<ExtensionList>
  choosePluginsFolder: () => Promise<ExtensionList | null>
  readExtension: (folder: string) => Promise<ExtensionContents>
  writeExtension: (folder: string, files: ExtensionFile[], previousFolder?: string) => Promise<WriteResult>
  openExtensionFolder: (folder?: string) => Promise<void>
  chooseGameFolder: () => Promise<string | null>
  scanGame: (folder: string) => Promise<GameScan>
}

declare global {
  interface Window { vexb?: DesktopBridge }
}

export const desktop = window.vexb
export const isDesktop = desktop !== undefined

// In a plain browser (npm run dev) projects live in localStorage instead of the app profile.
const browserProjectsKey = 'vexb-projects'

function readBrowserProjects(): Record<string, ProjectRecord> {
  try {
    return JSON.parse(localStorage.getItem(browserProjectsKey) ?? '{}') as Record<string, ProjectRecord>
  } catch {
    return {}
  }
}

function writeBrowserProjects(projects: Record<string, ProjectRecord>) {
  try {
    localStorage.setItem(browserProjectsKey, JSON.stringify(projects))
  } catch {
    // Out of space: keep the settings and drop the images rather than lose the project.
    const slim = Object.fromEntries(Object.entries(projects)
      .map(([id, project]) => [id, { ...project, artwork: null, sidebarIcon: null }]))
    try { localStorage.setItem(browserProjectsKey, JSON.stringify(slim)) } catch { /* nothing else to try */ }
  }
}

export function toSummary(project: ProjectRecord): ProjectSummary {
  return {
    id: project.id,
    gameName: project.form.gameName,
    gameId: project.form.gameId,
    version: project.form.version,
    pluginFolder: project.pluginFolder,
    source: project.source,
    importNotes: project.importNotes,
    updatedAt: project.updatedAt,
    openedAt: project.openedAt,
  }
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const projects = desktop
    ? await desktop.listProjects()
    : Object.values(readBrowserProjects()).map(toSummary)
  return projects.sort((first, second) => second.openedAt - first.openedAt)
}

export async function readProject(id: string): Promise<ProjectRecord | null> {
  if (desktop) return desktop.readProject(id)
  return readBrowserProjects()[id] ?? null
}

export async function saveProject(project: ProjectRecord) {
  if (desktop) return desktop.saveProject(project)
  writeBrowserProjects({ ...readBrowserProjects(), [project.id]: project })
}

// Used while the window is closing, when an async save might not finish.
export function saveProjectNow(project: ProjectRecord) {
  if (desktop) desktop.saveProjectNow(project)
  else writeBrowserProjects({ ...readBrowserProjects(), [project.id]: project })
}

export async function deleteProject(id: string) {
  if (desktop) return desktop.deleteProject(id)
  const projects = readBrowserProjects()
  delete projects[id]
  writeBrowserProjects(projects)
}
