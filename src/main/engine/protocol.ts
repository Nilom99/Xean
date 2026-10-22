import type { Role } from '@shared/types'
import { parseJsonLoose, asString, parseJsonArrayLoose } from './json'

/** A task as produced by the orchestrator's plan. */
export interface PlannedTask {
  id: string
  title: string
  description: string
  role: Role
  dependsOn: string[]
}

export interface ParsedPlan {
  tasks: PlannedTask[]
  summary: string
}

const VALID_ROLES: Role[] = ['implementer', 'reviewer', 'runner']

/**
 * Parse the orchestrator's plan.
 *
 * Accepts several shapes because free models drift: a bare array of tasks,
 * `{plan:[...]}`, `{tasks:[...]}` or `{subtasks:[...]}`.
 */
export function parsePlan(text: string): ParsedPlan {
  const raw = parseJsonLoose<Record<string, unknown>>(text)
  let entries: unknown[] = []

  if (Array.isArray(raw)) {
    entries = raw
  } else if (raw && typeof raw === 'object') {
    for (const key of ['plan', 'tasks', 'subtasks', 'steps']) {
      const value = raw[key]
      if (Array.isArray(value)) {
        entries = value
        break
      }
    }
  }

  if (entries.length === 0) {
    // The model may have returned a single object describing one task.
    const single = parseJsonLoose<Record<string, unknown>>(text)
    if (single && typeof single === 'object' && (single.title || single.description)) {
      entries = [single]
    }
  }

  if (entries.length === 0) {
    const fallback = parseJsonArrayLoose<Record<string, unknown>>(text)
    entries = fallback
  }

  const tasks: PlannedTask[] = []
  let index = 0
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    const obj = entry as Record<string, unknown>
    const title = asString(obj.title, asString(obj.name, `Task ${index + 1}`))
    const description = asString(obj.description, asString(obj.task, asString(obj.details, title)))
    if (!title && !description) continue

    const roleRaw = String(obj.role ?? obj.assignee ?? 'implementer').toLowerCase()
    const role = VALID_ROLES.includes(roleRaw as Role) ? (roleRaw as Role) : 'implementer'

    const depsRaw = Array.isArray(obj.dependsOn) ? obj.dependsOn : []
    const dependsOn = depsRaw.map((d) => asString(d)).filter((d) => d.length > 0)

    tasks.push({
      id: asString(obj.id, `t${index + 1}`),
      title: title || `Task ${index + 1}`,
      description,
      role,
      dependsOn
    })
    index++
  }

  const summary = raw && typeof raw === 'object' ? asString(raw.summary, '') : ''
  return { tasks, summary }
}

/** A file the implementer wants to write. */
export interface ProposedFile {
  path: string
  content: string
}

/** Normalise a model-provided path to a workspace-relative POSIX path. */
export function normalizeProposedPath(raw: string): string {
  let p = raw.trim().replace(/\\/g, '/')
  p = p.replace(/^\.\//, '')
  p = p.replace(/^\/+/, '')
  return p
}

/** Read the content of a proposed file, tolerating the shapes models use. */
function proposedContent(obj: Record<string, unknown>): string {
  const raw =
    obj.content ?? obj.text ?? obj.body ?? obj.code ?? obj.source ?? obj.file_content
  if (Array.isArray(raw)) return raw.map((line) => String(line)).join('\n')
  return asString(raw, '')
}

/**
 * Parse the implementer response into concrete file writes.
 *
 * Supports `{"files":[{"path","content"}]}`, the common variants where the
 * model puts the content under `text` / `body` / `code`, and a bare top-level
 * array of file objects.
 */
export function parseProposedFiles(text: string): ProposedFile[] {
  const raw = parseJsonLoose<Record<string, unknown> | unknown[]>(text)
  if (!raw || typeof raw !== 'object') return []

  let list: unknown[]
  if (Array.isArray(raw)) {
    list = raw
  } else {
    const obj = raw as Record<string, unknown>
    list = Array.isArray(obj.files)
      ? obj.files
      : Array.isArray(obj.changes)
        ? obj.changes
        : Array.isArray(obj.edits)
          ? obj.edits
          : []
  }

  const out: ProposedFile[] = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const obj = entry as Record<string, unknown>
    const path = normalizeProposedPath(
      asString(obj.path, asString(obj.file, asString(obj.name, '')))
    )
    if (!path) continue
    const content = proposedContent(obj)
    if (!content) continue
    out.push({ path, content })
  }
  return out
}

/** Commands the implementer wants to run. */
export function parseCommands(text: string): string[] {
  const raw = parseJsonLoose<Record<string, unknown>>(text)
  if (!raw || typeof raw !== 'object') return []
  const list = Array.isArray(raw.commands) ? raw.commands : []
  return list.map((c) => asString(c)).filter((c) => c.trim().length > 0)
}
