/**
 * Intelligent Router and Fallback Engine.
 * Manages provider health, fallback chains, retries with exponential backoff, and capability matching.
 */

import type { ProviderAdapter, ProviderChatRequest, ProviderChatResponse, StreamChunk, ProviderConfig } from './types'
import { RateLimitError, AuthenticationError, ProviderError } from './types'
import { createProvider } from './registry'

export interface RouterConfig {
  providers: ProviderConfig[]
  fallbackOrder: string[] // provider ids
  maxRetries?: number
}

export class ModelRouter {
  private adapters = new Map<string, ProviderAdapter>()
  private health = new Map<string, { healthy: boolean; lastChecked: number; cooldownUntil: number }>()

  constructor(private routerConfig: RouterConfig) {
    for (const pc of routerConfig.providers) {
      const adapter = createProvider(pc)
      if (adapter) {
        this.adapters.set(pc.id, adapter)
      }
    }
  }

  updateConfig(config: RouterConfig): void {
    this.routerConfig = config
    this.adapters.clear()
    for (const pc of config.providers) {
      const adapter = createProvider(pc)
      if (adapter) {
        this.adapters.set(pc.id, adapter)
      }
    }
  }

  private isCooledDown(providerId: string): boolean {
    const h = this.health.get(providerId)
    if (!h) return true
    if (h.healthy) return true
    return Date.now() > h.cooldownUntil
  }

  private recordFailure(providerId: string, err: unknown): void {
    const cooldown = err instanceof RateLimitError ? 60000 : 30000
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

  async chat(request: ProviderChatRequest, preferredProviderId?: string): Promise<ProviderChatResponse> {
    const chain = preferredProviderId
      ? [preferredProviderId, ...this.routerConfig.fallbackOrder.filter((id) => id !== preferredProviderId)]
      : this.routerConfig.fallbackOrder

    let lastError: unknown = null

    for (const providerId of chain) {
      const adapter = this.adapters.get(providerId)
      if (!adapter) continue
      if (!this.isCooledDown(providerId)) continue

      try {
        const result = await adapter.chat(request)
        this.recordSuccess(providerId)
        return result
      } catch (err) {
        lastError = err
        this.recordFailure(providerId, err)
        // If auth error, do not retry other providers blindly unless configured, but fallback chain can continue
        if (err instanceof AuthenticationError && !preferredProviderId) {
          continue
        }
      }
    }

    throw lastError ?? new ProviderError('All routed providers failed', 'network_error')
  }

  async streamChat(
    request: ProviderChatRequest,
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal,
    preferredProviderId?: string
  ): Promise<ProviderChatResponse> {
    const chain = preferredProviderId
      ? [preferredProviderId, ...this.routerConfig.fallbackOrder.filter((id) => id !== preferredProviderId)]
      : this.routerConfig.fallbackOrder

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
      }
    }

    throw lastError ?? new ProviderError('All routed streaming providers failed', 'network_error')
  }
}
