import { useState } from 'react'
import { FileDiff } from 'lucide-react'
import type { FilePatch } from '@shared/types'
import { parseUnifiedRows } from '../lib/diff'
import { EmptyState } from './ui/Spinner'

/** Renders one unified diff as coloured rows. */
function DiffRows({ diff }: { diff: string }) {
  const rows = parseUnifiedRows(diff)
  return (
    <div className="overflow-x-auto font-mono text-[12px] leading-relaxed">
      {rows.map((row, index) => (
        <div
          key={index}
          className={
            row.type === 'add' ? 'diff-add' : row.type === 'del' ? 'diff-del' : 'diff-ctx'
          }
        >
          <span className="inline-block w-10 select-none pr-2 text-right text-ink-faint">
            {row.oldNumber ?? ''}
          </span>
          <span className="inline-block w-10 select-none pr-2 text-right text-ink-faint">
            {row.newNumber ?? ''}
          </span>
          <span
            className={
              row.type === 'add'
                ? 'text-success'
                : row.type === 'del'
                  ? 'text-danger'
                  : 'text-ink-muted'
            }
          >
            {row.type === 'add' ? '+' : row.type === 'del' ? '-' : ' '}
            {row.text}
          </span>
        </div>
      ))}
    </div>
  )
}

/** Shows every file the agents changed during the run. */
export function DiffViewer({ patches }: { patches: FilePatch[] }) {
  const [selected, setSelected] = useState<string | null>(null)

  if (patches.length === 0) {
    return (
      <EmptyState
        icon={<FileDiff size={22} />}
        title="No changes yet"
        description="Diffs appear here as soon as the implementer writes files into the workspace."
      />
    )
  }

  const active = patches.find((p) => p.path === selected) ?? patches[patches.length - 1]

  return (
    <div className="flex h-full min-h-0">
      {/* File list */}
      <div className="w-56 shrink-0 overflow-auto border-r border-border bg-surface">
        {patches.map((patch) => (
          <button
            key={`${patch.path}-${patch.added}-${patch.removed}`}
            onClick={() => setSelected(patch.path)}
            className={
              patch.path === active.path
                ? 'block w-full border-l-2 border-accent bg-surface-2 px-2.5 py-1.5 text-left'
                : 'block w-full border-l-2 border-transparent px-2.5 py-1.5 text-left hover:bg-surface-2'
            }
          >
            <div className="truncate text-[12px] text-ink" title={patch.path}>
              {patch.path}
            </div>
            <div className="flex gap-2 text-[10px]">
              <span className="text-success">+{patch.added}</span>
              <span className="text-danger">-{patch.removed}</span>
            </div>
          </button>
        ))}
      </div>

      {/* Diff */}
      <div className="min-w-0 flex-1 overflow-auto bg-surface">
        <div className="sticky top-0 border-b border-border bg-surface px-3 py-1.5">
          <span className="font-mono text-[12px] text-ink">{active.path}</span>
        </div>
        <DiffRows diff={active.diff} />
      </div>
    </div>
  )
}
