/**
 * Google Gemini provider adapter.
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

export class GeminiProvider implements ProviderAdapter {
  readonly id = 'gemini'
  readonly name = 'Google Gemini'
  readonly requiresKey = true
  readonly defaultBaseUrl = 'https://generativelanguage.googleapis.com/v1beta'

  constructor(private readonly config: ProviderConfig) {}

  private get baseUrl(): string {
    return (this.config.baseUrl || this.defaultBaseUrl).replace(/\/+$/, '')
  }

  async listModels(): Promise<ModelDescriptor[]> {
    return [
      {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        contextLength: 1048576,
        capabilities: this.getCapabilities('gemini-2.5-flash'),
        provider: this.id,
        isFree: true
      },
      {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        contextLength: 2097152,
        capabilities: this.getCapabilities('gemini-2.5-pro'),
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
    const apiKey = this.config.credentials?.apiKey ?? ''
    const url = `${this.baseUrl}/models/${request.model}:generateContent?key=${apiKey}`

    const contents = request.messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }))

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents }),
      signal: request.signal
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      if (res.status === 401 || res.status === 403) throw new AuthenticationError(`Unauthorized: ${text}`)
      if (res.status === 429) throw new RateLimitError(`Rate limited`)
      throw new NetworkError(`Gemini error ${res.status}: ${text}`)
    }

    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
    }

    const content = json.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    const usage = json.usageMetadata ?? { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 }

    return {
      content,
      usage: {
        promptTokens: usage.promptTokenCount ?? 0,
        completionTokens: usage.candidatesTokenCount ?? 0,
        totalTokens: usage.totalTokenCount ?? 0
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
    const apiKey = this.config.credentials?.apiKey ?? ''
    const url = `${this.baseUrl}/models/${request.model}:streamGenerateContent?alt=sse&key=${apiKey}`

    const contents = request.messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }))

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents }),
      signal: signal ?? request.signal
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new NetworkError(`Gemini stream error ${res.status}: ${text}`)
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
              candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
              usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
            }
            const delta = parsed.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
            if (delta) {
              fullContent += delta
              completionTokens++
              onChunk({ content: delta, isComplete: false })
            }
            if (parsed.usageMetadata) {
              promptTokens = parsed.usageMetadata.promptTokenCount ?? promptTokens
              completionTokens = parsed.usageMetadata.candidatesTokenCount ?? completionTokens
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
