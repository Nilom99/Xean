import { HelpCircle } from 'lucide-react'
import type { UiDecision } from '../lib/events'
import { Button } from './ui/Button'
import { Dialog } from './ui/Dialog'

export interface DecisionPromptProps {
  decision: UiDecision | null
  onRespond: (id: string, choice: string) => void
}

/**
 * An escalation the engine cannot resolve on its own.
 *
 * The run is paused until the operator picks one of the options.
 */
export function DecisionPrompt({ decision, onRespond }: DecisionPromptProps) {
  if (!decision) return null

  return (
    <Dialog
      open
      locked
      onClose={() => undefined}
      title="The agents need a decision"
      subtitle="Two agents disagree and the orchestrator could not break the tie"
      footer={null}
    >
      <div className="flex items-start gap-2">
        <HelpCircle size={16} className="mt-0.5 shrink-0 text-warning" />
        <p className="text-[13px] text-ink">{decision.question}</p>
      </div>

      {decision.detail ? (
        <pre className="mt-3 max-h-52 overflow-auto whitespace-pre-wrap rounded bg-surface-2 p-2.5 font-mono text-[12px] text-ink-muted">
          {decision.detail}
        </pre>
      ) : null}

      <div className="mt-4 flex flex-col gap-2">
        {decision.options.map((option) => (
          <Button
            key={option}
            variant="outline"
            className="h-auto justify-start py-2 text-left whitespace-normal"
            onClick={() => onRespond(decision.id, option)}
          >
            {option}
          </Button>
        ))}
      </div>
    </Dialog>
  )
}
