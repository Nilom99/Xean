/**
 * Shared type contract between the main process (engine) and the renderer (UI).
 * The renderer is a pure function of the event log produced by the engine.
 */

export type Role = 'orchestrator' | 'implementer' | 'reviewer' | 'runner'

export const ROLES: Role[] = ['orchestrator', 'implementer', 'reviewer', 'runner']

export const ROLE_LABELS: Record<Role, string> = {
  orchestrator: 'Orchestrator',
  implementer: 'Implementer',
  reviewer: 'Reviewer',
  runner: 'Runner'
}

export type RunState = 'QUEUED' | 'RUNNING' | 'VERIFYING' | 'SUCCEEDED' | 'FAILED' | 'PARTIALLY_SUCCEEDED' | 'CANCELLED';

export type TaskStatus =
  | 'PENDING'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'IN_REVIEW'
  | 'CHANGES_REQUESTED'
  | 'DONE'
  | 'BLOCKED'
  | 'FAILED'

export type ReviewVerdict = 'APPROVED' | 'CHANGES_REQUESTED' | 'BLOCKED'

export interface ReviewItem {
  id: string
  severity: 'blocker' | 'major' | 'minor'
  title: string
  detail: string
  file?: string
  line?: number
}

/** A single file change produced by the Implementer. */
export interface FilePatch {
  path: string
  /** Unified diff text. */
  diff: string
  added: number
  removed: number
  /** Absolute path used for writes, kept separate from the workspace-relative path. */
  absolutePath: string
}

/** Context handed to a receiving agent on a HANDOFF. */
export interface HandoffContext {
  taskId: string
  to: Role
  contextSummary: string
}

export type EngineEvent =
  | { type: 'TASK_CREATED'; ts: number; runId?: string; taskId: string; title: string; description: string; role: Role }
  | { type: 'TASK_ASSIGNED'; ts: number; runId?: string; taskId: string; role: Role; model: string }
  | { type: 'MESSAGE'; ts: number; runId?: string; from: Role; to: Role | 'user'; body: string; taskId?: string }
  | { type: 'HANDOFF'; ts: number; runId?: string; from: Role; taskId: string; to: Role; contextSummary: string }
  | { type: 'REVIEW_REQUEST'; ts: number; runId?: string; taskId: string; from: Role; to: Role }
  | { type: 'REVIEW_RESULT'; ts: number; runId?: string; taskId: string; from: Role; verdict: ReviewVerdict; items: ReviewItem[] }
  | { type: 'FILE_PATCH'; ts: number; runId?: string; taskId: string; from: Role; patch: FilePatch }
  | { type: 'COMMAND_REQUEST'; ts: number; runId?: string; taskId: string; from: Role; command: string; cwd: string }
  | { type: 'COMMAND_RESULT'; ts: number; runId?: string; taskId: string; command: string; exitCode: number; stdout: string; stderr: string; durationMs: number }
  | { type: 'RUN_STARTED'; ts: number; runId: string; goal: string }
  | { type: 'RUN_STATE_CHANGED'; ts: number; runId: string; from: RunState; to: RunState }
  | { type: 'RUN_FINISHED'; ts: number; runId: string; status: 'done' | 'aborted' | 'failed'; summary: string }
  | { type: 'RUN_ABORTED'; ts: number; runId: string; reason: string }
  | { type: 'APPROVAL_REQUIRED'; ts: number; runId?: string; id: string; kind: 'write' | 'command'; detail: string; payload: unknown }
  | { type: 'ERROR'; ts: number; runId?: string; scope: string; message: string }
  | { type: 'USAGE'; ts: number; runId?: string; model: string; role: Role; promptTokens: number; completionTokens: number }
  | { type: 'AGENT_DELTA'; ts: number; runId?: string; role: Role; taskId?: string; text: string }
  | { type: 'MODEL_SWITCHED'; ts: number; runId: string; role: Role; from: string; to: string; reason: string }
  | { type: 'NEEDS_DECISION'; ts: number; runId: string; id: string; question: string; options: string[]; taskId?: string; detail?: string }
  | { type: 'DECISION_MADE'; ts: number; runId: string; id: string; choice: string }

export type EngineEventType = EngineEvent['type']

/** Per-task record kept in the taskboard. */
export interface Task {
  id: string
  runId: string
  title: string
  description: string
  role: Role
  status: TaskStatus
  iteration: number
  createdAt: number
  updatedAt: number
  dependsOn: string[]
  patches: FilePatch[]
  reviewItems: ReviewItem[]
  verdict?: ReviewVerdict
  error?: string
}

export interface UsageTotals {
  promptTokens: number
  completionTokens: number
  requests: number
}

export interface RoleModelConfig {
  alias: string
  preferred: string[]
  fallbacks: string[]
  /** Currently resolved model id (may be empty until resolved). */
  model?: string
}

export interface ProviderSettings {
  localFirst: boolean
  lmStudioEnabled: boolean
  ollamaEnabled: boolean
  lmStudioUrl: string
  ollamaUrl: string
}

export interface AppConfig {
  workspaceRoot: string
  freeOnly: boolean
  iterationsPerTask: number
  maxParallelTasks: number
  tokenBudget: number
  autoApproveWrites: boolean
  theme: 'dark' | 'light'
  roles: Record<Role, RoleModelConfig>
  providers: ProviderSettings
}

export interface FreeModelInfo {
  id: string
  name: string
  contextLength: number
}

export interface ModelResolution {
  alias: string
  role: Role
  resolvedId?: string
  candidates: string[]
  confidence: number
  status: 'resolved' | 'ambiguous' | 'unresolved'
  message?: string
}

export interface SettingsState {
  config: AppConfig
  hasApiKey: boolean
  keySource: 'keychain' | 'env' | 'none'
  workspaceRoot: string
  autoApproveWrites: boolean
  catalogCount: number
  catalogFetchedAt: number | null
}

export interface RunSummary {
  runId: string
  goal: string
  status: 'done' | 'aborted' | 'failed'
  startedAt: number
  endedAt: number
  tasks: number
  reportPath?: string
}
