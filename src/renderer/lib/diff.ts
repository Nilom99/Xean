/** A single line in a unified diff. */
export interface DiffRow {
  type: 'context' | 'add' | 'del'
  oldNumber: number | null
  newNumber: number | null
  text: string
}

/**
 * Parse a unified diff back into rows.
 *
 * The main process stores patches as unified diff text, so the renderer
 * re-parses it for display.
 */
export function parseUnifiedRows(unified: string): DiffRow[] {
  const rows: DiffRow[] = []
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
