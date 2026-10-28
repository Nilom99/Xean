import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '../../lib/cn'
import { Button } from './Button'

export interface DialogProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  /** Prevent closing while a decision is pending. */
  locked?: boolean
}

/**
 * A modal dialog.
 *
 * Escape closes it and clicking the backdrop closes it, unless `locked` is
 * set (used for approvals, where dismissing would strand the engine).
 */
export function Dialog({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  locked = false
}: DialogProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !locked) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, locked, onClose])

  if (!open) return null

  const titleId = 'dialog-title-id'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div
        className="absolute inset-0 bg-black/55"
        onClick={() => {
          if (!locked) onClose()
        }}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          'relative flex max-h-full w-full max-w-xl flex-col overflow-hidden',
          'rounded-xl border border-border bg-surface shadow-2xl'
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div id={titleId} className="text-sm font-semibold text-ink">
              {title}
            </div>
            {subtitle ? <div className="mt-0.5 text-xs text-ink-muted">{subtitle}</div> : null}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={locked} aria-label="Close">
            <X size={14} />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">{children}</div>

        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  )
}
