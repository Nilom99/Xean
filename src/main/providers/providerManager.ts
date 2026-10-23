/**
 * ProviderManager — the single entry point the engine uses to talk to any LLM.
 *
 * Replaces the direct `OpenRouterClient` dependency in `Agent` and
 * `Orchestrator`. It owns:
 *   - the set of enabled providers (from config)
 *   - per-provider credentials (from the OS keychain)
 *   - health tracking and fallback chains
 *   - local-first routing (prefer local providers when available)
 *
 * The engine calls `manager.chat()` / `manager.streamChat()` and never
 * touches a specific provider adapter directly.
 */

import type {
  ProviderAdapter,
  ProviderChatRequest,
  ProviderChatResponse,
  StreamChunk,
  ProviderConfig,
  ModelDescriptor
} from './types'
import { ProviderError, RateLimitError, AuthenticationError } from './types'
import { createProvider, listProviderIds } from './registry'
import { getApiKey } from '../secrets'
import { catalog } from '../openrouter/catalog'

export interface ProviderManagerOptions {
  providers: ProviderConfig[]
  localFirst?: boolean
  maxRetries?: number
}

export interface ProviderStatus {
  id: string
  name: string
  enabled: boolean
  isLocal: boolean
  connected: boolean
  modelCount: number
  error?: string
}

export class ProviderManager {
  private adapters = new Map<string, ProviderAdapter>()
  private health = new Map<string, { healthy: boolean; lastChecked: number; cooldownUntil: number }>()
  private localFirst: boolean
  private maxRetries: number
  private configs: ProviderConfig[]

  constructor(options: ProviderManagerOptions) {
    this.localFirst = options.localFirst ?? true
    this.maxRetries = options.maxRetries ?? 2
    this.configs = options.providers
    this.rebuild(options.providers)
  }

  rebuild(providers: ProviderConfig[]): void {
    this.configs = providers
    this.adapters.clear()
    this.health.clear()
    for (const pc of providers) {
      if (!pc.enabled) continue
      const adapter = createProvider(pc)
      if (adapter) this.adapters.set(pc.id, adapter)
    }
  }

  setLocalFirst(localFirst: boolean): void {
    this.localFirst = localFirst
  }

  static registeredIds(): string[] {
    return listProviderIds()
  }

  getAdapter(providerId: string): ProviderAdapter | null {
    return this.adapters.get(providerId) ?? null
  }

  async checkAllHealth(): Promise<ProviderStatus[]> {
    const results: ProviderStatus[] = []
    for (const [id, adapter] of this.adapters) {
      const config = this.configs.find((c) => c.id === id)
      try {
        const health = await adapter.testConnection()
        const connected = health.connected
        this.health.set(id, {
          healthy: connected,
          lastChecked: Date.now(),
          cooldownUntil: connected ? 0 : Date.now() + 30_000
        })
        results.push({
          id,
          name: adapter.name,
          enabled: true,
          isLocal: config?.isLocal ?? false,
          connected,
          modelCount: connected ? (health as { models: ModelDescriptor[] }).models.length : 0,
          error: connected ? undefined : (health as { error: string }).error
        })
      } catch (err) {
        this.health.set(id, {
          healthy: false,
          lastChecked: Date.now(),
          cooldownUntil: Date.now() + 30_000
        })
        results.push({
          id,
          name: adapter.name,
          enabled: true,
          isLocal: config?.isLocal ?? false,
          connected: false,
          modelCount: 0,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    }
    return results
  }

  async checkHealth(providerId: string): Promise<ProviderStatus | null> {
    const adapter = this.adapters.get(providerId)
    if (!adapter) return null
    const config = this.configs.find((c) => c.id === providerId)
    try {
      const health = await adapter.testConnection()
      const connected = health.connected
      this.health.set(providerId, {
        healthy: connected,
        lastChecked: Date.now(),
        cooldownUntil: connected ? 0 : Date.now() + 30_000
      })
      return {
        id: providerId,
        name: adapter.name,
        enabled: true,
        isLocal: config?.isLocal ?? false,
        connected,
        modelCount: connected ? (health as { models: ModelDescriptor[] }).models.length : 0,
        error: connected ? undefined : (health as { error: string }).error
      }
    } catch (err) {
      this.health.set(providerId, {
        healthy: false,
        lastChecked: Date.now(),
        cooldownUntil: Date.now() + 30_000
      })
      return {
        id: providerId,
        name: adapter.name,
        enabled: true,
        isLocal: config?.isLocal ?? false,
        connected: false,
        modelCount: 0,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }

  async chat(request: ProviderChatRequest, preferredProviderId?: string): Promise<ProviderChatResponse> {
    const chain = this.buildChain(preferredProviderId)
    let lastError: unknown = null

    for (const providerId of chain) {
      const adapter = this.adapters.get(providerId)
      if (!adapter) continue
      if (!this.isCooledDown(providerId)) continue

      for (let attempt = 0; attempt < this.maxRetries; attempt++) {
        try {
          const result = await adapter.chat(request)
          this.recordSuccess(providerId)
          return result
        } catch (err) {
          lastError = err
          this.recordFailure(providerId, err)
          if (err instanceof AuthenticationError) break
          if (err instanceof RateLimitError) {
            const waitMs = err.retryAfterMs ?? 5000
            await sleep(Math.min(waitMs, 15000))
            continue
          }
          if (attempt < this.maxRetries - 1) {
            await sleep(1000 * 2 ** attempt)
          }
        }
      }
    }

    throw lastError ?? new ProviderError('All providers failed', 'network_error')
  }

  async streamChat(
    request: ProviderChatRequest,
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal,
    preferredProviderId?: string
  ): Promise<ProviderChatResponse> {
    const chain = this.buildChain(preferredProviderId)
    let lastError: unknown = null

    for (const providerId of chain) {
      const adapter = this.adapters.get(providerId)
      if (!adapter) continue
      if (!this.isCooledDown(providerId)) continue

      try {
        const result = await adapter.streamChat(request, onChunk, signal)
        this.recordSuccess(providerId)
        return result
      } catch (err) {
        lastError = err
        this.recordFailure(providerId, err)
        if (err instanceof AuthenticationError) continue
      }
    }

    throw lastError ?? new ProviderError('All streaming providers failed', 'network_error')
  }

  resolveProviderForModel(modelId: string): string | null {
    for (const [id, adapter] of this.adapters) {
      if (adapter.ownsModel(modelId)) return id
    }
    if (catalog.isFree(modelId)) return 'openrouter'
    return null
  }

  private buildChain(preferredProviderId?: string): string[] {
    const all = listProviderIds()
    if (!preferredProviderId) return all
    // When localFirst is enabled, local providers are placed first
    const filtered = this.localFirst
      ? all.filter((id) => this.isProviderLocal(id))
      : all
    return [preferredProviderId, ...filtered.filter((id) => id !== preferredProviderId)]
  }

  private isProviderLocal(providerId: string): boolean {
    const config = this.configs.find((c) => c.id === providerId)
    return config ? config.isLocal : false
  }

  private isCooledDown(providerId: string): boolean {
    const h = this.health.get(providerId)
    if (!h) return true
    if (h.healthy) return true
    return Date.now() > h.cooldownUntil
  }

  private recordFailure(providerId: string, err: unknown): void {
    const cooldown = err instanceof RateLimitError ? 60_000 : 30_000
    this.health.set(providerId, {
      healthy: false,
      lastChecked: Date.now(),
      cooldownUntil: Date.now() + cooldown
    })
  }

  private recordSuccess(providerId: string): void {
    this.health.set(providerId, {
      healthy: true,
      lastChecked: Date.now(),
      cooldownUntil: 0
    })
  }

  getConfigs(): ProviderConfig[] {
    return this.configs
  }

  updateConfigs(configs: ProviderConfig[]): void {
    this.rebuild(configs)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function buildDefaultProviderConfigs(
  localFirst: boolean,
  lmStudioEnabled: boolean,
  ollamaEnabled: boolean,
  lmStudioUrl: string,
  ollamaUrl: string
): ProviderConfig[] {
  const configs: ProviderConfig[] = []

  configs.push({
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    credentials: { apiKey: getApiKey() ?? undefined },
    isLocal: false,
    enabled: true,
    priority: 10
  })

  if (lmStudioEnabled) {
    configs.push({
      id: 'lmstudio',
      name: 'LM Studio',
      baseUrl: lmStudioUrl || 'http://localhost:1234/v1',
      isLocal: true,
      enabled: true,
      priority: localFirst ? 100 : 5
    })
  }

  if (ollamaEnabled) {
    configs.push({
      id: 'ollama',
      name: 'Ollama',
      baseUrl: ollamaUrl || 'http://localhost:11434',
      isLocal: true,
      enabled: true,
      priority: localFirst ? 90 : 4
    })
  }

  return configs
}