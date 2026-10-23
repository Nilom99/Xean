/**
 * .codexignore / .xeanignore support.
 *
 * Reads gitignore-style patterns from the workspace root and applies them
 * to the file listing and context builder. Patterns support:
 *   - comments (# ...)
 *   - negation (!)
 *   - directory patterns (trailing /)
 *   - glob (* and **)
 *   - basename-only patterns
 */

import type { Sandbox } from './sandbox'

export interface IgnoreRules {
  patterns: string[]
  /** True if a path is explicitly ignored by the rules. */
  isIgnored(relativePath: string): boolean
}

const IGNORE_FILE_NAMES = ['.codexignore', '.xeanignore']

/** Read and parse an ignore file. Returns null when none is present. */
export async function loadIgnoreRules(sandbox: Sandbox): Promise<IgnoreRules | null> {
  for (const name of IGNORE_FILE_NAMES) {
    try {
      const content = await sandbox.readFile(name)
      return parseIgnoreRules(content)
    } catch {
      continue
    }
  }
  return null
}

/** Parse raw ignore-file text into a rules object. */
export function parseIgnoreRules(text: string): IgnoreRules {
  const patterns: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    patterns.push(line)
  }
  return {
    patterns,
    isIgnored: (relativePath: string) => matchesAny(relativePath, patterns)
  }
}

/** Match a single path against a list of gitignore-style patterns. */
function matchesAny(relativePath: string, patterns: string[]): boolean {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '')
  let ignored = false
  for (const pattern of patterns) {
    const negated = pattern.startsWith('!')
    const pat = negated ? pattern.slice(1) : pattern
    if (matchesPattern(normalized, pat)) {
      ignored = !negated
    }
  }
  return ignored
}

function matchesPattern(path: string, pattern: string): boolean {
  const p = pattern.replace(/\\/g, '/').replace(/^\.\//, '')

  // Directory pattern (trailing slash) matches anything inside.
  if (p.endsWith('/')) {
    const dir = p.slice(0, -1)
    return path === dir || path.startsWith(dir + '/')
  }

  // ** matches across directory boundaries.
  if (p.includes('**')) {
    const re = new RegExp(
      '^' +
        p
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*\*/g, '<<<DOUBLESTAR>>>')
          .replace(/\*/g, '[^/]*')
          .replace(/<<<DOUBLESTAR>>>/g, '.*') +
        '$'
    )
    return re.test(path)
  }

  // Contains a slash -> anchored to root.
  if (p.includes('/')) {
    const re = new RegExp(
      '^' +
        p
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '[^/]*') +
        '$'
    )
    return re.test(path)
  }

  // No slash -> matches basename anywhere.
  const base = path.split('/').pop() ?? path
  const re = new RegExp(
    '^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$'
  )
  return re.test(base)
}

/** Filter a list of relative paths through ignore rules. */
export function filterIgnored(files: string[], rules: IgnoreRules | null): string[] {
  if (!rules) return files
  return files.filter((f) => !rules.isIgnored(f))
}