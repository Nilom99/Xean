import type {
  AppConfig,
  EngineEvent,
  FreeModelInfo,
  ModelResolution,
  Role,
  RunSummary,
  SettingsState
} from './types'

/** Channels invoked from the renderer via contextBridge (request/response). */
export const IPC = {
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsSetApiKey: 'settings:set-api-key',
  settingsClearApiKey: 'settings:clear-api-key',
  settingsTestConnection: 'settings:test-connection',
  providerList: 'providers:list',
  providerCheckHealth: 'providers:check-health',
  providerListModels: 'providers:list-models',
  catalogRefresh: 'catalog:refresh',
  catalogList: 'catalog:list',
  modelsResolve: 'models:resolve',
  modelsSetRole: 'models:set-role',
  workspacePick: 'workspace:pick',
  workspaceTree: 'workspace:tree',
  workspaceReadFile: 'workspace:read-file',
  runStart: 'run:start',
  runStop: 'run:stop',
  runList: 'run:list',
  approvalRespond: 'approval:respond',
  decisionRespond: 'decision:respond',
  exportReport: 'run:export-report',
  openPath: 'shell:open-path'
} as const

export const IPC_EVENT = 'engine:event' as const

/**
 * Channels the main process sends *to* the renderer (application menu and
 * tray actions). The renderer subscribes to them through `onMenu`.
 */
export const IPC_MENU = {
  pickWorkspace: 'menu:pick-workspace',
  exportReport: 'menu:export-report',
  commandPalette: 'menu:command-palette',
  stopRun: 'menu:stop-run'
} as const

export type MenuAction = (typeof IPC_MENU)[keyof typeof IPC_MENU]

export interface IpcApi {
  getSettings(): Promise<SettingsState>
  updateConfig(patch: Partial<AppConfig>): Promise<SettingsState>
  setApiKey(key: string): Promise<SettingsState>
  clearApiKey(): Promise<SettingsState>
  testConnection(): Promise<{ ok: boolean; message: string; freeCount?: number }>
  refreshCatalog(): Promise<{ ok: boolean; message: string; freeCount: number }>
  listFreeModels(): Promise<FreeModelInfo[]>
  resolveAliases(): Promise<ModelResolution[]>
  setRoleModel(role: Role, modelId: string): Promise<SettingsState>
  pickWorkspace(): Promise<{ ok: boolean; root?: string; canceled?: boolean }>
  readTree(): Promise<WorkspaceNode[]>
  readFile(path: string): Promise<{ ok: boolean; content?: string; error?: string }>
  startRun(goal: string): Promise<{ ok: boolean; runId?: string; error?: string }>
  stopRun(): Promise<{ ok: boolean }>
  listRuns(): Promise<RunSummary[]>
  respondApproval(id: string, allowed: boolean, always: boolean): Promise<void>
  respondDecision(id: string, choice: string): Promise<void>
  exportReport(runId?: string): Promise<{ ok: boolean; path?: string }>
  openPath(target: string): Promise<{ ok: boolean; error?: string }>
  onEvent(cb: (event: EngineEvent) => void): () => void
  onMenu(cb: (action: MenuAction) => void): () => void
}

export interface WorkspaceNode {
  name: string
  path: string
  type: 'file' | 'dir'
  children?: WorkspaceNode[]
}
