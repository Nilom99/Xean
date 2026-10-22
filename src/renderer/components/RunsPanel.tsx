import { useEffect, useState } from 'react'
import { FileText, History } from 'lucide-react'
import type { RunSummary } from '@shared/types'
import { api } from '../lib/api'
import { formatDuration, formatTime } from '../lib/format'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { EmptyState } from './ui/Spinner'

const STATUS_TONE = {
  done: 'success',
  aborted: 'warning',
  failed: 'danger'
} as const

/** The history of previous runs. */
export function RunsPanel() {
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = async (): Promise<void> => {
    try {
      const list = await api().listRuns()
      setRuns([...list].sort((a, b) => b.startedAt - a.startedAt))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    void load()
  }, [])

  if (runs.length === 0) {
    return (
      <EmptyState
        icon={<History size={22} />}
        title="No runs yet"
        description={error ?? 'Completed runs are listed here with their reports.'}
      />
    )
  }

  return (
    <div className="h-full overflow-auto p-3">
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        {runs.map((run) => (
          <div
            key={run.runId}
            className="flex items-start gap-3 rounded-lg border border-border bg-surface p-2.5"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-[13px] font-medium text-ink">{run.goal}</span>
                <Badge tone={STATUS_TONE[run.status]}>{run.status}</Badge>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-ink-faint">
                <span>{formatTime(run.startedAt)}</span>
                <span>·</span>
                <span>{formatDuration(run.endedAt - run.startedAt)}</span>
                <span>·</span>
                <span>
                  {run.tasks} task{run.tasks === 1 ? '' : 's'}
                </span>
              </div>
            </div>

            <Button
              size="sm"
              variant="ghost"
              title="Open the run report"
              onClick={() => void api().exportReport(run.runId)}
            >
              <FileText size={13} />
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
