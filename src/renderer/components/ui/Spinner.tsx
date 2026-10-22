import { Loader2 } from 'lucide-react'
import { cn } from '../../lib/cn'

/** An indeterminate loading indicator. */
export function Spinner({ className, size = 14 }: { className?: string; size?: number }) {
  return <Loader2 size={size} className={cn('animate-spin text-ink-muted', className)} />
}

/** A centred loading state. */
export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-[13px] text-ink-muted">
      <Spinner />
      <span>{label}</span>
    </div>
  )
}

/** An empty-state block. */
export function EmptyState({
  icon,
  title,
  description
}: {
  icon?: React.ReactNode
  title: string
  description?: string
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      {icon ? <div className="text-ink-faint">{icon}</div> : null}
      <div className="text-[13px] font-medium text-ink-muted">{title}</div>
      {description ? (
        <div className="max-w-sm text-xs text-ink-faint">{description}</div>
      ) : null}
    </div>
  )
}
