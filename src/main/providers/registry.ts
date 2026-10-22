/**
 * Provider registry, factory, and manager.
 * Manages loading of providers, routing decisions, health checks, and fallback chains.
 */

import type { ProviderAdapter, ProviderConfig } from './types'
import { OpenRouterProvider } from './openrouterProvider'
import { FreeLLMAPIProvider } from './freellmapiProvider'
import { OllamaProvider } from './ollamaProvider'
import { LmStudioProvider } from './lmstudioProvider'
import { OpenAIProvider } from './additionalProviders'
import { AnthropicProvider } from './anthropicProvider'
import { GeminiProvider } from './geminiProvider'
import { DeepSeekProvider } from './additionalProviders'
import { GroqProvider } from './additionalProviders'
import { MistralProvider } from './additionalProviders'
import { CohereProvider } from './additionalProviders'
import { HuggingFaceProvider } from './additionalProviders'
import { CustomOpenAIProvider } from './additionalProviders'

const registry = new Map<string, (config: ProviderConfig) => ProviderAdapter>()

/** Register a provider factory. */
export function registerProvider(
  id: string,
  factory: (config: ProviderConfig) => ProviderAdapter
): void {
  registry.set(id, factory)
}

// Register built-in providers
registerProvider('openrouter', (c) => new OpenRouterProvider(c))
registerProvider('freellmapi', (c) => new FreeLLMAPIProvider(c))
registerProvider('ollama', (c) => new OllamaProvider(c))
registerProvider('lmstudio', (c) => new LmStudioProvider(c))
registerProvider('openai', (c) => new OpenAIProvider(c))
registerProvider('anthropic', (c) => new AnthropicProvider(c))
registerProvider('gemini', (c) => new GeminiProvider(c))
registerProvider('deepseek', (c) => new DeepSeekProvider(c))
registerProvider('groq', (c) => new GroqProvider(c))
registerProvider('mistral', (c) => new MistralProvider(c))
registerProvider('cohere', (c) => new CohereProvider(c))
registerProvider('huggingface', (c) => new HuggingFaceProvider(c))
registerProvider('custom', (c) => new CustomOpenAIProvider(c))

/** Create a provider instance from configuration. */
export function createProvider(config: ProviderConfig): ProviderAdapter | null {
  const factory = registry.get(config.id)
  if (!factory) {
    console.warn(`[codex-local] Unknown provider: ${config.id}`)
    return null
  }
  return factory(config)
}

/** List all registered provider IDs. */
export function listProviderIds(): string[] {
  return [...registry.keys()]
}