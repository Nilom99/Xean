/**
 * Base OpenAI-compatible provider implementation (used by OpenAI, Groq, DeepSeek, Mistral, Custom, etc.)
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

export class BaseOpenAICompatibleProvider implements ProviderAdapter {
  constructor(
    readonly id: string,
    readonly name: string,
    readonly defaultBaseUrl: string,
    readonly requiresKey: boolean,
    protected readonly config: ProviderConfig
  ) {}

  protected get baseUrl(): string {
    return (this.config.baseUrl || this.defaultBaseUrl).replace(/\/+$/, '')
  }

  protected getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(this.config.credentials?.customHeaders ?? {})
    }
    const key = this.config.credentials?.apiKey
    if (key) {
      headers['Authorization'] = `Bearer ${key}`
    }
    return headers
  }

  async listModels(): Promise<ModelDescriptor[]> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: this.getHeaders()
      })
      if (!res.ok) throw new NetworkError(`Failed to fetch models: ${res.status}`)
      const data = (await res.json()) as { data?: Array<{ id: string; name?: string; max_model_len?: number }> }
      const models = data.data ?? []
      return models.map((m) => ({
        id: m.id,
        name: m.name ?? m.id,
        contextLength: m.max_model_len ?? 128000,
        capabilities: this.getCapabilities(m.id),
        provider: this.id,
        isFree: false
      }))
    } catch {
      return []
    }
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
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature ?? 0.3,
        max_tokens: request.maxTokens ?? 8192
      }),
      signal: request.signal
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      if (res.status === 401) throw new AuthenticationError(`Unauthorized: ${text}`)
      if (res.status === 429) throw new RateLimitError(`Rate limited`)
      throw new NetworkError(`API error ${res.status}: ${text}`)
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    }

    const content = json.choices?.[0]?.message?.content ?? ''
    const usage = json.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }

    return {
      content,
      usage: {
        promptTokens: usage.prompt_tokens ?? 0,
        completionTokens: usage.completion_tokens ?? 0,
        totalTokens: usage.total_tokens ?? 0
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
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature ?? 0.3,
        max_tokens: request.maxTokens ?? 8192,
        stream: true
      }),
      signal: signal ?? request.signal
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new NetworkError(`Stream error ${res.status}: ${text}`)
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
          if (data === '[DONE]') continue
          try {
            const parsed = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string } }>
            }
            const delta = parsed.choices?.[0]?.delta?.content ?? ''
            if (delta) {
              fullContent += delta
              completionTokens++
              onChunk({ content: delta, isComplete: false })
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
    return { tools: true, vision: true, reasoning: false, maxOutputTokens: 8192 }
  }

  normalizeModelId(id: string): string {
    return id
  }

  ownsModel(): boolean {
    return false
  }
}
