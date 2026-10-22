import type { Role, UsageTotals } from '@shared/types'

/**
 * Token + request budget guard.
 *
 * Free models have strict rate limits, so the run must never burn through
 * the allowance unnoticed. The budget is checked before every request and
 * the totals are persisted with the run.
 */
export class Budget {
  private totals: UsageTotals = { promptTokens: 0, completionTokens: 0, requests: 0 }
  private perModel = new Map<string, UsageTotals>()
  private tokenLimit: number
  private readonly requestLimit: number

  constructor(tokenLimit = 400_000, requestLimit = 500) {
    this.tokenLimit = tokenLimit
    this.requestLimit = requestLimit
  }

  /** Update the token cap (called when the user changes the setting). */
  setLimit(tokenLimit: number): void {
    this.tokenLimit = Math.max(1_000, tokenLimit)
  }

  get limit(): number {
    return this.tokenLimit
  }

  get used(): number {
    return this.totals.promptTokens + this.totals.completionTokens
  }

  get remaining(): number {
    return Math.max(0, this.tokenLimit - this.used)
  }

  snapshot(): UsageTotals {
    return { ...this.totals }
  }

  perModelTotals(): Record<string, UsageTotals> {
    const out: Record<string, UsageTotals> = {}
    for (const [model, totals] of this.perModel) out[model] = { ...totals }
    return out
  }

  /** Record usage for a completed request. */
  record(model: string, role: Role, promptTokens: number, completionTokens: number): void {
    this.totals.promptTokens += promptTokens
    this.totals.completionTokens += completionTokens
    this.totals.requests += 1

    const current = this.perModel.get(model) ?? { promptTokens: 0, completionTokens: 0, requests: 0 }
    current.promptTokens += promptTokens
    current.completionTokens += completionTokens
    current.requests += 1
    this.perModel.set(model, current)
    void role
  }

  /** True when another request fits inside the budget. */
  canRequest(): boolean {
    return this.used < this.tokenLimit && this.totals.requests < this.requestLimit
  }

  /** Reason the budget stopped the run (null when there is room). */
  exhaustedReason(): string | null {
    if (this.used >= this.tokenLimit) {
      return `Token budget exhausted (${this.used.toLocaleString()} / ${this.tokenLimit.toLocaleString()} tokens).`
    }
    if (this.totals.requests >= this.requestLimit) {
      return `Request budget exhausted (${this.totals.requests} requests).`
    }
    return null
  }

  reset(): void {
    this.totals = { promptTokens: 0, completionTokens: 0, requests: 0 }
    this.perModel.clear()
  }
}
