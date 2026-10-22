import type {
  EngineEvent,
  FilePatch,
  ReviewItem,
  ReviewVerdict,
  Role,
  TaskStatus
} from '@shared/types'

/**
 * The renderer is a pure function of the event log.
 *
 * Everything the UI shows is derived by folding the ordered stream of engine
 * events into this state object. Nothing is fetched from the engine except
 * the log itself, which keeps the UI reproducible and easy to reason about.
 */

/** A task as reconstructed from the event log. */
export interface UiTask {
  id: string
  title: string
  description: string
  role: Role
  status: TaskStatus
  iteration: number
  model?: string
  patches: FilePatch[]
  reviewItems: ReviewItem[]
  verdict?: ReviewVerdict
  error?: string
}

/** A message between two agents (or an agent and the user). */
export interface UiMessage {
  id: string
  ts: number
  from: Role
  to: Role | 'user'
  body: string
  taskId?: string
  /** True when the message is addressed to the human operator. */
  toUser: boolean
}

/** An approval the engine is waiting on. */
export interface UiApproval {
  id: string
  kind: 'write' | 'command'
  detail: string
  ts: number
  runId?: string
  payload: unknown
}

/** A decision the engine is waiting on. */
export interface UiDecision {
  id: string
  question: string
  options: string[]
  detail?: string
  ts: number
  runId?: string
  taskId?: string
}

/** A command the runner executed. */
export interface UiCommand {
  taskId: string
  command: string
  cwd: string
  exitCode?: number
  stdout?: string
  stderr?: string
  durationMs?: number
  /** True while the command is still running. */
  pending: boolean
}

export interface UiUsage {
  promptTokens: number
  completionTokens: number
  requests: number
}

export interface EngineState {
  /** The id of the run currently in progress, if any. */
  runId: string | null
  goal: string
  /** 'idle' before the first run, then the status of the last run. */
  status: 'idle' | 'running' | 'done' | 'aborted' | 'failed'
  tasks: UiTask[]
  messages: UiMessage[]
  approvals: UiApproval[]
  decisions: UiDecision[]
  commands: UiCommand[]
  usage: UiUsage
  /** Streaming model output, keyed by role. */
  streams: Partial<Record<Role, string>>
  /** Non-fatal errors reported by the engine. */
  errors: { ts: number; scope: string; message: string }[]
  /** Role model switches (primary unavailable, fallback used). */
  switches: { ts: number; role: Role; from: string; to: string; reason: string }[]
}

export const initialEngineState: EngineState = {
  runId: null,
  goal: '',
  status: 'idle',
  tasks: [],
  messages: [],
  approvals: [],
  decisions: [],
  commands: [],
  usage: { promptTokens: 0, completionTokens: 0, requests: 0 },
  streams: {},
  errors: [],
  switches: []
}

/** Find a task by id, or undefined. */
function findTask(tasks: UiTask[], id: string): UiTask | undefined {
  return tasks.find((t) => t.id === id)
}

/**
 * Fold one event into the state.
 *
 * The reducer is pure: it never mutates the state it is given.
 */
export function reduceEngine(state: EngineState, event: EngineEvent): EngineState {
  switch (event.type) {
    case 'RUN_STARTED':
      return {
        ...state,
        runId: event.runId,
        goal: event.goal,
        status: 'running',
        tasks: [],
        messages: [],
        approvals: [],
        decisions: [],
        commands: [],
        usage: { promptTokens: 0, completionTokens: 0, requests: 0 },
        streams: {},
        errors: [],
        switches: []
      }

    case 'RUN_FINISHED':
      return { ...state, status: event.status, streams: {} }

    case 'RUN_ABORTED':
      return { ...state, status: 'aborted', streams: {} }

    case 'TASK_CREATED': {
      const task: UiTask = {
        id: event.taskId,
        title: event.title,
        description: event.description,
        role: event.role,
        status: 'PENDING',
        iteration: 0,
        patches: [],
        reviewItems: []
      }
      return { ...state, tasks: [...state.tasks, task] }
    }

    case 'TASK_ASSIGNED': {
      if (!findTask(state.tasks, event.taskId)) return state
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === event.taskId
            ? { ...t, model: event.model, iteration: t.iteration + 1, status: 'IN_PROGRESS' }
            : t
        )
      }
    }

    case 'MESSAGE':
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            id: `${event.ts}-${event.from}-${state.messages.length}`,
            ts: event.ts,
            from: event.from,
            to: event.to,
            body: event.body,
            taskId: event.taskId,
            toUser: event.to === 'user'
          }
        ]
      }

    case 'FILE_PATCH': {
      if (!findTask(state.tasks, event.taskId)) return state
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === event.taskId ? { ...t, patches: [...t.patches, event.patch] } : t
        )
      }
    }

    case 'REVIEW_RESULT': {
      if (!findTask(state.tasks, event.taskId)) return state
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === event.taskId
            ? {
                ...t,
                verdict: event.verdict,
                reviewItems: event.items,
                status:
                  event.verdict === 'APPROVED'
                    ? 'DONE'
                    : event.verdict === 'BLOCKED'
                      ? 'BLOCKED'
                      : 'CHANGES_REQUESTED'
              }
            : t
        )
      }
    }

    case 'COMMAND_REQUEST':
      return {
        ...state,
        commands: [
          ...state.commands,
          {
            taskId: event.taskId,
            command: event.command,
            cwd: event.cwd,
            pending: true
          }
        ]
      }

    case 'COMMAND_RESULT':
      return {
        ...state,
        commands: state.commands.map((c, index) => {
          // Match the most recent pending command with the same text.
          const isMatch =
            c.pending &&
            c.command === event.command &&
            index ===
              state.commands.findLastIndex((x) => x.pending && x.command === event.command)
          if (!isMatch) return c
          return {
            ...c,
            pending: false,
            exitCode: event.exitCode,
            stdout: event.stdout,
            stderr: event.stderr,
            durationMs: event.durationMs
          }
        })
      }

    case 'APPROVAL_REQUIRED':
      return {
        ...state,
        approvals: [
          ...state.approvals,
          {
            id: event.id,
            kind: event.kind,
            detail: event.detail,
            ts: event.ts,
            runId: event.runId,
            payload: event.payload
          }
        ]
      }

    case 'NEEDS_DECISION':
      return {
        ...state,
        decisions: [
          ...state.decisions,
          {
            id: event.id,
            question: event.question,
            options: event.options,
            detail: event.detail,
            ts: event.ts,
            runId: event.runId,
            taskId: event.taskId
          }
        ]
      }

    case 'DECISION_MADE':
      return {
        ...state,
        decisions: state.decisions.filter((d) => d.id !== event.id)
      }

    case 'USAGE':
      return {
        ...state,
        usage: {
          promptTokens: state.usage.promptTokens + event.promptTokens,
          completionTokens: state.usage.completionTokens + event.completionTokens,
          requests: state.usage.requests + 1
        }
      }

    case 'AGENT_DELTA':
      return {
        ...state,
        streams: {
          ...state.streams,
          [event.role]: (state.streams[event.role] ?? '') + event.text
        }
      }

    case 'MODEL_SWITCHED':
      return {
        ...state,
        switches: [
          ...state.switches,
          {
            ts: event.ts,
            role: event.role,
            from: event.from,
            to: event.to,
            reason: event.reason
          }
        ]
      }

    case 'ERROR': {
      const message = event.message
      const scope = event.scope
      // An error that names a task marks that task as failed.
      const taskId = scope.startsWith('task:')
        ? scope.slice('task:'.length)
        : scope.includes(':')
          ? scope.split(':')[1]
          : null

      const withTaskError =
        taskId && findTask(state.tasks, taskId)
          ? {
              ...state,
              tasks: state.tasks.map((t) =>
                t.id === taskId ? { ...t, status: 'FAILED' as TaskStatus, error: message } : t
              )
            }
          : state

      return {
        ...withTaskError,
        errors: [...withTaskError.errors, { ts: event.ts, scope, message }]
      }
    }

    default:
      return state
  }
}

/** Fold a whole log of events into the final state. */
export function reduceEngineLog(events: EngineEvent[]): EngineState {
  return events.reduce(reduceEngine, initialEngineState)
}

/** Count of tasks per status, for the board summary. */
export function countByStatus(tasks: UiTask[]): Record<TaskStatus, number> {
  const counts: Record<TaskStatus, number> = {
    PENDING: 0,
    ASSIGNED: 0,
    IN_PROGRESS: 0,
    IN_REVIEW: 0,
    CHANGES_REQUESTED: 0,
    DONE: 0,
    BLOCKED: 0,
    FAILED: 0
  }
  for (const task of tasks) counts[task.status]++
  return counts
}

/** Total number of lines added and removed across every patch. */
export function patchTotals(tasks: UiTask[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const task of tasks) {
    for (const patch of task.patches) {
      added += patch.added
      removed += patch.removed
    }
  }
  return { added, removed }
}

