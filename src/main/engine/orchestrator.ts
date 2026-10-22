import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { AppConfig, Role } from '@shared/types'
import { ROLES } from '@shared/types'
import { bus } from './bus'
import type { Budget } from './budget'
import type { TaskBoard } from './taskboard'
import type { Sandbox } from './sandbox'
import type { ApprovalGate } from './approvals'
import type { DecisionGate } from './decision'
import type { Store } from './store'
import { Agent } from './agents'
import { parsePlan, parseCommands } from './protocol'
import { mergeCommands, filterPlatformCompatible } from './commands'
import { TaskCycle, type TaskState } from './taskCycle'
import { buildRunReport } from './report'
import { truncateFileContent } from '../openrouter/context'
import { OpenRouterClient, redactSecrets } from '../openrouter/client'
import type { RoleAssignment } from '../openrouter/assignment'

export interface OrchestratorDeps {
  client: OpenRouterClient
  budget: Budget
  sandbox: Sandbox
  board: TaskBoard
  approvals: ApprovalGate
  decisions: DecisionGate
  store: Store
  getConfig: () => AppConfig
  getAssignments: () => Record<Role, RoleAssignment>
}

/**
 * The multi-agent loop.
 *
 * Orchestrator plans -> implementers write in parallel -> reviewers critique
 * -> implementers fix -> runner verifies -> orchestrator merges and reports.
 *
 * Every step degrades gracefully: a failing agent produces an ERROR event and
 * the affected task is marked FAILED or BLOCKED, but the run always finishes
 * and always writes a RUN_REPORT.md.
 */
export class Orchestrator {
  private running = false
  private aborted = false
  private currentRunId: string | null = null

  constructor(private readonly deps: OrchestratorDeps) {}

  get isRunning(): boolean {
    return this.running
  }

  get runId(): string | null {
    return this.currentRunId
  }

  /** Ask the running run to stop; it finishes the current step first. */
  stop(): void {
    if (!this.running) return
    this.aborted = true
    if (this.currentRunId) {
      bus.emitEvent({
        type: 'RUN_ABORTED',
        ts: Date.now(),
        runId: this.currentRunId,
        reason: 'Stopped by user.'
      })
    }
  }

  /**
   * Start a new run for the given goal.
   *
   * Returns the run id immediately so the UI can start rendering events;
   * the actual work happens in the background and always finishes with a
   * RUN_REPORT.md.
   */
  start(goal: string): string {
    if (this.running) throw new Error('A run is already in progress.')

    const runId = randomUUID()
    this.running = true
    this.aborted = false
    this.currentRunId = runId
    this.deps.budget.reset()

    const startedAt = Date.now()
    const notes: string[] = []

    bus.emitEvent({ type: 'RUN_STARTED', ts: startedAt, runId, goal })

    // Fire and forget: the run reports its own progress through the bus.
    void this.execute(runId, goal, startedAt, notes).catch((err: unknown) => {
      const message = redactSecrets(err instanceof Error ? err.message : String(err))
      bus.emitEvent({ type: 'ERROR', ts: Date.now(), runId, scope: 'orchestrator', message })
    })

    return runId
  }

  /** Run the plan -> implement -> review -> verify -> merge pipeline. */
  private async execute(
    runId: string,
    goal: string,
    startedAt: number,
    notes: string[]
  ): Promise<void> {
    let status: 'done' | 'aborted' | 'failed' = 'done'
    try {
      // ---- 1. Plan ---------------------------------------------------------
      const planned = await this.createPlan(runId, goal)

      if (planned.length === 0) {
        bus.emitEvent({
          type: 'ERROR',
          ts: Date.now(),
          runId,
          scope: 'orchestrator',
          message: 'The planner produced no usable tasks; there is nothing to run.'
        })
        notes.push('The planner produced no usable tasks.')
      } else {
        // ---- 2. Materialise the task board -------------------------------
        const states = this.createTasks(runId, planned)

        // ---- 3. Execute in parallel batches --------------------------------
        await this.executeTasks(runId, states, notes)

        // ---- 4. Verify with the Runner ------------------------------------
        await this.runVerification(runId, states, notes)

        // ---- 5. Merge and summarise ---------------------------------------
        await this.mergeResults(runId, goal, states, notes)
      }

      if (this.aborted) status = 'aborted'
    } catch (err) {
      status = this.aborted ? 'aborted' : 'failed'
      const message = redactSecrets(err instanceof Error ? err.message : String(err))
      bus.emitEvent({ type: 'ERROR', ts: Date.now(), runId, scope: 'orchestrator', message })
      notes.push(message)
    } finally {
      await this.finish(runId, goal, startedAt, status, notes)
      this.running = false
      this.currentRunId = null
    }
  }

  // ---------------------------------------------------------------- plan ---

  /** Ask the Orchestrator model to decompose the goal into a task list. */
  private async createPlan(
    runId: string,
    goal: string
  ): Promise<ReturnType<typeof parsePlan>['tasks']> {
    const orchestrator = new Agent('orchestrator', {
      client: this.deps.client,
      budget: this.deps.budget,
      bus,
      resolveModel: (role) => this.deps.getAssignments()[role].chain
    })

    const files = await this.deps.sandbox.listFiles(60)
    const fileList = files.length > 0 ? files.join('\n') : '(the workspace is empty)'

    const response = await orchestrator.send({
      role: 'orchestrator',
      runId,
      content: goal,
      scratchpad: `Existing files in the workspace:\n${fileList}\n\nBreak this goal into independent, concrete tasks.`,
      temperature: 0.2
    })

    const parsed = parsePlan(response.content)
    bus.emitEvent({
      type: 'MESSAGE',
      ts: Date.now(),
      runId,
      from: 'orchestrator',
      to: 'user',
      body: parsed.summary || `Plan ready: ${parsed.tasks.length} task(s).`
    })
    return parsed.tasks
  }

  /** Create the task records and emit the TASK_CREATED events. */
  private createTasks(
    runId: string,
    planned: ReturnType<typeof parsePlan>['tasks']
  ): TaskState[] {
    // The plan refers to its own tasks by id ("t1", "t2"), while the board
    // assigns its own ids. The dependency graph is rewritten so the board
    // actually enforces the order the planner asked for.
    const planIdToBoardId = new Map<string, string>()
    const created: TaskState[] = []

    for (const p of planned) {
      const task = this.deps.board.create({
        runId,
        title: p.title,
        description: p.description,
        role: p.role,
        dependsOn: []
      })
      planIdToBoardId.set(p.id, task.id)
      bus.emitEvent({
        type: 'TASK_CREATED',
        ts: Date.now(),
        runId,
        taskId: task.id,
        title: task.title,
        description: task.description,
        role: task.role
      })
      created.push({
        task,
        reviewItems: [],
        disagreements: 0,
        approved: false,
        commands: []
      })
    }

    planned.forEach((p, index) => {
      const task = created[index].task
      const deps = p.dependsOn
        .map((dep) => planIdToBoardId.get(dep))
        .filter((dep): dep is string => Boolean(dep) && dep !== task.id)
      task.dependsOn = deps
      task.updatedAt = Date.now()
    })

    return created
  }

  // ------------------------------------------------------------ execution ---

  /**
   * Execute every task.
   *
   * Independent tasks run in parallel (Promise.all) up to maxParallelTasks;
   * tasks that depend on others run in a later wave.
   */
  private async executeTasks(
    runId: string,
    states: TaskState[],
    notes: string[]
  ): Promise<void> {
    const config = this.deps.getConfig()
    const maxParallel = Math.max(1, config.maxParallelTasks)
    const cycle = new TaskCycle(this.deps, runId, () => this.aborted)
    const pending = [...states]
    let guard = 0

    while (pending.length > 0) {
      if (++guard > 50) break
      if (this.aborted) break

      // A wave is the set of tasks whose dependencies are already satisfied.
      const doneIds = new Set(
        states.filter((s) => s.task.status === 'DONE').map((s) => s.task.id)
      )
      const wave = pending.filter((s) =>
        s.task.dependsOn.every((dep) => doneIds.has(dep))
      )
      const batch = wave.length > 0 ? wave : pending.slice(0, maxParallel)

      for (let i = 0; i < batch.length; i += maxParallel) {
        const chunk = batch.slice(i, i + maxParallel)
        if (this.aborted) break

        await Promise.all(
          chunk.map(async (state) => {
            try {
              await cycle.run(state)
            } catch (err) {
              const message = redactSecrets(
                err instanceof Error ? err.message : String(err)
              )
              bus.emitEvent({
                type: 'ERROR',
                ts: Date.now(),
                runId,
                scope: `task:${state.task.id}`,
                message
              })
              try {
                this.deps.board.transition(state.task.id, 'FAILED')
                state.task.error = message
              } catch {
                // the task may already be in a terminal state
              }
            }
          })
        )
      }

      for (const state of batch) {
        const index = pending.indexOf(state)
        if (index >= 0) pending.splice(index, 1)
      }
    }

    const failed = states.filter((s) => s.task.status === 'FAILED')
    for (const state of failed) {
      notes.push(`Task "${state.task.title}" failed: ${state.task.error ?? 'unknown error'}`)
    }
  }

  // --------------------------------------------------------- verification ---

  /** Let the Runner execute the proposed test/build commands. */
  private async runVerification(
    runId: string,
    states: TaskState[],
    notes: string[]
  ): Promise<void> {
    const withCommands = states.filter((s) => s.commands.length > 0)
    if (withCommands.length === 0) {
      notes.push('No test commands were proposed, so the runner had nothing to execute.')
      return
    }

    const runner = new Agent('runner', {
      client: this.deps.client,
      budget: this.deps.budget,
      bus,
      resolveModel: (role) => this.deps.getAssignments()[role].chain
    })

    for (const state of withCommands) {
      if (this.aborted) return

      const response = await runner.send({
        role: 'runner',
        runId,
        taskId: state.task.id,
        content: `Verify the work for "${state.task.title}". The implementer proposed these commands: ${state.commands.join(
          ', '
        )}.`,
        scratchpad: 'Choose the commands to run and report pass/fail.',
        temperature: 0.1
      })

      const suggested = parseCommands(response.content)
      // The implementer's own commands are the primary source; the runner may
      // add to them, but it must not replace them with something unrelated.
      const merged = mergeCommands(state.commands, suggested)
      const { compatible, skipped } = filterPlatformCompatible(merged)

      for (const command of skipped) {
        notes.push(
          `Skipped the command "${command}" because it does not run on this platform.`
        )
      }

      for (const command of compatible) {
        if (this.aborted) return

        bus.emitEvent({
          type: 'COMMAND_REQUEST',
          ts: Date.now(),
          runId,
          taskId: state.task.id,
          from: 'runner',
          command,
          cwd: this.deps.sandbox.rootPath
        })

        const decision = await this.deps.approvals.request(
          'command',
          `Run command in ${this.deps.sandbox.rootPath}:\n${command}`,
          {
            command,
            cwd: this.deps.sandbox.rootPath,
            workspaceRoot: this.deps.sandbox.rootPath
          },
          runId
        )

        if (!decision.allowed) {
          bus.emitEvent({
            type: 'COMMAND_RESULT',
            ts: Date.now(),
            runId,
            taskId: state.task.id,
            command,
            exitCode: 126,
            stdout: '',
            stderr: 'Denied by the user.',
            durationMs: 0
          })
          continue
        }

        const result = await this.deps.sandbox.runCommand(command)

        bus.emitEvent({
          type: 'COMMAND_RESULT',
          ts: Date.now(),
          runId,
          taskId: state.task.id,
          command,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          durationMs: result.durationMs
        })

        if (result.exitCode !== 0) {
          notes.push(
            `Command "${command}" failed with exit code ${result.exitCode} for "${state.task.title}".`
          )
          // A failing check becomes a new task for the Implementer.
          const failure = this.deps.board.create({
            runId,
            title: `Fix failing check: ${state.task.title}`,
            description: `The command "${command}" failed with exit code ${result.exitCode}.\n\nstdout:\n${truncateFileContent(
              result.stdout,
              4000
            )}\n\nstderr:\n${truncateFileContent(result.stderr, 4000)}`,
            role: 'implementer'
          })
          bus.emitEvent({
            type: 'TASK_CREATED',
            ts: Date.now(),
            runId,
            taskId: failure.id,
            title: failure.title,
            description: failure.description,
            role: 'implementer'
          })
        }
      }
    }
  }

  // --------------------------------------------------------------- merge ----

  /** Ask the Orchestrator for a final summary of the run. */
  private async mergeResults(
    runId: string,
    goal: string,
    states: TaskState[],
    notes: string[]
  ): Promise<void> {
    const done = states.filter((s) => s.task.status === 'DONE')
    const files = [...new Set(states.flatMap((s) => s.task.patches.map((p) => p.path)))]

    let summary = `${done.length} of ${states.length} task(s) completed.`
    try {
      const orchestrator = new Agent('orchestrator', {
        client: this.deps.client,
        budget: this.deps.budget,
        bus,
        resolveModel: (role) => this.deps.getAssignments()[role].chain
      })
      const response = await orchestrator.send({
        role: 'orchestrator',
        runId,
        content: `Goal: ${goal}\n\nCompleted tasks: ${
          done.map((s) => s.task.title).join(', ') || 'none'
        }\n\nFiles changed: ${files.join(', ') || 'none'}\n\nOutstanding notes:\n${
          notes.join('\n') || 'none'
        }\n\nWrite a short final summary (2-4 sentences) of what was built and what remains.`,
        temperature: 0.3
      })
      summary = response.content.trim() || summary
    } catch {
      // Keep the deterministic summary when the model is unavailable.
    }

    bus.emitEvent({
      type: 'MESSAGE',
      ts: Date.now(),
      runId,
      from: 'orchestrator',
      to: 'user',
      body: summary
    })
  }

  // -------------------------------------------------------------- finish ----

  /** Persist the run and always leave a RUN_REPORT.md in the workspace. */
  private async finish(
    runId: string,
    goal: string,
    startedAt: number,
    status: 'done' | 'aborted' | 'failed',
    notes: string[]
  ): Promise<void> {
    const endedAt = Date.now()
    const tasks = this.deps.board.list(runId)
    const assignments = this.deps.getAssignments()

    const models: Record<string, string> = {}
    for (const role of ROLES) {
      models[role] = assignments[role].primary ?? 'unassigned'
    }

    const report = buildRunReport({
      runId,
      goal,
      status,
      startedAt,
      endedAt,
      tasks,
      usage: this.deps.budget.snapshot(),
      perModel: this.deps.budget.perModelTotals(),
      models,
      notes
    })

    const reportPath = path.join(this.deps.sandbox.rootPath, 'RUN_REPORT.md')
    try {
      await fs.writeFile(reportPath, report, 'utf8')
    } catch (err) {
      bus.emitEvent({
        type: 'ERROR',
        ts: Date.now(),
        runId,
        scope: 'report',
        message: redactSecrets(err instanceof Error ? err.message : String(err))
      })
    }

    this.deps.store.saveRun({
      runId,
      goal,
      status,
      startedAt,
      endedAt,
      tasks: tasks.length,
      reportPath
    })
    for (const task of tasks) this.deps.store.saveTask(task)

    bus.emitEvent({
      type: 'RUN_FINISHED',
      ts: endedAt,
      runId,
      status,
      summary: notes.length > 0 ? notes.join(' ') : 'Run finished.'
    })
  }
}
