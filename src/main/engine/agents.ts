import type { Role } from '@shared/types'
import {
  OpenRouterClient,
  OpenRouterError,
  redactSecrets,
  DEFAULT_MAX_TOKENS,
  DEFAULT_REASONING_MAX_TOKENS
} from '../openrouter/client'
import { catalog } from '../openrouter/catalog'
import {
  modelHealth,
  RATE_LIMIT_COOLDOWN_MS,
  UNAVAILABLE_COOLDOWN_MS,
  type ModelHealth
} from '../openrouter/modelHealth'
import type { Budget } from './budget'
import type { Bus } from './bus'
import { ContextWindow, type ChatMessage } from '../openrouter/context'
import { ROLE_SYSTEM_PROMPTS, FORMAT_REMINDER } from './roles'

/**
 * True when the failure was a model that answered with nothing.
 *
 * The message is produced by the stream reader, which knows whether the model
 * spent its budget on reasoning.
 */
export function isEmptyAnswerError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return (
    err.message.includes('returned no answer') ||
    err.message.includes('returned an empty answer')
  )
}

export interface AgentDeps {
  client: OpenRouterClient
  budget: Budget
  bus: Bus
  /** Resolve the model for a role, honouring the configured fallback chain. */
  resolveModel: (role: Role) => string[]
  /**
   * Record of models that are currently refusing requests.
   *
   * Defaults to the process-wide registry, so one exhausted free model is not
   * re-discovered (and re-waited-on) by every task of the run.
   */
  health?: ModelHealth
}

export interface AgentRequest {
  role: Role
  runId: string
  taskId?: string
  /** The prompt content for this turn. */
  content: string
  /** Extra context (scratchpad) prepended to the user message. */
  scratchpad?: string
  temperature?: number
  maxTokens?: number
  /**
   * Cap on the reasoning tokens the model may spend.
   *
   * Lowered automatically when a model answers with nothing.
   */
  reasoningMaxTokens?: number
  signal?: AbortSignal
  /** Rolling context to continue an existing conversation. */
  context?: ContextWindow
}

export interface AgentResponse {
  content: string
  model: string
  usage: { promptTokens: number; completionTokens: number }
  /** True when the primary model failed and a fallback was used. */
  switched: boolean
}

/**
 * Describe the machine the agents are running on.
 *
 * Without this, models propose Unix commands (`ls`, `find`, `pwd`) that fail
 * outright on Windows, where the sandbox executes through cmd.exe.
 */
function platformHint(): string {
  if (process.platform === 'win32') {
    return [
      'The workspace runs on Windows (cmd.exe).',
      'Use Windows commands only: dir instead of ls, type instead of cat,',
      'del instead of rm, copy instead of cp, move instead of mv,',
      'where instead of which, xcopy instead of cp -r.',
      'Prefer the npm scripts of the project over raw shell commands.'
    ].join(' ')
  }
  if (process.platform === 'darwin') {
    return [
      'The workspace runs on macOS (zsh).',
      'Use macOS/Linux commands only. Prefer the npm scripts of the project',
      'over raw shell commands.'
    ].join(' ')
  }
  return [
    'The workspace runs on Linux (sh).',
    'Use Linux commands only. Prefer the npm scripts of the project over raw',
    'shell commands.'
  ].join(' ')
}

/**
 * A single agent instance: one model, one system prompt, one scratchpad.
 *
 * The fallback chain is walked automatically when the primary model is rate
 * limited or unavailable, and the swap is logged as a visible event.
 */
export class Agent {
  constructor(
    readonly role: Role,
    private readonly deps: AgentDeps
  ) {}

  /** The shared record of models that are refusing requests. */
  private get health(): ModelHealth {
    return this.deps.health ?? modelHealth
  }

  /**
   * Take a model out of the rotation for a while.
   *
   * A free-tier rate limit is per model and does not clear inside the client's
   * retry window, and a retired model never comes back. Without this, every
   * following task repeats the same minute of backoff before failing again.
   */
  private recordFailure(model: string, err: OpenRouterError): void {
    if (err.kind === 'rate_limit') {
      const hinted = err.retryAfterMs ?? 0
      this.health.penalize(model, hinted > 0 ? hinted : RATE_LIMIT_COOLDOWN_MS)
      return
    }
    if (err.kind === 'model_unavailable') {
      this.health.penalize(model, UNAVAILABLE_COOLDOWN_MS)
    }
  }

  private get systemPrompt(): string {
    return `${ROLE_SYSTEM_PROMPTS[this.role]}\n\n${platformHint()}\n\n${FORMAT_REMINDER}`
  }

  async send(request: AgentRequest): Promise<AgentResponse> {
    // Models that just failed are moved behind the healthy ones, so a task
    // does not repeat a wait the previous task already paid for.
    const candidates = this.health.preferReady(this.deps.resolveModel(this.role))
    if (candidates.length === 0) {
      throw new Error(
        `No free model is assigned to the ${this.role} role. Open Settings and pick one.`
      )
    }

    const exhausted = this.deps.budget.exhaustedReason()
    if (exhausted) throw new Error(exhausted)

    const context = request.context ?? new ContextWindow()
    const userContent = request.scratchpad
      ? `${request.scratchpad}\n\n${request.content}`
      : request.content
    context.push({ role: 'user', content: userContent })

    const messages: ChatMessage[] = context.build(this.systemPrompt)

    let lastError: unknown = null
    // Reasoning models can burn the whole output budget thinking and answer
    // with nothing. The first attempt gets the standard cap; the retry asks
    // the model to think less so that an answer actually fits.
    let reasoningMaxTokens =
      request.reasoningMaxTokens ?? DEFAULT_REASONING_MAX_TOKENS
    let retried = false

    for (let i = 0; i < candidates.length; i++) {
      const model = candidates[i]
      const switched = i > 0

      try {
        // Hard guard right before the request leaves the process.
        catalog.assertFreeModel(model)

        const result = await this.deps.client.chat({
          model,
          messages,
          temperature: request.temperature ?? 0.3,
          maxTokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
          reasoningMaxTokens,
          signal: request.signal,
          onDelta: (text) => {
            this.deps.bus.emitEvent({
              type: 'AGENT_DELTA',
              ts: Date.now(),
              runId: request.runId,
              role: this.role,
              taskId: request.taskId,
              text
            })
          }
        })

        if (switched) {
          this.deps.bus.emitEvent({
            type: 'MODEL_SWITCHED',
            ts: Date.now(),
            runId: request.runId,
            role: this.role,
            from: candidates[0],
            to: model,
            reason: 'primary model unavailable — continued on fallback free model'
          })
        }

        this.deps.budget.record(model, this.role, result.usage.promptTokens, result.usage.completionTokens)
        this.deps.bus.emitEvent({
          type: 'USAGE',
          ts: Date.now(),
          runId: request.runId,
          model,
          role: this.role,
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens
        })

        context.push({ role: 'assistant', content: result.content })
        return {
          content: result.content,
          model,
          usage: result.usage,
          switched
        }
      } catch (err) {
        lastError = err
        if (err instanceof OpenRouterError) this.recordFailure(model, err)

        const canFallback =
          err instanceof OpenRouterError &&
          (err.kind === 'rate_limit' ||
            err.kind === 'server' ||
            err.kind === 'network' ||
            err.kind === 'model_unavailable')

        // The model thought until the budget ran out and returned nothing.
        // Ask it to think less and try once more before giving up.
        if (!retried && isEmptyAnswerError(err)) {
          retried = true
          reasoningMaxTokens = Math.max(256, Math.floor(reasoningMaxTokens / 2))
          this.deps.bus.emitEvent({
            type: 'ERROR',
            ts: Date.now(),
            runId: request.runId,
            scope: `${this.role}:${model}`,
            message: `${model} returned an empty answer; retrying with a smaller reasoning budget.`
          })
          i-- // retry the same model
          continue
        }

        if (!canFallback || i === candidates.length - 1) break

        this.deps.bus.emitEvent({
          type: 'ERROR',
          ts: Date.now(),
          runId: request.runId,
          scope: `${this.role}:${model}`,
          message: redactSecrets(
            err instanceof Error ? err.message : String(err)
          )
        })
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`The ${this.role} agent could not complete its request.`)
  }
}
