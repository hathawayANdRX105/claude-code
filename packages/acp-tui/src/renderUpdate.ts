import type { ActiveSessionMessage } from '@agentclientprotocol/sdk'

/**
 * One line of conversation output. Pure data so the component layer is dumb
 * and the conversion is unit-testable without rendering.
 */
export interface DisplayLine {
  text: string
  dim?: boolean
}

/**
 * Turn an ACP session update into display lines.
 *
 * Deliberately partial: text and tool activity are what a usable first cut
 * needs. Plans, compaction summaries, and mode switches are ignored — they
 * render as nothing rather than as noise, and can grow real UI later.
 */
export function renderUpdate(message: ActiveSessionMessage): DisplayLine[] {
  if (message.kind !== 'session_update') return []
  const update = message.update as { sessionUpdate?: string } & Record<
    string,
    unknown
  >
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
      return textLines(update.content)
    case 'agent_thought_chunk':
      // Reasoning is agent-internal; show it dimmed so it reads as aside, not answer.
      return textLines(update.content, true)
    case 'tool_call':
      return [{ text: toolLine(update), dim: true }]
    case 'tool_call_update':
      // Only status changes carry new information; a title-only update repeats.
      if (update.status === null || update.status === undefined) return []
      return [{ text: toolLine(update), dim: true }]
    case 'usage_update':
      return [{ text: usageLine(update), dim: true }]
    default:
      return []
  }
}

function textLines(content: unknown, dim = false): DisplayLine[] {
  const text = extractText(content)
  if (text === null) return []
  return [{ text, ...(dim ? { dim: true } : {}) }]
}

function extractText(content: unknown): string | null {
  if (content === null || typeof content !== 'object') return null
  const block = content as { type?: string; text?: unknown }
  if (block.type !== 'text' || typeof block.text !== 'string') return null
  return block.text.length > 0 ? block.text : null
}

function toolLine(update: Record<string, unknown>): string {
  const name = typeof update.name === 'string' ? update.name : null
  const title = typeof update.title === 'string' ? update.title : null
  const status = typeof update.status === 'string' ? update.status : null
  const label = name ?? title ?? 'tool'
  return status === null ? `⚙ ${label}` : `⚙ ${label} — ${status}`
}

function usageLine(update: Record<string, unknown>): string {
  const used = Number(update.used)
  const size = Number(update.size)
  if (!Number.isFinite(used) || !Number.isFinite(size)) return ''
  const pct = size > 0 ? Math.round((used / size) * 100) : 0
  return `context ${used}/${size} tokens (${pct}%)`
}
