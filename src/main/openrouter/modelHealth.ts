/**
 * Short-lived memory of which free models are currently refusing requests.
 *
 * A free-tier `429` usually means the quota for that model is spent, and a
 * `404` means the model was retired. Neither clears inside the client's retry
 * window, so a chain that walks the same dead models for every task burns
 * minutes of a run before failing again. This registry lets an agent walk past
 * a model that just failed and only consider it again once the cooldown has
 * expired.
 *
 * The clock is injectable and the state is in-memory only, so the behaviour is
 * unit-testable without touching the network.
 */

/** How long a retired / unavailable model stays out of the rotation. */
export const UNAVAILABLE_COOLDOWN_MS = 10 * 60 * 1000

/** Fallback cooldown for a rate-limited model that sent no `Retry-After`. */
export const RATE_LIMIT_COOLDOWN_MS = 60 * 1000

export class ModelHealth {
  private readonly unavailableUntil = new Map<string, number>()
  /**
   * Injectable clock.
   *
   * Declared as a field rather than a constructor parameter property so the
   * module stays loadable under Node's `--experimental-strip-types`, which
   * rejects parameter properties.
   */
  private readonly clock: () => number

  constructor(clock: () => number = Date.now) {
    this.clock = clock
  }

  /** Keep `model` out of the rotation for `ms`. The longest window wins. */
  penalize(model: string, ms: number): void {
    if (!model || ms <= 0) return
    const until = this.clock() + ms
    const current = this.unavailableUntil.get(model)
    if (current === undefined || until > current) {
      this.unavailableUntil.set(model, until)
    }
  }

  /** True while `model` is still inside its cooldown window. */
  isCoolingDown(model: string): boolean {
    const until = this.unavailableUntil.get(model)
    if (until === undefined) return false
    if (until <= this.clock()) {
      this.unavailableUntil.delete(model)
      return false
    }
    return true
  }

  /**
   * Move models that are cooling down to the end of `candidates`.
   *
   * The list is reordered, never filtered: when every candidate is cooling
   * down the original order is kept, so a run can still make progress and
   * report the real provider error instead of dying with "no model assigned".
   */
  preferReady(candidates: string[]): string[] {
    if (candidates.length <= 1) return [...candidates]
    const ready = candidates.filter((m) => !this.isCoolingDown(m))
    if (ready.length === 0 || ready.length === candidates.length) {
      return [...candidates]
    }
    return [...ready, ...candidates.filter((m) => this.isCoolingDown(m))]
  }

  clear(): void {
    this.unavailableUntil.clear()
  }
}

/** The registry shared by every agent in the process. */
export const modelHealth = new ModelHealth()
