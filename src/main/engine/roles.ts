import type { Role, ReviewItem, ReviewVerdict } from '@shared/types'
import { parseJsonLoose, asString } from './json'

/** Each role has exactly one system prompt. */
export const ROLE_SYSTEM_PROMPTS: Record<Role, string> = {
  orchestrator: [
    'You are the Orchestrator of a multi-agent coding team.',
    'You decompose the user goal into independent tasks, assign each task to a role,',
    'and decide when the work is finished. You never edit code yourself.',
    'Always reply with a JSON object and nothing else.',
    'Shape: {"plan":[{"id":"t1","title":"short title","description":"what to build","role":"implementer","dependsOn":[]}],',
    '"summary":"one sentence plan"}',
    'Roles you may assign: implementer, reviewer, runner.',
    'Split the goal into 3 or more independent tasks when the goal is big enough.'
  ].join(' '),
  implementer: [
    'You are the Implementer. You write and edit files inside the workspace sandbox.',
    'You have no tools: you cannot list directories, read files, search the project',
    'or run commands. The workspace listing and the current content of the relevant',
    'files are provided in your message - that is your only view of the project.',
    'Never reply that you cannot access the workspace and never ask for access:',
    'work with the files that are shown to you.',
    'Always reply with a JSON object and nothing else.',
    'Shape: {"files":[{"path":"relative/path.ts","content":"full file content"}],',
    '"summary":"one line describing the change","commands":["npm test"]}',
    'Rules: use relative paths only, never write outside the workspace,',
    'include the complete file content for every file you touch,',
    'and list the commands needed to verify your work.',
    'Your reply must contain at least one entry in "files" with the complete file',
    'content - an empty "files" array is a failed answer.'
  ].join(' '),
  reviewer: [
    'You are the Reviewer. You read the proposed diff and return a verdict.',
    'Always reply with a JSON object and nothing else.',
    'Shape: {"verdict":"APPROVED | CHANGES_REQUESTED | BLOCKED",',
    '"items":[{"id":"1","severity":"blocker|major|minor","title":"short title",',
    '"detail":"what is wrong and how to fix it","file":"path.ts","line":12}]}',
    'Use CHANGES_REQUESTED when the code is wrong or incomplete.',
    'Each item must be specific and actionable.'
  ].join(' '),
  runner: [
    'You are the Runner. You execute the project test, lint and build commands',
    'inside the workspace sandbox and report the result.',
    'Always reply with a JSON object and nothing else.',
    'Shape: {"commands":["npm test"],"summary":"what you ran","expectations":"pass|fail"}',
    'Only run commands that make sense for the project.'
  ].join(' ')
}

/** Reminder appended to every request to keep free models on-format. */
export const FORMAT_REMINDER =
  'Respond with a single valid JSON object only. No prose, no markdown fences.'

/** Review verdict + items parsed from the reviewer model. */
export interface ParsedReview {
  verdict: ReviewVerdict
  items: ReviewItem[]
}

/**
 * Parse the reviewer response. Tolerant: a missing verdict defaults to
 * CHANGES_REQUESTED only when actionable items were found, otherwise
 * APPROVED — an unparsable reply must not silently approve broken code.
 */
export function parseReview(text: string): ParsedReview {
  const raw = parseJsonLoose<Record<string, unknown>>(text)
  if (!raw || typeof raw !== 'object') {
    return { verdict: 'APPROVED', items: [] }
  }

  const verdictRaw = String(raw.verdict ?? '').toUpperCase()
  const verdict: ReviewVerdict =
    verdictRaw === 'APPROVED' || verdictRaw === 'BLOCKED' || verdictRaw === 'CHANGES_REQUESTED'
      ? verdictRaw
      : 'APPROVED'

  const rawItems: unknown[] = Array.isArray(raw.items) ? raw.items : []
  const items: ReviewItem[] = []
  for (const [index, entry] of rawItems.entries()) {
    if (!entry || typeof entry !== 'object') continue
    const obj = entry as Record<string, unknown>
    const severityRaw = String(obj.severity ?? 'minor').toLowerCase()
    const severity: ReviewItem['severity'] =
      severityRaw === 'blocker' || severityRaw === 'major' ? severityRaw : 'minor'
    const title = asString(obj.title, `Issue ${index + 1}`)
    const detail = asString(obj.detail, asString(obj.description, title))
    const item: ReviewItem = {
      id: asString(obj.id, String(index + 1)),
      severity,
      title,
      detail
    }
    if (typeof obj.file === 'string') item.file = obj.file
    if (typeof obj.line === 'number') item.line = obj.line
    items.push(item)
  }
  if (verdict === 'APPROVED' && items.length > 0) {
    // The model listed problems but said APPROVED — treat the items as changes.
    return { verdict: 'CHANGES_REQUESTED', items }
  }
  return { verdict, items }
}
