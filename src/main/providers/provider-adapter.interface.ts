import type {
  ModelDescriptor,
  ProviderCredentials,
  ConnectionHealth,
  ProviderChatRequest,
  ProviderChatResponse,
  StreamChunk,
  ModelCapabilities
} from './types'

export interface ProviderAdapter {
  readonly id: string
  readonly name: string
  readonly requiresKey: boolean
  readonly defaultBaseUrl: string
  listModels(): Promise<ModelDescriptor[]>
  testConnection(credentials?: ProviderCredentials): Promise<ConnectionHealth>
  chat(request: ProviderChatRequest): Promise<ProviderChatResponse>
  streamChat(
    request: ProviderChatRequest,
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal
  ): Promise<ProviderChatResponse>
  getCapabilities(modelId: string): ModelCapabilities | null
  normalizeModelId(modelId: string): string
  ownsModel(modelId: string): boolean
}
