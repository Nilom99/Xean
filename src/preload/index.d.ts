import type { IpcApi } from '@shared/ipc'

declare global {
  interface Window {
    /** The bridge exposed by the preload script. */
    api: IpcApi
  }
}

export {}
