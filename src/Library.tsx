import { useState } from 'react'
import { AlertTriangle, FolderOpen, Info, Link2, Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import { projectTitle, timeAgo } from './project'
import type { ProjectSummary } from './project'
import { isDesktop } from './storage'
import type { ExtensionList, InstalledExtension } from './storage'

type LibraryProps = {
  projects: ProjectSummary[]
  currentProjectId: string
  extensionList: ExtensionList | null
  extensionsLoading: boolean
  error: string
  onOpenProject: (id: string) => void
  onRemoveProject: (id: string) => void
  onNewProject: () => void
  onRefreshExtensions: () => void
  onChooseFolder: () => void
  onEditExtension: (extension: InstalledExtension) => void
  onReloadExtension: (extension: InstalledExtension, projectId: string) => void
  onOpenFolder: (folder?: string) => void
}

function extensionKind(extension: InstalledExtension) {
  if (extension.hasProjectFile) return { label: 'VEXB project', className: 'vexb' }
  if (extension.looksLikeVexb) return { label: 'VEXB output', className: 'vexb' }
  return { label: 'Hand-written', className: 'other' }
}

function Library({
  projects, currentProjectId, extensionList, extensionsLoading, error,
  onOpenProject, onRemoveProject, onNewProject, onRefreshExtensions, onChooseFolder,
  onEditExtension, onReloadExtension, onOpenFolder,
}: LibraryProps) {
  const [filter, setFilter] = useState('')
  const [showAll, setShowAll] = useState(false)
  const sortedProjects = [...projects].sort((first, second) => second.openedAt - first.openedAt)
  const extensions = extensionList?.extensions ?? []
  const hiddenCount = extensions.filter((extension) => !extension.isGame).length
  const query = filter.trim().toLowerCase()
  const visibleExtensions = extensions
    .filter((extension) => showAll || extension.isGame)
    .filter((extension) => !query || [extension.name, extension.gameId, extension.folder, extension.author]
      .some((value) => value.toLowerCase().includes(query)))

  return (
    <div className="library">
      <div className="workspace-heading">
        <div><span className="eyebrow">LIBRARY</span><h1>Projects &amp; extensions</h1><p>Jump back into a recent project, or open an extension that’s already installed in Vortex.</p></div>
      </div>

      {error && <div className="notice warning library-notice"><AlertTriangle size={18} /><div><strong>Something went wrong</strong><p>{error}</p></div></div>}

      <section className="library-panel">
        <div className="library-panel-heading">
          <div><strong>Recent projects</strong><span>{projects.length}</span></div>
          <button className="secondary-button" onClick={onNewProject}><Plus size={16} />New project</button>
        </div>
        {sortedProjects.length === 0
          ? <div className="empty-targets"><Info size={18} /><div><strong>No saved projects yet</strong><p>Projects show up here as soon as you start filling one in, or when you open an installed extension below.</p></div></div>
          : <div className="project-grid">
            {sortedProjects.map((project) => {
              const current = project.id === currentProjectId
              return <article className={`project-card ${current ? 'current' : ''}`} key={project.id}>
                <button className="project-open" onClick={() => onOpenProject(project.id)}>
                  <strong>{projectTitle(project)}</strong>
                  <span>{project.gameId || 'No game ID'}{project.version ? ` · v${project.version}` : ''}</span>
                  <small>{current ? 'Open now' : `Edited ${timeAgo(project.updatedAt)}`}</small>
                  {project.pluginFolder && <em title={project.pluginFolder}><Link2 size={12} />{project.pluginFolder}</em>}
                </button>
                {!current && <button className="icon-button project-remove" aria-label={`Remove ${projectTitle(project)}`} title="Remove from VEXB (the installed extension is not touched)" onClick={() => onRemoveProject(project.id)}><Trash2 size={14} /></button>}
              </article>
            })}
          </div>}
      </section>

      <section className="library-panel">
        <div className="library-panel-heading">
          <div><strong>Installed in Vortex</strong>{extensionList && <span>{visibleExtensions.length}</span>}</div>
          {isDesktop && <div className="library-actions">
            <button className="icon-button subtle" aria-label="Open the plugins folder" title="Open the plugins folder" onClick={() => onOpenFolder()}><FolderOpen size={15} /></button>
            <button className="secondary-button" disabled={extensionsLoading} onClick={onRefreshExtensions}><RefreshCw size={15} className={extensionsLoading ? 'spinning' : ''} />Refresh</button>
          </div>}
        </div>

        {!isDesktop
          ? <div className="empty-targets"><Info size={18} /><div><strong>Desktop app only</strong><p>Reading Vortex’s plugins folder needs the VEXB desktop app. Run <code>npm run desktop</code> or the portable build.</p></div></div>
          : <>
            <div className="plugins-path">
              <FolderOpen size={15} /><code title={extensionList?.pluginsFolder}>{extensionList?.pluginsFolder ?? 'Looking for Vortex…'}</code>
              <button className="text-link" onClick={onChooseFolder}>Change…</button>
            </div>
            {extensionList && !extensionList.exists && <div className="notice warning"><AlertTriangle size={18} /><div><strong>Plugins folder not found</strong><p>Vortex keeps installed extensions in <code>%APPDATA%\Vortex\plugins</code>. If Vortex runs in shared mode or from another profile, choose that folder instead.</p></div></div>}
            {extensionList?.exists && <>
              <div className="library-filter">
                <label className="filter-input"><Search size={15} /><input value={filter} placeholder="Filter by name, game ID, author or folder" onChange={(event) => setFilter(event.target.value)} /></label>
                {hiddenCount > 0 && <label className="filter-toggle"><input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />Show {hiddenCount} non-game extension{hiddenCount === 1 ? '' : 's'}</label>}
              </div>
              <div className="extension-list">
                {visibleExtensions.length === 0 && <p className="extension-empty">{query ? 'No installed extensions match that filter.' : 'No game extensions are installed in this folder.'}</p>}
                {visibleExtensions.map((extension) => {
                  const linked = projects.find((project) => project.pluginFolder.toLowerCase() === extension.folder.toLowerCase())
                  const kind = extensionKind(extension)
                  return <div className="extension-row" key={extension.folder}>
                    <div className="extension-main">
                      <strong>{extension.name}</strong>
                      <span>{[extension.gameId, extension.version && `v${extension.version}`, extension.author].filter(Boolean).join(' · ')}</span>
                      <small title={extension.folder}>{extension.folder}</small>
                    </div>
                    <div className="extension-badges">
                      <span className={`badge ${kind.className}`}>{kind.label}</span>
                      {linked && <span className="badge linked"><Link2 size={11} />Linked</span>}
                    </div>
                    <div className="extension-actions">
                      {linked && <button className="icon-button subtle" aria-label={`Reload ${extension.name} from Vortex`} title="Reload the project from this folder" onClick={() => onReloadExtension(extension, linked.id)}><RefreshCw size={14} /></button>}
                      <button className="icon-button subtle" aria-label={`Open ${extension.folder}`} title="Open folder" onClick={() => onOpenFolder(extension.folder)}><FolderOpen size={14} /></button>
                      <button className="secondary-button" disabled={!extension.isGame} title={extension.isGame ? undefined : 'Only game extensions can be edited in VEXB'} onClick={() => onEditExtension(extension)}>{linked ? 'Open project' : 'Edit'}</button>
                    </div>
                  </div>
                })}
              </div>
            </>}
          </>}
      </section>
    </div>
  )
}

export default Library
