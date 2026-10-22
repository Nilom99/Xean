import { randomUUID } from 'node:crypto'
import type { Bus } from './bus'

export type ApprovalKind = 'write' | 'command'

export interface ApprovalPayload {
  /** Files that will be written (for kind = 'write'). */
  files?: Array<{ path: string; content: string }>
  /** Command that will run (for kind = 'command'). */
  command?: string
  cwd?: string
  /** Sandbox boundary shown in the dialog. */
  workspaceRoot: string
}

export interface ApprovalDecision {
  allowed: boolean
  /** "Allow always" sets this flag for subsequent requests of the same kind. */
  always: boolean
}

interface PendingApproval {
  resolve: (decision: ApprovalDecision) => void
  /** The kind of this request, remembered so "Allow always" can register it. */
  kind: ApprovalKind
}

/**
 * Human-in-the-loop gate.
 *
 * The engine suspends on a promise while the UI shows the approval dialog.
 * Approvals are granted per request, or "always" per kind for the session.
 */
export class ApprovalGate {
  private pending = new Map<string, PendingApproval>()
  private alwaysAllowed = new Set<ApprovalKind>()

  constructor(private readonly bus: Bus) {}

  /** True when this kind no longer needs a user decision. */
  isAutoApproved(kind: ApprovalKind): boolean {
    return this.alwaysAllowed.has(kind)
  }

  /** Grant blanket approval for a kind (used by "Allow always"). */
  allowAlways(kind: ApprovalKind): void {
    this.alwaysAllowed.add(kind)
  }

  /** Turn off blanket approval for a kind. */
  revokeAlways(kind: ApprovalKind): void {
    this.alwaysAllowed.delete(kind)
  }

  /** Request approval and wait for the user's answer. */
  request(
    kind: ApprovalKind,
    detail: string,
    payload: ApprovalPayload,
    runId: string
  ): Promise<ApprovalDecision> {
    if (this.alwaysAllowed.has(kind)) {
      return Promise.resolve({ allowed: true, always: false })
    }

    const id = randomUUID()
    return new Promise<ApprovalDecision>((resolve) => {
      this.pending.set(id, { resolve, kind })
      this.bus.emitEvent({
        type: 'APPROVAL_REQUIRED',
        ts: Date.now(),
        runId,
        id,
        kind,
        detail,
        payload
      })
    })
  }

  /**
   * Resolve a pending approval (called from the IPC handler).
   *
   * The kind defaults to the one recorded when the request was made, so the
   * renderer does not have to repeat it.
   */
  respond(id: string, allowed: boolean, always: boolean, kind?: ApprovalKind): void {
    const entry = this.pending.get(id)
    if (!entry) return
    this.pending.delete(id)
    if (always && allowed) this.alwaysAllowed.add(kind ?? entry.kind)
    entry.resolve({ allowed, always })
  }

  /** Number of approvals currently waiting. */
  get pendingCount(): number {
    return this.pending.size
  }
}
