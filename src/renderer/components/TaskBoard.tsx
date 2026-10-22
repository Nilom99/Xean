import { AlertTriangle, CheckCircle2, CircleDashed, Clock, FileCode2, Loader2 } from 'lucide-react'
import type { TaskStatus } from '@shared/types'
import { ROLE_LABELS } from '@shared/types'
import type { UiTask } from '../lib/events'
import { countByStatus, patchTotals } from '../lib/events'
import { Badge } from './ui/Badge'
import { EmptyState } from './ui/Spinner'

const STATUS_META: Record<TaskStatus, { label: string; tone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info' }> = {
  PENDING: { label: 'Pending', tone: 'neutral' },
  ASSIGNED: { label: 'Assigned', tone: 'neutral' },
  IN_PROGRESS: { label: 'In progress', tone: 'accent' },
  IN_REVIEW: { label: 'In review', tone: 'info' },
  CHANGES_REQUESTED: { label: 'Changes requested', tone: 'warning' },
  DONE: { label: 'Done', tone: 'success' },
  BLOCKED: { label: 'Blocked', tone: 'warning' },
  FAILED: { label: 'Failed', tone: 'danger' }
}

const ORDER: TaskStatus[] = [
  'IN_PROGRESS',
  'IN_REVIEW',
  'CHANGES_REQUESTED',
  'PENDING',
  'ASSIGNED',
  'DONE',
  'BLOCKED',
  'FAILED'
]

function StatusIcon({ status }: { status: TaskStatus }) {
  if (status === 'IN_PROGRESS') return <Loader2 size={12} className="animate-spin text-accent" />
  if (status === 'DONE') return <CheckCircle2 size={12} className="text-success" />
  if (status === 'FAILED') return <AlertTriangle size={12} className="text-danger" />
  if (status === 'BLOCKED') return <AlertTriangle size={12} className="text-warning" />
  if (status === 'CHANGES_REQUESTED') return <AlertTriangle size={12} className="text-warning" />
  return <CircleDashed size={12} className="text-ink-faint" />
}

/** The task board — every task the orchestrator planned, grouped by status. */
export function TaskBoard({ tasks }: { tasks: UiTask[] }) {
  const counts = countByStatus(tasks)
  const totals = patchTotals(tasks)

  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={<Clock size={22} />}
        title="No tasks yet"
        description="Describe a goal above and the orchestrator will break it into tasks."
      />
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-3 py-2 text-[11px] text-ink-muted">
        {ORDER.filter((status) => counts[status] > 0).map((status) => (
          <Badge key={status} tone={STATUS_META[status].tone}>
            <StatusIcon status={status} />
            {counts[status]} {STATUS_META[status].label.toLowerCase()}
          </Badge>
        ))}
        <span className="ml-auto flex items-center gap-2">
          <span className="text-success">+{totals.added}</span>
          <span className="text-danger">-{totals.removed}</span>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2 2xl:grid-cols-3">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="rounded-lg border border-border bg-surface p-2.5 transition-colors hover:border-border-strong"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <StatusIcon status={task.status} />
                  <span className="truncate text-[13px] font-medium text-ink">{task.title}</span>
                </div>
                <Badge tone={STATUS_META[task.status].tone}>{STATUS_META[task.status].label}</Badge>
              </div>

              {task.description ? (
                <p className="mt-1 line-clamp-3 text-xs text-ink-muted">{task.description}</p>
              ) : null}

              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-faint">
                <span className="rounded bg-surface-2 px-1.5 py-0.5">
                  {ROLE_LABELS[task.role]}
                </span>
                {task.model ? (
                  <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono" title={task.model}>
                    {task.model}
                  </span>
                ) : null}
                {task.iteration > 0 ? <span>iter {task.iteration}</span> : null}
                {task.patches.length > 0 ? (
                  <span className="flex items-center gap-1">
                    <FileCode2 size={11} />
                    {task.patches.length} file{task.patches.length === 1 ? '' : 's'}
                  </span>
                ) : null}
              </div>

              {task.reviewItems.length > 0 ? (
                <ul className="mt-2 space-y-1 border-t border-border pt-2">
                  {task.reviewItems.slice(0, 4).map((item) => (
                    <li key={item.id} className="flex gap-1.5 text-[11px]">
                      <Badge
                        tone={
                          item.severity === 'blocker'
                            ? 'danger'
                            : item.severity === 'major'
                              ? 'warning'
                              : 'neutral'
                        }
                      >
                        {item.severity}
                      </Badge>
                      <span className="min-w-0 flex-1 truncate text-ink-muted" title={item.detail}>
                        {item.title}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {task.error ? (
                <p className="mt-2 rounded bg-danger-soft px-2 py-1 text-[11px] text-danger">
                  {task.error}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
