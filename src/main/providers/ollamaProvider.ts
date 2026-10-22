/**
 * Ollama local provider adapter.
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
import { NetworkError, ProviderError } from './types'

export class OllamaProvider implements ProviderAdapter {
  readonly id = 'ollama'
  readonly name = 'Ollama'
  readonly requiresKey = false
  readonly defaultBaseUrl = 'http://localhost:11434'

  constructor(private readonly config: ProviderConfig) {}

  private get baseUrl(): string {
    return (this.config.baseUrl || this.defaultBaseUrl).replace(/\/+$/, '')
  }

  async listModels(): Promise<ModelDescriptor[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`)
      if (!res.ok) throw new NetworkError(`Ollama tags failed: ${res.status}`)
      const data = (await res.json()) as { models?: Array<{ name: string; size?: number }> }
      const models = data.models ?? []
      return models.map((m) => ({
        id: m.name,
        name: m.name,
        contextLength: 16384,
        capabilities: this.getCapabilities(m.name),
        provider: this.id,
        isFree: true
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
    const url = `${this.baseUrl}/api/chat`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
        stream: false,
        options: {
          temperature: request.temperature ?? 0.3,
          num_predict: request.maxTokens ?? 4096
        }
      }),
      signal: request.signal
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new NetworkError(`Ollama error ${res.status}: ${text}`)
    }

    const json = (await res.json()) as {
      message?: { content?: string }
      prompt_eval_count?: number
      eval_count?: number
    }

    const content = json.message?.content ?? ''
    const promptTokens = json.prompt_eval_count ?? 0
    const completionTokens = json.eval_count ?? 0

    return {
      content,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens
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
    const url = `${this.baseUrl}/api/chat`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
        options: {
          temperature: request.temperature ?? 0.3,
          num_predict: request.maxTokens ?? 4096
        }
      }),
      signal: signal ?? request.signal
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new NetworkError(`Ollama stream error ${res.status}: ${text}`)
    }

    if (!res.body) {
      throw new ProviderError('No response body for stream', 'network_error')
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let fullContent = ''
    let promptTokens = 0
    let completionTokens = 0

    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        const chunkStr = decoder.decode(value, { stream: true })
        const lines = chunkStr.split('\n')
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const parsed = JSON.parse(line) as {
              message?: { content?: string }
              prompt_eval_count?: number
              eval_count?: number
              done?: boolean
            }
            const delta = parsed.message?.content ?? ''
            if (delta) {
              fullContent += delta
              completionTokens++
              onChunk({ content: delta, isComplete: false })
            }
            if (parsed.prompt_eval_count) promptTokens = parsed.prompt_eval_count
            if (parsed.eval_count) completionTokens = parsed.eval_count
          } catch {
            // ignore JSON parse errors on partial lines
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    onChunk({ isComplete: true })

    return {
      content: fullContent,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens
      },
      model: request.model,
      provider: this.id,
      attempts: 1
    }
  }

  getCapabilities(_modelId: string): ModelCapabilities {
    return {
      tools: true,
      vision: false,
      reasoning: false,
      maxOutputTokens: 8192
    }
  }

  normalizeModelId(modelId: string): string {
    return modelId
  }

  ownsModel(): boolean {
    return true
  }
}
