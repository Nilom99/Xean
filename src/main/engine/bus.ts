import { EventEmitter } from 'node:events'
import type { EngineEvent } from '@shared/types'

/**
 * Typed agent-to-agent message bus.
 *
 * Every engine event flows through here. The bus is the single source of
 * truth: the UI is a pure function of the event log, and the event log is
 * persisted by the store via the `persist` hook.
 */
export class Bus extends EventEmitter {
  private readonly log: EngineEvent[] = []
  private persistFn: ((event: EngineEvent) => void) | null = null

  constructor() {
    super()
    this.setMaxListeners(200)
  }

  /** Attach a sink that persists every emitted event (wired to SQLite). */
  setPersist(fn: (event: EngineEvent) => void): void {
    this.persistFn = fn
  }

  emitEvent(event: EngineEvent): EngineEvent {
    this.log.push(event)
    try {
      this.persistFn?.(event)
    } catch (err) {
      // Persistence must never break the run, but it must not be silent.
      console.error(
        '[codex-local] failed to persist engine event:',
        err instanceof Error ? err.message : String(err)
      )
    }
    this.emit('event', event)
    this.emit(event.type, event)
    return event
  }

  /** Subscribe to all events. */
  onEvent(listener: (event: EngineEvent) => void): () => void {
    this.on('event', listener)
    return () => this.off('event', listener)
  }

  /** Full ordered event history for a run (or everything when runId is omitted). */
  history(runId?: string): EngineEvent[] {
    if (!runId) return [...this.log]
    return this.log.filter((e) => {
      const anyEvent = e as unknown as Record<string, unknown>
      return anyEvent.runId === runId
    })
  }

  clear(): void {
    this.log.length = 0
    this.removeAllListeners('event')
  }
}

export const bus = new Bus()
