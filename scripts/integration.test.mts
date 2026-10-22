/**
 * Temporary integration probe for the Phase 1 reliability fixes.
 * Drives the real Orchestrator against a scripted OpenRouter (fetch stubbed).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { bus } from '../src/main/engine/bus.ts'
import { Budget } from '../src/main/engine/budget.ts'
import { TaskBoard } from '../src/main/engine/taskboard.ts'
import { Sandbox } from '../src/main/engine/sandbox.ts'
import { ApprovalGate } from '../src/main/engine/approvals.ts'
import { DecisionGate } from '../src/main/engine/decision.ts'
import { Orchestrator } from '../src/main/engine/orchestrator.ts'
import { OpenRouterClient } from '../src/main/openrouter/client.ts'
import { catalog } from '../src/main/openrouter/catalog.ts'
import { buildAssignments } from '../src/main/openrouter/assignment.ts'
import { DEFAULT_CONFIG } from '../src/main/engine/config-defaults.ts'
import type { AppConfig, EngineEvent, RunStatus } from '../src/shared/types.ts'

type Scenario = 'repair-passes' | 'repair-fails' | 'unverified' | 'cycle'

const ids = {
  orchestrator: 'fake/orchestrator:free',
  implementer: 'fake/implementer:free',
  reviewer: 'fake/reviewer:free',
  runner: 'fake/runner:free'
}
const models = Object.values(ids).map((id) => ({ id, name: id, context_length: 8192 }))

let scenario: Scenario = 'repair-passes'
let repairCalls = 0

const sse = (content: string): Response =>
  new Response(
    `data: ${JSON.stringify({
      choices: [{ delta: { content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 }
    })}\n\ndata: [DONE]\n\n`,
    { status: 200 }
  )

const command = `node -e "process.exit(require('fs').existsSync('fixed.txt')?0:1)"`

globalThis.fetch = (async (url: unknown, init?: { body?: string }) => {
  if (String(url).includes('/models')) {
    return new Response(JSON.stringify({ data: models }), { status: 200 })
  }
  const body = JSON.parse(init?.body ?? '{}') as {
    messages: Array<{ role: string; content: string }>
  }
  const system = body.messages.find((m) => m.role === 'system')?.content ?? ''
  const last = [...body.messages].reverse().find((m) => m.role === 'user')?.content ?? ''

  if (system.includes('You are the Orchestrator')) {
    if (last.includes('Write a short final summary')) return sse('Done.')
    if (scenario === 'cycle') {
      return sse(
        JSON.stringify({
          plan: [
            { id: 't1', title: 'A', description: 'a', role: 'implementer', dependsOn: ['t2'] },
            { id: 't2', title: 'B', description: 'b', role: 'implementer', dependsOn: ['t1'] }
          ]
        })
      )
    }
    return sse(
      JSON.stringify({
        plan: [
          {
            id: 't1',
            title: 'Create hello.txt',
            description: 'Write a greeting file.',
            role: 'implementer',
            dependsOn: []
          }
        ]
      })
    )
  }

  if (system.includes('You are the Implementer')) {
    if (last.includes('failed with exit code')) {
      repairCalls++
      if (scenario === 'repair-fails') {
        return sse(JSON.stringify({ files: [{ path: 'unrelated.txt', content: 'x' }], commands: [] }))
      }
      return sse(JSON.stringify({ files: [{ path: 'fixed.txt', content: 'fixed' }], commands: [] }))
    }
    return sse(
      JSON.stringify({
        files: [{ path: 'hello.txt', content: 'hello world\n' }],
        commands: scenario === 'unverified' ? [] : [command]
      })
    )
  }

  if (system.includes('You are the Reviewer')) {
    return sse(JSON.stringify({ verdict: 'APPROVED', items: [] }))
  }
  if (system.includes('You are the Runner')) {
    return sse(JSON.stringify({ commands: [], summary: 'ok', expectations: 'pass' }))
  }
  return new Response('unexpected', { status: 400 })
}) as unknown as typeof fetch

const live = await catalog.refresh(true)


/** Run one scenario and return its observable outcome. */
async function runScenario(name: Scenario): Promise<{
  status: RunStatus
  taskStatuses: string[]
  report: string
  repairs: number
  tempFiles: string[]
}> {
  scenario = name
  repairCalls = 0
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `codex-${name}-`))
  const config: AppConfig = {
    ...structuredClone(DEFAULT_CONFIG),
    workspaceRoot: workspace,
    maxParallelTasks: 1,
    autoApproveWrites: false,
    maxRepairAttempts: 1
  }
  for (const role of Object.keys(ids) as Array<keyof typeof ids>) {
    config.roles[role] = { alias: role, preferred: [ids[role]], fallbacks: [] }
  }
  const assignments = buildAssignments(config, live)
  const board = new TaskBoard()
  const budget = new Budget(config.tokenBudget)
  const sandbox = new Sandbox(workspace)
  const approvals = new ApprovalGate(bus)
  const decisions = new DecisionGate(bus)
  const memory = { events: [] as EngineEvent[], runs: [] as unknown[] }
  const store = {
    init() {},
    persistEvent(event: EngineEvent) {
      memory.events.push(event)
    },
    saveTask() {},
    listTasks() {
      return []
    },
    listEvents() {
      return memory.events
    },
    saveRun(summary: unknown) {
      memory.runs.push(summary)
    },
    listRuns() {
      return memory.runs
    },
    close() {},
    backend: 'json' as const
  }

  const resolveApproval = (event: EngineEvent): void => {
    if (event.type === 'APPROVAL_REQUIRED') approvals.respond(event.id, true, true)
  }
  const resolveDecision = (event: EngineEvent): void => {
    if (event.type === 'NEEDS_DECISION') decisions.respond(event.id, event.options[0])
  }
  bus.on('APPROVAL_REQUIRED', resolveApproval)
  bus.on('NEEDS_DECISION', resolveDecision)

  const orchestrator = new Orchestrator({
    client: new OpenRouterClient(() => 'sk-or-test'),
    budget,
    sandbox,
    board,
    approvals,
    decisions,
    store: store as never,
    getConfig: () => config,
    getAssignments: () => assignments
  })

  const finished = new Promise<RunStatus>((resolve) => {
    bus.once('RUN_FINISHED', (event) => {
      resolve((event as unknown as { status: RunStatus }).status)
    })
  })
  const runId = orchestrator.start(`scenario ${name}`)
  const status = await finished
  bus.off('APPROVAL_REQUIRED', resolveApproval)
  bus.off('NEEDS_DECISION', resolveDecision)

  const reportPath = path.join(workspace, 'RUN_REPORT.md')
  return {
    status,
    taskStatuses: board.list(runId).map((task) => `${task.title}:${task.status}`),
    report: fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf8') : '',
    repairs: repairCalls,
    tempFiles: fs.readdirSync(workspace)
  }

}

const results: Record<string, Awaited<ReturnType<typeof runScenario>>> = {}
for (const name of ['repair-passes', 'repair-fails', 'unverified', 'cycle'] as Scenario[]) {
  results[name] = await runScenario(name)
}

let failures = 0
const check = (label: string, ok: boolean, detail: unknown): void => {
  if (!ok) failures++
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}: ${JSON.stringify(detail)}`)
}

check(
  'repair task runs and turns a failing check into success',
  results['repair-passes'].status === 'done' &&
    results['repair-passes'].repairs === 1 &&
    results['repair-passes'].taskStatuses.some(
      (s) => s.includes('Fix failing check') && s.endsWith('DONE')
    ),
  { status: results['repair-passes'].status, tasks: results['repair-passes'].taskStatuses }
)
check(
  'repair attempts are bounded and a still-failing check fails the run',
  results['repair-fails'].status === 'failed' && results['repair-fails'].repairs === 1,
  { status: results['repair-fails'].status, repairs: results['repair-fails'].repairs }
)
check(
  'work without checks is reported unverified',
  results.unverified.status === 'unverified',
  results.unverified.status
)
check(
  'a dependency cycle is rejected before execution',
  results.cycle.status === 'failed' && results.cycle.taskStatuses.length === 0,
  { status: results.cycle.status, tasks: results.cycle.taskStatuses.length }
)
check(
  'every scenario still writes RUN_REPORT.md',
  Object.values(results).every((r) => r.tempFiles.includes('RUN_REPORT.md')),
  Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.tempFiles]))
)

if (failures > 0) {
  console.error(`${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nAll Phase 1 integration checks passed.')

