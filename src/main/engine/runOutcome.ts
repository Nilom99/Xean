import type { RunStatus, TaskStatus } from '@shared/types'

/** Minimal shape of a planned task used for dependency validation. */
export interface PlannedDependency {
  id: string
  dependsOn: string[]
}

/**
 * Validate the planner's dependency graph before any task is created.
 *
 * Returns human-readable errors. An empty array means the graph is valid.
 * The checks are deliberately independent of the task board so they can be
 * unit-tested without Electron.
 */
export function validateTaskGraph(planned: PlannedDependency[]): string[] {
  const errors: string[] = []
  const byId = new Map<string, PlannedDependency>()

  for (const task of planned) {
    const id = task.id.trim()
    if (!id) {
      errors.push('A planned task has an empty id.')
      continue
    }
    if (byId.has(id)) {
      errors.push(`Duplicate task id "${id}".`)
      continue
    }
    byId.set(id, task)
  }

  for (const task of planned) {
    const id = task.id.trim()
    for (const rawDep of task.dependsOn) {
      const dep = rawDep.trim()
      if (dep === id) {
        errors.push(`Task "${id}" depends on itself.`)
        continue
      }
      if (!byId.has(dep)) {
        errors.push(`Task "${id}" depends on unknown task "${dep}".`)
      }
    }
  }

  // Depth-first cycle detection; report the cycle path for a clear message.
  const state = new Map<string, 'visiting' | 'done'>()
  const stack: string[] = []

  const visit = (id: string): void => {
    const current = state.get(id)
    if (current === 'done') return
    if (current === 'visiting') {
      const start = stack.indexOf(id)
      const cycle = [...stack.slice(start), id].join(' -> ')
      errors.push(`Circular dependency: ${cycle}.`)
      return
    }
    state.set(id, 'visiting')
    stack.push(id)
    const task = byId.get(id)
    for (const rawDep of task?.dependsOn ?? []) {
      const dep = rawDep.trim()
      if (byId.has(dep)) visit(dep)
    }
    stack.pop()
    state.set(id, 'done')
  }

  for (const id of byId.keys()) visit(id)

  return [...new Set(errors)]
}

/** Result of executing the verification commands for a run. */
export interface VerificationSummary {
  /** Number of commands that were actually executed. */
  ran: number
  /** Number of executed commands that exited non-zero. */
  failed: number
}

/**
 * Compute the honest final state of a run.
 *
 * A run is only `done` when every task completed and at least one check ran
 * and passed. Work that finished without any executable check is
 * `unverified`, never a verified success.
 */
export function computeRunStatus(input: {
  aborted: boolean
  tasks: Array<{ status: TaskStatus }>
  verification: VerificationSummary
}): RunStatus {
  if (input.aborted) return 'aborted'
  if (input.tasks.length === 0) return 'failed'

  const unfinished = input.tasks.some(
    (task) => task.status === 'FAILED' || task.status === 'BLOCKED'
  )
  if (unfinished) return 'failed'
  if (input.tasks.some((task) => task.status !== 'DONE')) return 'failed'
  if (input.verification.failed > 0) return 'failed'
  if (input.verification.ran === 0) return 'unverified'
  return 'done'
}
