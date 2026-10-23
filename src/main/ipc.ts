import { ipcMain, dialog, BrowserWindow, shell } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { IPC, IPC_EVENT, type WorkspaceNode } from '../shared/ipc'
import type { AppConfig, Role } from '../shared/types'
import { runtime } from './runtime'
import { catalog } from './openrouter/catalog'
import { saveApiKey, clearApiKey } from './secrets'
import { bus } from './engine/bus'
import { Budget } from './engine/budget'
import { TaskBoard } from './engine/taskboard'
import { Sandbox } from './engine/sandbox'
import { ApprovalGate } from './engine/approvals'
import { DecisionGate } from './engine/decision'
import { Orchestrator } from './engine/orchestrator'
import { createStore } from './engine/store'
import { CheckpointManager } from './engine/checkpoints'
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

/** Directories that are never shown in the file tree. */
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  '.codex-local',
  '.next',
  'build',
  '.cache'
])

/** Build a directory tree for the sidebar, bounded in size. */
async function buildTree(
  root: string,
  workspaceRoot: string,
  depth = 0,
  maxDepth = 3
): Promise<WorkspaceNode[]> {
  if (depth > maxDepth) return []
  let entries
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }

  const nodes: WorkspaceNode[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue
    if (IGNORED_DIRS.has(entry.name)) continue
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: path.relative(workspaceRoot, full),
        type: 'dir',
        children: await buildTree(full, workspaceRoot, depth + 1, maxDepth)
      })
    } else if (entry.isFile()) {
      nodes.push({ name: entry.name, path: path.relative(workspaceRoot, full), type: 'file' })
    }
  }
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return nodes
}

/** Register every IPC channel the renderer can call. */
export function registerIpc(): void {
  const store = createStore()
  const budget = new Budget(runtime.getConfig().tokenBudget)
  const board = new TaskBoard()
  const sandbox = new Sandbox(runtime.workspaceRoot())
  const approvals = new ApprovalGate(bus)
  const decisions = new DecisionGate(bus)
  const checkpoints = new CheckpointManager(sandbox)

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

  const orchestrator = new Orchestrator({
    client,
    budget,
    sandbox,
    board,
    approvals,
    decisions,
    store,
    checkpoints,
    getConfig: () => runtime.getConfig(),
    getAssignments: () => runtime.getAssignments()
  })

  // Persist every engine event to the store.
  bus.setPersist((event) => store.persistEvent(event))

  // Forward engine events to every open renderer window.
  bus.onEvent((event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IPC_EVENT, event)
    }
  })

  const handle = <T>(
    channel: string,
    fn: (...args: never[]) => Promise<T> | T
  ): void => {
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return await fn(...(args as never[]))
      } catch (err) {
        console.error(`[codex-local] IPC ${channel} failed:`, safeMessage(err))
        throw new Error(safeMessage(err))
      }
    })
  }

  // ---- settings ----------------------------------------------------------
  handle(IPC.settingsGet, () => runtime.settingsState())

  handle(IPC.settingsSet, async (patch: Partial<AppConfig>) => {
    await runtime.update(patch)
    sandbox.setRoot(runtime.workspaceRoot())
    budget.setLimit(runtime.getConfig().tokenBudget)
    return runtime.settingsState()
  })

  handle(IPC.settingsSetApiKey, async (key: string) => {
    await saveApiKey(key)
    return runtime.settingsState()
  })

  handle(IPC.settingsClearApiKey, async () => {
    await clearApiKey()
    return runtime.settingsState()
  })

  // ---- models ------------------------------------------------------------
  handle(IPC.modelsResolve, async () => {
    if (catalog.list().length === 0) {
      await catalog.refresh().catch(() => undefined)
      runtime.recompute()
    }
    return runtime.resolveModels()
  })

  handle(IPC.modelsSetRole, async (role: Role, modelId: string) => {
    await runtime.setRoleModel(role, modelId)
    return runtime.settingsState()
  })

  // ---- workspace ---------------------------------------------------------
  handle(IPC.workspacePick, async () => {
    const win = BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose the workspace folder',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true }
    }
    const root = result.filePaths[0]
    await runtime.update({ workspaceRoot: root })
    sandbox.setRoot(root)
    return { ok: true, root }
  })

  handle(IPC.workspaceTree, async () => buildTree(sandbox.rootPath, sandbox.rootPath))

  handle(IPC.workspaceReadFile, async (relativePath: string) => {
    try {
      // The sandbox guard blocks reads outside the workspace too.
      const absolute = await sandbox.resolveInside(relativePath)
      const content = await fs.readFile(absolute, 'utf8')
      return { ok: true, content }
    } catch (err) {
      return { ok: false, error: safeMessage(err) }
    }
  })

  // ---- runs --------------------------------------------------------------
  handle(IPC.runStart, async (goal: string) => {
    const trimmed = goal.trim()
    if (!trimmed) return { ok: false, error: 'Describe what you want to build first.' }

    const unassigned = runtime.unassignedRoles()
    if (unassigned.length > 0) {
      return {
        ok: false,
        error: `No free model is assigned to: ${unassigned.join(', ')}. Pick one in Settings.`
      }
    }

    try {
      const runId = orchestrator.start(trimmed)
      return { ok: true, runId }
    } catch (err) {
      return { ok: false, error: safeMessage(err) }
    }
  })

  handle(IPC.runStop, async () => {
    orchestrator.stop()
    return { ok: true }
  })

  handle(IPC.runList, async () => store.listRuns())

  // ---- approvals & decisions --------------------------------------------
  handle(IPC.approvalRespond, async (id: string, allowed: boolean, always: boolean) => {
    approvals.respond(id, allowed, always)
  })

  handle(IPC.decisionRespond, async (id: string, choice: string) => {
    decisions.respond(id, choice)
  })

  // ---- misc --------------------------------------------------------------
  handle(IPC.exportReport, async (runId?: string) => {
    // Prefer the report recorded for the requested run; fall back to the
    // report of the most recent run in the workspace.
    let reportPath = path.join(sandbox.rootPath, 'RUN_REPORT.md')
    if (runId) {
      const summary = store.listRuns().find((r) => r.runId === runId)
      if (summary?.reportPath) reportPath = summary.reportPath
    } else {
      const latest = store.listRuns().sort((a, b) => b.startedAt - a.startedAt)[0]
      if (latest?.reportPath) reportPath = latest.reportPath
    }

    try {
      await fs.access(reportPath)
    } catch {
      return { ok: false }
    }
    const error = await shell.openPath(reportPath)
    if (error) return { ok: false, path: reportPath }
    return { ok: true, path: reportPath }
  })

  handle(IPC.openPath, async (target: string) => {
    // Only paths inside the workspace may be opened.
    try {
      const absolute = await sandbox.resolveInside(target)
      await shell.openPath(absolute)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: safeMessage(err) }
    }
  })

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