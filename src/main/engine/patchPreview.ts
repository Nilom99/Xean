import { computeDiff } from './diff'
import type { Sandbox } from './sandbox'
import { randomUUID } from 'node:crypto'

export interface ProposedFileChange {
  path: string
  content: string
}

export interface FileDiffPreview {
  path: string
  existed: boolean
  oldContent: string | null
  newContent: string
  unifiedDiff: string
  linesAdded: number
  linesRemoved: number
}

export interface AtomicChangeGroup {
  id: string
  runId: string
  taskId: string
  description: string
  files: FileDiffPreview[]
  totalAdded: number
  totalRemoved: number
  createdAt: number
}

/** Previews patches and manages atomic change groups. */
export class PatchPreviewManager {
  private readonly sandbox: Sandbox

  constructor(sandbox: Sandbox) {
    this.sandbox = sandbox
  }

  /** Create an atomic change group preview for proposed file edits. */
  async createPreviewGroup(
    runId: string,
    taskId: string,
    description: string,
    proposedFiles: ProposedFileChange[]
  ): Promise<AtomicChangeGroup> {
    const filePreviews: FileDiffPreview[] = []
    let totalAdded = 0
    let totalRemoved = 0

    for (const proposed of proposedFiles) {
      let oldContent: string | null = null
      let existed = false

      try {
        oldContent = await this.sandbox.readFile(proposed.path)
        existed = true
      } catch {
        oldContent = null
        existed = false
      }

      const diffResult = computeDiff(proposed.path, oldContent, proposed.content)
      totalAdded += diffResult.added
      totalRemoved += diffResult.removed

      filePreviews.push({
        path: proposed.path,
        existed,
        oldContent,
        newContent: proposed.content,
        unifiedDiff: diffResult.unified,
        linesAdded: diffResult.added,
        linesRemoved: diffResult.removed
      })
    }

    return {
      id: `group-${randomUUID()}`,
      runId,
      taskId,
      description,
      files: filePreviews,
      totalAdded,
      totalRemoved,
      createdAt: Date.now()
    }
  }

  /** Format atomic change group preview into a human-readable markdown summary. */
  formatGroupSummary(group: AtomicChangeGroup): string {
    const header = `### Atomic Patch Preview (${group.files.length} files, +${group.totalAdded} / -${group.totalRemoved})\n`
    const fileList = group.files
      .map(
        (f) =>
          `- **${f.path}** (${f.existed ? 'modified' : 'created'}): +${f.linesAdded} / -${f.linesRemoved}`
      )
      .join('\n')

    return `${header}\n${fileList}`
  }
}
