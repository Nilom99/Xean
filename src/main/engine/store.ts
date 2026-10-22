import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import type { EngineEvent, RunSummary, Task } from '@shared/types'

/**
 * The main bundle is ESM, so `require` is not defined at runtime.
 * `createRequire` gives us a working CommonJS loader for the native module.
 */
const requireCjs = createRequire(import.meta.url)

/**
 * Persistence for conversations, tasks, events and artifacts.
 *
 * Uses better-sqlite3 when the native module is available for Electron's
 * ABI, otherwise falls back to an append-only JSON log so the app always
 * starts. The public surface is identical in both cases.
 */
export interface Store {
  init(): void
  persistEvent(event: EngineEvent): void
  saveTask(task: Task): void
  listTasks(runId: string): Task[]
  listEvents(runId?: string): EngineEvent[]
  saveRun(summary: RunSummary): void
  listRuns(): RunSummary[]
  close(): void
  readonly backend: 'sqlite' | 'json'
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id);
`

function dataDir(): string {
  return process.env.CODEX_LOCAL_DATA_DIR ?? app.getPath('userData')
}

/** SQLite-backed store. */
class SqliteStore implements Store {
  readonly backend = 'sqlite' as const
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any

  constructor(private readonly file: string) {}

  init(): void {
    // Required lazily so the app still boots when the native module is absent.
    const Database = requireCjs('better-sqlite3')
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    this.db = new Database(this.file)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(SCHEMA)
  }

  persistEvent(event: EngineEvent): void {
    const runId = (event as unknown as { runId?: string }).runId ?? null
    this.db
      .prepare('INSERT INTO events (run_id, ts, type, payload) VALUES (?, ?, ?, ?)')
      .run(runId, event.ts, event.type, JSON.stringify(event))
  }

  saveTask(task: Task): void {
    this.db
      .prepare(
        'INSERT INTO tasks (id, run_id, payload, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at'
      )
      .run(task.id, task.runId, JSON.stringify(task), task.updatedAt)
  }

  listTasks(runId: string): Task[] {
    const rows = this.db
      .prepare('SELECT payload FROM tasks WHERE run_id = ?')
      .all(runId) as Array<{ payload: string }>
    return rows.map((r) => JSON.parse(r.payload) as Task)
  }

  listEvents(runId?: string): EngineEvent[] {
    const rows = (
      runId
        ? this.db.prepare('SELECT payload FROM events WHERE run_id = ? ORDER BY id').all(runId)
        : this.db.prepare('SELECT payload FROM events ORDER BY id').all()
    ) as Array<{ payload: string }>
    return rows.map((r) => JSON.parse(r.payload) as EngineEvent)
  }

  saveRun(summary: RunSummary): void {
    this.db
      .prepare(
        'INSERT INTO runs (run_id, payload) VALUES (?, ?) ON CONFLICT(run_id) DO UPDATE SET payload = excluded.payload'
      )
      .run(summary.runId, JSON.stringify(summary))
  }

  listRuns(): RunSummary[] {
    const rows = this.db.prepare('SELECT payload FROM runs').all() as Array<{ payload: string }>
    return rows.map((r) => JSON.parse(r.payload) as RunSummary)
  }

  close(): void {
    try {
      this.db?.close()
    } catch {
      // already closed
    }
  }
}

/** JSON fallback store used when better-sqlite3 cannot be loaded. */
class JsonStore implements Store {
  readonly backend = 'json' as const
  private events: EngineEvent[] = []
  private tasks = new Map<string, Task>()
  private runs = new Map<string, RunSummary>()

  constructor(private readonly file: string) {}

  init(): void {
    try {
      const raw = fs.readFileSync(this.file, 'utf8')
      const parsed = JSON.parse(raw) as {
        events?: EngineEvent[]
        tasks?: Task[]
        runs?: RunSummary[]
      }
      this.events = parsed.events ?? []
      for (const t of parsed.tasks ?? []) this.tasks.set(t.id, t)
      for (const r of parsed.runs ?? []) this.runs.set(r.runId, r)
    } catch {
      // fresh store
    }
  }

  private flush(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(
        this.file,
        JSON.stringify({
          events: this.events,
          tasks: [...this.tasks.values()],
          runs: [...this.runs.values()]
        }),
        'utf8'
      )
    } catch {
      // disk errors must not break the run
    }
  }

  persistEvent(event: EngineEvent): void {
    this.events.push(event)
    this.flush()
  }

  saveTask(task: Task): void {
    this.tasks.set(task.id, task)
    this.flush()
  }

  listTasks(runId: string): Task[] {
    return [...this.tasks.values()].filter((t) => t.runId === runId)
  }

  listEvents(runId?: string): EngineEvent[] {
    return runId
      ? this.events.filter((e) => (e as unknown as { runId?: string }).runId === runId)
      : [...this.events]
  }

  saveRun(summary: RunSummary): void {
    this.runs.set(summary.runId, summary)
    this.flush()
  }

  listRuns(): RunSummary[] {
    return [...this.runs.values()]
  }

  close(): void {
    this.flush()
  }
}

/** Create the best available store for this machine. */
export function createStore(): Store {
  const dir = dataDir()
  const dbFile = path.join(dir, 'codex-local.db')
  const jsonFile = path.join(dir, 'codex-local.json')
  try {
    const store = new SqliteStore(dbFile)
    store.init()
    return store
  } catch (err) {
    console.warn(
      '[codex-local] better-sqlite3 unavailable, falling back to JSON store:',
      err instanceof Error ? err.message : err
    )
    const store = new JsonStore(jsonFile)
    store.init()
    return store
  }
}
