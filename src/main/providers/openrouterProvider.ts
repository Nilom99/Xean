/**
 * OpenRouter provider wrapper.
 *
 * This module wraps the existing OpenRouter client into the unified ProviderAdapter interface.
 */

import type {
  ProviderAdapter,
  ModelDescriptor,
  ConnectionHealth,
  ProviderChatRequest,
  ProviderChatResponse,
  StreamChunk,
  ModelCapabilities,
  ProviderCredentials
} from './types'
import { AuthenticationError, RateLimitError, NetworkError, ProviderError } from './types'
import { OpenRouterClient } from '../openrouter/client'
import { catalog } from '../openrouter/catalog'
import { OpenRouterError } from '../openrouter/client'

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'

export class OpenRouterProvider implements ProviderAdapter {
  readonly id = 'openrouter'
  readonly name = 'OpenRouter'
  readonly requiresKey = true
  readonly defaultBaseUrl = DEFAULT_BASE_URL

  private client: OpenRouterClient | null = null

  constructor(private readonly config: {
    baseUrl: string;
    credentials?: ProviderCredentials;
  }) {
    if (this.config.credentials?.apiKey) {
      this.client = new OpenRouterClient(() => this.config.credentials!.apiKey!)
    }
  }

  async listModels(): Promise<ModelDescriptor[]> {
    const models = catalog.list()
    return models.map((m) => ({
      id: m.id,
      name: m.name,
      contextLength: m.contextLength,
      capabilities: this.getCapabilities(m.id),
      provider: this.id,
      isFree: true,
      pricing: { prompt: 0, completion: 0 }
    }))
  }

  async testConnection(credentials?: ProviderCredentials): Promise<ConnectionHealth> {
    if (credentials?.apiKey) {
      this.client = new OpenRouterClient(() => credentials.apiKey ?? null)
    }

    if (!this.client) {
      return { connected: false, error: 'No API key configured', reason: 'auth_failed' }
    }

    try {
      const models = await catalog.refresh()
      return {
        connected: true,
        models: models.slice(0, 10).map((m) => ({
          id: m.id,
          name: m.name,
          contextLength: m.contextLength,
          capabilities: this.getCapabilities(m.id),
          provider: this.id,
          isFree: true
        }))
      }
    } catch (err) {
      return {
        connected: false,
        error: err instanceof Error ? err.message : String(err),
        reason: 'unreachable'
      }
    }
  }

  async chat(request: ProviderChatRequest): Promise<ProviderChatResponse> {
    if (!this.client) {
      throw new ProviderError('OpenRouter client not initialized', 'network_error')
    }

    try {
      const result = await this.client.chat({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        stop: request.stop,
        reasoningMaxTokens: request.reasoningMaxTokens
      })

      return {
        content: result.content,
        usage: {
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          totalTokens: result.usage.promptTokens + result.usage.completionTokens
        },
        model: result.model,
        provider: this.id,
        attempts: result.attempts
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (err instanceof OpenRouterError) {
        if (err.kind === 'auth') {
          throw new AuthenticationError(message, err)
        }
        if (err.kind === 'rate_limit') {
          throw new RateLimitError(message, err.retryAfterMs, err)
        }
        if (err.kind === 'model_unavailable') {
          throw new NetworkError(message, err)
        }
      }
      throw new NetworkError(message, err)
    }
  }

  async streamChat(
    request: ProviderChatRequest,
    onChunk: (chunk: StreamChunk) => void,
    _signal?: AbortSignal
  ): Promise<ProviderChatResponse> {
    if (!this.client) {
      throw new ProviderError('OpenRouter client not initialized', 'network_error')
    }

    try {
      const result = await this.client.chat({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        stop: request.stop,
        reasoningMaxTokens: request.reasoningMaxTokens,
        onDelta: (text) => {
          onChunk({ content: text, isComplete: false })
        }
      })

      return {
        content: result.content,
        usage: {
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          totalTokens: result.usage.promptTokens + result.usage.completionTokens
        },
        model: result.model,
        provider: this.id,
        attempts: result.attempts
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (err instanceof OpenRouterError) {
        if (err.kind === 'auth') {
          throw new AuthenticationError(message, err)
        }
        if (err.kind === 'rate_limit') {
          throw new RateLimitError(message, err.retryAfterMs, err)
        }
        if (err.kind === 'model_unavailable') {
          throw new NetworkError(message, err)
        }
      }
      throw new NetworkError(message, err)
    }
  }

  getCapabilities(modelId: string): ModelCapabilities {
    return {
      tools: true,
      vision: modelId.includes('vision') || modelId.includes('gpt-4') || modelId.includes('claude'),
      reasoning: modelId.includes('sonnet') || modelId.includes('opus') || modelId.includes('reason'),
      maxOutputTokens: 32000
    }
  }

  normalizeModelId(modelId: string): string {
    return modelId
  }

  ownsModel(modelId: string): boolean {
    return catalog.isFree(modelId)
  }
}

// Also export a mock for testing
export const openRouterDefaultProvider = new OpenRouterProvider({ baseUrl: DEFAULT_BASE_URL })