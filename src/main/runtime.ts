import type { AppConfig, ModelResolution, Role, SettingsState } from '@shared/types'
import { ROLES } from '@shared/types'
import { DEFAULT_CONFIG, loadConfig, saveConfig, resolveWorkspaceRoot, normalizeRoles } from './config'
import { catalog } from './openrouter/catalog'
import { buildAssignments, type RoleAssignment } from './openrouter/assignment'
import { resolveAll } from './openrouter/aliasMap'
import { getKeySource, hasApiKey } from './secrets'

/**
 * Shared runtime state.
 *
 * Owns the live config, the sandbox root and the resolved role -> model
 * assignments so every subsystem (engine, IPC, UI) reads one source of truth.
 */
export class Runtime {
  private config: AppConfig = structuredClone(DEFAULT_CONFIG)
  private assignments: Record<Role, RoleAssignment> = buildAssignments(this.config, [])

  async load(): Promise<void> {
    const loaded = await loadConfig()
    this.config = { ...loaded, roles: normalizeRoles(loaded) }
    this.recompute()
  }

  getConfig(): AppConfig {
    return this.config
  }

  getAssignments(): Record<Role, RoleAssignment> {
    return this.assignments
  }

  /** Recompute the role -> model chains against the live free catalog. */
  recompute(): void {
    this.assignments = buildAssignments(this.config, catalog.list())
  }

  /** Absolute workspace root. */
  workspaceRoot(): string {
    return resolveWorkspaceRoot(this.config)
  }

  /** Apply a partial config update and persist it. */
  async update(patch: Partial<AppConfig>): Promise<void> {
    const next: AppConfig = {
      ...this.config,
      ...patch,
      // The free-only lock cannot be turned off.
      freeOnly: true,
      roles: patch.roles ? normalizeRoles({ ...this.config, roles: patch.roles }) : this.config.roles,
      providers: patch.providers ? { ...this.config.providers, ...patch.providers } : this.config.providers
    }

    // Defence in depth: a model that is not in the live free list is dropped
    // rather than stored, so the free-only invariant holds even if a caller
    // bypasses setRoleModel.
    for (const role of ROLES) {
      const model = next.roles[role].model
      if (model && !catalog.isFree(model)) {
        const { model: _dropped, ...rest } = next.roles[role]
        next.roles[role] = rest
      }
    }

    this.config = next
    this.recompute()
    await saveConfig(this.config)
  }

  /** Assign a model to a role. Rejects anything that is not live-free. */
  async setRoleModel(role: Role, modelId: string): Promise<void> {
    if (!catalog.isFree(modelId)) {
      throw new Error(
        `"${modelId}" is not in the live free-model list. Only free-tier models can be assigned.`
      )
    }
    this.config.roles[role] = { ...this.config.roles[role], model: modelId }
    this.recompute()
    await saveConfig(this.config)
  }

  /** Update provider settings. */
  async updateProviderSettings(settings: Partial<AppConfig['providers']>): Promise<void> {
    this.config.providers = { ...this.config.providers, ...settings }
    await saveConfig(this.config)
  }

  /** Snapshot for the renderer. */
  settingsState(): SettingsState {
    return {
      config: this.config,
      hasApiKey: hasApiKey(),
      keySource: getKeySource(),
      workspaceRoot: this.workspaceRoot(),
      autoApproveWrites: this.config.autoApproveWrites,
      catalogCount: catalog.list().length,
      catalogFetchedAt: catalog.fetchedAtMs()
    }
  }

  /** Roles missing a usable free model (used to gate "Start run"). */
  unassignedRoles(): Role[] {
    return ROLES.filter((role) => this.assignments[role].chain.length === 0)
  }

  /**
   * Fuzzy-resolve every configured alias against the live free catalog.
   *
   * Used by the model panel to show what each alias guessed and to flag
   * ambiguous or unresolved aliases for manual correction.
   */
  resolveModels(): ModelResolution[] {
    const roles = {} as Record<Role, { alias: string; preferred: string[] }>
    for (const role of ROLES) {
      roles[role] = {
        alias: this.config.roles[role].alias,
        preferred: this.config.roles[role].preferred
      }
    }
    return resolveAll(roles, catalog.list())
  }
}

export const runtime = new Runtime()
