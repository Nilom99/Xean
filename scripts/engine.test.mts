/**
 * Unit tests for the pure logic of Codex Local.
 *
 * These modules have no side effects and no runtime dependency on Electron,
 * so they can be exercised directly with `node --test`.
 *
 * Run with: npm test
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { resolveAlias, scoreCandidate, tokenize } from '../src/main/openrouter/aliasMap.ts'
import {
  ModelHealth,
  RATE_LIMIT_COOLDOWN_MS,
  UNAVAILABLE_COOLDOWN_MS
} from '../src/main/openrouter/modelHealth.ts'
import { parseJsonLoose, stripCodeFences, repairJson, asString } from '../src/main/engine/json.ts'
import { computeDiff, parseUnifiedRows } from '../src/main/engine/diff.ts'
import { reduceEngine, reduceEngineLog, countByStatus } from '../src/renderer/lib/events.ts'
import { rankFiles, scoreFile, isTextFile, tokenize as ctxTokenize } from '../src/main/engine/workspaceContext.ts'
import { mergeCommands, isPlatformCompatible, filterPlatformCompatible, classifyCommandRisk } from '../src/main/engine/commands.ts'
import { parseFileSymbols, parseImports, resolveImportPath, analyzeImpact } from '../src/main/engine/symbolIndex.ts'
import { parseProposedFiles, normalizeProposedPath } from '../src/main/engine/protocol.ts'
import { buildRunReport, type ReportInput } from '../src/main/engine/report.ts'
import { AuditLog, audit } from '../src/main/engine/audit.ts'
import { CheckpointManager } from '../src/main/engine/checkpoints.ts'
import { PatchPreviewManager } from '../src/main/engine/patchPreview.ts'
import { ApprovalGate } from '../src/main/engine/approvals.ts'
import { Sandbox } from '../src/main/engine/sandbox.ts'
import { bus } from '../src/main/engine/bus.ts'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type { EngineEvent, Task } from '../src/shared/types.ts'

// ---------------------------------------------------------------- json ----

test('stripCodeFences removes markdown fences', () => {
  assert.equal(stripCodeFences('```json\n{"a":1}\n```'), '{"a":1}')
  assert.equal(stripCodeFences('  {"a":1}  '), '{"a":1}')
})

test('repairJson removes trailing commas', () => {
  assert.equal(repairJson('{"a":1,}'), '{"a":1}')
  assert.equal(repairJson('[1,2,]'), '[1,2]')
})

test('parseJsonLoose finds JSON inside prose and fences', () => {
  assert.deepEqual(parseJsonLoose('sure! {"verdict":"APPROVED"} hope that helps'), {
    verdict: 'APPROVED'
  })
  assert.deepEqual(parseJsonLoose('```json\n{"files":[{"path":"a.ts"}]}\n```'), {
    files: [{ path: 'a.ts' }]
  })
  assert.equal(parseJsonLoose('not json at all'), null)
})

test('asString coerces loose model output', () => {
  assert.equal(asString('hello'), 'hello')
  assert.equal(asString(42), '42')
  assert.equal(asString({ content: 'nested' }), 'nested')
  assert.equal(asString(undefined, 'fallback'), 'fallback')
})

test('parseJsonLoose recovers a payload with literal newlines in strings', () => {
  const raw = '{\n  "files": [\n    { "path": "a.ts", "content": "line one\nline two" }\n  ]\n}'
  const parsed = parseJsonLoose<{ files: Array<{ path: string; content: string }> }>(raw)
  assert.ok(parsed, 'expected the payload to be recovered')
  assert.equal(parsed.files[0].content, 'line one\nline two')
})

// ----------------------------------------------------------- aliasMap ----

test('tokenize splits identifiers into comparable tokens', () => {
  assert.deepEqual(tokenize('minimax 3.1 flash'), ['minimax', '3', '1', 'flash'])
})

test('scoreCandidate prefers the matching model', () => {
  const models = [
    { id: 'minimax/minimax-m3.1-flash:free', name: 'MiniMax M3.1 Flash', contextLength: 0 },
    { id: 'other/llama-3-8b:free', name: 'Llama 3 8B', contextLength: 0 }
  ]
  const good = scoreCandidate('minimax 3.1 flash', models[0])
  const bad = scoreCandidate('minimax 3.1 flash', models[1])
  assert.ok(good > bad, `expected ${good} > ${bad}`)
})

test('resolveAlias resolves a preferred id exactly', () => {
  const result = resolveAlias({
    alias: 'minimax 3.1 flash',
    role: 'orchestrator',
    preferred: ['minimax/minimax-m3.1-flash:free'],
    models: [{ id: 'minimax/minimax-m3.1-flash:free', name: 'MiniMax', contextLength: 0 }]
  })
  assert.equal(result.status, 'resolved')
  assert.equal(result.resolvedId, 'minimax/minimax-m3.1-flash:free')
  assert.equal(result.confidence, 1)
})

test('resolveAlias reports an empty catalog instead of guessing', () => {
  const result = resolveAlias({
    alias: 'lfm2.5',
    role: 'implementer',
    preferred: [],
    models: []
  })
  assert.equal(result.status, 'unresolved')
  assert.equal(result.resolvedId, undefined)
})

// -------------------------------------------------------------- diff ----

test('computeDiff counts added and removed lines', () => {
  const diff = computeDiff('a.ts', 'one\ntwo\n', 'one\nthree\n')
  assert.equal(diff.added, 1)
  assert.equal(diff.removed, 1)
  assert.ok(diff.unified.includes('@@'))
})

test('computeDiff treats a missing file as a new file', () => {
  const diff = computeDiff('new.ts', null, 'hello\n')
  assert.equal(diff.isNewFile, true)
  assert.equal(diff.added, 1)
  assert.ok(diff.unified.includes('/dev/null'))
})

test('parseUnifiedRows round-trips a diff', () => {
  const unified = computeDiff('a.ts', 'one\n', 'one\ntwo\n').unified
  const rows = parseUnifiedRows(unified)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].type, 'context')
  assert.equal(rows[1].type, 'add')
  assert.equal(rows[1].text, 'two')
})

// ------------------------------------------------------- event reducer ----

const baseEvent: EngineEvent = {
  type: 'RUN_STARTED',
  ts: 1,
  runId: 'run-1',
  goal: 'Build a thing'
}

test('reduceEngine records the goal of a new run', () => {
  const state = reduceEngine(reduceEngineLog([]), baseEvent)
  assert.equal(state.runId, 'run-1')
  assert.equal(state.goal, 'Build a thing')
  assert.equal(state.status, 'running')
  assert.equal(state.tasks.length, 0)
})

test('reduceEngine tracks tasks through their lifecycle', () => {
  let state = reduceEngineLog([
    baseEvent,
    {
      type: 'TASK_CREATED',
      ts: 2,
      runId: 'run-1',
      taskId: 't1',
      title: 'Write the module',
      description: 'do the thing',
      role: 'implementer'
    }
  ])
  assert.equal(state.tasks.length, 1)
  assert.equal(state.tasks[0].status, 'PENDING')

  state = reduceEngine(state, {
    type: 'TASK_ASSIGNED',
    ts: 3,
    runId: 'run-1',
    taskId: 't1',
    role: 'implementer',
    model: 'liquid/lfm-2.5-2.6b:free'
  })
  assert.equal(state.tasks[0].status, 'IN_PROGRESS')
  assert.equal(state.tasks[0].iteration, 1)
  assert.equal(state.tasks[0].model, 'liquid/lfm-2.5-2.6b:free')

  state = reduceEngine(state, {
    type: 'REVIEW_RESULT',
    ts: 4,
    runId: 'run-1',
    taskId: 't1',
    from: 'reviewer',
    verdict: 'APPROVED',
    items: []
  })
  assert.equal(state.tasks[0].status, 'DONE')
  assert.equal(state.tasks[0].verdict, 'APPROVED')
})

test('reduceEngine accumulates usage', () => {
  const state = reduceEngineLog([
    baseEvent,
    {
      type: 'USAGE',
      ts: 2,
      runId: 'run-1',
      model: 'm',
      role: 'orchestrator',
      promptTokens: 100,
      completionTokens: 50
    },
    {
      type: 'USAGE',
      ts: 3,
      runId: 'run-1',
      model: 'm',
      role: 'orchestrator',
      promptTokens: 200,
      completionTokens: 100
    }
  ])
  assert.equal(state.usage.promptTokens, 300)
  assert.equal(state.usage.completionTokens, 150)
  assert.equal(state.usage.requests, 2)
})

test('reduceEngine holds approvals until they are answered', () => {
  const state = reduceEngineLog([
    baseEvent,
    {
      type: 'APPROVAL_REQUIRED',
      ts: 2,
      runId: 'run-1',
      id: 'a1',
      kind: 'write',
      detail: 'Write a.ts',
      payload: {}
    }
  ])
  assert.equal(state.approvals.length, 1)
  assert.equal(state.approvals[0].kind, 'write')
})

test('reduceEngine clears a decision once it is made', () => {
  let state = reduceEngineLog([
    baseEvent,
    {
      type: 'NEEDS_DECISION',
      ts: 2,
      runId: 'run-1',
      id: 'd1',
      question: 'Which one?',
      options: ['a', 'b']
    }
  ])
  assert.equal(state.decisions.length, 1)

  state = reduceEngine(state, {
    type: 'DECISION_MADE',
    ts: 3,
    runId: 'run-1',
    id: 'd1',
    choice: 'a'
  })
  assert.equal(state.decisions.length, 0)
})

test('reduceEngine pairs a command with its result', () => {
  let state = reduceEngineLog([
    baseEvent,
    {
      type: 'COMMAND_REQUEST',
      ts: 2,
      runId: 'run-1',
      taskId: 't1',
      from: 'runner',
      command: 'npm test',
      cwd: '/ws'
    }
  ])
  assert.equal(state.commands.length, 1)
  assert.equal(state.commands[0].pending, true)

  state = reduceEngine(state, {
    type: 'COMMAND_RESULT',
    ts: 3,
    runId: 'run-1',
    taskId: 't1',
    command: 'npm test',
    exitCode: 0,
    stdout: 'ok',
    stderr: '',
    durationMs: 120
  })
  assert.equal(state.commands[0].pending, false)
  assert.equal(state.commands[0].exitCode, 0)
  assert.equal(state.commands[0].stdout, 'ok')
})

test('reduceEngine marks the task failed when an error names it', () => {
  const state = reduceEngineLog([
    baseEvent,
    {
      type: 'TASK_CREATED',
      ts: 2,
      runId: 'run-1',
      taskId: 't1',
      title: 'x',
      description: 'y',
      role: 'implementer'
    },
    {
      type: 'ERROR',
      ts: 3,
      runId: 'run-1',
      scope: 'task:t1',
      message: 'it broke'
    }
  ])
  assert.equal(state.tasks[0].status, 'FAILED')
  assert.equal(state.tasks[0].error, 'it broke')
  assert.equal(state.errors.length, 1)
})

test('countByStatus tallies every task status', () => {
  const state = reduceEngineLog([
    baseEvent,
    {
      type: 'TASK_CREATED',
      ts: 2,
      runId: 'run-1',
      taskId: 'a',
      title: 'a',
      description: '',
      role: 'implementer'
    },
    {
      type: 'TASK_CREATED',
      ts: 3,
      runId: 'run-1',
      taskId: 'b',
      title: 'b',
      description: '',
      role: 'reviewer'
    }
  ])
  const counts = countByStatus(state.tasks)
  assert.equal(counts.PENDING, 2)
  assert.equal(counts.DONE, 0)
})

// --------------------------------------------------- workspace context ----

test('ctxTokenize drops short words and keeps identifiers', () => {
  assert.deepEqual(ctxTokenize('Implement the todo REST api'), [
    'implement',
    'the',
    'todo',
    'rest',
    'api'
  ])
  assert.deepEqual(ctxTokenize('a to be it'), [])
})

test('scoreFile prefers a file that matches the task text', () => {
  const tokens = ctxTokenize('implement todo routes')
  assert.ok(scoreFile('src/todo/routes.ts', tokens) > scoreFile('README.md', tokens))
})

test('rankFiles puts files written earlier in the run first', () => {
  const files = ['README.md', 'src/todo/routes.ts', 'src/todo/model.ts']
  const ranked = rankFiles(files, 'implement todo routes', ['src/todo/model.ts'])
  assert.equal(ranked[0], 'src/todo/model.ts')
  assert.deepEqual([...ranked].sort(), [...files].sort())
})

test('isTextFile accepts source and rejects lock files', () => {
  assert.equal(isTextFile('src/server.ts'), true)
  assert.equal(isTextFile('README.md'), true)
  assert.equal(isTextFile('package-lock.json'), false)
})

// ------------------------------------------------------------- protocol ----

test('parseProposedFiles reads the files array', () => {
  const files = parseProposedFiles(
    '{"files":[{"path":"src/a.ts","content":"export const a = 1"}]}'
  )
  assert.equal(files.length, 1)
  assert.equal(files[0].path, 'src/a.ts')
  assert.equal(files[0].content, 'export const a = 1')
})

test('parseProposedFiles reads a bare top-level array', () => {
  const files = parseProposedFiles('[{"path":"src/a.ts","content":"x"}]')
  assert.equal(files.length, 1)
  assert.equal(files[0].path, 'src/a.ts')
})

test('parseProposedFiles normalises windows paths', () => {
  const files = parseProposedFiles(
    '{"files":[{"path":".\\\\src\\\\a.ts","content":"x"}]}'
  )
  assert.equal(files[0].path, 'src/a.ts')
})

test('parseProposedFiles joins content given as an array of lines', () => {
  const files = parseProposedFiles(
    '{"files":[{"path":"a.ts","content":["one","two"]}]}'
  )
  assert.equal(files[0].content, 'one\ntwo')
})

test('parseProposedFiles returns nothing for an empty answer', () => {
  assert.deepEqual(parseProposedFiles('{"files":[],"summary":"no access"}'), [])
})

test('normalizeProposedPath strips leading slashes and dots', () => {
  assert.equal(normalizeProposedPath('./src/a.ts'), 'src/a.ts')
  assert.equal(normalizeProposedPath('/src/a.ts'), 'src/a.ts')
})

// ------------------------------------------------------------ commands ----

test('mergeCommands keeps the first occurrence of each command', () => {
  const merged = mergeCommands(['npm test', 'npm run build'], ['npm test', 'npm run lint'])
  assert.deepEqual(merged, ['npm test', 'npm run build', 'npm run lint'])
})

test('isPlatformCompatible rejects unix commands on windows', () => {
  assert.equal(isPlatformCompatible('npm test', 'win32'), true)
  assert.equal(isPlatformCompatible('ls -la', 'win32'), false)
  assert.equal(isPlatformCompatible('pwd && find . -type f', 'win32'), false)
  assert.equal(isPlatformCompatible('ls -la', 'linux'), true)
})

test('filterPlatformCompatible separates the skipped commands', () => {
  const { compatible, skipped } = filterPlatformCompatible(
    ['npm test', 'cat package.json'],
    'win32'
  )
  assert.deepEqual(compatible, ['npm test'])
  assert.deepEqual(skipped, ['cat package.json'])
})

// --------------------------------------------------------- modelHealth ----

test('preferReady keeps every candidate and moves cooled-down models last', () => {
  const health = new ModelHealth(() => 0)
  health.penalize('b:free', RATE_LIMIT_COOLDOWN_MS)

  const ordered = health.preferReady(['a:free', 'b:free', 'c:free'])
  assert.deepEqual(ordered, ['a:free', 'c:free', 'b:free'])
  // Nothing is dropped: a chain never shrinks because of a cooldown.
  assert.equal(ordered.length, 3)
})

test('preferReady keeps the original order when every model is cooling down', () => {
  const health = new ModelHealth(() => 0)
  for (const model of ['a:free', 'b:free']) {
    health.penalize(model, RATE_LIMIT_COOLDOWN_MS)
  }

  assert.deepEqual(health.preferReady(['a:free', 'b:free']), ['a:free', 'b:free'])
})

test('preferReady copies the input and tolerates an empty chain', () => {
  const health = new ModelHealth(() => 0)
  const input = ['a:free']
  const ordered = health.preferReady(input)
  assert.deepEqual(ordered, ['a:free'])
  assert.notEqual(ordered, input)
  assert.deepEqual(health.preferReady([]), [])
})

test('a cooldown expires once its window has passed', () => {
  let clock = 1_000
  const health = new ModelHealth(() => clock)

  health.penalize('a:free', UNAVAILABLE_COOLDOWN_MS)
  assert.equal(health.isCoolingDown('a:free'), true)

  clock += UNAVAILABLE_COOLDOWN_MS - 1
  assert.equal(health.isCoolingDown('a:free'), true)

  clock += 1
  assert.equal(health.isCoolingDown('a:free'), false)
  assert.deepEqual(health.preferReady(['a:free', 'b:free']), ['a:free', 'b:free'])
})

test('penalize keeps the longest window and ignores non-positive delays', () => {
  let clock = 0
  const health = new ModelHealth(() => clock)

  health.penalize('a:free', 1_000)
  health.penalize('a:free', 10_000)
  health.penalize('a:free', 5_000)
  health.penalize('b:free', 0)
  health.penalize('', 10_000)

  clock = 6_000
  assert.equal(health.isCoolingDown('a:free'), true)
  assert.equal(health.isCoolingDown('b:free'), false)

  clock = 10_000
  assert.equal(health.isCoolingDown('a:free'), false)
})

test('clear forgets every cooldown', () => {
  const health = new ModelHealth(() => 0)
  health.penalize('a:free', RATE_LIMIT_COOLDOWN_MS)
  assert.equal(health.isCoolingDown('a:free'), true)

  health.clear()
  assert.equal(health.isCoolingDown('a:free'), false)
})

// --------------------------------------------------------------- report ----

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    runId: 'r1',
    title: 'Scaffold the project',
    description: 'Create the initial files.',
    role: 'implementer',
    status: 'PENDING',
    iteration: 1,
    createdAt: 0,
    updatedAt: 0,
    dependsOn: [],
    patches: [],
    reviewItems: [],
    ...overrides
  }
}

function reportInput(overrides: Partial<ReportInput> = {}): ReportInput {
  return {
    runId: 'r1',
    goal: 'Build something',
    status: 'done',
    startedAt: 0,
    endedAt: 1_000,
    tasks: [],
    usage: { promptTokens: 0, completionTokens: 0, requests: 0 },
    perModel: {},
    models: { implementer: 'a:free' },
    notes: [],
    ...overrides
  }
}

/** Just the "What remains" section, so the assertions stay readable. */
function remains(report: string): string {
  const start = report.indexOf('## What remains')
  assert.ok(start >= 0, 'the report must contain a "What remains" section')
  return report.slice(start).split('\n').filter((l) => l.trim() !== '').slice(1).join('\n')
}

test('a successful run with finished tasks reports nothing outstanding', () => {
  const report = buildRunReport(
    reportInput({ status: 'done', tasks: [makeTask({ status: 'DONE' })] })
  )
  assert.match(remains(report), /Nothing outstanding/)
})

test('a failed run that never planned a task does not claim success', () => {
  const section = remains(
    buildRunReport(reportInput({ status: 'failed', tasks: [], notes: ['planner blew up'] }))
  )
  assert.doesNotMatch(section, /every task completed successfully/)
  assert.match(section, /before any task could be planned/)
})

test('an aborted run lists the tasks that never finished', () => {
  const section = remains(
    buildRunReport(
      reportInput({
        status: 'aborted',
        tasks: [makeTask({ status: 'DONE' }), makeTask({ id: 't2', title: 'Add tests', status: 'PENDING' })]
      })
    )
  )
  assert.doesNotMatch(section, /Nothing outstanding/)
  assert.match(section, /\*\*Add tests\*\* is still PENDING/)
})

test('a failed run whose tasks all reached DONE still says so', () => {
  const section = remains(
    buildRunReport(
      reportInput({ status: 'failed', tasks: [makeTask({ status: 'DONE' })] })
    )
  )
  assert.match(section, /ended as FAILED after every task reached DONE/)
})

test('failed and blocked tasks are listed before any completion claim', () => {
  const section = remains(
    buildRunReport(
      reportInput({
        status: 'failed',
        tasks: [
          makeTask({ id: 't1', title: 'Broken', status: 'FAILED', error: 'boom' }),
          makeTask({ id: 't2', title: 'Stuck', status: 'BLOCKED' })
        ]
      })
    )
  )
  assert.match(section, /\*\*Broken\*\* failed: boom/)
  assert.match(section, /\*\*Stuck\*\* was blocked/)
})

// ------------------------------------------------------ secret protection ----

test('isTextFile rejects secret and credential files', () => {
  assert.equal(isTextFile('.env'), false)
  assert.equal(isTextFile('.env.local'), false)
  assert.equal(isTextFile('.env.production'), false)
  assert.equal(isTextFile('config/.env'), false)
  assert.equal(isTextFile('server.pem'), false)
  assert.equal(isTextFile('id_rsa'), false)
  assert.equal(isTextFile('id_ed25519'), false)
  assert.equal(isTextFile('credentials.json'), false)
  assert.equal(isTextFile('secrets.yaml'), false)
  assert.equal(isTextFile('.npmrc'), false)
  assert.equal(isTextFile('.pypirc'), false)
  assert.equal(isTextFile('.netrc'), false)
  assert.equal(isTextFile('.aws/credentials'), false)
  assert.equal(isTextFile('.ssh/config'), false)
  assert.equal(isTextFile('.ssh/id_rsa'), false)
  assert.equal(isTextFile('.vscode/settings.json'), false)
  assert.equal(isTextFile('.idea/workspace.xml'), false)
})

test('isTextFile still accepts normal source files', () => {
  assert.equal(isTextFile('src/server.ts'), true)
  assert.equal(isTextFile('README.md'), true)
  assert.equal(isTextFile('config.yml'), true)
  assert.equal(isTextFile('package.json'), true)
  assert.equal(isTextFile('index.html'), true)
})

// --------------------------------------------- phase 1: symbol index & risk ----

test('parseFileSymbols extracts functions, classes, interfaces and variables', () => {
  const code = `
    export interface UserConfig {
      id: string
    }
    export class Orchestrator {
      run() {}
    }
    export function processTask() {
      return true
    }
    const MAX_LIMIT = 50
  `
  const symbols = parseFileSymbols('test.ts', code)
  assert.equal(symbols.length, 4)
  assert.equal(symbols[0].name, 'UserConfig')
  assert.equal(symbols[0].kind, 'interface')
  assert.equal(symbols[1].name, 'Orchestrator')
  assert.equal(symbols[1].kind, 'class')
  assert.equal(symbols[2].name, 'processTask')
  assert.equal(symbols[2].kind, 'function')
  assert.equal(symbols[3].name, 'MAX_LIMIT')
  assert.equal(symbols[3].kind, 'variable')
})

test('parseImports finds all imported modules', () => {
  const code = `
    import { app, BrowserWindow } from 'electron'
    import path from 'node:path'
    import { bus } from './bus'
  `
  const imports = parseImports('index.ts', code)
  assert.deepEqual(imports, ['electron', 'node:path', './bus'])
})

test('resolveImportPath resolves relative typescript paths', () => {
  const allFiles = new Set(['src/main/engine/bus.ts', 'src/shared/types.ts'])
  const resolved = resolveImportPath('src/main/engine/orchestrator.ts', './bus', allFiles)
  assert.equal(resolved, 'src/main/engine/bus.ts')

  const sharedResolved = resolveImportPath('src/main/engine/orchestrator.ts', '@shared/types', allFiles)
  assert.equal(sharedResolved, 'src/shared/types.ts')
})

test('analyzeImpact finds direct and transitive dependencies', () => {
  const graph = {
    imports: {
      'src/main/index.ts': ['src/main/engine/bus.ts'],
      'src/main/engine/orchestrator.ts': ['src/main/engine/bus.ts'],
      'src/main/engine/bus.ts': []
    },
    importedBy: {
      'src/main/engine/bus.ts': ['src/main/index.ts', 'src/main/engine/orchestrator.ts'],
      'src/main/index.ts': [],
      'src/main/engine/orchestrator.ts': []
    }
  }

  const impact = analyzeImpact(['src/main/engine/bus.ts'], graph)
  assert.deepEqual(impact.changedFiles, ['src/main/engine/bus.ts'])
  assert.equal(impact.directlyAffected.length, 2)
  assert.ok(impact.directlyAffected.includes('src/main/index.ts'))
  assert.ok(impact.directlyAffected.includes('src/main/engine/orchestrator.ts'))
  assert.equal(impact.totalAffectedCount, 3)
})

test('classifyCommandRisk identifies safe, write, network and destructive commands', () => {
  assert.equal(classifyCommandRisk('npm test'), 'SAFE_READ_ONLY')
  assert.equal(classifyCommandRisk('tsc --noEmit'), 'SAFE_READ_ONLY')
  assert.equal(classifyCommandRisk('git status'), 'SAFE_READ_ONLY')

  assert.equal(classifyCommandRisk('npm run build'), 'WORKSPACE_WRITE')
  assert.equal(classifyCommandRisk('mkdir src/test'), 'WORKSPACE_WRITE')

  assert.equal(classifyCommandRisk('curl https://example.com'), 'NETWORK_ACCESS')
  assert.equal(classifyCommandRisk('git push origin main'), 'NETWORK_ACCESS')
  assert.equal(classifyCommandRisk('npm publish'), 'NETWORK_ACCESS')

  assert.equal(classifyCommandRisk('rm -rf node_modules'), 'HIGH_RISK_DESTRUCTIVE')
  assert.equal(classifyCommandRisk('del /s /q test.txt'), 'HIGH_RISK_DESTRUCTIVE')
  assert.equal(classifyCommandRisk('sudo rm file'), 'HIGH_RISK_DESTRUCTIVE')
})


// ------------------------------------ phase 2: autonomous editing & checkpoints ----

test('AuditLog records entries, filters by action/task and formats to JSONL', () => {
  const log = new AuditLog('run-123')
  audit.runStarted(log, 'run-123', 'Implement Phase 2')
  audit.taskCreated(log, 'run-123', 'task-1', 'Add Checkpoints', 'implementer')
  audit.fileWrite(log, 'run-123', 'task-1', 'src/checkpoints.ts', 120, true)

  const all = log.getAll()
  assert.equal(all.length, 3)

  const taskEntries = log.getByTask('task-1')
  assert.equal(taskEntries.length, 2)

  const writeEntries = log.getByAction('FILE_WRITE')
  assert.equal(writeEntries.length, 1)
  assert.equal(writeEntries[0].metadata.file, 'src/checkpoints.ts')

  const jsonl = log.toJSONL()
  assert.ok(jsonl.includes('"action":"RUN_STARTED"'))
  assert.ok(jsonl.includes('"action":"FILE_WRITE"'))
})

test('CheckpointManager creates snapshots and rolls back file changes', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-chk-test-'))
  try {
    const sandbox = new Sandbox(tmpDir)
    const fileRel = 'src/test.txt'
    await sandbox.writeFile(fileRel, 'version 1')

    const chkManager = new CheckpointManager(sandbox)
    const chk = await chkManager.createCheckpoint('run-1', 'task-1', 'Before v2 update', [fileRel])

    assert.equal(chk.snapshots.length, 1)
    assert.equal(chk.snapshots[0].content, 'version 1')
    assert.equal(chk.snapshots[0].existed, true)

    // Modify file
    await sandbox.writeFile(fileRel, 'version 2 modified')
    assert.equal(await sandbox.readFile(fileRel), 'version 2 modified')

    // Rollback
    const restored = await chkManager.rollback(chk.id)
    assert.deepEqual(restored, [fileRel])
    assert.equal(await sandbox.readFile(fileRel), 'version 1')
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
})

test('PatchPreviewManager generates atomic change groups and summaries', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-patch-test-'))
  try {
    const sandbox = new Sandbox(tmpDir)
    await sandbox.writeFile('existing.ts', 'line 1\nline 2')

    const previewManager = new PatchPreviewManager(sandbox)
    const group = await previewManager.createPreviewGroup('run-1', 'task-1', 'Multi-file patch', [
      { path: 'existing.ts', content: 'line 1\nline 2\nline 3' },
      { path: 'newfile.ts', content: 'hello world' }
    ])

    assert.equal(group.files.length, 2)
    assert.equal(group.totalAdded, 3)
    assert.ok(group.totalRemoved >= 0)

    const summary = previewManager.formatGroupSummary(group)
    assert.ok(summary.includes('Atomic Patch Preview (2 files'))
    assert.ok(summary.includes('existing.ts'))
    assert.ok(summary.includes('newfile.ts'))
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
})

test('ApprovalGate respects risk levels and security policy', async () => {
  const gate = new ApprovalGate(bus)

  // Safe read-only commands should resolve automatically without needing explicit approval response
  const readDecision = await gate.request(
    'command',
    'Run npm test',
    { command: 'npm test', workspaceRoot: '/tmp' },
    'run-1'
  )
  assert.equal(readDecision.allowed, true)

  // Configure security policy
  gate.setPolicy({ alwaysRequireDestructiveApproval: true })
  gate.allowAlways('command')

  // Destructive command should NOT be auto-approved even when allowAlways('command') is enabled
  const pendingPromise = gate.request(
    'command',
    'Delete node_modules',
    { command: 'rm -rf node_modules', workspaceRoot: '/tmp' },
    'run-1'
  )
  assert.equal(gate.pendingCount, 1)

  // Clean up pending gate
  gate.respond(Array.from((gate as unknown as { pending: Map<string, unknown> }).pending.keys())[0], false, false)
  await pendingPromise
})

