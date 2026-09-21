import { describe, expect, test } from 'bun:test'
import { SessionRegistry } from '../registry.js'
import { drainSession } from '../drainSession.js'
import type {
  ActiveSession,
  ActiveSessionMessage,
} from '@agentclientprotocol/sdk'

/** Shape the SDK actually delivers: { kind: 'session_update', update: {...} } */
function chunk(text: string): ActiveSessionMessage {
  return {
    kind: 'session_update',
    update: {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text },
    },
  } as unknown as ActiveSessionMessage
}

describe('drainSession', () => {
  test('writes the failure as a line when the update stream rejects', async () => {
    const registry = new SessionRegistry()
    const sessionId = 'dead-session'
    registry.upsert({
      sessionId,
      cwd: '/tmp',
      title: '/tmp',
      active: true,
      lines: [],
    })

    // A session whose daemon died: every read rejects.
    const deadSession = {
      sessionId,
      nextUpdate: () => Promise.reject(new Error('daemon exited')),
    } as unknown as ActiveSession

    await drainSession(deadSession, registry)

    const session = registry.list()[0]
    expect(session.lines).toHaveLength(1)
    expect(session.lines[0].text).toBe('✗ daemon exited')
  })

  test('pumps rendered updates until the stream rejects', async () => {
    const registry = new SessionRegistry()
    const sessionId = 'live-then-dead'
    registry.upsert({
      sessionId,
      cwd: '/tmp',
      title: '/tmp',
      active: true,
      lines: [],
    })

    const messages = [chunk('hi')]
    let sent = 0
    const session = {
      sessionId,
      nextUpdate: () =>
        sent < messages.length
          ? Promise.resolve(messages[sent++])
          : Promise.reject(new Error('daemon exited')),
    } as unknown as ActiveSession

    await drainSession(session, registry)

    const stored = registry.list()[0]
    expect(stored.lines.map(l => l.text)).toEqual(['hi', '✗ daemon exited'])
  })
})
