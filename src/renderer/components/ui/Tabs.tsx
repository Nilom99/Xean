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
  return (
    <div className={cn('flex items-center gap-0.5 border-b border-border', className)} role="tablist">
      {tabs.map((tab) => {
        const isActive = tab.id === active
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={cn(
              'relative flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium transition-colors',
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
