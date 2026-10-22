import fs from 'node:fs'

const p = 'src/shared/types.ts'
let t = fs.readFileSync(p, 'utf8')

const start = t.indexOf('export type EngineEvent =')
const end = t.indexOf('export type EngineEventType')

if (start < 0 || end < 0) {
  console.error('markers not found')
  process.exit(1)
}

const block = `export type EngineEvent =
  | { type: 'TASK_CREATED'; ts: number; runId?: string; taskId: string; title: string; description: string; role: Role }
  | { type: 'TASK_ASSIGNED'; ts: number; runId?: string; taskId: string; role: Role; model: string }
  | { type: 'MESSAGE'; ts: number; runId?: string; from: Role; to: Role | 'user'; body: string; taskId?: string }
  | { type: 'HANDOFF'; ts: number; runId?: string; from: Role; taskId: string; to: Role; contextSummary: string }
  | { type: 'REVIEW_REQUEST'; ts: number; runId?: string; taskId: string; from: Role; to: Role }
  | { type: 'REVIEW_RESULT'; ts: number; runId?: string; taskId: string; from: Role; verdict: ReviewVerdict; items: ReviewItem[] }
  | { type: 'FILE_PATCH'; ts: number; runId?: string; taskId: string; from: Role; patch: FilePatch }
  | { type: 'COMMAND_REQUEST'; ts: number; runId?: string; taskId: string; from: Role; command: string; cwd: string }
  | { type: 'COMMAND_RESULT'; ts: number; runId?: string; taskId: string; command: string; exitCode: number; stdout: string; stderr: string; durationMs: number }
  | { type: 'RUN_STARTED'; ts: number; runId: string; goal: string }
  | { type: 'RUN_FINISHED'; ts: number; runId: string; status: 'done' | 'aborted' | 'failed'; summary: string }
  | { type: 'RUN_ABORTED'; ts: number; runId: string; reason: string }
  | { type: 'APPROVAL_REQUIRED'; ts: number; runId?: string; id: string; kind: 'write' | 'command'; detail: string; payload: unknown }
  | { type: 'ERROR'; ts: number; runId?: string; scope: string; message: string }
  | { type: 'USAGE'; ts: number; runId?: string; model: string; role: Role; promptTokens: number; completionTokens: number }
  | { type: 'AGENT_DELTA'; ts: number; runId?: string; role: Role; taskId?: string; text: string }
  | { type: 'MODEL_SWITCHED'; ts: number; runId?: string; role: Role; from: string; to: string; reason: string }
  | { type: 'NEEDS_DECISION'; ts: number; runId?: string; id: string; question: string; options: string[]; taskId?: string; detail?: string }
  | { type: 'DECISION_MADE'; ts: number; runId?: string; id: string; choice: string }

`

t = t.slice(0, start) + block + t.slice(end)
fs.writeFileSync(p, t, 'utf8')
console.log('types.ts EngineEvent block restored')
