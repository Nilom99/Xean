import { useState } from 'react'
import { Play, Square, Wand2 } from 'lucide-react'
import { Button } from './ui/Button'
import { Textarea } from './ui/Input'

export interface GoalBarProps {
  running: boolean
  disabled: boolean
  onStart: (goal: string) => void
  onStop: () => void
}

const EXAMPLES = [
  'Build a REST API for a todo list with tests',
  'Add TypeScript types to every exported function',
  'Write a README explaining how to run this project'
]

/** The goal composer — the input that starts a run. */
export function GoalBar({ running, disabled, onStart, onStop }: GoalBarProps) {
  const [goal, setGoal] = useState('')

  const submit = (): void => {
    const trimmed = goal.trim()
    if (!trimmed || running) return
    onStart(trimmed)
  }

  return (
    <div className="shrink-0 border-b border-border bg-surface px-3 py-2.5">
      <div className="flex items-end gap-2">
        <Textarea
          rows={2}
          value={goal}
          disabled={running}
          placeholder="Describe what you want to build…"
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              submit()
            }
          }}
          className="min-h-[52px]"
        />

        {running ? (
          <Button variant="danger" onClick={onStop}>
            <Square size={13} />
            Stop
          </Button>
        ) : (
          <Button variant="primary" onClick={submit} disabled={disabled || !goal.trim()}>
            <Play size={13} />
            Start run
          </Button>
        )}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Wand2 size={11} className="text-ink-faint" />
        {EXAMPLES.map((example) => (
          <button
            key={example}
            onClick={() => setGoal(example)}
            disabled={running}
            className="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-muted transition-colors hover:border-border-strong hover:text-ink disabled:opacity-40"
          >
            {example}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-ink-faint">Ctrl+Enter to start</span>
      </div>
    </div>
  )
}
