/**
 * Unified provider abstraction for multi-backend LLM inference.
 *
 * All providers implement this interface so the routing engine can treat
 * OpenRouter, FreeLLMAPI, local servers, and cloud APIs uniformly.
 */

import type { ChatMessage } from '../openrouter/context'

export interface ProviderCredentials {
  apiKey?: string;
  customHeaders?: Record<string, string>;
  options?: Record<string, unknown>;
}

export interface ModelDescriptor {
  id: string
  name: string
  contextLength: number
  capabilities: ModelCapabilities
  provider: string
  /** For local models: hardware requirements hint. */
  requirements?: HardwareRequirements
  /** Whether this model is free to use. */
  isFree: boolean
  /** Pricing info when available (prompt/completion per 1M tokens). */
  pricing?: { prompt: number; completion: number }
}

export interface ModelCapabilities {
  /** Supports function/tool calling. */
  tools: boolean
  /** Supports vision/multimodal input. */
  vision: boolean
  /** Supports reasoning/thinking tokens. */
  reasoning: boolean
  /** Maximum output tokens. */
  maxOutputTokens: number
  /** Supported stop sequences. */
  stopSequences?: string[]
}

export interface HardwareRequirements {
  /** Minimum system RAM in GB. */
  minSystemRamGb: number
  /** Minimum VRAM in GB (0 for CPU-only). */
  minVramGb: number
  /** Recommended quantization. */
  recommendedQuantization?: string
  /** Suggested context window for this hardware. */
  suggestedContextTokens: number
}

export type ConnectionHealth =
  | { connected: true; models: ModelDescriptor[]; metadata?: Record<string, unknown> }
  | {
      connected: false;
      error: string;
      reason: 'auth_failed' | 'unreachable' | 'rate_limited' | 'unknown';
      metadata?: Record<string, unknown>;
    }

export interface ProviderChatRequest {
  model: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  stop?: string[]
  signal?: AbortSignal
  reasoningMaxTokens?: number
  /** Provider-specific options. */
  providerOptions?: Record<string, unknown>
}

export interface ProviderChatResponse {
  content: string
  usage: TokenUsage
  model: string
  /** Provider that served the request. */
  provider: string
  /** Number of attempts (for retry tracking). */
  attempts: number
}

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface StreamChunk {
  content?: string
  reasoning?: string
  finishReason?: string
  usage?: TokenUsage
  isComplete: boolean
}

/**
 * Common provider interface.
 *
 * Every backend (OpenRouter, FreeLLMAPI, Ollama, LM Studio, OpenAI, etc.)
 * implements this so the routing engine can use them interchangeably.
 */
export interface ProviderAdapter {
  /** Unique provider identifier (e.g., "openrouter", "freellmapi", "ollama"). */
  readonly id: string
  /** Human-readable name. */
  readonly name: string
  /** Whether this provider requires an API key. */
  readonly requiresKey: boolean
  /** Default base URL for this provider. */
  readonly defaultBaseUrl: string

  /**
   * List all available models from this provider.
   * Should hit the provider's /models endpoint or equivalent.
   */
  listModels(): Promise<ModelDescriptor[]>

  /**
   * Test connectivity and authentication.
   * Returns health status with discovered models.
   */
  testConnection(credentials?: ProviderCredentials): Promise<ConnectionHealth>

  /**
   * Non-streaming chat completion.
   */
  chat(request: ProviderChatRequest): Promise<ProviderChatResponse>

  /**
   * Streaming chat completion.
   * Calls onChunk for each delta, returns final aggregated response.
   */
  streamChat(
    request: ProviderChatRequest,
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal
  ): Promise<ProviderChatResponse>

  /**
   * Get static capabilities for a model (without network call).
   */
  getCapabilities(modelId: string): ModelCapabilities | null

  /**
   * Normalize a model ID to the provider's canonical form.
   * e.g., "gpt-4o" -> "openai/gpt-4o" for OpenRouter.
   */
  normalizeModelId(modelId: string): string

  /**
   * Check if a model ID belongs to this provider.
   */
  ownsModel(modelId: string): boolean
}

/** Configuration for a provider instance. */
export interface ProviderConfig {
  id: string
  name: string
  baseUrl: string
  credentials?: ProviderCredentials
  /** Whether this is a local/offline provider. */
  isLocal: boolean
  /** Enabled state. */
  enabled: boolean
  /** Priority for routing (higher = preferred). */
  priority: number
}

/** Registry of all available provider implementations. */
export type ProviderFactory = (config: ProviderConfig) => ProviderAdapter

export class ProviderError extends Error {
  constructor(message: string, readonly kind: string, readonly originalError?: unknown) {
    super(message)
    this.name = 'ProviderError'
  }
}

export class AuthenticationError extends ProviderError {
  constructor(message: string, originalError?: unknown) {
    super(message, 'auth_failed', originalError)
    this.name = 'AuthenticationError'
  }
}

export class RateLimitError extends ProviderError {
  constructor(message: string, readonly retryAfterMs?: number, originalError?: unknown) {
    super(message, 'rate_limited', originalError)
    this.name = 'RateLimitError'
  }
}

export class ContextOverflowError extends ProviderError {
  constructor(message: string, originalError?: unknown) {
    super(message, 'context_overflow', originalError)
    this.name = 'ContextOverflowError'
  }
}

export class NetworkError extends ProviderError {
  constructor(message: string, originalError?: unknown) {
    super(message, 'network_error', originalError)
    this.name = 'NetworkError'
  }
}
