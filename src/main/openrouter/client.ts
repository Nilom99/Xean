import type { ChatMessage } from './context'
import { catalog } from './catalog'
import { consumeStream } from './stream'

const API_URL = 'https://openrouter.ai/api/v1/chat/completions'

/** Backoff schedule required by the spec: 1s, 4s, 12s, 30s with jitter. */
export const BACKOFF_SCHEDULE_MS = [1_000, 4_000, 12_000, 30_000]
const MAX_SERVER_RETRIES = 3
const MAX_RATE_LIMIT_RETRIES = BACKOFF_SCHEDULE_MS.length

/**
 * Default output budget per request.
 *
 * Large enough for a complete source file, small enough to stay cheap on the
 * free tier.
 */
export const DEFAULT_MAX_TOKENS = 8192

/**
 * Default cap on reasoning tokens.
 *
 * Reasoning is billed against the output budget, so an uncapped reasoning
 * model can spend the whole budget thinking and reply with nothing at all.
 * 1024 tokens is enough to think and still leaves room for the answer.
 */
export const DEFAULT_REASONING_MAX_TOKENS = 1024

export type ClientErrorKind =
  | 'auth'
  | 'credits'
  | 'rate_limit'
  | 'server'
  | 'network'
  | 'blocked'
  /**
   * The model itself is gone or not served to this account (404 / 403).
   *
   * Retrying cannot help — the model must be swapped for another free one —
   * so this kind is never retried by the client and is always eligible for
   * the agent's fallback chain.
   */
  | 'model_unavailable'

export class OpenRouterError extends Error {
  constructor(
    message: string,
    readonly kind: ClientErrorKind,
    readonly status?: number,
    readonly retryAfterMs?: number
  ) {
    super(message)
    this.name = 'OpenRouterError'
  }
}

export interface Usage {
  promptTokens: number
  completionTokens: number
}

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  stop?: string[]
  signal?: AbortSignal
  onDelta?: (text: string) => void
  /**
   * Cap on the tokens a reasoning model may spend thinking.
   *
   * Reasoning tokens are billed against `max_tokens`, so a model that thinks
   * for 4096 tokens returns an *empty* answer. Capping the reasoning leaves
   * room for the actual reply.
   */
  reasoningMaxTokens?: number
}

export interface ChatResult {
  content: string
  usage: Usage
  model: string
  /** Number of attempts made (1 = first try succeeded). */
  attempts: number
}

/** Scrub anything that looks like an OpenRouter key out of free-form text. */
export function redactSecrets(text: string): string {
  return text.replace(/sk-or-[A-Za-z0-9_-]+/g, 'sk-or-***REDACTED***')
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'))
      return
    }
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new Error('aborted'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * OpenRouter HTTP client.
 *
 * - Streams SSE chunks and emits deltas as they arrive.
 * - 429 -> exponential backoff with jitter, honouring `Retry-After`.
 * - 5xx / network -> up to 3 retries.
 * - 401 / 402 -> surfaced immediately, never retried.
 * - 403 / 404 -> the model itself is unusable; never retried, so the agent
 *   swaps it for the next free model in the chain at once.
 * - Every request is guarded by `assertFreeModel`.
 */
export class OpenRouterClient {
  constructor(private readonly getApiKey: () => string | null) {}

  private headers(): Record<string, string> {
    const key = this.getApiKey()
    if (!key) {
      throw new OpenRouterError('No OpenRouter API key configured.', 'auth')
    }
    return {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.CODEX_LOCAL_REFERER ?? 'http://localhost:7777',
      'X-Title': 'Codex Local'
    }
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    // Hard guard: never talk to a model that is not free-tier.
    catalog.assertFreeModel(request.model)

    let attempt = 0
    let rateLimitRetries = 0
    let serverRetries = 0

    for (;;) {
      attempt++
      try {
        const result = await this.attempt(request)
        return { ...result, attempts: attempt }
      } catch (err) {
        if (!(err instanceof OpenRouterError)) throw err
        // 401 / 402 / blocked / retired model -> hard stop, no retry.
        if (
          err.kind === 'auth' ||
          err.kind === 'credits' ||
          err.kind === 'blocked' ||
          err.kind === 'model_unavailable'
        ) {
          throw err
        }

        if (err.kind === 'rate_limit') {
          if (rateLimitRetries >= MAX_RATE_LIMIT_RETRIES) throw err
          const base =
            BACKOFF_SCHEDULE_MS[Math.min(rateLimitRetries, BACKOFF_SCHEDULE_MS.length - 1)]
          rateLimitRetries++
          const jitter = Math.floor(Math.random() * 500)
          const wait = Math.max(base + jitter, err.retryAfterMs ?? 0)
          await sleep(wait, request.signal)
          continue
        }

        if (err.kind === 'server' || err.kind === 'network') {
          if (serverRetries >= MAX_SERVER_RETRIES) throw err
          serverRetries++
          await sleep(1_000 * 2 ** serverRetries, request.signal)
          continue
        }
        throw err
      }
    }
  }

  private async attempt(request: ChatRequest): Promise<ChatResult> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages,
      stream: true,
      temperature: request.temperature ?? 0.3,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(request.stop && request.stop.length > 0 ? { stop: request.stop } : {})
    }

    // Reasoning models bill their thinking against max_tokens. Without a cap a
    // chatty model can spend the whole budget thinking and return nothing.
    if (request.reasoningMaxTokens && request.reasoningMaxTokens > 0) {
      body.reasoning = { max_tokens: request.reasoningMaxTokens }
    }

    let res: Response
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: request.signal
      })
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err
      throw new OpenRouterError(
        `Network error reaching OpenRouter: ${redactSecrets(
          err instanceof Error ? err.message : String(err)
        )}`,
        'network'
      )
    }

    if (!res.ok) {
      const bodyText = await res.text().catch(() => '')
      const detail = redactSecrets(bodyText).slice(0, 400)
      if (res.status === 401) {
        throw new OpenRouterError(
          `OpenRouter rejected the API key (401). Check the key in Settings. ${detail}`,
          'auth',
          401
        )
      }
      if (res.status === 402) {
        throw new OpenRouterError(
          `OpenRouter credits exhausted (402). ${detail}`,
          'credits',
          402
        )
      }
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after'))
        const retryAfterMs =
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0
        throw new OpenRouterError(
          `Rate limited by OpenRouter (429) for ${request.model}.`,
          'rate_limit',
          429,
          retryAfterMs
        )
      }
      if (res.status === 403) {
        // OpenRouter answer a 403 per model, e.g. "…is only available on
        // agentic harnesses". The model cannot be used by this account, so
        // fall back to another free model instead of retrying this one.
        throw new OpenRouterError(
          `OpenRouter refused ${request.model} (403). ${detail}`,
          'model_unavailable',
          403
        )
      }
      if (res.status === 404) {
        // The `:free` variant was retired (or the id never existed). Retrying
        // is pointless; the fallback chain has to move on.
        throw new OpenRouterError(
          `OpenRouter does not serve ${request.model} any more (404). ${detail}`,
          'model_unavailable',
          404
        )
      }
      if (res.status >= 500) {
        throw new OpenRouterError(
          `OpenRouter server error (${res.status}). ${detail}`,
          'server',
          res.status
        )
      }
      throw new OpenRouterError(
        `OpenRouter request failed (${res.status}). ${detail}`,
        'server',
        res.status
      )
    }

    return consumeStream(res, request)
  }
}
