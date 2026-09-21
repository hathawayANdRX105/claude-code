import { describe, expect, it } from 'bun:test'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AcpDaemon } from '../daemon.js'

/**
 * Bind to a fresh path per test: two servers can't share a socket, and a
 * leftover file blocks the next bind.
 */
function uniqueSocket(): string {
  return join(
    tmpdir(),
    `acp-daemon-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`,
  )
}

async function dial(path: string): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  const socket = createConnection(path, () => resolve())
  socket.on('error', reject)
  await promise
  socket.destroy()
}

describe('AcpDaemon', () => {
  it('accepts a connection and counts it', async () => {
    const socketPath = uniqueSocket()
    const accepted: number[] = []
    const daemon = new AcpDaemon(() => {
      accepted.push(1)
    })

    await daemon.listen(socketPath)
    expect(daemon.connectionCount).toBe(0)

    await dial(socketPath)
    // connection event is async; give the accept loop a turn
    await new Promise(resolve => setImmediate(resolve))

    expect(accepted).toHaveLength(1)
    expect(daemon.connectionCount).toBe(1)
    daemon.close()
  })

  it('drops the count back to zero on disconnect', async () => {
    const socketPath = uniqueSocket()
    const daemon = new AcpDaemon(() => {})
    await daemon.listen(socketPath)

    const { promise, resolve } = Promise.withResolvers<void>()
    const socket = createConnection(socketPath, () => resolve())
    await promise
    await new Promise(r => setImmediate(r))
    expect(daemon.connectionCount).toBe(1)

    socket.destroy()
    await new Promise(r => setImmediate(r))
    expect(daemon.connectionCount).toBe(0)
    daemon.close()
  })

  it('refuses a second listener on the same socket', async () => {
    const socketPath = uniqueSocket()
    const first = new AcpDaemon(() => {})
    await first.listen(socketPath)

    const second = new AcpDaemon(() => {})
    await expect(second.listen(socketPath)).rejects.toThrow()
    first.close()
  })
})
