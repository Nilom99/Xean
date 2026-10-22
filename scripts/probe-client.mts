/**
 * Probe: how the engine reacts when OpenRouter retires or refuses a model.
 *
 * `fetch` is stubbed, so no tokens are spent and the result is deterministic.
 *
 *   1. a 404 (retired model) fails after a *single* request — no backoff —
 *      and is reported as `model_unavailable`;
 *   2. the agent swaps to the next free model at once and puts the dead one on
 *      cooldown, so the following task does not touch it again;
 *   3. a transient 5xx is still retried.
 *
 * Usage:
 *   node --experimental-transform-types --import ./scripts/ts-register.mjs \
 *        scripts/probe-client.mts
 */
import { Agent } from '../src/main/engine/agents.ts'
import { Budget } from '../src/main/engine/budget.ts'
import { bus } from '../src/main/engine/bus.ts'
import { ModelHealth } from '../src/main/openrouter/modelHealth.ts'
import { OpenRouterClient, OpenRouterError } from '../src/main/openrouter/client.ts'
import { catalog } from '../src/main/openrouter/catalog.ts'

const models = await catalog.refresh(true)
if (models.length < 2) {
  console.error(`[probe] need at least 2 live free models, got ${models.length}`)
  process.exit(1)
}
const dead = models[0].id
const alive = models[1].id
console.log(`[probe] dead=${dead}`)
console.log(`[probe] alive=${alive}`)

let failures = 0
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++
  console.log(`[${label}] ${ok ? 'PASS' : 'FAIL'}: ${detail}`)
}

const json = (status: number, message: string): Response =>
  new Response(JSON.stringify({ error: { message } }), { status })

/** A minimal SSE body that `consumeStream` accepts as a complete answer. */
const sse = (content: string): Response =>
  new Response(
    `data: ${JSON.stringify({
      choices: [{ delta: { content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 }
    })}\n\ndata: [DONE]\n\n`,
    { status: 200 }
  )

/** Swap the global fetch for a scripted responder; returns a call counter. */
function stubFetch(
  handler: (body: { model?: string }) => Response
): { calls: () => number } {
  let calls = 0
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    calls++
    const body = init?.body ? (JSON.parse(init.body) as { model?: string }) : {}
    return handler(body)
  }) as unknown as typeof fetch
  return { calls: () => calls }
}

// -------------------------------------- 1. a retired model fails instantly ---
{
  const stub = stubFetch(() => json(404, 'The `:free` variant has been retired.'))
  const client = new OpenRouterClient(() => 'sk-or-test')
  const started = Date.now()
  try {
    await client.chat({ model: dead, messages: [{ role: 'user', content: 'hi' }] })
    check('1', false, 'the request unexpectedly succeeded')
  } catch (err) {
    const e = err as OpenRouterError
    const elapsed = Date.now() - started
    check(
      '1',
      e.kind === 'model_unavailable' && stub.calls() === 1 && elapsed < 500,
      `kind=${e.kind} requests=${stub.calls()} elapsed=${elapsed}ms`
    )
  }
}

// ------------------------------- 2. the agent swaps model and cools it down ---
{
  const health = new ModelHealth()
  const stub = stubFetch((body) =>
    body.model === dead
      ? json(403, 'is only available on agentic harnesses')
      : sse('{"files":[]}')
  )

  const agent = new Agent('implementer', {
    client: new OpenRouterClient(() => 'sk-or-test'),
    budget: new Budget(400_000),
    bus,
    resolveModel: () => [dead, alive],
    health
  })

  const first = await agent.send({ role: 'implementer', runId: 'probe', content: 'go' })
  check(
    '2',
    first.model === alive && first.switched && health.isCoolingDown(dead),
    `used=${first.model} switched=${first.switched} coolingDown=${health.isCoolingDown(dead)} ` +
      `requests=${stub.calls()}`
  )

  const before = stub.calls()
  const second = await agent.send({ role: 'implementer', runId: 'probe', content: 'go' })
  check(
    '2b',
    second.model === alive && !second.switched && stub.calls() === before + 1,
    `used=${second.model} switched=${second.switched} requests=${stub.calls() - before}`
  )
}

// ------------------------------------- 3. a transient 5xx is still retried ---
{
  let n = 0
  const stub = stubFetch(() => (n++ === 0 ? json(500, 'upstream hiccup') : sse('ok')))
  const client = new OpenRouterClient(() => 'sk-or-test')
  const result = await client.chat({
    model: alive,
    messages: [{ role: 'user', content: 'hi' }]
  })
  check(
    '3',
    result.attempts === 2 && result.content === 'ok' && stub.calls() === 2,
    `attempts=${result.attempts} requests=${stub.calls()} content=${result.content}`
  )
}

console.log(failures === 0 ? '\n[probe] all checks passed' : `\n[probe] ${failures} check(s) failed`)
process.exitCode = failures === 0 ? 0 : 1
