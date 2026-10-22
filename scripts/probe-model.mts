/**
 * Diagnostic: call a free model with the implementer prompt and dump the raw
 * SSE stream so the response format can be inspected.
 */
import fs from 'node:fs'
import path from 'node:path'

function readApiKey(): string | null {
  const envPath = path.join(process.cwd(), '.env')
  if (!fs.existsSync(envPath)) return null
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = /^\s*OPENROUTER_API_KEY\s*=\s*(.+)\s*$/.exec(line)
    if (match) return match[1].trim().replace(/^["']|["']$/g, '')
  }
  return null
}

const model = process.argv[2] ?? 'minimax/minimax-m3.1-flash:free'
const key = readApiKey()
if (!key) {
  console.error('no key')
  process.exit(1)
}

const maxTokens = Number(process.env.PROBE_MAX_TOKENS ?? 4096)
const reasoningMax = Number(process.env.PROBE_REASONING_MAX ?? 0)

const payload: Record<string, unknown> = {
  model,
  stream: true,
  temperature: 0.2,
  max_tokens: maxTokens,
  messages: [
    {
      role: 'system',
      content:
        'You are the Implementer. You write and edit files inside the workspace sandbox. ' +
        'You have no tools: you cannot list directories, read files, search the project or run commands. ' +
        'The workspace listing and the current content of the relevant files are provided in your message - ' +
        'that is your only view of the project. Never reply that you cannot access the workspace and never ' +
        'ask for access: work with the files that are shown to you. Always reply with a JSON object and nothing ' +
        'else. Shape: {"files":[{"path":"relative/path.ts","content":"full file content"}],' +
        '"summary":"one line describing the change","commands":["npm test"]} Rules: use relative paths only, ' +
        'never write outside the workspace, include the complete file content for every file you touch, and ' +
        'list the commands needed to verify your work. Your reply must contain at least one entry in "files" ' +
        'with the complete file content - an empty "files" array is a failed answer. ' +
        'The workspace runs on Windows (cmd.exe). Use Windows commands only: dir instead of ls, type instead ' +
        'of cat, del instead of rm, copy instead of cp, move instead of mv, where instead of which, xcopy ' +
        'instead of cp -r. Prefer the npm scripts of the project over raw shell commands. ' +
        'Respond with a single valid JSON object only. No prose, no markdown fences.'
    },
    {
      role: 'user',
      content: fs.existsSync(path.join(process.cwd(), 'probe-task.txt'))
        ? fs.readFileSync(path.join(process.cwd(), 'probe-task.txt'), 'utf8').trim()
        : 'Scaffold a small TypeScript project. Create package.json and src/server.ts.'
    }
  ]
}

if (reasoningMax > 0) {
  payload.reasoning = { max_tokens: reasoningMax }
}

const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'http://localhost:7777',
    'X-Title': 'Codex Local'
  },
  body: JSON.stringify(payload)
})

console.log('status', res.status, res.statusText)

const reader = res.body!.getReader()
const decoder = new TextDecoder()
let buffer = ''
let content = ''
let reasoning = ''
let chunkCount = 0
let finishReason = ''
let usage: any = null

for (;;) {
  const { done, value } = await reader.read()
  if (done) break
  buffer += decoder.decode(value, { stream: true })
  let sep = buffer.indexOf('\n\n')
  while (sep !== -1) {
    const block = buffer.slice(0, sep)
    buffer = buffer.slice(sep + 2)
    for (const line of block.split('\n')) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      chunkCount++
      let parsed: any
      try {
        parsed = JSON.parse(payload)
      } catch {
        console.log('UNPARSEABLE:', payload.slice(0, 200))
        continue
      }
      const delta = parsed.choices?.[0]?.delta
      if (delta?.content) content += delta.content
      if (delta?.reasoning) reasoning += delta.reasoning
      const fr = parsed.choices?.[0]?.finish_reason
      if (fr) finishReason = fr
      if (parsed.usage) usage = parsed.usage
      if (chunkCount <= 3) {
        console.log('CHUNK', payload.slice(0, 220))
      }
    }
    sep = buffer.indexOf('\n\n')
  }
}

console.log('--- chunks:', chunkCount)
console.log('--- finish_reason:', finishReason)
console.log('--- usage:', JSON.stringify(usage))
console.log('--- content length:', content.length)
console.log('--- reasoning length:', reasoning.length)
console.log('--- CONTENT ---')
console.log(content.slice(0, 2500))
if (!content && reasoning) {
  console.log('--- REASONING ONLY (last 1500) ---')
  console.log(reasoning.slice(-1500))
}
