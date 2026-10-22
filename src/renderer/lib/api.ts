import type { IpcApi } from '@shared/ipc'

/**
 * Access the preload bridge.
 *
 * The bridge is installed by the preload script before the renderer loads, so
 * `window.api` is always present at runtime. The guard only exists to give
 * a readable error if the preload failed to load.
 */
export function api(): IpcApi {
  const bridge = (window as unknown as { api?: IpcApi }).api
  if (!bridge) {
    throw new Error('The preload bridge is unavailable — the app window failed to initialise.')
  }
  return bridge
}
