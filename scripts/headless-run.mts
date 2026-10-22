/**
 * Headless end-to-end run of the Codex Local engine.
 *
 * Drives the real Orchestrator against the real free OpenRouter models with
 * no UI: approvals and decisions are answered automatically so the whole
 * pipeline (plan -> implement -> review -> verify -> report) can be observed
 * from a terminal.
 *
 * Usage:
 *   node --experimental-strip-types --import ./scripts/ts-register.mjs \
 *        scripts/headless-run.mts "<goal>" [workspaceDir]
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

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
import type { AppConfig, EngineEvent } from '../src/shared/types.ts'

const goal = process.argv[2] ?? 'Build a REST API for a todo list with tests'
const workspace = path.resolve(
  process.argv[3] ?? path.join(process.cwd(), 'workspace')
)

/** Read the API key from the .env file next to package.json. */
function readApiKey(): string | null {
  const envPath = path.join(process.cwd(), '.env')
  if (!fs.existsSync(envPath)) return null
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = /^\s*OPENROUTER_API_KEY\s*=\s*(.+)\s*$/.exec(line)
    if (match) return match[1].trim().replace(/^["']|["']$/g, '')
  }
  return null
}

const apiKey = readApiKey()
if (!apiKey) {
  console.error('No OPENROUTER_API_KEY found in .env')
  process.exit(1)
}

fs.mkdirSync(workspace, { recursive: true })

const models = await catalog.refresh(true)
console.log(`[harness] free models: ${models.length}`)

/** Read the project's real config so the harness uses the same model chains. */
function readConfig(): AppConfig {
  const configPath = path.join(process.cwd(), 'codex-local.config.json')
  if (!fs.existsSync(configPath)) return structuredClone(DEFAULT_CONFIG)
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as AppConfig
  return { ...structuredClone(DEFAULT_CONFIG), ...raw }
}

const config: AppConfig = {
  ...readConfig(),
  workspaceRoot: workspace,
  autoApproveWrites: false,
  maxParallelTasks: 1
}
const assignments = buildAssignments(config, models)
for (const [role, assignment] of Object.entries(assignments)) {
  console.log(
    `[harness] ${role}: ${assignment.primary ?? 'UNASSIGNED'} (chain: ${
      assignment.chain.join(' -> ') || 'none'
    })`
  )
}

const budget = new Budget(config.tokenBudget)
const board = new TaskBoard()
const sandbox = new Sandbox(workspace)
const approvals = new ApprovalGate(bus)
const decisions = new DecisionGate(bus)
const client = new OpenRouterClient(() => apiKey)

/** A store that keeps everything in memory. */
const memory = { events: [], tasks: [], runs: [] }
const store = {
  init() {},
  persistEvent(event) {
    memory.events.push(event)
  },
  saveTask(task) {
    memory.tasks.push(task)
  },
  listTasks(runId) {
    return memory.tasks.filter((t) => t.runId === runId)
  },
  listEvents(runId) {
    return runId
      ? memory.events.filter((e) => e.runId === runId)
      : [...memory.events]
  },
  saveRun(summary) {
    memory.runs.push(summary)
  },
  listRuns() {
    return memory.runs
  },
  close() {},
  backend: 'json'
}

const orchestrator = new Orchestrator({
  client,
  budget,
  sandbox,
  board,
  approvals,
  decisions,
  store,
  getConfig: () => config,
  getAssignments: () => assignments
})

// Answer every approval and decision automatically.
bus.on('APPROVAL_REQUIRED', (event) => {
  const detail = (event as unknown as { detail: string }).detail
  console.log(`[harness] APPROVE (${event.kind}): ${detail.split('\n')[0]}`)
  approvals.respond((event as unknown as { id: string }).id, true, true)
})
bus.on('NEEDS_DECISION', (event) => {
  const e = event as unknown as { id: string; options: string[] }
  console.log(`[harness] DECIDE: ${e.options[0]}`)
  decisions.respond(e.id, e.options[0])
})

const seen: Record<string, number> = {}

/** Reassemble the streamed replies so the raw model output can be inspected. */
const replies = new Map<string, string>()
bus.on('AGENT_DELTA', (event) => {
  const e = event as unknown as { role: string; taskId?: string; text: string }
  const key = `${e.role}|${e.taskId ?? '-'}`
  replies.set(key, (replies.get(key) ?? '') + e.text)
})
bus.on('MESSAGE', (event) => {
  const e = event as unknown as { from: string; taskId?: string; body: string }
  if (e.body && e.from === 'implementer') {
    console.log(`[harness] IMPLEMENTER REPLY (${e.taskId}):`)
    console.log(e.body.slice(0, 1200))
  }
})

bus.onEvent((event: EngineEvent) => {
  seen[event.type] = (seen[event.type] ?? 0) + 1
  if (event.type === 'ERROR') {
    console.log(`[harness] ERROR ${(event as unknown as { scope: string }).scope}: ${
      (event as unknown as { message: string }).message
    }`)
  }
  if (event.type === 'TASK_CREATED') {
    const e = event as unknown as { title: string; role: string }
    console.log(`[harness] TASK ${e.title} (${e.role})`)
  }
  if (event.type === 'FILE_PATCH') {
    const e = event as unknown as { patch: { path: string; added: number } }
    console.log(`[harness] WROTE ${e.patch.path} (+${e.patch.added})`)
  }
  if (event.type === 'COMMAND_RESULT') {
    const e = event as unknown as { command: string; exitCode: number }
    console.log(`[harness] CMD "${e.command}" -> ${e.exitCode}`)
  }
})

const runId = orchestrator.start(goal)
console.log(`[harness] run ${runId} started in ${workspace}`)

await new Promise<void>((resolve) => {
  bus.on('RUN_FINISHED', () => resolve())
  bus.on('RUN_ABORTED', () => resolve())
})

console.log('\n[harness] --- event counts ---')
for (const [type, count] of Object.entries(seen)) {
  console.log(`  ${type}: ${count}`)
}

console.log('\n[harness] --- raw agent replies ---')
for (const [key, text] of replies) {
  console.log(`>>> ${key} (${text.length} chars)`)
  console.log(text.slice(0, 800))
}

const report = path.join(workspace, 'RUN_REPORT.md')
if (fs.existsSync(report)) {
  console.log('\n[harness] --- RUN_REPORT.md ---')
  console.log(fs.readFileSync(report, 'utf8'))
}
