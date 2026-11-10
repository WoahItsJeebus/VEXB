import { defaultForm, makeUid, normalizeForm, signatureFolderName } from './project'
import type { DeploymentTarget, FormState, ProjectSource } from './project'
import type { ExtensionContents } from './storage'

export type ImportResult = { form: FormState; source: ProjectSource; notes: string[] }

type SavedProject = { format?: number; form?: Partial<FormState>; signatureFiles?: string[] }

type GeneratedTarget = {
  id?: string
  name?: string
  path?: string[]
  markers?: string[]
  requiredArchivePath?: string
  priority?: number
  keepArchiveLayout?: boolean
}

const stringLiteral = String.raw`(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')`

function readString(literal: string) {
  if (literal.startsWith('"')) {
    try { return JSON.parse(literal) as string } catch { return undefined }
  }
  const body = literal.slice(1, -1).replace(/\\'/g, '\'').replace(/"/g, '\\"')
  try { return JSON.parse(`"${body}"`) as string } catch { return undefined }
}

// Top-level `const NAME = 'value';` declarations, so properties that refer to a
// constant (executable: () => GAME_EXE) still resolve.
function readStringConstants(code: string) {
  const constants = new Map<string, string>()
  const pattern = new RegExp(String.raw`^\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*(${stringLiteral})\s*;`, 'gm')
  for (const match of code.matchAll(pattern)) {
    const value = readString(match[2])
    if (value !== undefined) constants.set(match[1], value)
  }
  return constants
}

function resolveValue(expression: string, constants: Map<string, string>): string | undefined {
  const value = expression.trim()
  if (new RegExp(`^${stringLiteral}$`).test(value)) return readString(value)
  if (/^[A-Za-z_$][\w$]*$/.test(value)) return constants.get(value)
  // path.join('BepInEx', 'plugins') and friends.
  const join = /^path\.(?:join|posix\.join|win32\.join)\(([\s\S]*)\)$/.exec(value)
  if (join) {
    const parts = splitArguments(join[1]).map((part) => resolveValue(part, constants))
    return parts.every((part) => part !== undefined) ? parts.join('/') : undefined
  }
  return undefined
}

function splitArguments(value: string) {
  const parts: string[] = []
  let depth = 0
  let quote = ''
  let current = ''
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (quote) {
      current += character
      if (character === '\\') { current += value[index + 1] ?? ''; index += 1 } else if (character === quote) quote = ''
      continue
    }
    if (character === '"' || character === '\'') quote = character
    if ('([{'.includes(character)) depth += 1
    if (')]}'.includes(character)) depth -= 1
    if (character === ',' && depth === 0) {
      if (current.trim()) parts.push(current.trim())
      current = ''
      continue
    }
    current += character
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

// Returns the text between a bracket at `start` and its partner.
function readBracketed(code: string, start: number) {
  const open = code[start]
  const close = open === '[' ? ']' : open === '{' ? '}' : ')'
  let depth = 0
  let quote = ''
  for (let index = start; index < code.length; index += 1) {
    const character = code[index]
    if (quote) {
      if (character === '\\') index += 1
      else if (character === quote) quote = ''
      continue
    }
    if (character === '"' || character === '\'' || character === '`') quote = character
    else if (character === open) depth += 1
    else if (character === close) {
      depth -= 1
      if (depth === 0) return code.slice(start + 1, index)
    }
  }
  return undefined
}

function readArray(source: string | undefined, constants: Map<string, string>) {
  if (source === undefined) return undefined
  const values = splitArguments(source).map((item) => resolveValue(item, constants))
  return values.every((item) => item !== undefined) ? values as string[] : undefined
}

function readConstantArray(code: string, name: string, constants: Map<string, string>) {
  const match = new RegExp(String.raw`const\s+${name}\s*=\s*\[`).exec(code)
  return match ? readArray(readBracketed(code, match.index + match[0].length - 1), constants) : undefined
}

function readJsonConstant<T>(code: string, name: string): T | undefined {
  const match = new RegExp(String.raw`const\s+${name}\s*=\s*\[`).exec(code)
  if (!match) return undefined
  const body = readBracketed(code, match.index + match[0].length - 1)
  if (body === undefined) return undefined
  try { return JSON.parse(`[${body}]`) as T } catch { return undefined }
}

function readProperty(block: string, property: string, constants: Map<string, string>) {
  const match = new RegExp(String.raw`(?:^|[\s,{])${property}\s*:\s*(?:\(\s*\)\s*=>\s*)?(${stringLiteral}|path\.join\([^)]*\)|[A-Za-z_$][\w$]*)`).exec(block)
  return match ? resolveValue(match[1], constants) : undefined
}

function readGameBlock(code: string) {
  const match = /registerGame\(\s*\{/.exec(code)
  return match ? readBracketed(code, match.index + match[0].length - 1) ?? '' : ''
}

function joinPath(segments: string[] | undefined) {
  return segments?.length ? segments.join('/') : '.'
}

function pathKey(value: string) {
  return value.split(/[\\/]+/).filter((part) => part && part !== '.').join('/').toLowerCase()
}

function fromProjectFile(contents: ExtensionContents, saved: SavedProject): ImportResult {
  const form = normalizeForm(saved.form ?? {})
  const names = Array.isArray(saved.signatureFiles) ? saved.signatureFiles : form.signatureFiles.map((file) => file.name)
  const signatureFiles = names
    .map((name) => contents.signatureFiles.find((file) => file.name.toLowerCase() === name.toLowerCase()))
    .filter((file) => file !== undefined)
  const missing = names.filter((name) => !signatureFiles.some((file) => file.name.toLowerCase() === name.toLowerCase()))
  return {
    form: { ...form, signatureFiles },
    source: 'vexb',
    notes: missing.length ? [`These signature files were missing from ${signatureFolderName}: ${missing.join(', ')}.`] : [],
  }
}

export function importExtension(contents: ExtensionContents): ImportResult {
  const saved = contents.projectFile as SavedProject | null
  if (saved && typeof saved === 'object' && saved.form && typeof saved.form === 'object') {
    return fromProjectFile(contents, saved)
  }

  const code = contents.indexJs
  const info = contents.info
  const constants = readStringConstants(code)
  const game = readGameBlock(code)
  const notes: string[] = []
  const infoText = (key: string) => (typeof info[key] === 'string' ? info[key] as string : '')

  const gameId = constants.get('GAME_ID') ?? readProperty(game, 'id', constants) ?? ''
  const gameName = readProperty(game, 'name', constants) ?? infoText('name').replace(/^Game:\s*/i, '')
  const executable = readProperty(game, 'executable', constants) ?? ''
  const modPath = readProperty(game, 'queryModPath', constants)
  const requiredMatch = /requiredFiles\s*:\s*\[/.exec(game)
  const requiredFiles = requiredMatch ? readArray(readBracketed(game, requiredMatch.index + requiredMatch[0].length - 1), constants) : undefined
  const storeIds = readConstantArray(code, 'STORE_IDS', constants) ?? []
  const steamId = readProperty(game, 'steamAppId', constants) ?? readProperty(game, 'SteamAPPId', constants) ?? ''
  const gogId = readProperty(game, 'gogAppId', constants) ?? ''
  const mergeMods = /mergeMods\s*:\s*false\b/.test(game) ? false : true

  if (!gameId) notes.push('Game ID')
  if (!executable) notes.push('game executable')
  if (modPath === undefined) notes.push('primary mod destination')
  if (requiredFiles === undefined) notes.push('required files')

  // Everything below is only present in extensions VEXB generated.
  const generatedTargets = readJsonConstant<GeneratedTarget[]>(code, 'DEPLOYMENT_TARGETS') ?? []
  const setupDirectories = (readJsonConstant<string[][]>(code, 'MOD_DIRECTORIES') ?? []).map((segments) => pathKey(segments.join('/')))
  const maintainDeploymentDirectories = /function ensureDeploymentDirectories\(/.test(code)
  const primaryPath = constants.get('MOD_PATH') ?? modPath ?? defaultForm.modPath
  const targetLocations: DeploymentTarget[] = generatedTargets.map((target, index) => {
    const id = target.id || `target-${index + 1}`
    const targetPath = joinPath(target.path)
    return {
      uid: makeUid(id),
      id,
      name: target.name ?? id,
      path: targetPath,
      markers: (target.markers ?? []).join('\n'),
      requiredArchivePath: target.requiredArchivePath ?? '',
      priority: String(target.priority ?? 20),
      createPath: maintainDeploymentDirectories || setupDirectories.includes(pathKey(targetPath)),
      keepArchiveLayout: target.keepArchiveLayout === true,
    }
  })

  const signaturePath = readJsonConstant<string[]>(code, 'SIGNATURES_PATH')
  const signatureNames = readConstantArray(code, 'SIGNATURE_FILES', constants) ?? []
  const signatureFiles = signatureNames
    .map((name) => contents.signatureFiles.find((file) => file.name.toLowerCase() === name.toLowerCase()))
    .filter((file) => file !== undefined)

  const installerExtension = constants.get('MOD_FILE_EXT')
  const installerPriority = /registerInstaller\([^,]+,\s*(\d+),\s*testSupportedContent/.exec(code)?.[1]
  const toolBlock = /const moddingTools = \[\{([\s\S]*?)\}\];/.exec(code)?.[1]
  const toolName = toolBlock ? readProperty(toolBlock, 'name', constants) : undefined
  const toolExecutable = toolBlock ? readProperty(toolBlock, 'executable', constants) : undefined

  const form: FormState = {
    ...defaultForm,
    gameName,
    gameId,
    author: infoText('author'),
    version: infoText('version') || defaultForm.version,
    description: infoText('description'),
    executable,
    modPath: primaryPath,
    storeIds: storeIds.join(', '),
    steamId,
    launchThroughSteam: /\brequiresLauncher\b/.test(game) && /launcher:\s*'steam'/.test(code) && /^\d+$/.test(steamId),
    gogId,
    requiredFiles: (requiredFiles ?? []).join('\n'),
    mergeMods,
    mixedArchiveSupport: /const MIXED_MOD_TYPE\s*=/.test(code),
    keepExtraFiles: /function buildExtraCopyInstructions\(/.test(code),
    createModPath: maintainDeploymentDirectories || setupDirectories.includes(pathKey(primaryPath)),
    maintainDeploymentDirectories,
    targetLocations,
    installerEnabled: installerExtension !== undefined,
    installerExtension: installerExtension ?? defaultForm.installerExtension,
    installerPriority: installerPriority ?? defaultForm.installerPriority,
    toolEnabled: toolName !== undefined && toolExecutable !== undefined,
    toolName: toolName ?? '',
    toolExecutable: toolExecutable ?? '',
    bundleSignatures: signatureFiles.length > 0,
    signaturesPath: signaturePath ? signaturePath.join('/') : '',
    signatureFiles,
  }

  // VEXB output follows a fixed shape; anything else was written by hand and may do
  // things the builder can't represent.
  const generated = /module\.exports = \{\n {2}default: main,\n\};/.test(code) && /logo: 'gameart\.png',/.test(code)
  return {
    form,
    source: generated ? 'vexb' : 'imported',
    notes: notes.length ? [`Couldn't read the ${notes.join(', ')} from index.js. Fill ${notes.length === 1 ? 'it' : 'them'} in before updating the extension.`] : [],
  }
}
