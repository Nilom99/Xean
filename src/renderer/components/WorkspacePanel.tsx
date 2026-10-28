import { useEffect, useState } from 'react'
import { ChevronRight, File, FileCode2, Folder, FolderOpen } from 'lucide-react'
import type { WorkspaceNode } from '@shared/ipc'
import { api } from '../lib/api'
import { EmptyState } from './ui/Spinner'

interface TreeNodeProps {
  node: WorkspaceNode
  depth: number
  selected: string | null
  onSelect: (path: string) => void
}

function TreeNode({ node, depth, selected, onSelect }: TreeNodeProps) {
  const [open, setOpen] = useState(depth < 1)

  if (node.type === 'dir') {
    return (
      <div role="treeitem" aria-expanded={open} aria-label={node.name}>
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[12px] text-ink-muted hover:bg-surface-2 hover:text-ink"
          style={{ paddingLeft: depth * 10 + 4 }}
        >
          <ChevronRight
            size={11}
            className={open ? 'rotate-90 transition-transform' : 'transition-transform'}
          />
          {open ? <FolderOpen size={12} /> : <Folder size={12} />}
          <span className="truncate">{node.name}</span>
        </button>
        {open ? (
          <div role="group">
            {(node.children ?? []).map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                selected={selected}
                onSelect={onSelect}
              />
            ))}
          </div>
        ) : null}
      </div>
    )
  }

  const isCode = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|css|html|py|rs|go|java|sh|yml|yaml)$/i.test(
    node.name
  )

  const isSelected = selected === node.path

  return (
    <div role="treeitem" aria-selected={isSelected} aria-label={node.name}>
      <button
        onClick={() => onSelect(node.path)}
        className={
          isSelected
            ? 'flex w-full items-center gap-1 rounded bg-accent-soft px-1 py-0.5 text-left text-[12px] text-accent'
            : 'flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[12px] text-ink-muted hover:bg-surface-2 hover:text-ink'
        }
        style={{ paddingLeft: depth * 10 + 18 }}
      >
        {isCode ? <FileCode2 size={12} /> : <File size={12} />}
        <span className="truncate">{node.name}</span>
      </button>
    </div>
  )
}

export interface WorkspacePanelProps {
  /** Bumped by the parent whenever the workspace may have changed. */
  refreshToken: number
}

/** The workspace file tree and a simple file viewer. */
export function WorkspacePanel({ refreshToken }: WorkspacePanelProps) {
  const [tree, setTree] = useState<WorkspaceNode[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const nodes = await api().readTree()
        if (!cancelled) {
          setTree(nodes)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [refreshToken])

  const open = async (path: string): Promise<void> => {
    setSelected(path)
    setContent(null)
    try {
      const result = await api().readFile(path)
      if (result.ok) {
        setContent(result.content ?? '')
        setError(null)
      } else {
        setError(result.error ?? 'Could not read the file.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="flex h-full min-h-0">
      <div role="tree" aria-label="Workspace file tree" className="w-56 shrink-0 overflow-auto border-r border-border bg-surface p-1.5">
        {tree.length === 0 ? (
          <div className="px-1.5 py-2 text-[11px] text-ink-faint">
            {error ? error : 'The workspace is empty.'}
          </div>
        ) : (
          tree.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              depth={0}
              selected={selected}
              onSelect={(path) => void open(path)}
            />
          ))
        )}
      </div>

      <div className="min-w-0 flex-1 overflow-auto bg-surface">
        {selected ? (
          <>
            <div className="sticky top-0 border-b border-border bg-surface px-3 py-1.5 font-mono text-[12px] text-ink">
              {selected}
            </div>
            {error ? (
              <div className="p-3 text-[12px] text-danger">{error}</div>
            ) : content === null ? (
              <div className="p-3 text-[12px] text-ink-faint">Loading…</div>
            ) : (
              <pre className="p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink-muted">
                {content}
              </pre>
            )}
          </>
        ) : (
          <EmptyState
            icon={<FolderOpen size={22} />}
            title="No file selected"
            description="Pick a file from the tree to view its contents."
          />
        )}
      </div>
    </div>
  )
}
