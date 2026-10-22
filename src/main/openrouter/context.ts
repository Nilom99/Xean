export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** Rolling window + compacted summary context management. */
export interface ContextWindowOptions {
  /** Number of recent messages kept verbatim (default 12). */
  keep?: number
  /** Max characters for a single file payload (default 20000). */
  maxFileChars?: number
}

export const DEFAULT_KEEP = 12
export const DEFAULT_MAX_FILE_CHARS = 20_000

/** Truncate a file payload, marking the cut explicitly. */
export function truncateFileContent(content: string, maxChars = DEFAULT_MAX_FILE_CHARS): string {
  if (content.length <= maxChars) return content
  return `${content.slice(0, maxChars)}\n\n[truncated — ${content.length - maxChars} more characters omitted]`
}

/**
 * Keeps a rolling window of the last K messages plus a compacted summary of
 * everything older. Prevents context from blowing up across iterations
 * without losing the thread of the conversation.
 */
export class ContextWindow {
  private messages: ChatMessage[] = []
  private summary = ''

  constructor(private readonly options: ContextWindowOptions = {}) {}

  private get keep(): number {
    return this.options.keep ?? DEFAULT_KEEP
  }

  /** Max characters for a single file payload (default 20000). */
  private get maxFileChars(): number {
    return this.options.maxFileChars ?? DEFAULT_MAX_FILE_CHARS
  }

  /** Truncate file content using this window's configured limit. */
  truncate(content: string): string {
    return truncateFileContent(content, this.maxFileChars)
  }

  /** Truncate a file payload using this window's file limit. */
  clipFile(content: string): string {
    return truncateFileContent(content, this.maxFileChars)
  }

  getSummary(): string {
    return this.summary
  }

  /** Append a message, compacting old ones when the window overflows. */
  push(message: ChatMessage): void {
    if (message.role === 'system') {
      this.summary = message.content
      return
    }
    this.messages.push(message)

    while (this.messages.length > this.keep) {
      const dropped = this.messages.shift()
      if (dropped) this.summary += `\n- ${dropped.role}: ${this.summarizeLine(dropped.content)}`
    }
  }

  /** Replace the compacted summary (used when an agent receives a handoff). */
  setSummary(summary: string): void {
    this.summary = summary
  }

  private summarizeLine(content: string): string {
    const trimmed = content.replace(/\s+/g, ' ').trim()
    return trimmed.length > 300 ? `${trimmed.slice(0, 300)}…` : trimmed
  }

  /** Build the final message array sent to the model. */
  build(system: string): ChatMessage[] {
    const out: ChatMessage[] = []
    if (system) out.push({ role: 'system', content: system })
    if (this.summary) {
      out.push({
        role: 'system',
        content: `Context summary of earlier steps:\n${this.summary}`
      })
    }
    out.push(...this.messages)
    return out
  }

  /** All retained messages (used for persistence/debug). */
  snapshot(): ChatMessage[] {
    return [...this.messages]
  }

  clear(): void {
    this.messages = []
    this.summary = ''
  }
}
