import { useEffect, useMemo, useRef, useState } from 'react'
import { FolderOpen, Play, Search, Square, X } from 'lucide-react'
import { cn } from '../lib/cn'

export interface Command {
  id: string
  label: string
  hint?: string
  icon?: React.ReactNode
  run: () => void
}

export interface CommandPaletteProps {
  open: boolean
  commands: Command[]
  onClose: () => void
}

/** A searchable command palette (Ctrl+K). */
export function CommandPalette({ open, commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
    // Focus after the dialog mounts.
    const timer = window.setTimeout(() => inputRef.current?.focus(), 10)
    return () => window.clearTimeout(timer)
  }, [open])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return commands
    return commands.filter(
      (command) =>
        command.label.toLowerCase().includes(needle) ||
        (command.hint ?? '').toLowerCase().includes(needle)
    )
  }, [commands, query])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActive((i) => Math.min(i + 1, filtered.length - 1))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActive((i) => Math.max(i - 1, 0))
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        const command = filtered[active]
        if (command) {
          command.run()
          onClose()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, filtered, active, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]">
      <div className="absolute inset-0 bg-black/55" onClick={onClose} aria-hidden />

      <div className="relative w-full max-w-lg overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search size={14} className="shrink-0 text-ink-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            placeholder="Type a command…"
            className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-faint"
          />
          <button
            onClick={onClose}
            className="shrink-0 rounded p-0.5 text-ink-faint hover:text-ink"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        <div className="max-h-72 overflow-auto p-1.5">
          {filtered.length === 0 ? (
            <div className="px-2 py-6 text-center text-[13px] text-ink-faint">No matching command</div>
          ) : (
            filtered.map((command, index) => (
              <button
                key={command.id}
                onMouseEnter={() => setActive(index)}
                onClick={() => {
                  command.run()
                  onClose()
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]',
                  index === active ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:bg-surface-2'
                )}
              >
                <span className="shrink-0">{command.icon ?? <Search size={13} />}</span>
                <span className="min-w-0 flex-1 truncate">{command.label}</span>
                {command.hint ? (
                  <span className="shrink-0 text-[11px] text-ink-faint">{command.hint}</span>
                ) : null}
              </button>
            ))
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-border px-3 py-1.5 text-[11px] text-ink-faint">
          <span>↑↓ navigate</span>
          <span>↵ run</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  )
}

/** Icons used by the built-in commands. */
export const CommandIcons = {
  play: <Play size={13} />,
  stop: <Square size={13} />,
  folder: <FolderOpen size={13} />
}
