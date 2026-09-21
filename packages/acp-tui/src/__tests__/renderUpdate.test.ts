import { describe, expect, it } from 'bun:test'
import type { ActiveSessionMessage } from '@agentclientprotocol/sdk'
import { renderUpdate } from '../renderUpdate.js'

function update(
  sessionUpdate: string,
  extra: Record<string, unknown> = {},
): ActiveSessionMessage {
  return {
    kind: 'session_update',
    update: { sessionUpdate, ...extra },
  } as unknown as ActiveSessionMessage
}

describe('renderUpdate', () => {
  it('renders agent message text', () => {
    const lines = renderUpdate(
      update('agent_message_chunk', {
        content: { type: 'text', text: 'hello' },
      }),
    )
    expect(lines).toEqual([{ text: 'hello' }])
  })

  it('dims agent thoughts so they read as aside, not answer', () => {
    const lines = renderUpdate(
      update('agent_thought_chunk', { content: { type: 'text', text: 'hm' } }),
    )
    expect(lines).toEqual([{ text: 'hm', dim: true }])
  })

  it('drops empty text chunks instead of blank lines', () => {
    expect(
      renderUpdate(
        update('agent_message_chunk', { content: { type: 'text', text: '' } }),
      ),
    ).toEqual([])
  })

  it('ignores non-text content blocks', () => {
    expect(
      renderUpdate(
        update('agent_message_chunk', {
          content: { type: 'image', data: 'x' },
        }),
      ),
    ).toEqual([])
  })

  it('renders tool calls with a name', () => {
    const lines = renderUpdate(
      update('tool_call', {
        name: 'bash',
        title: 'Run ls',
        status: 'completed',
      }),
    )
    expect(lines).toEqual([{ text: '⚙ bash — completed', dim: true }])
  })

  it('falls back to the title when the tool name is absent', () => {
    const lines = renderUpdate(update('tool_call', { title: 'Read file' }))
    expect(lines[0]?.text).toBe('⚙ Read file')
  })

  it('ignores tool updates that carry no new status', () => {
    expect(
      renderUpdate(update('tool_call_update', { title: 'Read file' })),
    ).toEqual([])
  })

  it('renders usage as a context fraction', () => {
    const lines = renderUpdate(
      update('usage_update', { used: 5000, size: 20000 }),
    )
    expect(lines[0]?.text).toBe('context 5000/20000 tokens (25%)')
  })

  it('ignores plan, compaction, and mode updates', () => {
    expect(renderUpdate(update('plan', {}))).toEqual([])
    expect(renderUpdate(update('current_mode_update', {}))).toEqual([])
    expect(renderUpdate(update('compaction_update', {}))).toEqual([])
  })

  it('renders nothing for the stop message', () => {
    expect(
      renderUpdate({ kind: 'stop' } as unknown as ActiveSessionMessage),
    ).toEqual([])
  })
})
