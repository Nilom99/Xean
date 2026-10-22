import { z } from 'zod'
import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { ROLES, type AppConfig, type Role } from '@shared/types'
import { DEFAULT_CONFIG } from './engine/config-defaults'

export { DEFAULT_CONFIG }

const RoleConfigSchema = z.object({
  // An empty alias means "use the default" — it is filled in by normalizeRoles.
  alias: z.string().default(''),
  preferred: z.array(z.string()).default([]),
  fallbacks: z.array(z.string()).default([]),
  model: z.string().optional()
})

const ConfigSchema = z.object({
  workspaceRoot: z.string().default('./workspace'),
  freeOnly: z.literal(true).default(true),
  iterationsPerTask: z.number().int().min(1).max(10).default(3),
  maxParallelTasks: z.number().int().min(1).max(8).default(3),
  tokenBudget: z.number().int().min(1000).default(400000),
  autoApproveWrites: z.boolean().default(false),
  theme: z.enum(['dark', 'light']).default('dark'),
  maxRepairAttempts: z.number().int().min(0).max(5).default(2),
  requestTimeoutMs: z.number().int().min(5_000).max(900_000).default(120_000),
  commandTimeoutMs: z.number().int().min(1_000).max(900_000).default(120_000),
  runTimeoutMs: z.number().int().min(60_000).max(24 * 3_600_000).default(3_600_000),
  roles: z
    .object({
      // Every role is optional: a hand-edited config that is missing one role
      // must not throw away the whole file. normalizeRoles fills the gaps.
      orchestrator: RoleConfigSchema.optional(),
      implementer: RoleConfigSchema.optional(),
      reviewer: RoleConfigSchema.optional(),
      runner: RoleConfigSchema.optional()
    })
    .default({})
})

/**
 * Path of the user-editable config file.
 *
 * In development this is the project root (so the checked-in file is edited).
 * In a packaged build the app directory is read-only, so the config lives in
 * the per-user data directory and is seeded from the bundled default.
 */
export function configPath(): string {
  if (app.isPackaged) return path.join(app.getPath('userData'), 'codex-local.config.json')
  return path.join(app.getAppPath(), 'codex-local.config.json')
}

/** Seed a packaged app's config from the bundled default on first launch. */
export async function ensureConfigFile(): Promise<void> {
  if (!app.isPackaged) return
  const target = configPath()
  try {
    await fs.access(target)
    return
  } catch {
    // not created yet — fall through
  }
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(
    target,
    `${JSON.stringify(structuredClone(DEFAULT_CONFIG), null, 2)}\n`,
    'utf8'
  )
}

export async function loadConfig(): Promise<AppConfig> {
  try {
    const raw = await fs.readFile(configPath(), 'utf8')
    const parsed = ConfigSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) {
      console.warn('[codex-local] Invalid config file, using defaults:', parsed.error.issues)
      return structuredClone(DEFAULT_CONFIG)
    }
    return parsed.data as AppConfig
  } catch {
    return structuredClone(DEFAULT_CONFIG)
  }
}

/** Persist the config back to disk. */
export async function saveConfig(config: AppConfig): Promise<void> {
  const validated = ConfigSchema.safeParse(config)
  const next = validated.success ? (validated.data as AppConfig) : config
  await fs.writeFile(configPath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8')
}

/** Absolute workspace root for the current config. */
export function resolveWorkspaceRoot(config: AppConfig): string {
  const root = config.workspaceRoot
  if (path.isAbsolute(root)) return path.normalize(root)
  return path.resolve(app.getAppPath(), root)
}

/** Ensure every role has a usable entry (guards against a hand-edited config). */
export function normalizeRoles(config: AppConfig): Record<Role, AppConfig['roles'][Role]> {
  const out = {} as AppConfig['roles']
  for (const role of ROLES) {
    const provided = config.roles?.[role]
    // A missing role, or one with no alias, falls back to the shipped default.
    if (!provided || !provided.alias) {
      out[role] = structuredClone(DEFAULT_CONFIG.roles[role])
      continue
    }
    out[role] = {
      alias: provided.alias,
      preferred: provided.preferred ?? [],
      fallbacks: provided.fallbacks ?? [],
      ...(provided.model ? { model: provided.model } : {})
    }
  }
  return out
}
