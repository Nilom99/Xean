/**
 * Tolerant JSON extraction.
 *
 * Small free models rarely emit perfectly formed JSON. These helpers find the
 * most plausible JSON payload inside a model response so the orchestrator can
 * keep working instead of hard-failing the run.
 */

/** Strip markdown code fences and surrounding prose. */
export function stripCodeFences(text: string): string {
  const fence = /```(?:json|JSON)?\s*([\s\S]*?)```/g
  const matches = [...text.matchAll(fence)]
  if (matches.length > 0) {
    return matches.map((m) => m[1].trim()).join('\n')
  }
  return text.trim()
}

/** Find the first balanced JSON object/array in a string. */
function findBalanced(text: string): string | null {
  const start = text.search(/[{[]/)
  if (start === -1) return null

  const open = text[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/** Remove trailing commas before } or ]. */
export function repairJson(text: string): string {
  return text.replace(/,(\s*[}\]])/g, '$1')
}

/**
 * Escape raw newlines that a model emitted inside a JSON string.
 *
 * Small free models regularly write multi-line file contents with literal
 * line breaks instead of the `\n` escape, which makes the whole payload
 * unparseable and silently loses every proposed file.
 */
export function repairLiteralNewlines(text: string): string {
  let out = ''
  let inString = false
  let escaped = false

  for (const ch of text) {
    if (escaped) {
      out += ch
      escaped = false
      continue
    }
    if (ch === '\\') {
      out += ch
      escaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      out += ch
      continue
    }
    if (inString && (ch === '\n' || ch === '\r')) {
      out += '\\n'
      continue
    }
    out += ch
  }
  return out
}

/** Parse JSON from a model response, tolerating fences and trailing commas. */
export function parseJsonLoose<T>(text: string): T | null {
  const cleaned = stripCodeFences(text)
  const candidates = [cleaned]

  const balanced = findBalanced(cleaned)
  if (balanced) candidates.push(balanced)

  for (const candidate of candidates) {
    for (const attempt of [
      candidate,
      repairJson(candidate),
      repairLiteralNewlines(candidate),
      repairLiteralNewlines(repairJson(candidate))
    ]) {
      try {
        return JSON.parse(attempt) as T
      } catch {
        // try next
      }
    }
  }
  return null
}

/** Parse a JSON array of objects, ignoring any surrounding prose. */
export function parseJsonArrayLoose<T>(text: string): T[] {
  const direct = parseJsonLoose<T[]>(text)
  if (Array.isArray(direct)) return direct

  const cleaned = stripCodeFences(text)
  const start = cleaned.indexOf('[')
  if (start === -1) return []

  // Try progressively shorter prefixes to find a decodable array.
  for (let end = cleaned.length; end > start; end--) {
    const slice = cleaned.slice(start, end)
    const last = slice.lastIndexOf(']')
    if (last === -1) continue
    const candidate = slice.slice(0, last + 1)
    try {
      const parsed = JSON.parse(repairJson(candidate)) as unknown
      if (Array.isArray(parsed)) return parsed as T[]
    } catch {
      // keep shrinking
    }
  }
  return []
}

/** Coerce loose values into strings (models sometimes emit numbers/objects). */
export function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    for (const key of ['text', 'content', 'value', 'body', 'description']) {
      if (typeof obj[key] === 'string') return obj[key]
    }
  }
  return fallback
}
