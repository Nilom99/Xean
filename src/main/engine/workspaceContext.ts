import type { Sandbox } from './sandbox'

/**
 * A snapshot of the workspace, rendered as prompt text.
 *
 * The Implementer agent has no tools: it cannot list directories, read files
 * or run commands. Without a snapshot it has no way to know what the project
 * looks like, so it answers "I need access to the workspace" and proposes no
 * files at all. This module produces the snapshot that is embedded in the
 * implementer's prompt.
 */

/** Extensions that are worth showing to a model. */
const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.mdx',
  '.txt',
  '.yml',
  '.yaml',
  '.toml',
  '.ini',
  '.cfg',
  '.env',
  '.example',
  '.html',
  '.css',
  '.scss',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.sh',
  '.bat',
  '.sql',
  '.graphql'
])

/** Words that carry no signal when ranking files against a task. */
const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'into',
  'file',
  'files',
  'code',
  'task',
  'build',
  'add',
  'new',
  'use',
  'using',
  'make',
  'create',
  'write',
  'should',
  'must',
  'have',
  'tests',
  'test'
])

export interface WorkspaceContextOptions {
  /** The task text used to rank the most relevant files first. */
  taskText?: string
  /** Paths that must be included (e.g. files written by earlier tasks). */
  include?: string[]
  /** Maximum number of files whose content is included. */
  maxFiles?: number
  /** Maximum characters of a single file. */
  maxFileChars?: number
  /** Maximum characters of the whole snapshot. */
  maxTotalChars?: number
  /** Maximum number of entries in the file listing. */
  listLimit?: number
}

/** Split a text into comparable lower-case tokens. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3)
}

/** Score how likely a file is to be relevant for a task. */
export function scoreFile(file: string, tokens: string[]): number {
  const lower = file.toLowerCase()
  let score = 0
  for (const token of tokens) {
    if (token.length < 3 || STOP_WORDS.has(token)) continue
    if (lower.includes(token)) score += 1
  }
  return score
}

/**
 * Order the workspace files by relevance for a task.
 *
 * Files listed in `mustInclude` always come first, because they are the
 * output of earlier tasks in the same run and the implementer has to build on
 * top of them.
 */
export function rankFiles(
  files: string[],
  taskText: string,
  mustInclude: string[] = []
): string[] {
  const tokens = tokenize(taskText)
  const required = new Set(mustInclude.map((f) => f.replace(/\\/g, '/').replace(/^\.\//, '')))

  return files
    .map((file) => ({
      file,
      required: required.has(file),
      score: scoreFile(file, tokens)
    }))
    .sort(
      (a, b) =>
        Number(b.required) - Number(a.required) ||
        b.score - a.score ||
        a.file.localeCompare(b.file)
    )
    .map((entry) => entry.file)
}

/** True when a file looks like text we can safely paste into a prompt. */
export function isTextFile(file: string): boolean {
  const lower = file.toLowerCase()
  if (lower.endsWith('package-lock.json') || lower.endsWith('yarn.lock')) return false
  const dot = lower.lastIndexOf('.')
  if (dot === -1) return true
  const ext = lower.slice(dot)
  return TEXT_EXTENSIONS.has(ext)
}

/** Truncate a file body, marking the cut explicitly. */
function clip(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n[truncated — ${text.length - maxChars} more characters omitted]`
}

/**
 * Build the workspace snapshot for a prompt.
 *
 * The listing is always complete (capped) so the model knows the shape of the
 * project; the file bodies are budgeted and ordered by relevance.
 */
export async function buildWorkspaceContext(
  sandbox: Sandbox,
  options: WorkspaceContextOptions = {}
): Promise<string> {
  const maxFiles = options.maxFiles ?? 12
  const maxFileChars = options.maxFileChars ?? 4000
  const maxTotalChars = options.maxTotalChars ?? 14_000
  const listLimit = options.listLimit ?? 400

  const files = await sandbox.listFiles(listLimit)
  const listing = files.length > 0 ? files.join('\n') : '(the workspace is empty)'

  const ranked = rankFiles(files, options.taskText ?? '', options.include ?? [])
  const bodies: string[] = []
  let used = 0
  let included = 0

  for (const file of ranked) {
    if (included >= maxFiles) break
    if (!isTextFile(file)) continue

    let content: string
    try {
      content = await sandbox.readFile(file)
    } catch {
      continue
    }
    // Binary or unreadable content is never useful in a prompt.
    if (!content.trim() || content.includes('\u0000')) continue

    const block = `--- FILE: ${file} ---\n${clip(content, maxFileChars)}\n--- END FILE: ${file} ---\n`
    if (used + block.length > maxTotalChars) continue

    used += block.length
    included += 1
    bodies.push(block)
  }

  const parts = [
    'Workspace files (paths are relative to the workspace root):',
    listing,
    ''
  ]
  if (bodies.length > 0) {
    parts.push('Current content of the most relevant files:', ...bodies)
  } else {
    parts.push('The workspace has no readable files yet - create the files you need.')
  }
  return parts.join('\n')
}
