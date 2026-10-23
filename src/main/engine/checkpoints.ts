import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type { Sandbox } from './sandbox'

export interface FileSnapshot {
  relativePath: string
  absolutePath: string
  content: string | null // null if file did not exist before
  existed: boolean
  hash?: string
}

export interface Checkpoint {
  id: string
  runId: string
  taskId: string
  ts: number
  description: string
  snapshots: FileSnapshot[]
}

export class CheckpointManager {
  private readonly sandbox: Sandbox
  private checkpoints = new Map<string, Checkpoint>()

  constructor(sandbox: Sandbox) {
    this.sandbox = sandbox
  }

  /** Create a checkpoint by taking a snapshot of given workspace files. */
  async createCheckpoint(
    runId: string,
    taskId: string,
    description: string,
    relativePaths: string[]
  ): Promise<Checkpoint> {
    const snapshots: FileSnapshot[] = []

    for (const relPath of relativePaths) {
      const absPath = await this.sandbox.resolveInside(relPath)
      let content: string | null = null
      let existed = false

      try {
        content = await fs.readFile(absPath, 'utf8')
        existed = true
      } catch {
        content = null
        existed = false
      }

      snapshots.push({
        relativePath: relPath,
        absolutePath: absPath,
        content,
        existed
      })
    }

    const checkpoint: Checkpoint = {
      id: `chk-${randomUUID()}`,
      runId,
      taskId,
      ts: Date.now(),
      description,
      snapshots
    }

    this.checkpoints.set(checkpoint.id, checkpoint)
    return checkpoint
  }

  /** Rollback a checkpoint, restoring all files to their original state. */
  async rollback(checkpointId: string): Promise<string[]> {
    const checkpoint = this.checkpoints.get(checkpointId)
    if (!checkpoint) {
      throw new Error(`Checkpoint ${checkpointId} not found`)
    }

    const restored: string[] = []

    for (const snapshot of checkpoint.snapshots) {
      if (snapshot.existed && snapshot.content !== null) {
        await this.sandbox.writeFile(snapshot.relativePath, snapshot.content)
      } else if (!snapshot.existed) {
        try {
          await fs.unlink(snapshot.absolutePath)
        } catch {
          // File might already be gone
        }
      }
      restored.push(snapshot.relativePath)
    }

    return restored
  }

  /** Rollback a single file within a checkpoint. */
  async rollbackFile(checkpointId: string, relativePath: string): Promise<boolean> {
    const checkpoint = this.checkpoints.get(checkpointId)
    if (!checkpoint) return false

    const snapshot = checkpoint.snapshots.find((s) => s.relativePath === relativePath)
    if (!snapshot) return false

    if (snapshot.existed && snapshot.content !== null) {
      await this.sandbox.writeFile(snapshot.relativePath, snapshot.content)
    } else if (!snapshot.existed) {
      try {
        await fs.unlink(snapshot.absolutePath)
      } catch {
        // File might already be gone
      }
    }
    return true
  }

  getCheckpoint(id: string): Checkpoint | undefined {
    return this.checkpoints.get(id)
  }

  listForTask(taskId: string): Checkpoint[] {
    return [...this.checkpoints.values()].filter((c) => c.taskId === taskId)
  }

  listForRun(runId: string): Checkpoint[] {
    return [...this.checkpoints.values()].filter((c) => c.runId === runId)
  }
}
