import { useState } from 'react'
import { FilePlus2, Terminal } from 'lucide-react'
import type { UiApproval } from '../lib/events'
import { Button } from './ui/Button'
import { Dialog } from './ui/Dialog'

/** The payload the engine sends with a write approval. */
interface WritePayload {
  files?: Array<{ path: string; content: string }>
  workspaceRoot?: string
}

/** The payload the engine sends with a command approval. */
interface CommandPayload {
  command?: string
  cwd?: string
  workspaceRoot?: string
}

export interface ApprovalPromptProps {
  approval: UiApproval | null
  onRespond: (id: string, allowed: boolean, always: boolean) => void
}

/**
 * A human-in-the-loop approval.
 *
 * The engine is suspended while this dialog is open, so it cannot be
 * dismissed without answering.
 */
export function ApprovalPrompt({ approval, onRespond }: ApprovalPromptProps) {
  const [always, setAlways] = useState(false)

  if (!approval) return null

  const payload = approval.payload as WritePayload & CommandPayload
  const isWrite = approval.kind === 'write'
  const files = payload.files ?? []
  const command = payload.command

  return (
    <Dialog
      open
      locked
      onClose={() => undefined}
      title={isWrite ? 'Approve file write' : 'Approve command'}
      subtitle={isWrite ? 'The implementer wants to write files' : 'The runner wants to run a command'}
      footer={
        <>
          <label className="mr-auto flex items-center gap-1.5 text-xs text-ink-muted">
            <input
              type="checkbox"
              checked={always}
              onChange={(e) => setAlways(e.target.checked)}
              className="accent-[var(--color-accent)]"
            />
            Allow all {isWrite ? 'writes' : 'commands'} for this session
          </label>
          <Button
            variant="danger"
            onClick={() => {
              onRespond(approval.id, false, false)
              setAlways(false)
            }}
          >
            Deny
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onRespond(approval.id, true, always)
              setAlways(false)
            }}
          >
            {always ? 'Always allow' : 'Allow'}
          </Button>
        </>
      }
    >
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded bg-surface-2 p-2.5 font-mono text-[12px] text-ink-muted">
        {approval.detail}
      </pre>

      {isWrite && files.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {files.map((file) => (
            <li
              key={file.path}
              className="flex items-center gap-2 rounded bg-surface-2 px-2 py-1.5 text-[12px]"
            >
              <FilePlus2 size={13} className="shrink-0 text-accent" />
              <span className="min-w-0 flex-1 truncate font-mono text-ink">{file.path}</span>
              <span className="shrink-0 text-[11px] text-ink-faint">
                {file.content.length} chars
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {command ? (
        <div className="mt-3 flex items-center gap-2 rounded bg-surface-2 px-2.5 py-2">
          <Terminal size={13} className="shrink-0 text-warning" />
          <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">{command}</code>
          {payload.cwd ? (
            <span className="shrink-0 font-mono text-[11px] text-ink-faint" title={payload.cwd}>
              {payload.cwd}
            </span>
          ) : null}
        </div>
      ) : null}

      {payload.workspaceRoot ? (
        <p className="mt-3 text-[11px] text-ink-faint">
          Sandbox root: <span className="font-mono">{payload.workspaceRoot}</span>
        </p>
      ) : null}
    </Dialog>
  )
}
