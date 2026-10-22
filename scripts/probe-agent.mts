/**
 * Diagnostic: run the real Agent against a real free model with the real
 * implementer prompt, and report what came back.
 */
import fs from 'node:fs'
import path from 'node:path'

import { Agent } from '../src/main/engine/agents.ts'
import { Budget } from '../src/main/engine/budget.ts'
import { bus } from '../src/main/engine/bus.ts'
import { OpenRouterClient } from '../src/main/openrouter/client.ts'
import { catalog } from '../src/main/openrouter/catalog.ts'

function readApiKey(): string | null {
  const envPath = path.join(process.cwd(), '.env')
  if (!fs.existsSync(envPath)) return null
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = /^\s*OPENROUTER_API_KEY\s*=\s*(.+)\s*$/.exec(line)
    if (match) return match[1].trim().replace(/^["']|["']$/g, '')
  }
  return null
}

const key = readApiKey()
if (!key) {
  console.error('no key')
  process.exit(1)
}

const model = process.argv[2] ?? 'minimax/minimax-m3.1-flash:free'
const maxTokens = Number(process.env.PROBE_MAX_TOKENS ?? 4096)

await catalog.refresh(true)

const client = new OpenRouterClient(() => key)
const budget = new Budget(400_000)
const agent = new Agent('implementer', {
  client,
  budget,
  bus,
  resolveModel: () => [model]
})

let deltas = ''
bus.on('AGENT_DELTA', (e) => {
  deltas += (e as unknown as { text: string }).text
})

const taskFile = path.join(process.cwd(), 'probe-task.txt')
const taskText = fs.existsSync(taskFile)
  ? fs.readFileSync(taskFile, 'utf8').trim()
  : 'Scaffold a TypeScript API. Create package.json and src/server.ts.'

const response = await agent.send({
  role: 'implementer',
  runId: 'probe',
  taskId: 'probe-task',
  content: taskText,
  scratchpad: [
    'Task: Scaffold TypeScript API',
    'Create package.json and src/server.ts.',
    '',
    'You have no tools. The workspace snapshot below is your only view of the',
    'project - work with the files that are shown to you.',
    '',
    'Workspace files (paths are relative to the workspace root):',
    '(the workspace is empty)',
    '',
    'The workspace has no readable files yet - create the files you need.',
    '',
    'Answer with the JSON object only, including at least one file with its',
    'complete content.'
  ].join('\n'),
  maxTokens,
  temperature: 0.2
})

console.log('--- model:', response.model)
console.log('--- usage:', JSON.stringify(response.usage))
console.log('--- content length:', response.content.length)
console.log('--- delta length:', deltas.length)
console.log('--- CONTENT ---')
console.log(response.content.slice(0, 1200))
