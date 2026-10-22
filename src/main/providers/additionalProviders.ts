import { BaseOpenAICompatibleProvider } from './baseOpenAICompatible'
import type { ProviderConfig } from './types'

export class OpenAIProvider extends BaseOpenAICompatibleProvider {
  constructor(config: ProviderConfig) {
    super('openai', 'OpenAI', 'https://api.openai.com/v1', true, config)
  }
}

export class DeepSeekProvider extends BaseOpenAICompatibleProvider {
  constructor(config: ProviderConfig) {
    super('deepseek', 'DeepSeek', 'https://api.deepseek.com/v1', true, config)
  }
}

export class GroqProvider extends BaseOpenAICompatibleProvider {
  constructor(config: ProviderConfig) {
    super('groq', 'GroqCloud', 'https://api.groq.com/openai/v1', true, config)
  }
}

export class MistralProvider extends BaseOpenAICompatibleProvider {
  constructor(config: ProviderConfig) {
    super('mistral', 'Mistral AI', 'https://api.mistral.ai/v1', true, config)
  }
}

export class CohereProvider extends BaseOpenAICompatibleProvider {
  constructor(config: ProviderConfig) {
    super('cohere', 'Cohere', 'https://api.cohere.com/v1', true, config)
  }
}

export class HuggingFaceProvider extends BaseOpenAICompatibleProvider {
  constructor(config: ProviderConfig) {
    super('huggingface', 'Hugging Face', 'https://api-inference.huggingface.co/v1', true, config)
  }
}

export class CustomOpenAIProvider extends BaseOpenAICompatibleProvider {
  constructor(config: ProviderConfig) {
    super('custom', config.name || 'Custom Endpoint', config.baseUrl || 'http://localhost:8000/v1', false, config)
  }
}

export { BaseOpenAICompatibleProvider }