import type { AppConfig, Role, Task } from '@shared/types'
import { bus } from './bus'
import type { Budget } from './budget'
import type { TaskBoard } from './taskboard'
import type { Sandbox } from './sandbox'
import { SandboxError } from './sandbox'
import type { ApprovalGate } from './approvals'
import type { DecisionGate } from './decision'
import { Agent } from './agents'
import { parseProposedFiles, parseCommands } from './protocol'
import { buildWorkspaceContext } from './workspaceContext'
import { parseReview } from './roles'
import { computeDiff } from './diff'
import { truncateFileContent } from '../openrouter/context'
import type { OpenRouterClient } from '../openrouter/client'
import type { RoleAssignment } from '../openrouter/assignment'

export interface TaskCycleDeps {
  client: OpenRouterClient
  budget: Budget
  sandbox: Sandbox
  board: TaskBoard
  approvals: ApprovalGate
  decisions: DecisionGate
  getConfig: () => AppConfig
  getAssignments: () => Record<Role, RoleAssignment>
}

/** Per-task working state that survives across iterations. */
export interface TaskState {
  task: Task
  /** Review items the Implementer must address on the next pass. */
  reviewItems: string[]
  /** Disagreement counter used for escalation. */
  disagreements: number
  /** True once the reviewer approved the current state. */
  approved: boolean
  /** Commands proposed for verification. */
  commands: string[]
}

/**
 * The implement -> review -> fix cycle for a single task.
 *
 * Kept in its own module so the orchestrator stays a thin run lifecycle.
 */
export class TaskCycle {
  constructor(
    private readonly deps: TaskCycleDeps,
    private readonly runId: string,
    private readonly isAborted: () => boolean
  ) {}

  /**
   * Run one task to completion (or to the iteration cap).
   */
  async run(state: TaskState): Promise<TaskState> {
    const config = this.deps.getConfig()
    const assignments = this.deps.getAssignments()
    const maxIterations = Math.max(1, config.iterationsPerTask)
    const { task } = state

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      if (this.isAborted()) return state

      const implemented = await this.implement(state, assignments)
      if (implemented !== 'ok') return state

      const reviewed = await this.review(state, assignments)
      if (reviewed === 'approved') {
        state.approved = true
        state.reviewItems = []
        this.transition(task.id, 'DONE')
        return state
      }
      if (reviewed === 'blocked') {
        await this.escalate(state, [])
        return state
      }

      // CHANGES_REQUESTED -> hand the items back to the implementer.
      this.transition(task.id, 'CHANGES_REQUESTED')

      if (state.disagreements >= 2 && iteration < maxIterations - 1) {
        const outcome = await this.escalate(state, [])
        if (outcome === 'stop') return state
      }
    }

    if (!state.approved) {
      this.transition(task.id, 'BLOCKED')
      task.error = `Reached the ${maxIterations}-iteration cap without approval.`
    }
    return state
  }

  /**
   * The snapshot of the workspace that the implementer works from.
   *
   * The implementer has no tools, so this is its only view of the project.
   */
  private async workspaceContext(task: Task): Promise<string> {
    try {
      // Files written earlier in this run come first: the implementer has to
      // build on top of them.
      const written = this.deps.board
        .list(this.runId)
        .flatMap((t) => t.patches.map((p) => p.path))

      return await buildWorkspaceContext(this.deps.sandbox, {
        taskText: `${task.title} ${task.description}`,
        include: written
      })
    } catch {
      return 'Workspace files: (the listing could not be read)'
    }
  }

  /** The Implementer proposes files; they are approved and written. */
  private async implement(
    state: TaskState,
    assignments: Record<Role, RoleAssignment>
  ): Promise<'ok' | 'denied' | 'blocked' | 'failed'> {
    const { task } = state
    this.transition(task.id, 'IN_PROGRESS')
    this.deps.board.update(task.id, { iteration: task.iteration + 1 })

    bus.emitEvent({
      type: 'TASK_ASSIGNED',
      ts: Date.now(),
      runId: this.runId,
      taskId: task.id,
      role: 'implementer',
      model: assignments.implementer.primary ?? 'unassigned'
    })

    const implementer = new Agent('implementer', {
      client: this.deps.client,
      budget: this.deps.budget,
      bus,
      resolveModel: (role) => assignments[role].chain
    })

    const brief = [
      `Task: ${task.title}`,
      task.description,
      ...(state.reviewItems.length
        ? [
            '',
            'A previous review requested these changes - address every one:',
            ...state.reviewItems.map((r, i) => `${i + 1}. ${r}`)
          ]
        : [])
    ].join('\n')

    const context = await this.workspaceContext(task)

    const scratchpad = [
      brief,
      '',
      'You have no tools. The workspace snapshot below is your only view of the',
      'project - work with the files that are shown to you.',
      '',
      context,
      '',
      'Answer with the JSON object only, including at least one file with its',
      'complete content.'
    ].join('\n')

    const response = await implementer.send({
      role: 'implementer',
      runId: this.runId,
      taskId: task.id,
      content: task.description,
      scratchpad,
      temperature: 0.2
    })

    let proposed = parseProposedFiles(response.content)
    let commands = parseCommands(response.content)

    if (proposed.length === 0) {
      // The model usually just needs to be told that writing the files is its
      // own job. One corrective retry is cheap; giving up is not.
      const retry = await implementer.send({
        role: 'implementer',
        runId: this.runId,
        taskId: task.id,
        content: task.description,
        scratchpad: [
          brief,
          '',
          'Your previous answer was not usable:',
          response.content.slice(0, 1500),
          '',
          'It contained no files. You do not need any tool and you do not need',
          'access to the workspace: you write the files yourself, in full, in the',
          '"files" array of your JSON answer.',
          '',
          context,
          '',
          'Answer with the JSON object only.'
        ].join('\n'),
        temperature: 0.1
      })

      proposed = parseProposedFiles(retry.content)
      const retryCommands = parseCommands(retry.content)
      if (retryCommands.length > 0) commands = retryCommands
    }

    if (commands.length > 0) state.commands = commands

    if (proposed.length === 0) {
      bus.emitEvent({
        type: 'MESSAGE',
        ts: Date.now(),
        runId: this.runId,
        from: 'implementer',
        to: 'orchestrator',
        body: response.content.slice(0, 2000),
        taskId: task.id
      })
      bus.emitEvent({
        type: 'ERROR',
        ts: Date.now(),
        runId: this.runId,
        scope: `implementer:${task.id}`,
        message: 'The implementer returned no file changes for this task.'
      })
      this.transition(task.id, 'FAILED')
      task.error = 'No file changes were produced.'
      return 'failed'
    }
    const written = await this.writeFiles(task.id, proposed)
    if (written !== 'written') {
      this.transition(task.id, 'BLOCKED')
      task.error =
        written === 'denied'
          ? 'The file writes were denied.'
          : 'A write target was outside the workspace sandbox.'
      if (written === 'denied') {
        bus.emitEvent({
          type: 'MESSAGE',
          ts: Date.now(),
          runId: this.runId,
          from: 'implementer',
          to: 'user',
          body: 'The proposed file writes were denied, so this task was not applied.',
          taskId: task.id
        })
      }
      return written
    }
    return 'ok'
  }
  /** The Reviewer critiques the diff and returns a verdict. */
  private async review(
    state: TaskState,
    assignments: Record<Role, RoleAssignment>
  ): Promise<'approved' | 'changes' | 'blocked'> {
    const { task } = state
    this.transition(task.id, 'IN_REVIEW')

    const diffText = task.patches.map((p) => p.diff).join('\n')
    const reviewer = new Agent('reviewer', {
      client: this.deps.client,
      budget: this.deps.budget,
      bus,
      resolveModel: (role) => assignments[role].chain
    })

    // The visible agent-to-agent handshake.
    bus.emitEvent({
      type: 'MESSAGE',
      ts: Date.now(),
      runId: this.runId,
      from: 'implementer',
      to: 'reviewer',
      body: `Please review my changes for "${task.title}". I touched ${task.patches.length} file(s): ${task.patches
        .map((p) => p.path)
        .join(', ')}.`,
      taskId: task.id
    })
    bus.emitEvent({
      type: 'REVIEW_REQUEST',
      ts: Date.now(),
      runId: this.runId,
      taskId: task.id,
      from: 'implementer',
      to: 'reviewer'
    })
    bus.emitEvent({
      type: 'HANDOFF',
      ts: Date.now(),
      runId: this.runId,
      from: 'implementer',
      taskId: task.id,
      to: 'reviewer',
      contextSummary: truncateFileContent(diffText, 8000)
    })

    const response = await reviewer.send({
      role: 'reviewer',
      runId: this.runId,
      taskId: task.id,
      content: `Task: ${task.title}\n${task.description}\n\nDiff under review:\n${truncateFileContent(
        diffText,
        12000
      )}`,
      scratchpad: 'Return your verdict as JSON.',
      temperature: 0.2
    })

    const parsed = parseReview(response.content)
    bus.emitEvent({
      type: 'REVIEW_RESULT',
      ts: Date.now(),
      runId: this.runId,
      taskId: task.id,
      from: 'reviewer',
      verdict: parsed.verdict,
      items: parsed.items
    })

    this.deps.board.update(task.id, {
      verdict: parsed.verdict,
      reviewItems: parsed.items
    })

    if (parsed.verdict === 'APPROVED') {
      bus.emitEvent({
        type: 'MESSAGE',
        ts: Date.now(),
        runId: this.runId,
        from: 'reviewer',
        to: 'orchestrator',
        body: `Approved: ${task.title}.`,
        taskId: task.id
      })
      return 'approved'
    }

    if (parsed.verdict === 'BLOCKED') {
      bus.emitEvent({
        type: 'MESSAGE',
        ts: Date.now(),
        runId: this.runId,
        from: 'reviewer',
        to: 'orchestrator',
        body: `Blocked: ${task.title}. ${parsed.items.map((i) => i.detail).join(' ')}`.trim(),
        taskId: task.id
      })
      task.error = parsed.items[0]?.detail ?? 'The reviewer blocked this task.'
      return 'blocked'
    }

    state.disagreements += 1
    state.reviewItems = parsed.items.map(
      (i) => `[${i.severity}] ${i.title}${i.file ? ` (${i.file})` : ''}: ${i.detail}`
    )

    bus.emitEvent({
      type: 'MESSAGE',
      ts: Date.now(),
      runId: this.runId,
      from: 'reviewer',
      to: 'implementer',
      body: `Changes requested on "${task.title}":\n${state.reviewItems
        .map((r) => `- ${r}`)
        .join('\n')}`,
      taskId: task.id
    })
    return 'changes'
  }

  /**
   * Break a tie between two agents. The orchestrator tries first; when it
   * cannot decide, the user is asked through a "Needs decision" card.
   */
  private async escalate(state: TaskState, notes: string[]): Promise<'continue' | 'stop'> {
    const { task } = state
    const reviewerPosition = state.reviewItems.join('\n') || 'no details given'
    const implementerPosition = `The implementer produced ${task.patches.length} file change(s) for "${task.title}".`

    const orchestrator = new Agent('orchestrator', {
      client: this.deps.client,
      budget: this.deps.budget,
      bus,
      resolveModel: (role) => this.deps.getAssignments()[role].chain
    })

    let tieBroken = false
    try {
      const response = await orchestrator.send({
        role: 'orchestrator',
        runId: this.runId,
        taskId: task.id,
        content: `Two agents disagree about "${task.title}".\n\nImplementer position:\n${implementerPosition}\n\nReviewer position:\n${reviewerPosition}\n\nAnswer with JSON: {"resolution":"implementer"|"reviewer"|"user","reason":"..."}`,
        temperature: 0.1
      })
      tieBroken =
        response.content.includes('"implementer"') || response.content.includes('"reviewer"')
    } catch {
      tieBroken = false
    }

    if (tieBroken) {
      bus.emitEvent({
        type: 'MESSAGE',
        ts: Date.now(),
        runId: this.runId,
        from: 'orchestrator',
        to: 'implementer',
        body: `I broke the tie on "${task.title}" - continuing with the reviewer's items.`,
        taskId: task.id
      })
      return 'continue'
    }

    const choice = await this.deps.decisions.request({
      runId: this.runId,
      question: `The implementer and the reviewer disagree about "${task.title}". How should I proceed?`,
      options: [
        'Accept the reviewer changes and keep iterating',
        'Accept the implementer version as-is'
      ],
      taskId: task.id,
      detail: `Reviewer said:\n${reviewerPosition}\n\nImplementer produced ${task.patches.length} file change(s).`
    })

    if (choice.startsWith('Accept the implementer')) {
      state.approved = true
      this.transition(task.id, 'DONE')
      notes.push(`You accepted the implementer's version of "${task.title}".`)
      return 'stop'
    }

    state.reviewItems = [reviewerPosition]
    notes.push(`You asked for more changes to "${task.title}".`)
    return 'continue'
  }

  /**
   * Ask for approval, then write the proposed files into the sandbox.
   *
   * Returns 'written', 'denied' or 'blocked'.
   */
  private async writeFiles(
    taskId: string,
    proposed: Array<{ path: string; content: string }>
  ): Promise<'written' | 'denied' | 'blocked'> {
    const config = this.deps.getConfig()

    // Reject anything outside the sandbox before asking the user.
    for (const file of proposed) {
      try {
        await this.deps.sandbox.resolveInside(file.path)
      } catch (err) {
        const message =
          err instanceof SandboxError ? err.message : `Blocked write: ${file.path}`
        bus.emitEvent({
          type: 'ERROR',
          ts: Date.now(),
          runId: this.runId,
          scope: `sandbox:${taskId}`,
          message: `${message} (attempted path: ${file.path})`
        })
        bus.emitEvent({
          type: 'MESSAGE',
          ts: Date.now(),
          runId: this.runId,
          from: 'implementer',
          to: 'user',
          body: `Blocked: a write to "${file.path}" was outside the workspace sandbox (${this.deps.sandbox.rootPath}).`,
          taskId
        })
        return 'blocked'
      }
    }

    let decision = { allowed: config.autoApproveWrites, always: false }

    if (!config.autoApproveWrites) {
      const detail = `Write ${proposed.length} file(s):\n${proposed
        .map((f) => `  - ${f.path}`)
        .join('\n')}\n\nSandbox root: ${this.deps.sandbox.rootPath}`
      decision = await this.deps.approvals.request(
        'write',
        detail,
        {
          files: proposed.map((f) => ({ path: f.path, content: f.content })),
          workspaceRoot: this.deps.sandbox.rootPath
        },
        this.runId
      )
    }

    if (!decision.allowed) return 'denied'

    for (const file of proposed) {
      let before: string | null = null
      try {
        before = await this.deps.sandbox.readFile(file.path)
      } catch {
        before = null
      }

      const absolute = await this.deps.sandbox.writeFile(file.path, file.content)
      const diff = computeDiff(file.path, before, file.content)

      this.deps.board.appendPatch(taskId, {
        path: file.path,
        diff: diff.unified,
        added: diff.added,
        removed: diff.removed,
        absolutePath: absolute
      })

      bus.emitEvent({
        type: 'FILE_PATCH',
        ts: Date.now(),
        runId: this.runId,
        taskId,
        from: 'implementer',
        patch: {
          path: file.path,
          diff: diff.unified,
          added: diff.added,
          removed: diff.removed,
          absolutePath: absolute
        }
      })
    }

    return 'written'
  }

  /** Transition a task, ignoring invalid transitions. */
  private transition(taskId: string, status: Task['status']): void {
    try {
      this.deps.board.transition(taskId, status)
    } catch {
      // Already in a terminal state - nothing to do.
    }
  }
}
