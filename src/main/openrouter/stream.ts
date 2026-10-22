import type { ChatRequest, ChatResult } from './client'
import { redactSecrets } from './client'

interface StreamDelta {
  content?: string
  reasoning?: string
}

interface StreamChoice {
  delta?: StreamDelta
  finish_reason?: string | null
}

interface StreamChunk {
  choices?: StreamChoice[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  error?: { message?: string }
}

/**
 * Consume an OpenRouter SSE stream.
 *
 * Chunks arrive as `data: {...}` lines; `[DONE]` terminates the stream.
 * Deltas are forwarded to `onDelta` as they arrive so the UI can render
 * tokens live without layout jank.
 */
export async function consumeStream(
  res: Response,
  request: ChatRequest
): Promise<ChatResult> {
  const body = res.body
  if (!body) {
    throw new Error('OpenRouter returned an empty response body.')
  }

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let reasoning = ''
  let promptTokens = 0
  let completionTokens = 0
  let finished = false
  let finishReason = ''

  const handleChunk = (raw: string): void => {
    const line = raw.trim()
    if (!line.startsWith('data:')) return
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') {
      if (payload === '[DONE]') finished = true
      return
    }

    let parsed: StreamChunk
    try {
      parsed = JSON.parse(payload) as StreamChunk
    } catch {
      return
    }

    if (parsed.error?.message) {
      throw new Error(redactSecrets(parsed.error.message))
    }

    const delta = parsed.choices?.[0]?.delta
    if (delta?.content) {
      content += delta.content
      request.onDelta?.(delta.content)
    } else if (delta?.reasoning) {
      // Reasoning is not part of the answer, but it must be tracked: a model
      // that thinks until the token budget runs out returns no content at all.
      reasoning += delta.reasoning
    }

    const finish = parsed.choices?.[0]?.finish_reason
    if (finish) finishReason = finish

    if (parsed.usage) {
      promptTokens = parsed.usage.prompt_tokens ?? promptTokens
      completionTokens = parsed.usage.completion_tokens ?? completionTokens
    }
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // SSE events are separated by a blank line; handle both \n\n and \r\n\r\n.
      let separator = buffer.indexOf('\n\n')
      while (separator !== -1) {
        const block = buffer.slice(0, separator)
        buffer = buffer.slice(separator + 2)
        for (const line of block.split('\n')) handleChunk(line)
        separator = buffer.indexOf('\n\n')
      }
    }
    if (buffer.trim()) {
      for (const line of buffer.split('\n')) handleChunk(line)
    }
  } finally {
    reader.releaseLock()
  }

  // An empty answer is always a failure. The usual cause is a reasoning
  // model that spent the whole token budget thinking, so the reply says so
  // instead of failing later with a confusing "no files" error.
  if (!content) {
    if (reasoning) {
      throw new Error(
        `${request.model} used its entire token budget reasoning and returned no answer. ` +
          'Retry with a lower reasoning budget or a different model.'
      )
    }
    throw new Error(
      `${request.model} returned an empty answer ` +
        `(finish_reason: ${finishReason || 'none'}, stream ${finished ? 'complete' : 'truncated'}).`
    )
  }

  return {
    content,
    usage: {
      promptTokens: promptTokens || estimateTokens(request.messages.map((m) => m.content).join('\n')),
      completionTokens: completionTokens || estimateTokens(content)
    },
    model: request.model,
    attempts: 1
  }
}

/** Rough token estimate used only when the provider omits usage data. */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.max(1, Math.ceil(text.length / 4))
}
