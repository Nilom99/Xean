/**
 * LlmClient — the interface the Agent class uses to talk to any LLM backend.
 *
 * Both the legacy OpenRouterClient and the new ProviderManager can be
 * wrapped to satisfy this interface, so the Agent class is provider-agnostic.
 */

import type { ChatMessage } from '../openrouter/context'

export interface LlmUsage {
  promptTokens: number
  completionTokens: number
}

export interface LlmChatRequest {
  model: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  stop?: string[]
  signal?: AbortSignal
  onDelta?: (text: string) => void
  reasoningMaxTokens?: number
}

export interface LlmChatResult {
  content: string
  usage: LlmUsage
  model: string
  attempts: number
  /** Which provider served the request (for reporting). */
  provider?: string
}

export interface LlmClient {
  chat(request: LlmChatRequest): Promise<LlmChatResult>
}

/**
 * Wraps a ProviderManager to satisfy the LlmClient interface.
 *
 * Uses streamChat under the hood so that onDelta callbacks fire
 * as tokens arrive, matching the OpenRouterClient behaviour.
 */
import type { ProviderManager } from './providerManager'
import type { ProviderChatRequest, StreamChunk } from './types'

export class ProviderManagerClient implements LlmClient {
  constructor(private readonly manager: ProviderManager) {}

  async chat(request: LlmChatRequest): Promise<LlmChatResult> {
    const providerRequest: ProviderChatRequest = {
      model: request.model,
      messages: request.messages,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      stop: request.stop,
      signal: request.signal,
      reasoningMaxTokens: request.reasoningMaxTokens
    }

    // Use streamChat so onDelta fires as tokens arrive
    const result = await this.manager.streamChat(
      providerRequest,
      (chunk: StreamChunk) => {
        if (chunk.content && request.onDelta) {
          request.onDelta(chunk.content)
        }
      },
      request.signal
    )

    return {
      content: result.content,
      usage: {
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens
      },
      model: result.model,
      attempts: result.attempts,
      provider: result.provider
    }
  }
}

/**
 * Wraps the legacy OpenRouterClient to satisfy the LlmClient interface.
 * This is a thin passthrough for backward compatibility.
 */
import type { OpenRouterClient } from '../openrouter/client'

export class OpenRouterClientAdapter implements LlmClient {
  constructor(private readonly client: OpenRouterClient) {}

  async chat(request: LlmChatRequest): Promise<LlmChatResult> {
    const result = await this.client.chat({
      model: request.model,
      messages: request.messages,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      stop: request.stop,
      signal: request.signal,
      onDelta: request.onDelta,
      reasoningMaxTokens: request.reasoningMaxTokens
    })
    return {
      content: result.content,
      usage: result.usage,
      model: result.model,
      attempts: result.attempts,
      provider: 'openrouter'
    }
  }
}