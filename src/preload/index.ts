import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  IPC_EVENT,
  IPC_MENU,
  type IpcApi,
  type MenuAction
} from '@shared/ipc'
import type { AppConfig, EngineEvent, Role } from '@shared/types'

/**
 * The renderer-facing bridge.
 *
 * Everything the UI can do is listed here explicitly — the renderer never
 * gets direct access to `ipcRenderer`, so it cannot reach channels the app
 * did not intend to expose.
 */
const api: IpcApi = {
  // ---- settings ---------------------------------------------------------
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  updateConfig: (patch: Partial<AppConfig>) => ipcRenderer.invoke(IPC.settingsSet, patch),
  setApiKey: (key: string) => ipcRenderer.invoke(IPC.settingsSetApiKey, key),
  clearApiKey: () => ipcRenderer.invoke(IPC.settingsClearApiKey),
  testConnection: () => ipcRenderer.invoke(IPC.settingsTestConnection),

  // ---- models -----------------------------------------------------------
  refreshCatalog: () => ipcRenderer.invoke(IPC.catalogRefresh),
  listFreeModels: () => ipcRenderer.invoke(IPC.catalogList),
  resolveAliases: () => ipcRenderer.invoke(IPC.modelsResolve),
  setRoleModel: (role: Role, modelId: string) => ipcRenderer.invoke(IPC.modelsSetRole, role, modelId),

  // ---- workspace --------------------------------------------------------
  pickWorkspace: () => ipcRenderer.invoke(IPC.workspacePick),
  readTree: () => ipcRenderer.invoke(IPC.workspaceTree),
  readFile: (path: string) => ipcRenderer.invoke(IPC.workspaceReadFile, path),

  // ---- runs -------------------------------------------------------------
  startRun: (goal: string) => ipcRenderer.invoke(IPC.runStart, goal),
  stopRun: () => ipcRenderer.invoke(IPC.runStop),
  listRuns: () => ipcRenderer.invoke(IPC.runList),

  // ---- approvals & decisions --------------------------------------------
  respondApproval: (id: string, allowed: boolean, always: boolean) =>
    ipcRenderer.invoke(IPC.approvalRespond, id, allowed, always),
  respondDecision: (id: string, choice: string) =>
    ipcRenderer.invoke(IPC.decisionRespond, id, choice),

  // ---- misc -------------------------------------------------------------
  exportReport: (runId?: string) => ipcRenderer.invoke(IPC.exportReport, runId),
  openPath: (target: string) => ipcRenderer.invoke(IPC.openPath, target),

  // ---- subscriptions ----------------------------------------------------
  onEvent: (cb: (event: EngineEvent) => void) => {
    const listener = (_event: unknown, payload: EngineEvent): void => cb(payload)
    ipcRenderer.on(IPC_EVENT, listener)
    return () => {
      ipcRenderer.removeListener(IPC_EVENT, listener)
    }
  },

  onMenu: (cb: (action: MenuAction) => void) => {
    const channels = Object.values(IPC_MENU)
    const listeners = channels.map((channel) => {
      const listener = (): void => cb(channel as MenuAction)
      ipcRenderer.on(channel, listener)
      return { channel, listener }
    })
    return () => {
      for (const { channel, listener } of listeners) {
        ipcRenderer.removeListener(channel, listener)
      }
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
