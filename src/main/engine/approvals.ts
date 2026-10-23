import { randomUUID } from 'node:crypto'
import type { Bus } from './bus'
import { classifyCommandRisk, type CommandRiskLevel } from './commands'

export type ApprovalKind = 'write' | 'command'

export interface ApprovalPayload {
  /** Files that will be written (for kind = 'write'). */
  files?: Array<{ path: string; content: string }>
  /** Command that will run (for kind = 'command'). */
  command?: string
  cwd?: string
  /** Risk classification for commands. */
  risk?: CommandRiskLevel
  /** Sandbox boundary shown in the dialog. */
  workspaceRoot: string
}

export interface ApprovalDecision {
  allowed: boolean
  /** "Allow always" sets this flag for subsequent requests of the same kind. */
  always: boolean
  /** Escalation rationale if blocked or escalated. */
  reason?: string
}

interface PendingApproval {
  resolve: (decision: ApprovalDecision) => void
  /** The kind of this request, remembered so "Allow always" can register it. */
  kind: ApprovalKind
  risk?: CommandRiskLevel
}

export interface SecurityPolicy {
  /** Max command risk level that can be auto-approved. Defaults to WORKSPACE_WRITE. */
  maxAutoApproveRisk: CommandRiskLevel
  /** Require explicit confirmation for HIGH_RISK_DESTRUCTIVE actions regardless of "always" setting. */
  alwaysRequireDestructiveApproval: boolean
}

const DEFAULT_POLICY: SecurityPolicy = {
  maxAutoApproveRisk: 'WORKSPACE_WRITE',
  alwaysRequireDestructiveApproval: true
}

/**
 * Human-in-the-loop gate with risk-aware escalation policies.
 *
 * The engine suspends on a promise while the UI shows the approval dialog.
 * Approvals are granted per request, or "always" per kind for the session.
 */
export class ApprovalGate {
  private readonly bus: Bus
  private pending = new Map<string, PendingApproval>()
  private alwaysAllowed = new Set<ApprovalKind>()
  private policy: SecurityPolicy = { ...DEFAULT_POLICY }

  constructor(bus: Bus) {
    this.bus = bus
  }

  setPolicy(policy: Partial<SecurityPolicy>): void {
    this.policy = { ...this.policy, ...policy }
  }

  getPolicy(): SecurityPolicy {
    return { ...this.policy }
  }

  /** True when this kind no longer needs a user decision. */
  isAutoApproved(kind: ApprovalKind, risk?: CommandRiskLevel): boolean {
    if (risk === 'HIGH_RISK_DESTRUCTIVE' && this.policy.alwaysRequireDestructiveApproval) {
      return false
    }
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
    const risk = payload.command ? (payload.risk ?? classifyCommandRisk(payload.command)) : undefined

    // Safe read-only commands bypass approval gate completely
    if (kind === 'command' && risk === 'SAFE_READ_ONLY') {
      return Promise.resolve({ allowed: true, always: false })
    }

    // Check auto-approve condition
    if (this.isAutoApproved(kind, risk)) {
      return Promise.resolve({ allowed: true, always: false })
    }

    const id = randomUUID()
    return new Promise<ApprovalDecision>((resolve) => {
      this.pending.set(id, { resolve, kind, risk })
      this.bus.emitEvent({
        type: 'APPROVAL_REQUIRED',
        ts: Date.now(),
        runId,
        id,
        kind,
        detail,
        payload: {
          ...payload,
          risk
        }
      })
    })
  }

  /**
   * Resolve a pending approval (called from the IPC handler).
   *
   * The kind defaults to the one recorded when the request was made, so the
   * renderer does not have to repeat it.
   */
  respond(id: string, allowed: boolean, always: boolean, kind?: ApprovalKind, reason?: string): void {
    const entry = this.pending.get(id)
    if (!entry) return
    this.pending.delete(id)
    const targetKind = kind ?? entry.kind
    if (always && allowed) {
      // Don't auto-allow high risk if policy forbids
      if (!(entry.risk === 'HIGH_RISK_DESTRUCTIVE' && this.policy.alwaysRequireDestructiveApproval)) {
        this.alwaysAllowed.add(targetKind)
      }
    }
    entry.resolve({ allowed, always, reason })
  }

  /** Number of approvals currently waiting. */
  get pendingCount(): number {
    return this.pending.size
  }
}
