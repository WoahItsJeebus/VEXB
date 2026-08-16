import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import JSZip from 'jszip'
import {
  AlertTriangle, Check, ChevronLeft, ChevronRight, Download, ExternalLink,
  FileCode2, Gamepad2, Image as ImageIcon, PackageCheck, Rocket, Save,
  Settings2, ShieldAlert, Upload, Wrench, X,
} from 'lucide-react'

type FormState = {
  gameName: string
  gameId: string
  author: string
  version: string
  description: string
  executable: string
  modPath: string
  storeIds: string
  steamId: string
  gogId: string
  requiredFiles: string
  mergeMods: boolean
  createModPath: boolean
  installerEnabled: boolean
  installerExtension: string
  installerPriority: string
  toolEnabled: boolean
  toolName: string
  toolExecutable: string
}

type Artwork = { file: File; url: string; width: number; height: number }

const defaultForm: FormState = {
  gameName: '', gameId: '', author: '', version: '0.1.0', description: '',
  executable: '', modPath: 'Mods', storeIds: '', steamId: '', gogId: '',
  requiredFiles: '', mergeMods: true, createModPath: true,
  installerEnabled: false, installerExtension: '.pak', installerPriority: '25',
  toolEnabled: false, toolName: '', toolExecutable: '',
}

const steps = [
  { label: 'Game details', icon: Gamepad2 },
  { label: 'Detection & paths', icon: Settings2 },
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

function isAbsolutePath(value: string) {
  return /^[a-zA-Z]:[\\/]|^[\\/]{1,2}/.test(value.trim())
}

function generateInfo(form: FormState) {
  return JSON.stringify({
    name: form.gameName,
    author: form.author,
    version: form.version,
    description: form.description,
  }, null, 2)
}

function generateIndex(form: FormState) {
  const storeIds = lines(form.storeIds)
  const requiredFiles = lines(form.requiredFiles)
  const modSegments = form.modPath.split(/[\\/]+/).filter(Boolean)
  const toolId = form.toolName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'game-tool'
  const installerId = `${form.gameId || 'game'}-mod`
  const extension = form.installerExtension.startsWith('.')
    ? form.installerExtension.toLowerCase()
    : `.${form.installerExtension.toLowerCase()}`
  const constants = [
    `const path = require('path');`,
    `const { fs, util } = require('vortex-api');`,
    '',
    `const GAME_ID = ${js(form.gameId)};`,
    storeIds.length ? `const STORE_IDS = ${JSON.stringify(storeIds)};` : '',
    form.installerEnabled ? `const MOD_FILE_EXT = ${js(extension)};` : '',
  ].filter((line, index, all) => line !== '' || all[index - 1] !== '').join('\n')
  const tool = form.toolEnabled && form.toolName && form.toolExecutable
    ? `\nconst moddingTools = [{\n  id: ${js(toolId)},\n  name: ${js(form.toolName)},\n  executable: () => ${js(form.toolExecutable)},\n  requiredFiles: [${js(form.toolExecutable)}],\n  relative: true,\n}];\n`
    : ''
  const detection = storeIds.length
    ? `\nfunction findGame() {\n  return util.GameStoreHelper.findByAppId(STORE_IDS)\n    .then((game) => game.gamePath);\n}\n`
    : ''
  const setup = form.createModPath
    ? `\nfunction prepareForModding(discovery) {\n  return fs.ensureDirWritableAsync(path.join(discovery.path, ...${JSON.stringify(modSegments)}));\n}\n`
    : ''
  const installer = form.installerEnabled
    ? `\nfunction testSupportedContent(files, gameId) {\n  const supported = gameId === GAME_ID\n    && files.some((file) => path.extname(file).toLowerCase() === MOD_FILE_EXT);\n\n  return Promise.resolve({ supported, requiredFiles: [] });\n}\n\nfunction installContent(files) {\n  const modFile = files.find((file) => path.extname(file).toLowerCase() === MOD_FILE_EXT);\n  const rootPath = path.dirname(modFile);\n  const filtered = files.filter((file) => file.startsWith(rootPath) && !file.endsWith(path.sep));\n  const instructions = filtered.map((file) => ({\n    type: 'copy',\n    source: file,\n    destination: path.relative(rootPath, file),\n  }));\n\n  return Promise.resolve({ instructions });\n}\n`
    : ''
  const properties = [
    `    id: GAME_ID,`,
    `    name: ${js(form.gameName)},`,
    `    mergeMods: ${form.mergeMods},`,
    storeIds.length ? `    queryPath: findGame,` : '',
    form.toolEnabled ? `    supportedTools: moddingTools,` : `    supportedTools: [],`,
    `    queryModPath: () => ${js(form.modPath)},`,
    `    logo: 'gameart.png',`,
    `    executable: () => ${js(form.executable)},`,
    `    requiredFiles: ${JSON.stringify(requiredFiles, null, 2).replace(/\n/g, '\n    ')},`,
    form.createModPath ? `    setup: prepareForModding,` : '',
    form.steamId ? `    environment: { SteamAPPId: ${js(form.steamId)} },` : '',
    (form.steamId || form.gogId)
      ? `    details: {${form.steamId ? ` steamAppId: ${js(form.steamId)},` : ''}${form.gogId ? ` gogAppId: ${js(form.gogId)},` : ''} },`
      : '',
  ].filter(Boolean).join('\n')
  const installerRegistration = form.installerEnabled
    ? `\n  context.registerInstaller(${js(installerId)}, ${Number(form.installerPriority) || 25}, testSupportedContent, installContent);`
    : ''
  return `${constants}${tool}${detection}${setup}${installer}\nfunction main(context) {\n  context.registerGame({\n${properties}\n  });${installerRegistration}\n\n  return true;\n}\n\nmodule.exports = {\n  default: main,\n};\n`
}

function Builder() {
  const [form, setForm] = useState<FormState>(() => {
    try { return { ...defaultForm, ...JSON.parse(localStorage.getItem('vexb-draft') ?? '{}') } }
    catch { return defaultForm }
  })
  const [activeStep, setActiveStep] = useState(0)
  const [artwork, setArtwork] = useState<Artwork | null>(null)
  const [previewFile, setPreviewFile] = useState<'index.js' | 'info.json'>('index.js')
  const [exporting, setExporting] = useState(false)
  const [saved, setSaved] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => { localStorage.setItem('vexb-draft', JSON.stringify(form)) }, [form])

  const requiredFiles = lines(form.requiredFiles)
  const baseErrors = [
    !form.gameName.trim() && 'Add the game name.',
    !/^[a-z0-9][a-z0-9-]*$/.test(form.gameId) && 'Use a lowercase Nexus game ID with no spaces.',
    !form.author.trim() && 'Add an author name.',
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(form.version) && 'Use a semantic version such as 0.1.0.',
    !form.description.trim() && 'Add an extension description.',
    !form.executable.trim() && 'Add the game executable.',
    isAbsolutePath(form.executable) && 'The game executable must be a relative path.',
    !form.modPath.trim() && 'Add the relative mod path.',
    isAbsolutePath(form.modPath) && 'The mod path must be relative to the game folder.',
    lines(form.modPath.replace(/[\\/]+/g, ',')).includes('..') && 'The mod path cannot traverse outside the game folder.',
    requiredFiles.length === 0 && 'Add at least one required game file.',
    requiredFiles.some(isAbsolutePath) && 'Required files must use relative paths.',
    form.installerEnabled && !form.installerExtension.trim() && 'Add the installer file extension.',
    form.toolEnabled && !form.toolName.trim() && 'Add the bundled tool name.',
    form.toolEnabled && !form.toolExecutable.trim() && 'Add the bundled tool executable.',
    form.toolEnabled && isAbsolutePath(form.toolExecutable) && 'The tool executable must be a relative path.',
  ].filter(Boolean) as string[]
  const artworkValid = artwork?.width === 640 && artwork.height === 360
    && artwork.file.size <= 1024 * 1024 && artwork.file.type === 'image/png'
  const exportReady = baseErrors.length === 0 && artworkValid
  const indexCode = generateIndex(form)
  const infoCode = generateInfo(form)

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
    setSaved(false)
  }

  function updateName(value: string) {
    const previousSlug = form.gameName.toLowerCase().replace(/[^a-z0-9]+/g, '')
    setForm((current) => ({
      ...current,
      gameName: value,
      gameId: current.gameId && current.gameId !== previousSlug ? current.gameId : value.toLowerCase().replace(/[^a-z0-9]+/g, ''),
      description: current.description && current.description !== `Vortex extension for ${current.gameName}`
        ? current.description : `Vortex extension for ${value}`,
    }))
    setSaved(false)
  }

  function handleArtwork(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      if (artwork) URL.revokeObjectURL(artwork.url)
      setArtwork({ file, url, width: image.naturalWidth, height: image.naturalHeight })
    }
    image.src = url
  }

  function clearArtwork() {
    if (artwork) URL.revokeObjectURL(artwork.url)
    setArtwork(null)
    if (fileInput.current) fileInput.current.value = ''
  }

  async function exportZip() {
    if (!exportReady || !artwork) return
    setExporting(true)
    try {
      const zip = new JSZip()
      zip.file('info.json', infoCode)
      zip.file('index.js', indexCode)
      zip.file('gameart.png', artwork.file)
      const archive = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 9 } })
      const url = URL.createObjectURL(archive)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `game-${form.gameId}-${form.version}.zip`
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } finally { setExporting(false) }
  }

  function saveDraft() {
    localStorage.setItem('vexb-draft', JSON.stringify(form))
    setSaved(true)
    setTimeout(() => setSaved(false), 1800)
  }

  function resetDraft() {
    setForm(defaultForm)
    clearArtwork()
    setActiveStep(0)
    localStorage.removeItem('vexb-draft')
  }

  const field = (key: keyof FormState, label: string, hint?: string, placeholder?: string, type = 'text') => (
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
        <div className="top-actions">
          <button className="text-button" onClick={resetDraft}>New project</button>
          <button className="secondary-button" onClick={saveDraft}>{saved ? <Check size={16} /> : <Save size={16} />}{saved ? 'Saved' : 'Save draft'}</button>
        </div>
      </header>

      <aside className="sidebar">
        <div className="project-label">PROJECT WORKFLOW</div>
        <nav aria-label="Builder steps">
          {steps.map((step, index) => {
            const Icon = step.icon
            return <button key={step.label} className={`step-button ${activeStep === index ? 'active' : ''}`} onClick={() => setActiveStep(index)}>
              <span className="step-icon">{index < activeStep ? <Check size={16} /> : <Icon size={17} />}</span>
              <span><small>0{index + 1}</small>{step.label}</span>
            </button>
          })}
        </nav>
        <a className="docs-link" href={docs.guide} target="_blank" rel="noreferrer"><FileCode2 size={17} /> Official guide <ExternalLink size={14} /></a>
      </aside>

      <main className="workspace">
        <div className="workspace-heading">
          <div><span className="eyebrow">STEP {activeStep + 1} OF {steps.length}</span><h1>{steps[activeStep].label}</h1><p>{[
            'Define the identity Vortex and Nexus Mods will display.',
            'Tell Vortex how to find, verify, and launch the game.',
            'Choose how downloaded mod archives are deployed.',
            'Add the exact artwork required by the Vortex package format.',
            'Resolve any checks, inspect the output, and build the extension archive.',
          ][activeStep]}</p></div>
          <div className="completion"><strong>{Math.round(((activeStep + 1) / steps.length) * 100)}%</strong><span>workflow</span></div>
        </div>

        <div className="content-grid">
          <section className="form-surface">
            {activeStep === 0 && <div className="form-section">
              <div className="two-column">
                <label className="field"><span>Game name</span><input value={form.gameName} placeholder="Bloodstained: Ritual of the Night" onChange={(event) => updateName(event.target.value)} /><small>Match the name displayed on Nexus Mods.</small></label>
                {field('gameId', 'Nexus game ID', 'The lowercase part of the Nexus Mods URL.', 'bloodstainedritualofthenight')}
              </div>
              <div className="two-column">{field('author', 'Author', undefined, 'Your Nexus Mods name')}{field('version', 'Version', 'Semantic versioning is required. Start at 0.1.0.', '0.1.0')}</div>
              <label className="field"><span>Description</span><textarea value={form.description} rows={4} onChange={(event) => update('description', event.target.value)} /></label>
              <div className="notice"><AlertTriangle size={18} /><div><strong>Version contract</strong><p>The version here must exactly match the version uploaded to Nexus Mods. Every re-upload needs a new version.</p></div></div>
            </div>}

            {activeStep === 1 && <div className="form-section">
              <div className="two-column">{field('executable', 'Game executable', 'Relative to the game installation.', 'Game.exe')}{field('modPath', 'Mod deployment path', 'Relative to the game installation.', 'Game/Content/Mods')}</div>
              <label className="field"><span>Required files</span><textarea value={form.requiredFiles} rows={4} placeholder={'Game.exe\nGame/Binaries/Win64/Game-Win64-Shipping.exe'} onChange={(event) => update('requiredFiles', event.target.value)} /><small>One relative path per line. Vortex checks all of them to verify the installation.</small></label>
              <div className="section-divider"><span>Automatic discovery</span></div>
              <label className="field"><span>Game store application IDs</span><input value={form.storeIds} placeholder="692850, 1133514031" onChange={(event) => update('storeIds', event.target.value)} /><small>Steam, GOG, Epic, EA, Ubisoft, or Xbox IDs accepted by GameStoreHelper. Separate multiple IDs with commas.</small></label>
              <div className="two-column">{field('steamId', 'Steam App ID', 'Also configures launching through Steam.', '692850')}{field('gogId', 'GOG App ID', 'Stored in the extension details.', '1133514031')}</div>
              {!lines(form.storeIds).length && <div className="notice warning"><ShieldAlert size={18} /><div><strong>Manual discovery needed</strong><p>Without a store ID, users must locate the game manually in Vortex.</p></div></div>}
            </div>}

            {activeStep === 2 && <div className="form-section">
              <Toggle label="Merge deployed mods" detail="Install files from all mods into the same destination tree." value={form.mergeMods} onChange={(value) => update('mergeMods', value)} />
              <Toggle label="Create the mod folder" detail="Ensure the destination exists before Vortex manages the game." value={form.createModPath} onChange={(value) => update('createModPath', value)} />
              <Toggle label="Normalize mod archives" detail="Find a primary file type inside wrapper folders." value={form.installerEnabled} onChange={(value) => update('installerEnabled', value)} />
              {form.installerEnabled && <div className="nested-fields two-column">{field('installerExtension', 'Primary mod file type', undefined, '.pak')}{field('installerPriority', 'Installer priority', 'Lower values run first.', '25', 'number')}</div>}
              <Toggle label="Add a bundled game tool" detail="Expose a tool or alternate launcher from Vortex." value={form.toolEnabled} onChange={(value) => update('toolEnabled', value)} />
              {form.toolEnabled && <div className="nested-fields two-column">{field('toolName', 'Tool name', undefined, 'Script Extender')}{field('toolExecutable', 'Tool executable', undefined, 'tool_loader.exe')}</div>}
            </div>}

            {activeStep === 3 && <div className="form-section artwork-section">
              <input ref={fileInput} className="hidden-input" type="file" accept="image/png" onChange={handleArtwork} />
              {!artwork
                ? <button className="drop-zone" onClick={() => fileInput.current?.click()}><span className="upload-icon"><Upload size={24} /></span><strong>Choose gameart.png</strong><p>PNG only, exactly 640 × 360 px, maximum 1 MB</p></button>
                : <div className="artwork-preview"><img src={artwork.url} alt="Selected game artwork" /><button className="icon-button remove-art" aria-label="Remove artwork" title="Remove artwork" onClick={clearArtwork}><X size={18} /></button><div className="artwork-stats"><span className={artwork.width === 640 && artwork.height === 360 ? 'pass' : 'fail'}>{artwork.width} × {artwork.height} px</span><span className={artwork.file.size <= 1024 * 1024 ? 'pass' : 'fail'}>{(artwork.file.size / 1024).toFixed(0)} KB</span><span>{artwork.file.name}</span></div></div>}
              <div className="art-rules"><div><Check size={17} /><span>Landscape 16:9 composition</span></div><div><Check size={17} /><span>Clearly visible on a dark background</span></div><div><X size={17} /><span>No text or game title in the image</span></div></div>
              <p className="manual-note"><strong>Visual review remains manual.</strong> VEXB verifies dimensions, type, and size, but cannot reliably determine whether artwork contains text or whether you have permission to use it.</p>
            </div>}

            {activeStep === 4 && <div className="form-section review-section">
              <div className={`readiness ${exportReady ? 'ready' : ''}`}><span>{exportReady ? <Check size={24} /> : <AlertTriangle size={24} />}</span><div><strong>{exportReady ? 'Package ready' : 'Action required'}</strong><p>{exportReady ? 'All automated package checks pass.' : `${baseErrors.length + (artworkValid ? 0 : 1)} checks remaining before export.`}</p></div></div>
              <div className="check-list">
                {baseErrors.map((error) => <div className="check-row fail" key={error}><X size={16} /><span>{error}</span></div>)}
                {!artworkValid && <div className="check-row fail"><X size={16} /><span>Add a valid 640 × 360 PNG under 1 MB.</span></div>}
                {exportReady && ['Metadata is complete and versioned.', 'All configured paths are relative.', 'Required package files will be placed at ZIP root.', 'Artwork dimensions and file size are valid.'].map((item) => <div className="check-row pass" key={item}><Check size={16} /><span>{item}</span></div>)}
              </div>
              <button className="export-button" disabled={!exportReady || exporting} onClick={exportZip}><Download size={19} />{exporting ? 'Building archive...' : `Export game-${form.gameId || 'extension'}-${form.version}.zip`}</button>
              <div className="section-divider"><span>Cannot be automated here</span></div>
              <div className="manual-grid">
                <a href={docs.testing} target="_blank" rel="noreferrer"><span>1</span><div><strong>Test in Vortex</strong><p>Extract into <code>%APPDATA%\Vortex\Plugins</code>, restart Vortex, test clean installs and popular mods.</p></div><ExternalLink size={15} /></a>
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
            <div className="package-files"><strong>PACKAGE ROOT</strong><span><Check size={14} /> index.js</span><span><Check size={14} /> info.json</span><span className={artworkValid ? '' : 'missing'}>{artworkValid ? <Check size={14} /> : <AlertTriangle size={14} />} gameart.png</span></div>
          </aside>
        </div>
      </main>

      <footer className="statusbar"><span><span className="online-dot" /> Draft stored locally</span><span><Rocket size={14} /> Generates Vortex JavaScript extensions</span><a href={docs.packaging} target="_blank" rel="noreferrer">Packaging specification <ExternalLink size={12} /></a></footer>
    </div>
  )
}

function Toggle({ label, detail, value, onChange }: { label: string; detail: string; value: boolean; onChange: (value: boolean) => void }) {
  return <div className="toggle-row"><div><strong>{label}</strong><p>{detail}</p></div><button className={`switch ${value ? 'on' : ''}`} role="switch" aria-label={label} aria-checked={value} onClick={() => onChange(!value)}><span /></button></div>
}

export default Builder