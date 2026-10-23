import { ipcMain, BrowserWindow } from 'electron'
import { IPC_EVENT } from '../shared/ipc'

import { runtime } from './runtime'
import { bus } from './engine/bus'
import { createStore } from './engine/store'
import {
  ProviderManager,
  buildDefaultProviderConfigs
} from './providers/providerManager'
import { ProviderManagerClient } from './providers/llmClient'

function safeMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object') return JSON.stringify(err)
  return String(err)
}

/** Register every IPC channel the renderer can call. */
export function registerIpc(): void {
  const store = createStore()

  // Build provider configs from runtime config
  const config = runtime.getConfig()
  const providerConfigs = buildDefaultProviderConfigs(
    config.providers.localFirst,
    config.providers.lmStudioEnabled,
    config.providers.ollamaEnabled,
    config.providers.lmStudioUrl,
    config.providers.ollamaUrl
  )

  const providerManager = new ProviderManager({
    providers: providerConfigs,
    localFirst: config.providers.localFirst
  })

  // Wrap providerManager with ProviderManagerClient for LlmClient interface
  const client = new ProviderManagerClient(providerManager)

  // Register provider IPC handlers
  ipcMain.handle('providers:list', async () => {
    const ids = ProviderManager.registeredIds()
    return ids.map(id => ({
      id,
      name: providerManager.getAdapter(id)?.name || id
    }))
  })

  ipcMain.handle('providers:check-health', async () => {
    const results: Record<string, { ok: boolean; message: string; models?: { id: string; name: string }[] }> = {}
    const ids = ProviderManager.registeredIds()
    for (const id of ids) {
      try {
        const health = await providerManager.getAdapter(id)!.testConnection()
        results[id] = {
          ok: health.connected,
          message: health.connected ? 'Connected' : health.error || 'Unreachable',
          models: health.connected ? health.models || [] : []
        }
      } catch (err) {
        results[id] = {
          ok: false,
          message: safeMessage(err)
        }
      }
    }
    return results
  })

  ipcMain.handle('providers:list-models', async (_, providerId: string) => {
    const adapter = providerManager.getAdapter(providerId)
    if (!adapter) throw new Error(`Unknown provider: ${providerId}`)
    const models = await adapter.listModels()
    return models.map(m => ({
      id: m.id,
      name: m.name,
      contextLength: m.contextLength,
      isFree: m.isFree
    }))
  })

  // Forward engine events to every open renderer window.
  bus.onEvent((event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IPC_EVENT, event)
    }
  })
}