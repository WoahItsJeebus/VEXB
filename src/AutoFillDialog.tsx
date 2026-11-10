import { useEffect } from 'react'
import { AlertTriangle, FolderOpen, Info, LoaderCircle, WandSparkles, X } from 'lucide-react'
import type { AutoFillArtwork, AutoFillChange, GameScan } from './autoFill'

export type AutoFillState =
  | { status: 'scanning'; folder: string }
  | { status: 'error'; folder: string; message: string }
  | { status: 'review'; scan: GameScan; changes: AutoFillChange[]; artwork: AutoFillArtwork | null; notes: string[] }

type Props = {
  state: AutoFillState
  onToggle: (key: string) => void
  onToggleAll: (selected: boolean) => void
  onToggleArtwork: () => void
  onApply: () => void
  onChooseAgain: () => void
  onClose: () => void
}

function AutoFillDialog({ state, onToggle, onToggleAll, onToggleArtwork, onApply, onChooseAgain, onClose }: Props) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const allSelected = state.status === 'review'
    && state.changes.every((change) => change.selected) && (!state.artwork || state.artwork.selected)
  const selectedCount = state.status === 'review'
    ? state.changes.filter((change) => change.selected).length + (state.artwork?.selected ? 1 : 0)
    : 0

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && state.status !== 'scanning') onClose() }}>
    <section className="autofill-dialog" role="dialog" aria-modal="true" aria-labelledby="autofill-title">
      <header className="autofill-heading">
        <span className="autofill-icon"><WandSparkles size={18} /></span>
        <div>
          <h2 id="autofill-title">Auto-Fill from game folder</h2>
          <code>{state.status === 'review' ? state.scan.folder : state.folder}</code>
        </div>
        <button className="icon-button subtle" aria-label="Close" title="Close" onClick={onClose}><X size={16} /></button>
      </header>

      {state.status === 'scanning' && <div className="autofill-progress">
        <LoaderCircle size={22} className="spinning" />
        <div><strong>Reading the install</strong><p>Looking for the Unreal project, executables, UE4SS and store files, then checking Steam, GOG and Nexus Mods.</p></div>
      </div>}

      {state.status === 'error' && <div className="autofill-body">
        <div className="notice warning"><AlertTriangle size={18} /><div><strong>Nothing to fill in</strong><p>{state.message}</p></div></div>
      </div>}

      {state.status === 'review' && <div className="autofill-body">
        <div className="autofill-facts">
          <span>Unreal Engine</span>
          <span>{state.scan.projectName}</span>
          <span>{state.scan.platform}</span>
          {state.scan.ue4ss.installed && <span>UE4SS</span>}
          {state.scan.paks.ioStore && <span>IoStore</span>}
        </div>
        <div className="autofill-hint"><p>Checked fields are written to the project. Fields you’ve already filled in are left unchecked when the value differs.</p><button className="text-link" onClick={() => onToggleAll(!allSelected)}>{allSelected ? 'Uncheck all' : 'Check all'}</button></div>
        <div className="autofill-list">
          {state.changes.map((change) => <label className={`autofill-row ${change.selected ? 'selected' : ''}`} key={change.key}>
            <input type="checkbox" checked={change.selected} onChange={() => onToggle(change.key)} />
            <div className="autofill-row-main">
              <strong>{change.label}</strong>
              <pre>{change.value}</pre>
              {change.current && <small className="autofill-current">Currently: {change.current.split('\n').join(', ')}</small>}
              <small>{change.source}</small>
            </div>
          </label>)}
          {state.artwork && <label className={`autofill-row ${state.artwork.selected ? 'selected' : ''}`}>
            <input type="checkbox" checked={state.artwork.selected} onChange={onToggleArtwork} />
            <div className="autofill-row-main">
              <strong>Game artwork</strong>
              <img className="autofill-art" src={state.artwork.image.dataUrl} alt="Artwork cropped to 640 × 360" />
              {state.artwork.replaces && <small className="autofill-current">Replaces the current gameart.png</small>}
              <small>{state.artwork.source}, cropped to 640 × 360 PNG. Check it has no text or logo before release.</small>
            </div>
          </label>}
        </div>
        {state.notes.length > 0 && <div className="autofill-notes">
          {state.notes.map((note) => <div key={note}><Info size={14} /><span>{note}</span></div>)}
        </div>}
      </div>}

      <footer className="autofill-footer">
        {state.status !== 'scanning' && <button className="secondary-button" onClick={onChooseAgain}><FolderOpen size={16} />Choose another folder</button>}
        <span />
        <button className="secondary-button" onClick={onClose}>Cancel</button>
        {state.status === 'review' && <button className="primary-button" disabled={selectedCount === 0} onClick={onApply}>Apply {selectedCount} {selectedCount === 1 ? 'change' : 'changes'}</button>}
      </footer>
    </section>
  </div>
}

export default AutoFillDialog
