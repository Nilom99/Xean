import { randomUUID } from 'node:crypto'
import type { Bus } from './bus'

export interface DecisionRequest {
  question: string
  options: string[]
  taskId?: string
  /** Extra context shown to the user (both agent positions). */
  detail?: string
  /** The run this decision belongs to. */
  runId: string
}

interface PendingDecision {
  resolve: (choice: string) => void
  runId: string
}

/**
 * Escalation gate.
 *
 * When two agents disagree twice and the orchestrator cannot break the tie,
 * the run pauses and asks the user through a "Needs decision" card.
 */
export class DecisionGate {
  private pending = new Map<string, PendingDecision>()

  constructor(private readonly bus: Bus) {}

  /** Ask the user and wait for their choice. */
  request(request: DecisionRequest): Promise<string> {
    const id = randomUUID()
    return new Promise<string>((resolve) => {
      this.pending.set(id, { resolve, runId: request.runId })
      this.bus.emitEvent({
        type: 'NEEDS_DECISION',
        ts: Date.now(),
        id,
        runId: request.runId,
        question: request.question,
        options: request.options,
        taskId: request.taskId,
        detail: request.detail
      })
    })
  }

  /** Resolve a pending decision (called from the IPC handler). */
  respond(id: string, choice: string): void {
    const entry = this.pending.get(id)
    if (!entry) return
    this.pending.delete(id)
    this.bus.emitEvent({
      type: 'DECISION_MADE',
      ts: Date.now(),
      id,
      runId: entry.runId,
      choice
    })
    entry.resolve(choice)
  }

  get pendingCount(): number {
    return this.pending.size
  }
}
