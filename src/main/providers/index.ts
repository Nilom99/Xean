/**
 * Provider registry and factory.
 *
 * Manages loading of providers and routing decisions.
 */

import type { ProviderAdapter, ProviderConfig } from './types'

// Registry of provider factories
const registry = new Map<string, (config: ProviderConfig) => ProviderAdapter>()

/**
 * Register a provider factory.
 * Called when each provider module is initialized.
 */
export function registerProvider(factory: (config: ProviderConfig) => ProviderAdapter): void {
  const id = factory({ id: '', name: '', baseUrl: '', enabled: true, isLocal: false, priority: 0 }).id
  registry.set(id, factory)
}

/**
 * Create a provider instance from configuration.
 */
export function createProvider(config: ProviderConfig): ProviderAdapter | null {
  const factory = registry.get(config.id)
  if (!factory) {
    console.warn(`[codex-local] Unknown provider: ${config.id}`)
    return null
  }
  return factory(config)
}

/**
 * List all registered provider IDs.
 */
export function listProviderIds(): string[] {
  return [...registry.keys()]
}

// Import providers to register them
import './openrouterProvider'
import './freellmapiProvider'
import './ollamaProvider'
import './lmstudioProvider'
import './additionalProviders'
import './anthropicProvider'
import './geminiProvider'