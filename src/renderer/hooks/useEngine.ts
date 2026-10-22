import { useEffect, useMemo, useReducer, useRef } from 'react'
import type { EngineEvent } from '@shared/types'
import { api } from '../lib/api'
import { initialEngineState, reduceEngine, type EngineState } from '../lib/events'

/**
 * Subscribe to the engine event log.
 *
 * The hook keeps the whole log in a ref so late subscribers (and the
 * command palette) can see the full history, while the component tree is
 * driven by the reduced state.
 */
export function useEngine(): {
  state: EngineState
  events: EngineEvent[]
} {
  const [state, dispatch] = useReducer(reduceEngine, initialEngineState)
  const events = useRef<EngineEvent[]>([])

  useEffect(() => {
    const unsubscribe = api().onEvent((event) => {
      events.current = [...events.current, event]
      dispatch(event)
    })
    return unsubscribe
  }, [])

  // Expose a stable snapshot of the log for consumers that need it.
  const log = useMemo(() => events.current, [state])

  return { state, events: log }
}
