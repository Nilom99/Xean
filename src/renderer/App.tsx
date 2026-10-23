import { useCallback, useEffect, useMemo, useState } from 'react'
import { IPC_MENU, type MenuAction } from '@shared/ipc'
import type { Role } from '@shared/types'
import { api } from './lib/api'
import { useEngine } from './hooks/useEngine'
import { useSettings } from './hooks/useSettings'
import { patchTotals } from './lib/events'
import { AppHeader } from './components/AppHeader'
import { ApprovalPrompt } from './components/ApprovalPrompt'
import { CommandPalette, CommandIcons, type Command } from './components/CommandPalette'
import { DecisionPrompt } from './components/DecisionPrompt'
import { DiffViewer } from './components/DiffViewer'
import { GoalBar } from './components/GoalBar'
import { RunsPanel } from './components/RunsPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { StatusBar } from './components/StatusBar'
import { TaskBoard } from './components/TaskBoard'
import { Transcript } from './components/Transcript'
import { WorkspacePanel } from './components/WorkspacePanel'
import { Badge } from './components/ui/Badge'
import { Tabs } from './components/ui/Tabs'

type TabId = 'transcript' | 'tasks' | 'changes' | 'workspace' | 'runs'

export default function App() {
  const { state } = useEngine()
  const { settings, reload, updateConfig, setApiKey, clearApiKey, setRoleModel } = useSettings()

  const [tab, setTab] = useState<TabId>('transcript')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [workspaceToken, setWorkspaceToken] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // Apply the configured theme to the document.
  useEffect(() => {
    document.documentElement.dataset.theme = settings?.config.theme ?? 'dark'
  }, [settings?.config.theme])

  // Ctrl+K opens the command palette.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() === 'k' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const startRun = useCallback(async (goal: string): Promise<void> => {
    setError(null)
    try {
      const result = await api().startRun(goal)
      if (!result.ok) {
        setError(result.error ?? 'The run could not be started.')
      } else {
        setTab('transcript')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const stopRun = useCallback(async (): Promise<void> => {
    try {
      await api().stopRun()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const pickWorkspace = useCallback(async (): Promise<void> => {
    try {
      const result = await api().pickWorkspace()
      if (result.ok) {
        setWorkspaceToken((t) => t + 1)
        await reload()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [reload])

  const exportReport = useCallback(async (): Promise<void> => {
    try {
      const result = await api().exportReport(state.runId ?? undefined)
      if (!result.ok) setError('There is no run report to open yet.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [state.runId])

  // Application menu and tray actions.
  useEffect(() => {
    const unsubscribe = api().onMenu((action: MenuAction) => {
      switch (action) {
        case IPC_MENU.pickWorkspace:
          void pickWorkspace()
          break
        case IPC_MENU.exportReport:
          void exportReport()
          break
        case IPC_MENU.commandPalette:
          setPaletteOpen((v) => !v)
          break
        case IPC_MENU.stopRun:
          void stopRun()
          break
      }
    })
    return unsubscribe
  }, [pickWorkspace, exportReport, stopRun])

  const totals = useMemo(() => patchTotals(state.tasks), [state.tasks])

  const commands = useMemo<Command[]>(
    () => [
      {
        id: 'stop',
        label: 'Stop the current run',
        icon: CommandIcons.stop,
        run: () => void stopRun()
      },
      {
        id: 'workspace',
        label: 'Open workspace folder…',
        icon: CommandIcons.folder,
        run: () => void pickWorkspace()
      },
      {
        id: 'report',
        label: 'Export the run report',
        run: () => void exportReport()
      },
      {
        id: 'settings',
        label: 'Open settings',
        run: () => setSettingsOpen(true)
      },
      { id: 'tasks', label: 'Show the task board', run: () => setTab('tasks') },
      { id: 'changes', label: 'Show the changes', run: () => setTab('changes') },
      { id: 'workspace-files', label: 'Show the workspace files', run: () => setTab('workspace') },
      { id: 'runs', label: 'Show previous runs', run: () => setTab('runs') }
    ],
    [stopRun, pickWorkspace, exportReport]
  )

  const running = state.status === 'running'

  return (
    <div className="flex h-full flex-col bg-canvas">
      <AppHeader
        settings={settings}
        running={running}
        goal={state.goal}
        usage={state.usage}
        onStart={(goal: string) => void startRun(goal)}
        onStop={() => void stopRun()}
        onOpenSettings={() => setSettingsOpen((v) => !v)}
        onOpenPalette={() => setPaletteOpen(true)}
        onPickWorkspace={() => void pickWorkspace()}
      />

      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          <GoalBar
            running={running}
            disabled={!settings?.hasApiKey}
            onStart={(goal) => void startRun(goal)}
            onStop={() => void stopRun()}
          />

          {error ? (
            <div className="border-b border-border bg-danger-soft px-3 py-1.5 text-[12px] text-danger">
              {error}
              <button onClick={() => setError(null)} className="ml-2 underline underline-offset-2">
                dismiss
              </button>
            </div>
          ) : null}

          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[
              { id: 'transcript', label: 'Transcript' },
              {
                id: 'tasks',
                label: 'Tasks',
                badge: state.tasks.length > 0 ? <Badge>{state.tasks.length}</Badge> : null
              },
              {
                id: 'changes',
                label: 'Changes',
                badge:
                  totals.added + totals.removed > 0 ? (
                    <Badge tone="success">+{totals.added}</Badge>
                  ) : null
              },
              { id: 'workspace', label: 'Files' },
              { id: 'runs', label: 'Runs' }
            ]}
          />

          <div className="min-h-0 flex-1">
            {tab === 'transcript' ? (
              <Transcript messages={state.messages} streams={state.streams} />
            ) : null}
            {tab === 'tasks' ? <TaskBoard tasks={state.tasks} /> : null}
            {tab === 'changes' ? (
              <DiffViewer patches={state.tasks.flatMap((task) => task.patches)} />
            ) : null}
            {tab === 'workspace' ? <WorkspacePanel refreshToken={workspaceToken} /> : null}
            {tab === 'runs' ? <RunsPanel /> : null}
          </div>
        </main>

        {settingsOpen ? (
          <SettingsPanel
            settings={settings}
            onClose={() => setSettingsOpen(false)}
            onSetApiKey={setApiKey}
            onClearApiKey={clearApiKey}
            onUpdateConfig={updateConfig}
            onSetRoleModel={(role: Role, modelId: string) => setRoleModel(role, modelId)}
            onCatalogRefreshed={() => void reload()}
          />
        ) : null}
      </div>

      <StatusBar
        state={state}
        workspaceRoot={settings?.workspaceRoot ?? '—'}
        hasApiKey={settings?.hasApiKey ?? false}
      />

      <ApprovalPrompt
        approval={state.approvals[0] ?? null}
        onRespond={(id, allowed, always) => void api().respondApproval(id, allowed, always)}
      />

      <DecisionPrompt
        decision={state.decisions[0] ?? null}
        onRespond={(id, choice) => void api().respondDecision(id, choice)}
      />

      <CommandPalette open={paletteOpen} commands={commands} onClose={() => setPaletteOpen(false)} />
    </div>
  )
}
