import path from 'node:path'
import type { Sandbox } from './sandbox'
import { isTextFile } from './workspaceContext'

export interface SymbolDefinition {
  name: string
  kind: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'export'
  file: string
  line: number
}

export interface DependencyGraph {
  /** File -> set of files it imports */
  imports: Record<string, string[]>
  /** File -> set of files that import it */
  importedBy: Record<string, string[]>
}

export interface ImpactAnalysis {
  changedFiles: string[]
  directlyAffected: string[]
  indirectlyAffected: string[]
  totalAffectedCount: number
}

/** Regex patterns to identify code symbol definitions across TS/JS files. */
const SYMBOL_PATTERNS: Array<{ kind: SymbolDefinition['kind']; regex: RegExp }> = [
  { kind: 'class', regex: /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_]+)/ },
  { kind: 'interface', regex: /^\s*(?:export\s+)?interface\s+([A-Za-z0-9_]+)/ },
  { kind: 'type', regex: /^\s*(?:export\s+)?type\s+([A-Za-z0-9_]+)/ },
  { kind: 'function', regex: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/ },
  { kind: 'variable', regex: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_]+)\s*=/ }
]

/** Extract symbol definitions from text content of a file. */
export function parseFileSymbols(file: string, content: string): SymbolDefinition[] {
  const symbols: SymbolDefinition[] = []
  const lines = content.split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const { kind, regex } of SYMBOL_PATTERNS) {
      const match = line.match(regex)
      if (match && match[1]) {
        symbols.push({ name: match[1], kind, file, line: i + 1 })
        break
      }
    }
  }
  return symbols
}

/** Extract import specifiers from file content. */
export function parseImports(_file: string, content: string): string[] {
  const imports: string[] = []
  const importRegex = /(?:import|export)\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"]/g
  let match: RegExpExecArray | null

  while ((match = importRegex.exec(content)) !== null) {
    if (match[1]) imports.push(match[1])
  }
  return imports
}

/** Resolve relative or aliased import path to workspace relative file path. */
export function resolveImportPath(
  currentFile: string,
  importPath: string,
  allFiles: Set<string>
): string | null {
  if (!importPath.startsWith('.') && !importPath.startsWith('@/')) {
    if (importPath.startsWith('@shared/')) {
      const sub = importPath.slice('@shared/'.length)
      const candidates = [`src/shared/${sub}`, `src/shared/${sub}.ts`, `src/shared/${sub}.tsx`, `src/shared/${sub}/index.ts`]
      for (const candidate of candidates) {
        if (allFiles.has(candidate)) return candidate
      }
    }
    return null
  }

  const dir = path.dirname(currentFile)
  const normalizedImport = importPath.startsWith('@/')
    ? importPath.slice(2)
    : path.normalize(path.join(dir, importPath)).replace(/\\/g, '/')

  const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '.json', '/index.ts', '/index.js']
  for (const ext of extensions) {
    const candidate = `${normalizedImport}${ext}`
    if (allFiles.has(candidate)) return candidate
  }
  return null
}

/** Build the full workspace dependency graph across JS/TS files. */
export async function buildDependencyGraph(sandbox: Sandbox): Promise<DependencyGraph> {
  const files = await sandbox.listFiles(1000)
  const allFilesSet = new Set(files.map((f) => f.replace(/\\/g, '/')))
  const importsMap: Record<string, string[]> = {}
  const importedByMap: Record<string, string[]> = {}

  for (const file of files) {
    const normFile = file.replace(/\\/g, '/')
    importsMap[normFile] = []
    if (!importedByMap[normFile]) importedByMap[normFile] = []
  }

  for (const file of files) {
    const normFile = file.replace(/\\/g, '/')
    if (!isTextFile(normFile)) continue

    try {
      const content = await sandbox.readFile(normFile)
      const rawImports = parseImports(normFile, content)

      for (const rawImport of rawImports) {
        const resolved = resolveImportPath(normFile, rawImport, allFilesSet)
        if (resolved) {
          if (!importsMap[normFile].includes(resolved)) importsMap[normFile].push(resolved)
          if (!importedByMap[resolved]) importedByMap[resolved] = []
          if (!importedByMap[resolved].includes(normFile)) importedByMap[resolved].push(normFile)
        }
      }
    } catch {
      // Ignore unreadable files
    }
  }

  return { imports: importsMap, importedBy: importedByMap }
}

/** Perform impact analysis for a set of modified files. */
export function analyzeImpact(changedFiles: string[], graph: DependencyGraph): ImpactAnalysis {
  const normChanged = changedFiles.map((f) => f.replace(/\\/g, '/'))
  const directlyAffectedSet = new Set<string>()
  const indirectlyAffectedSet = new Set<string>()

  for (const changed of normChanged) {
    const directDependents = graph.importedBy[changed] || []
    for (const dep of directDependents) {
      if (!normChanged.includes(dep)) directlyAffectedSet.add(dep)
    }
  }

  const queue = Array.from(directlyAffectedSet)
  const visited = new Set<string>([...normChanged, ...directlyAffectedSet])

  while (queue.length > 0) {
    const current = queue.shift()!
    const upstream = graph.importedBy[current] || []
    for (const parent of upstream) {
      if (!visited.has(parent)) {
        visited.add(parent)
        indirectlyAffectedSet.add(parent)
        queue.push(parent)
      }
    }
  }

  const directlyAffected = Array.from(directlyAffectedSet)
  const indirectlyAffected = Array.from(indirectlyAffectedSet)

  return {
    changedFiles: normChanged,
    directlyAffected,
    indirectlyAffected,
    totalAffectedCount: normChanged.length + directlyAffected.length + indirectlyAffected.length
  }
}

/** Search symbols matching a query pattern across all workspace files. */
export async function searchSymbols(query: string, sandbox: Sandbox): Promise<SymbolDefinition[]> {
  const files = await sandbox.listFiles(1000)
  const results: SymbolDefinition[] = []
  const lowerQuery = query.toLowerCase()

  for (const file of files) {
    const normFile = file.replace(/\\/g, '/')
    if (!isTextFile(normFile)) continue

    try {
      const content = await sandbox.readFile(normFile)
      const symbols = parseFileSymbols(normFile, content)

      for (const symbol of symbols) {
        if (symbol.name.toLowerCase().includes(lowerQuery)) {
          results.push(symbol)
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  return results
}

/** Generate a repository map summarizing codebase symbols and modules. */
export async function generateRepositoryMap(sandbox: Sandbox): Promise<string> {
  const files = await sandbox.listFiles(500)
  const mapLines: string[] = ['# Repository Map\n']

  for (const file of files) {
    const normFile = file.replace(/\\/g, '/')
    if (!isTextFile(normFile)) continue

    try {
      const content = await sandbox.readFile(normFile)
      const symbols = parseFileSymbols(normFile, content)

      if (symbols.length > 0) {
        mapLines.push(`## ${normFile}`)
        for (const sym of symbols) {
          mapLines.push(`  - [${sym.kind}] ${sym.name} (line ${sym.line})`)
        }
        mapLines.push('')
      }
    } catch {
      // Ignore unreadable files
    }
  }

  return mapLines.join('\n')
}

