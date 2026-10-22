import type { Role, Task, TaskStatus } from '@shared/types'

/**
 * Task state machine.
 *
 *   PENDING → ASSIGNED → IN_PROGRESS → IN_REVIEW → CHANGES_REQUESTED → IN_REVIEW …
 *   DONE | BLOCKED | FAILED
 *
 * Illegal transitions throw, which surfaces bugs instead of silently
 * corrupting the board.
 */
const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  PENDING: ['ASSIGNED', 'BLOCKED', 'FAILED'],
  ASSIGNED: ['IN_PROGRESS', 'PENDING', 'BLOCKED', 'FAILED'],
  IN_PROGRESS: ['IN_REVIEW', 'CHANGES_REQUESTED', 'DONE', 'BLOCKED', 'FAILED'],
  IN_REVIEW: ['DONE', 'CHANGES_REQUESTED', 'BLOCKED', 'FAILED'],
  CHANGES_REQUESTED: ['ASSIGNED', 'IN_PROGRESS', 'BLOCKED', 'FAILED'],
  DONE: [],
  BLOCKED: ['PENDING'],
  FAILED: []
}

export class TaskBoard {
  private tasks = new Map<string, Task>()
  private counter = 0

  create(input: {
    runId: string
    title: string
    description: string
    role: Role
    dependsOn?: string[]
  }): Task {
    const id = `task-${++this.counter}-${Date.now().toString(36)}`
    const now = Date.now()
    const task: Task = {
      id,
      runId: input.runId,
      title: input.title,
      description: input.description,
      role: input.role,
      status: 'PENDING',
      iteration: 0,
      createdAt: now,
      updatedAt: now,
      dependsOn: input.dependsOn ?? [],
      patches: [],
      reviewItems: []
    }
    this.tasks.set(id, task)
    return task
  }

  get(id: string): Task | undefined {
    return this.tasks.get(id)
  }

  list(runId?: string): Task[] {
    const all = [...this.tasks.values()]
    return runId ? all.filter((t) => t.runId === runId) : all
  }

  /** Apply a transition. Throws on an illegal move. */
  transition(id: string, next: TaskStatus): Task {
    const task = this.tasks.get(id)
    if (!task) throw new Error(`Unknown task: ${id}`)
    if (task.status === next) return task
    const allowed = TRANSITIONS[task.status]
    if (!allowed.includes(next)) {
      throw new Error(`Illegal task transition ${task.status} → ${next} for ${id}`)
    }
    task.status = next
    task.updatedAt = Date.now()
    return task
  }

  update(id: string, patch: Partial<Omit<Task, 'id' | 'runId'>>): Task {
    const task = this.tasks.get(id)
    if (!task) throw new Error(`Unknown task: ${id}`)
    Object.assign(task, patch, { updatedAt: Date.now() })
    return task
  }

  /** Append a file patch produced by the implementer. */
  appendPatch(id: string, patch: Task['patches'][number]): Task {
    const task = this.tasks.get(id)
    if (!task) throw new Error(`Unknown task: ${id}`)
    task.patches.push(patch)
    task.updatedAt = Date.now()
    return task
  }

  /** True when every dependency is DONE. */
  dependenciesMet(id: string): boolean {
    const task = this.tasks.get(id)
    if (!task) return false
    return task.dependsOn.every((dep) => this.tasks.get(dep)?.status === 'DONE')
  }

  /** Tasks that are ready to be dispatched for a role. */
  readyFor(role: Role): Task[] {
    return this.list().filter(
      (t) =>
        t.role === role &&
        (t.status === 'PENDING' || t.status === 'ASSIGNED' || t.status === 'CHANGES_REQUESTED') &&
        this.dependenciesMet(t.id)
    )
  }

  isComplete(runId: string): boolean {
    const list = this.list(runId)
    if (list.length === 0) return true
    return list.every((t) => t.status === 'DONE' || t.status === 'BLOCKED' || t.status === 'FAILED')
  }

  summary(runId: string): Record<TaskStatus, number> {
    const out: Record<TaskStatus, number> = {
      PENDING: 0,
      ASSIGNED: 0,
      IN_PROGRESS: 0,
      IN_REVIEW: 0,
      CHANGES_REQUESTED: 0,
      DONE: 0,
      BLOCKED: 0,
      FAILED: 0
    }
    for (const task of this.list(runId)) out[task.status]++
    return out
  }

  clearRun(runId: string): void {
    for (const [id, task] of this.tasks) {
      if (task.runId === runId) this.tasks.delete(id)
    }
  }
}
