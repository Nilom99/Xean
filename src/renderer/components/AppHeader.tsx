import { Command, FolderOpen, Play, Square, Settings2 } from 'lucide-react'
import type { SettingsState } from '@shared/types'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Spinner } from './ui/Spinner'
import { formatTokens } from '../lib/format'

export interface AppHeaderProps {
  settings: SettingsState | null
  running: boolean
  goal: string
  usage: { promptTokens: number; completionTokens: number; requests: number }
  onStart: () => void
  onStop: () => void
  onOpenSettings: () => void
  onOpenPalette: () => void
  onPickWorkspace: () => void
}

/** The top bar: identity, run controls and usage. */
export function AppHeader({
  settings,
  running,
  goal,
  usage,
  onStart,
  onStop,
  onOpenSettings,
  onOpenPalette,
  onPickWorkspace
}: AppHeaderProps) {
  const hasKey = settings?.hasApiKey ?? false
  const totalTokens = usage.promptTokens + usage.completionTokens

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-3">
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded bg-accent text-[11px] font-bold text-canvas">
          CL
        </div>
        <span className="text-[13px] font-semibold text-ink">Codex Local</span>
        <Badge tone="success">free models only</Badge>
      </div>

      <div className="mx-1 min-w-0 flex-1 truncate text-xs text-ink-muted" title={goal}>
        {goal || 'No goal yet — describe what you want to build.'}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {usage.requests > 0 ? (
          <span
            className="hidden items-center gap-2 text-[11px] text-ink-faint md:flex"
            title={`${usage.requests} request(s), ${totalTokens} tokens`}
          >
            <span>{usage.requests} req</span>
            <span>{formatTokens(totalTokens)} tok</span>
          </span>
        ) : null}

        <Button
          variant="ghost"
          size="sm"
          onClick={onOpenPalette}
          title="Command palette (Ctrl+K)"
        >
          <Command size={13} />
          <span className="hidden lg:inline">Palette</span>
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={onPickWorkspace}
          title="Choose the workspace folder"
        >
          <FolderOpen size={13} />
        </Button>

        <Button variant="ghost" size="sm" onClick={onOpenSettings} title="Settings">
          <Settings2 size={13} />
        </Button>

        {running ? (
          <Button variant="danger" size="sm" onClick={onStop}>
            <Square size={12} />
            Stop
          </Button>
        ) : (
          <Button variant="primary" size="sm" onClick={onStart} disabled={!hasKey}>
            {running ? <Spinner size={12} /> : <Play size={12} />}
            Run
          </Button>
        )}
      </div>
    </header>
  )
}
