/**
 * Anthropic provider adapter.
 */

import type {
  ProviderAdapter,
  ModelDescriptor,
  ConnectionHealth,
  ProviderChatRequest,
  ProviderChatResponse,
  StreamChunk,
  ModelCapabilities,
  ProviderConfig
} from './types'
import { AuthenticationError, RateLimitError, NetworkError, ProviderError } from './types'

export class AnthropicProvider implements ProviderAdapter {
  readonly id = 'anthropic'
  readonly name = 'Anthropic'
  readonly requiresKey = true
  readonly defaultBaseUrl = 'https://api.anthropic.com/v1'

  constructor(private readonly config: ProviderConfig) {}

  private get baseUrl(): string {
    return (this.config.baseUrl || this.defaultBaseUrl).replace(/\/+$/, '')
  }

  private getHeaders(): Record<string, string> {
    return {
      'x-api-key': this.config.credentials?.apiKey ?? '',
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
      ...(this.config.credentials?.customHeaders ?? {})
    }
  }

  async listModels(): Promise<ModelDescriptor[]> {
    return [
      {
        id: 'claude-3-5-sonnet-20241022',
        name: 'Claude 3.5 Sonnet',
        contextLength: 200000,
        capabilities: this.getCapabilities('claude-3-5-sonnet-20241022'),
        provider: this.id,
        isFree: false
      },
      {
        id: 'claude-3-opus-20240229',
        name: 'Claude 3 Opus',
        contextLength: 200000,
        capabilities: this.getCapabilities('claude-3-opus-20240229'),
        provider: this.id,
        isFree: false
      },
      {
        id: 'claude-3-5-haiku-20241022',
        name: 'Claude 3.5 Haiku',
        contextLength: 200000,
        capabilities: this.getCapabilities('claude-3-5-haiku-20241022'),
        provider: this.id,
        isFree: false
      }
    ]
  }

  async testConnection(): Promise<ConnectionHealth> {
    try {
      const models = await this.listModels()
      return { connected: true, models }
    } catch (err) {
      return {
        connected: false,
        error: err instanceof Error ? err.message : String(err),
        reason: 'unreachable'
      }
    }
  }

  async chat(request: ProviderChatRequest): Promise<ProviderChatResponse> {
    const systemMessage = request.messages.find((m) => m.role === 'system')?.content
    const nonSystemMessages = request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }))

    const body: Record<string, unknown> = {
      model: request.model,
      messages: nonSystemMessages,
      max_tokens: request.maxTokens ?? 8192,
      temperature: request.temperature ?? 0.3
    }
    if (systemMessage) body.system = systemMessage

    const res = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
      signal: request.signal
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      if (res.status === 401) throw new AuthenticationError(`Unauthorized: ${text}`)
      if (res.status === 429) throw new RateLimitError(`Rate limited`)
      throw new NetworkError(`Anthropic error ${res.status}: ${text}`)
    }

    const json = (await res.json()) as {
      content?: Array<{ text?: string }>
      usage?: { input_tokens?: number; output_tokens?: number }
    }

    const content = json.content?.[0]?.text ?? ''
    const usage = json.usage ?? { input_tokens: 0, output_tokens: 0 }

    return {
      content,
      usage: {
        promptTokens: usage.input_tokens ?? 0,
        completionTokens: usage.output_tokens ?? 0,
        totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0)
      },
      model: request.model,
      provider: this.id,
      attempts: 1
    }
  }

  async streamChat(
    request: ProviderChatRequest,
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal
  ): Promise<ProviderChatResponse> {
    const systemMessage = request.messages.find((m) => m.role === 'system')?.content
    const nonSystemMessages = request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }))

    const body: Record<string, unknown> = {
      model: request.model,
      messages: nonSystemMessages,
      max_tokens: request.maxTokens ?? 8192,
      temperature: request.temperature ?? 0.3,
      stream: true
    }
    if (systemMessage) body.system = systemMessage

    const res = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
      signal: signal ?? request.signal
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new NetworkError(`Anthropic stream error ${res.status}: ${text}`)
    }

    if (!res.body) throw new ProviderError('No body', 'network_error')

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let fullContent = ''
    let promptTokens = 0
    let completionTokens = 0

    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        const lines = decoder.decode(value, { stream: true }).split('\n')
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const data = trimmed.slice(5).trim()
          try {
            const parsed = JSON.parse(data) as {
              type?: string
              delta?: { text?: string }
              message?: { usage?: { input_tokens?: number } }
              usage?: { output_tokens?: number }
            }
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              const delta = parsed.delta.text
              fullContent += delta
              completionTokens++
              onChunk({ content: delta, isComplete: false })
            }
            if (parsed.usage?.output_tokens) {
              completionTokens = parsed.usage.output_tokens
            }
          } catch {
            // ignore
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    onChunk({ isComplete: true })

    return {
      content: fullContent,
      usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
      model: request.model,
      provider: this.id,
      attempts: 1
    }
  }

  getCapabilities(_modelId: string): ModelCapabilities {
    return { tools: true, vision: true, reasoning: true, maxOutputTokens: 8192 }
  }

  normalizeModelId(id: string): string {
    return id
  }

  ownsModel(): boolean {
    return false
  }
}
