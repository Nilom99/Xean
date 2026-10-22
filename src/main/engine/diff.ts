import { structuredPatch } from 'diff'

export interface DiffLine {
  type: 'context' | 'add' | 'del'
  oldNumber: number | null
  newNumber: number | null
  text: string
}

export interface FileDiff {
  path: string
  /** Unified diff text, ready for the DiffViewer. */
  unified: string
  /** Rows for the side-by-side view. */
  rows: DiffLine[]
  added: number
  removed: number
  isNewFile: boolean
}

/**
 * Compute a diff between the previous file content and the new content.
 *
 * A missing previous file means "new file" and diffs against an empty string.
 */
export function computeDiff(path: string, before: string | null, after: string): FileDiff {
  const isNewFile = before === null
  const oldText = before ?? ''
  const patch = structuredPatch(
    `a/${path}`,
    `b/${path}`,
    oldText,
    after,
    undefined,
    undefined,
    { context: 3 }
  )

  const rows: DiffLine[] = []
  let added = 0
  let removed = 0

  for (const hunk of patch.hunks) {
    let oldLine = hunk.oldStart
    let newLine = hunk.newStart

    for (const line of hunk.lines) {
      const marker = line.charAt(0)
      const text = line.slice(1)
      if (marker === '+') {
        rows.push({ type: 'add', oldNumber: null, newNumber: newLine++, text })
        added++
      } else if (marker === '-') {
        rows.push({ type: 'del', oldNumber: oldLine++, newNumber: null, text })
        removed++
      } else {
        rows.push({ type: 'context', oldNumber: oldLine++, newNumber: newLine++, text })
      }
    }
  }

  const header = `--- ${isNewFile ? '/dev/null' : `a/${path}`}\n+++ b/${path}`
  const unified = [header, ...patch.hunks.map(formatHunk)].join('\n')

  return { path, unified, rows, added, removed, isNewFile }
}

function formatHunk(hunk: {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}): string {
  const head = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`
  return [head, ...hunk.lines].join('\n')
}

/** Parse a unified diff back into rows (used when loading a persisted patch). */
export function parseUnifiedRows(unified: string): DiffLine[] {
  const rows: DiffLine[] = []
  let oldLine = 0
  let newLine = 0

  for (const raw of unified.split('\n')) {
    const hunkHeader = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
    if (hunkHeader) {
      oldLine = Number(hunkHeader[1])
      newLine = Number(hunkHeader[2])
      continue
    }
    if (raw.startsWith('---') || raw.startsWith('+++')) continue
    if (raw.startsWith('diff ') || raw.startsWith('index ')) continue

    const marker = raw.charAt(0)
    const text = raw.slice(1)
    if (marker === '+') {
      rows.push({ type: 'add', oldNumber: null, newNumber: newLine++, text })
    } else if (marker === '-') {
      rows.push({ type: 'del', oldNumber: oldLine++, newNumber: null, text })
    } else {
      rows.push({ type: 'context', oldNumber: oldLine++, newNumber: newLine++, text })
    }
  }
  return rows
}
