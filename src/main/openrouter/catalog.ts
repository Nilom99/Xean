import { z } from 'zod'
import type { FreeModelInfo } from '@shared/types'

const MODELS_URL = 'https://openrouter.ai/api/v1/models'
const CACHE_TTL_MS = 30 * 60 * 1000

const PricingSchema = z
  .object({
    prompt: z.union([z.string(), z.number()]).optional(),
    completion: z.union([z.string(), z.number()]).optional()
  })
  .loose()

const ModelSchema = z
  .object({
    id: z.string(),
    name: z.string().optional().default(''),
    context_length: z.number().optional().default(0),
    pricing: PricingSchema.optional()
  })
  .loose()

const ModelsResponseSchema = z
  .object({
    data: z.array(ModelSchema)
  })
  .loose()

/**
 * A model is free when its id ends with `:free` OR both price components are
 * exactly zero. This is the single definition of "free" used everywhere in
 * the app — the UI, the guard and the client all agree because they all
 * call into this module.
 */
export function isFreeModel(
  id: string,
  pricing?: { prompt?: string | number; completion?: string | number }
): boolean {
  if (id.endsWith(':free')) return true
  if (!pricing) return false
  const prompt = pricing.prompt
  const completion = pricing.completion
  const zero = (v: string | number | undefined): boolean =>
    v === 0 || v === '0' || v === '0.0' || v === 0.0
  return zero(prompt) && zero(completion)
}

export class Catalog {
  private cache: FreeModelInfo[] = []
  private allFree = new Set<string>()
  private fetchedAt = 0
  private inFlight: Promise<FreeModelInfo[]> | null = null

  /** Cached free models (empty until the first successful fetch). */
  list(): FreeModelInfo[] {
    return this.cache
  }

  fetchedAtMs(): number | null {
    return this.fetchedAt ? this.fetchedAt : null
  }

  isFree(id: string): boolean {
    return this.allFree.has(id)
  }

  /** Throw if the model is not a known free model. Used as a hard guard. */
  assertFreeModel(id: string): void {
    if (!this.allFree.has(id)) {
      throw new Error(
        `Blocked non-free model "${id}". Codex Local only calls free-tier models.`
      )
    }
  }

  /** Fetch the catalog, honouring the 30 minute cache. */
  async refresh(force = false): Promise<FreeModelInfo[]> {
    const fresh = Date.now() - this.fetchedAt < CACHE_TTL_MS
    if (!force && fresh && this.cache.length > 0) return this.cache
    if (this.inFlight) return this.inFlight

    this.inFlight = this.doFetch()
      .then((models) => {
        this.cache = models
        this.fetchedAt = Date.now()
        this.allFree = new Set(models.map((m) => m.id))
        return models
      })
      .finally(() => {
        this.inFlight = null
      })

    return this.inFlight
  }

  private async doFetch(): Promise<FreeModelInfo[]> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20_000)
    try {
      const res = await fetch(MODELS_URL, {
        signal: controller.signal,
        headers: { Accept: 'application/json' }
      })
      if (!res.ok) {
        throw new Error(`OpenRouter /models responded with ${res.status}`)
      }
      const parsed = ModelsResponseSchema.parse(await res.json())
      return parsed.data
        .filter((m) => isFreeModel(m.id, m.pricing))
        .map((m) => ({
          id: m.id,
          name: m.name || m.id,
          contextLength: m.context_length ?? 0
        }))
        .sort((a, b) => a.id.localeCompare(b.id))
    } finally {
      clearTimeout(timer)
    }
  }
}

export const catalog = new Catalog()
