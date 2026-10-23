import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

/** Severity level for audit entries. */
export type AuditSeverity = 'info' | 'warning' | 'error' | 'critical'

/** Action categories for audit trail. */
export type AuditAction =
  | 'RUN_STARTED'
  | 'RUN_FINISHED'
  | 'TASK_CREATED'
  | 'TASK_TRANSITION'
  | 'FILE_READ'
  | 'FILE_WRITE'
  | 'FILE_DELETE'
  | 'COMMAND_EXECUTED'
  | 'APPROVAL_REQUESTED'
  | 'APPROVAL_GRANTED'
  | 'APPROVAL_DENIED'
  | 'APPROVAL_ESCALATED'
  | 'CHECKPOINT_CREATED'
  | 'CHECKPOINT_ROLLED_BACK'
  | 'PATCH_PREVIEW'
  | 'CHANGE_GROUP_COMMITTED'
  | 'ERROR'

export interface AuditEntry {
  id: string
  ts: number
  runId: string
  taskId?: string
  action: AuditAction
  severity: AuditSeverity
  /** Human-readable description. */
  message: string
  /** Structured metadata for programmatic analysis. */
  metadata: Record<string, unknown>
}

/** In-memory audit log with optional persistence. */
export class AuditLog {
  private readonly runId: string
  private readonly persistPath?: string
  private entries: AuditEntry[] = []
  private maxEntries = 10_000

  constructor(runId: string, persistPath?: string) {
    this.runId = runId
    this.persistPath = persistPath
  }

  /** Record an audit entry. */
  log(entry: Omit<AuditEntry, 'id' | 'ts' | 'runId'>): AuditEntry {
    const fullEntry: AuditEntry = {
      id: randomUUID(),
      ts: Date.now(),
      runId: this.runId,
      ...entry
    }
    this.entries.push(fullEntry)
    if (this.entries.length > this.maxEntries) {
      this.entries.shift()
    }
    if (this.persistPath) {
      this.persist().catch(() => { /* best effort */ })
    }
    return fullEntry
  }

  /** Get all entries for this run. */
  getAll(): AuditEntry[] {
    return [...this.entries]
  }

  /** Get entries filtered by action type. */
  getByAction(action: AuditAction): AuditEntry[] {
    return this.entries.filter((e) => e.action === action)
  }

  /** Get entries for a specific task. */
  getByTask(taskId: string): AuditEntry[] {
    return this.entries.filter((e) => e.taskId === taskId)
  }

  /** Get recent entries (last N). */
  getRecent(limit = 100): AuditEntry[] {
    return this.entries.slice(-limit)
  }

  /** Export as JSONL for external tooling. */
  toJSONL(): string {
    return this.entries.map((e) => JSON.stringify(e)).join('\n')
  }

  /** Persist to disk (async, fire-and-forget). */
  private async persist(): Promise<void> {
    if (!this.persistPath) return
    try {
      await fs.mkdir(path.dirname(this.persistPath), { recursive: true })
      await fs.writeFile(this.persistPath, this.toJSONL(), 'utf8')
    } catch {
      // Persistence is best-effort
    }
  }
}

/** Convenience helpers for common audit actions. */
export const audit = {
  runStarted: (log: AuditLog, _runId: string, goal: string) =>
    log.log({ action: 'RUN_STARTED', severity: 'info', message: `Run started: ${goal}`, metadata: { goal } }),

  runFinished: (log: AuditLog, _runId: string, status: string, summary: string) =>
    log.log({ action: 'RUN_FINISHED', severity: 'info', message: `Run ${status}: ${summary}`, metadata: { status, summary } }),

  taskCreated: (log: AuditLog, _runId: string, taskId: string, title: string, role: string) =>
    log.log({ action: 'TASK_CREATED', severity: 'info', message: `Task created: ${title}`, metadata: { title, role }, taskId }),

  taskTransition: (log: AuditLog, _runId: string, taskId: string, from: string, to: string) =>
    log.log({ action: 'TASK_TRANSITION', severity: 'info', message: `Task ${from} → ${to}`, metadata: { from, to }, taskId }),

  fileRead: (log: AuditLog, _runId: string, taskId: string, file: string, bytes: number) =>
    log.log({ action: 'FILE_READ', severity: 'info', message: `Read file: ${file}`, metadata: { file, bytes }, taskId }),

  fileWrite: (log: AuditLog, _runId: string, taskId: string, file: string, bytes: number, isNew: boolean) =>
    log.log({ action: 'FILE_WRITE', severity: 'info', message: `${isNew ? 'Created' : 'Modified'} file: ${file}`, metadata: { file, bytes, isNew }, taskId }),

  commandExecuted: (log: AuditLog, _runId: string, taskId: string, command: string, exitCode: number, durationMs: number) =>
    log.log({ action: 'COMMAND_EXECUTED', severity: exitCode === 0 ? 'info' : 'warning', message: `Command ${exitCode === 0 ? 'succeeded' : 'failed'}: ${command}`, metadata: { command, exitCode, durationMs }, taskId }),

  approvalRequested: (log: AuditLog, _runId: string, taskId: string | undefined, kind: string, detail: string, risk: string) =>
    log.log({ action: 'APPROVAL_REQUESTED', severity: risk === 'HIGH_RISK_DESTRUCTIVE' ? 'critical' : 'warning', message: `Approval requested (${risk}): ${detail}`, metadata: { kind, detail, risk }, taskId }),

  approvalGranted: (log: AuditLog, _runId: string, taskId: string | undefined, kind: string, always: boolean) =>
    log.log({ action: 'APPROVAL_GRANTED', severity: 'info', message: `Approval granted for ${kind}${always ? ' (always)' : ''}`, metadata: { kind, always }, taskId }),

  approvalDenied: (log: AuditLog, _runId: string, taskId: string | undefined, kind: string, reason?: string) =>
    log.log({ action: 'APPROVAL_DENIED', severity: 'warning', message: `Approval denied for ${kind}: ${reason ?? 'no reason given'}`, metadata: { kind, reason }, taskId }),

  approvalEscalated: (log: AuditLog, _runId: string, taskId: string | undefined, kind: string, reason: string) =>
    log.log({ action: 'APPROVAL_ESCALATED', severity: 'critical', message: `Approval escalated for ${kind}: ${reason}`, metadata: { kind, reason }, taskId }),

  checkpointCreated: (log: AuditLog, _runId: string, taskId: string, file: string, checkpointId: string) =>
    log.log({ action: 'CHECKPOINT_CREATED', severity: 'info', message: `Checkpoint created for ${file}`, metadata: { file, checkpointId }, taskId }),

  checkpointRolledBack: (log: AuditLog, _runId: string, taskId: string, file: string, checkpointId: string) =>
    log.log({ action: 'CHECKPOINT_ROLLED_BACK', severity: 'warning', message: `Rolled back ${file} to checkpoint ${checkpointId}`, metadata: { file, checkpointId }, taskId }),

  patchPreview: (log: AuditLog, _runId: string, taskId: string, files: Array<{ path: string; added: number; removed: number }>) =>
    log.log({ action: 'PATCH_PREVIEW', severity: 'info', message: `Patch preview: ${files.length} file(s)`, metadata: { files }, taskId }),

  changeGroupCommitted: (log: AuditLog, _runId: string, taskId: string, groupId: string, fileCount: number) =>
    log.log({ action: 'CHANGE_GROUP_COMMITTED', severity: 'info', message: `Change group ${groupId} committed (${fileCount} files)`, metadata: { groupId, fileCount }, taskId }),

  error: (log: AuditLog, _runId: string, taskId: string | undefined, message: string, scope: string) =>
    log.log({ action: 'ERROR', severity: 'error', message, metadata: { scope }, taskId })
}

/** Create an audit log for a run. */
export function createAuditLog(
  runId: string,
  sandboxRoot: string
): AuditLog {
  const logPath = path.join(sandboxRoot, '.codex-local', 'audit', `${runId}.jsonl`)
  return new AuditLog(runId, logPath)
}
