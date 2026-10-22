import type { AppConfig, FreeModelInfo, Role } from '@shared/types'
import { ROLES } from '@shared/types'

export interface RoleAssignment {
  role: Role
  /** Primary model id, or null when nothing is resolved. */
  primary: string | null
  /** Ordered chain: primary first, then free fallbacks. */
  chain: string[]
  /** Models that were dropped because they are not in the live free list. */
  rejected: Array<{ id: string; reason: string }>
  message?: string
}

/**
 * Build the effective model chain for every role.
 *
 * Rules:
 *  - Only models present in the live free catalog are ever used.
 *  - The user's explicit choice (`config.roles[role].model`) wins.
 *  - Otherwise the first `preferred` id that is live-free is used.
 *  - `fallbacks` are appended, but only when they are live-free too.
 *  - Nothing here can ever produce a paid model.
 */
export function buildAssignments(
  config: AppConfig,
  liveFreeModels: FreeModelInfo[]
): Record<Role, RoleAssignment> {
  const live = new Set(liveFreeModels.map((m) => m.id))
  const out = {} as Record<Role, RoleAssignment>

  for (const role of ROLES) {
    const roleConfig = config.roles[role]
    const rejected: Array<{ id: string; reason: string }> = []
    const chain: string[] = []

    const chosen = roleConfig.model
    if (chosen) {
      if (live.has(chosen)) {
        chain.push(chosen)
      } else {
        rejected.push({ id: chosen, reason: 'not in the live free-model list' })
      }
    }

    for (const preferred of roleConfig.preferred) {
      if (chain.includes(preferred)) continue
      if (live.has(preferred)) {
        chain.push(preferred)
      } else {
        rejected.push({ id: preferred, reason: 'not in the live free-model list' })
      }
    }

    for (const fallback of roleConfig.fallbacks) {
      if (chain.includes(fallback)) continue
      if (live.has(fallback)) {
        chain.push(fallback)
      } else {
        rejected.push({ id: fallback, reason: 'fallback is not a live free model' })
      }
    }

    out[role] = {
      role,
      primary: chain[0] ?? null,
      chain,
      rejected,
      message:
        chain.length === 0
          ? `No free model is assigned to the ${role} role yet. Pick one in the model panel.`
          : undefined
    }
  }

  return out
}
