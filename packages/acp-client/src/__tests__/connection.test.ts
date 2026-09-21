import { describe, expect, it } from 'bun:test'
import { AcpClientConnection, type ContextApi } from '../connection.js'
import { AcpConnectionError } from '../types.js'

/**
 * Stand-in for the SDK's ClientContext: records requests so tests assert what
 * the connection actually forwarded, without touching any child process.
 */
function mockContext(): ContextApi & { calls: Array<[string, unknown]> } {
  const calls: Array<[string, unknown]> = []
  return {
    calls,
    request: async (method, params) => {
      calls.push([method, params])
      return { echoed: method }
    },
    buildSession: (cwd: string) => ({
      start: async () => ({ sessionId: 'synthetic', cwd }) as never,
    }),
  }
}

function testConnection(ctx: ContextApi): AcpClientConnection {
  const conn = new AcpClientConnection(
    { close: () => {} } as never,
    null,
  )
  conn.setContextForTest(ctx)
  return conn
}

describe('AcpClientConnection', () => {
  it('forwards requests through withContext', async () => {
    const ctx = mockContext()
    const conn = testConnection(ctx)

    const result = await conn.withContext(async c => c.request('session/list', {}))
    expect((result as { echoed: string }).echoed).toBe('session/list')
    expect(ctx.calls).toEqual([['session/list', {}]])
  })

  it('starts a session via buildSession', async () => {
    const conn = testConnection(mockContext())

    const session = await conn.withContext(async c => c.buildSession('/tmp').start())
    expect(session as unknown as { sessionId: string; cwd: string }).toEqual({
      sessionId: 'synthetic',
      cwd: '/tmp',
    })
  })

  it('rejects withContext after close()', async () => {
    const conn = testConnection(mockContext())
    conn.close()

    await expect(
      conn.withContext(async c => c.request('session/list', {})),
    ).rejects.toThrow(AcpConnectionError)
  })
})
