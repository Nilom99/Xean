import { useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { ArrowRight, MessagesSquare } from 'lucide-react'
import type { Role } from '@shared/types'
import { ROLE_LABELS } from '@shared/types'
import type { UiMessage } from '../lib/events'
import { formatTime } from '../lib/format'
import { EmptyState } from './ui/Spinner'

const ROLE_TONE: Record<Role, string> = {
  orchestrator: 'text-info',
  implementer: 'text-accent',
  reviewer: 'text-warning',
  runner: 'text-success'
}

/**
 * The agent transcript.
 *
 * Messages addressed to the user are highlighted; agent-to-agent traffic is
 * shown dimmed so the conversation between agents is still readable.
 */
export function Transcript({
  messages,
  streams
}: {
  messages: UiMessage[]
  streams: Partial<Record<Role, string>>
}) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length, streams])

  const hasContent = messages.length > 0 || Object.keys(streams).length > 0

  if (!hasContent) {
    return (
      <EmptyState
        icon={<MessagesSquare size={22} />}
        title="Nothing has happened yet"
        description="The orchestrator's plan, the agents' messages and their streamed output appear here."
      />
    )
  }

  return (
    <div className="h-full overflow-auto px-3 py-2">
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        {messages.map((message) => (
          <div
            key={message.id}
            className={
              message.toUser
                ? 'rounded-lg border border-border bg-surface-2 p-2.5'
                : 'rounded-lg border border-transparent p-2.5'
            }
          >
            <div className="mb-1 flex items-center gap-1.5 text-[11px]">
              <span className={`font-semibold ${ROLE_TONE[message.from]}`}>
                {ROLE_LABELS[message.from]}
              </span>
              <ArrowRight size={10} className="text-ink-faint" />
              <span className="text-ink-muted">
                {message.to === 'user' ? 'You' : ROLE_LABELS[message.to]}
              </span>
              <span className="ml-auto text-ink-faint">{formatTime(message.ts)}</span>
            </div>
            <div
              className={
                message.toUser ? 'md-body text-ink' : 'md-body text-ink-muted'
              }
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                {message.body}
              </ReactMarkdown>
            </div>
          </div>
        ))}

        {/* Live streamed model output, keyed by role. */}
        {Object.entries(streams).map(([role, text]) => (
          <div key={role} className="rounded-lg border border-border bg-surface-2 p-2.5">
            <div className="mb-1 flex items-center gap-1.5 text-[11px]">
              <span className={`font-semibold ${ROLE_TONE[role as Role]}`}>
                {ROLE_LABELS[role as Role]}
              </span>
              <span className="text-ink-faint">streaming…</span>
            </div>
            <pre className="md-body overflow-x-auto whitespace-pre-wrap text-ink-muted">
              {text}
            </pre>
          </div>
        ))}

        <div ref={endRef} />
      </div>
    </div>
  )
}
