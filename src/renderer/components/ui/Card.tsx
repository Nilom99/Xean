import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-lg border border-border bg-surface', className)}
      {...props}
    />
  )
}

export function CardHeader({
  className,
  title,
  subtitle,
  actions,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 border-b border-border px-3 py-2',
        className
      )}
      {...props}
    >
      <div className="min-w-0">
        <div className="truncate text-[13px] font-semibold text-ink">{title}</div>
        {subtitle ? (
          <div className="truncate text-xs text-ink-muted">{subtitle}</div>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </div>
  )
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-3', className)} {...props} />
}
