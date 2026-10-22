import { AlertTriangle, Cpu, FolderTree, ShieldCheck } from 'lucide-react'
import type { EngineState } from '../lib/events'
import { formatTokens } from '../lib/format'

export interface StatusBarProps {
  state: EngineState
  workspaceRoot: string
  hasApiKey: boolean
}

/** The footer: run status, sandbox path and error count. */
export function StatusBar({ state, workspaceRoot, hasApiKey }: StatusBarProps) {
  const statusLabel =
    state.status === 'running'
      ? 'Running'
      : state.status === 'done'
        ? 'Completed'
        : state.status === 'unverified'
          ? 'Unverified'
          : state.status === 'aborted'
            ? 'Stopped'
            : state.status === 'failed'
              ? 'Failed'
              : 'Idle'

  const statusTone =
    state.status === 'running'
      ? 'text-accent'
      : state.status === 'done'
        ? 'text-success'
        : state.status === 'unverified'
          ? 'text-warning'
          : state.status === 'failed'
            ? 'text-danger'
            : state.status === 'aborted'
              ? 'text-warning'
              : 'text-ink-faint'

  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-border bg-surface px-3 text-[11px] text-ink-faint">
      <span className={statusTone}>{statusLabel}</span>

      {state.errors.length > 0 ? (
        <span className="flex items-center gap-1 text-danger" title={state.errors[0].message}>
          <AlertTriangle size={11} />
          {state.errors.length}
        </span>
      ) : null}

      {state.switches.length > 0 ? (
        <span className="flex items-center gap-1 text-warning" title="A fallback model was used">
          <Cpu size={11} />
          {state.switches.length}
        </span>
      ) : null}

      <span className="flex items-center gap-1">
        <ShieldCheck size={11} className={hasApiKey ? 'text-success' : 'text-ink-faint'} />
        {hasApiKey ? 'free tier' : 'no api key'}
      </span>

      <span className="ml-auto flex items-center gap-3">
        <span title="Tokens used in this run">
          {formatTokens(state.usage.promptTokens + state.usage.completionTokens)} tok
        </span>
        <span title="Model requests">{state.usage.requests} req</span>
        <span className="flex max-w-[38ch] items-center gap-1 truncate" title={workspaceRoot}>
          <FolderTree size={11} />
          <span className="truncate font-mono">{workspaceRoot}</span>
        </span>
      </span>
    </footer>
  )
}
