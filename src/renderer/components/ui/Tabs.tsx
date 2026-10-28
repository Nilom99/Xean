import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export interface TabDefinition<T extends string> {
  id: T
  label: ReactNode
  badge?: ReactNode
}

export interface TabsProps<T extends string> {
  tabs: TabDefinition<T>[]
  active: T
  onChange: (id: T) => void
  className?: string
}

/** A horizontal tab strip. */
export function Tabs<T extends string>({ tabs, active, onChange, className }: TabsProps<T>) {
  const handleKeyDown = (event: React.KeyboardEvent, index: number) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      const nextIndex = (index + 1) % tabs.length
      onChange(tabs[nextIndex].id)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      const prevIndex = (index - 1 + tabs.length) % tabs.length
      onChange(tabs[prevIndex].id)
    }
  }

  return (
    <div
      className={cn('flex items-center gap-0.5 border-b border-border', className)}
      role="tablist"
      aria-label="Workspace views"
    >
      {tabs.map((tab, index) => {
        const isActive = tab.id === active
        return (
          <button
            key={tab.id}
            id={`tab-${tab.id}`}
            role="tab"
            aria-selected={isActive}
            aria-controls={`tabpanel-${tab.id}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            className={cn(
              'relative flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent',
              isActive ? 'text-ink' : 'text-ink-muted hover:text-ink'
            )}
          >
            {tab.label}
            {tab.badge}
            {isActive ? (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
