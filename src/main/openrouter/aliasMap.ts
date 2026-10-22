import type { FreeModelInfo, ModelResolution, Role } from '@shared/types'

/**
 * Alias -> model resolution.
 *
 * The user's requested names are informal ("minimax 3.1 flash", "lfm2.5",
 * "dots3preview", "north mini code") and do not match OpenRouter ids
 * literally. Resolution therefore has three stages:
 *
 *   1. exact hit on a `preferred` id that is present in the live free list
 *   2. fuzzy match against the live free list (token overlap)
 *   3. ambiguous / unresolved -> surfaced to the user, never silently
 *      substituted with a paid model
 */

/** Tokenise an identifier or display name into comparable lowercase tokens. */
export function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length > 0)
}

/**
 * Extra forms of a token so that "m3" can match the alias token "3" and
 * "lfm2" can match "lfm". Keeps fuzzy matching honest without hardcoding
 * any particular model id.
 */
function variants(token: string): string[] {
  const out = new Set<string>([token])
  const numericSuffix = /^([a-z]+)(\d.*)$/.exec(token)
  if (numericSuffix) {
    out.add(numericSuffix[2])
    out.add(numericSuffix[1])
  }
  const splitVersion = /^([a-z]+)([\d.]*[a-z]?)$/.exec(token)
  if (splitVersion && splitVersion[1] !== token) out.add(splitVersion[1])
  return [...out]
}

/** Similarity between one alias token and one candidate token (0..1). */
function tokenScore(a: string, b: string): number {
  if (a === b) return 1
  const aVars = variants(a)
  const bVars = variants(b)
  for (const av of aVars) {
    for (const bv of bVars) {
      if (av === bv) return 1
    }
  }
  const shorter = a.length <= b.length ? a : b
  const longer = a.length <= b.length ? b : a
  if (shorter.length >= 2 && longer.startsWith(shorter)) {
    return 0.2 + 0.8 * (shorter.length / longer.length)
  }
  if (shorter.length >= 3 && longer.includes(shorter)) {
    return 0.6
  }
  return 0
}

/** Score how well a candidate model matches an alias (0..1). */
export function scoreCandidate(alias: string, model: FreeModelInfo): number {
  const aliasTokens = tokenize(alias)
  if (aliasTokens.length === 0) return 0

  const idTokens = tokenize(model.id)
  const nameTokens = tokenize(model.name)
  const candidateTokens = [...idTokens, ...nameTokens]

  let total = 0
  for (const at of aliasTokens) {
    let best = 0
    for (const ct of candidateTokens) {
      const s = tokenScore(at, ct)
      if (s > best) best = s
    }
    total += best
  }
  let score = total / aliasTokens.length

  // Bonus when the full alias string appears verbatim in the model name.
  const flatAlias = alias.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const flatName = model.name.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const flatId = model.id.toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (flatAlias.length >= 4 && (flatName.includes(flatAlias) || flatId.includes(flatAlias))) {
    score = Math.min(1, score + 0.2)
  }
  return Math.min(1, score)
}

export interface ResolveOptions {
  alias: string
  role: Role
  preferred?: string[]
  models: FreeModelInfo[]
}

const RESOLVE_THRESHOLD = 0.45
const AMBIGUITY_MARGIN = 0.06

/** Resolve one alias against the live free catalog. */
export function resolveAlias(options: ResolveOptions): ModelResolution {
  const { alias, role, preferred = [], models } = options

  if (models.length === 0) {
    return {
      alias,
      role,
      candidates: [],
      confidence: 0,
      status: 'unresolved',
      message: 'The free-model catalog is empty. Refresh the catalog in Settings.'
    }
  }

  const byId = new Map(models.map((m) => [m.id, m]))

  // Stage 1: a preferred id that is actually free and live.
  for (const candidate of preferred) {
    const hit = byId.get(candidate)
    if (hit) {
      return {
        alias,
        role,
        resolvedId: hit.id,
        candidates: [hit.id],
        confidence: 1,
        status: 'resolved'
      }
    }
  }

  // Stage 2: fuzzy match over the live free list.
  const scored = models
    .map((m) => ({ id: m.id, score: scoreCandidate(alias, m) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)

  const top = scored[0]
  if (!top || top.score < RESOLVE_THRESHOLD) {
    return {
      alias,
      role,
      candidates: scored.slice(0, 5).map((s) => s.id),
      confidence: top?.score ?? 0,
      status: 'unresolved',
      message: `Could not map "${alias}" to a free model. Pick one manually — paid models are locked out.`
    }
  }

  const runnerUp = scored[1]
  const ambiguous = runnerUp !== undefined && top.score - runnerUp.score < AMBIGUITY_MARGIN

  if (ambiguous) {
    return {
      alias,
      role,
      candidates: scored.slice(0, 5).map((s) => s.id),
      confidence: top.score,
      status: 'ambiguous',
      message: `"${alias}" matches ${top.id} and ${runnerUp.id} closely. Choose one in the model panel.`
    }
  }

  return {
    alias,
    role,
    resolvedId: top.id,
    candidates: scored.slice(0, 5).map((s) => s.id),
    confidence: top.score,
    status: 'resolved'
  }
}

/** Resolve every configured role. */
export function resolveAll(
  roles: Record<Role, { alias: string; preferred: string[] }>,
  models: FreeModelInfo[]
): ModelResolution[] {
  return (Object.keys(roles) as Role[]).map((role) =>
    resolveAlias({
      alias: roles[role].alias,
      role,
      preferred: roles[role].preferred,
      models
    })
  )
}
