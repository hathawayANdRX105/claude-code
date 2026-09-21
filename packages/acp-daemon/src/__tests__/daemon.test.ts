import { describe, expect, it } from 'bun:test'
import { createConnection, type Socket } from 'node:net'
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

function dial(path: string): Promise<Socket> {
  const { promise, resolve, reject } = Promise.withResolvers<Socket>()
  const socket = createConnection(path, () => resolve(socket))
  socket.on('error', reject)
  return promise
}

/**
 * Wait for the daemon to notice a socket lifecycle event. The accept and close
 * callbacks run on later event-loop turns than the connect callback, so tests
 * must await the event rather than assume ordering.
 */
function daemonSettled(daemon: AcpDaemon, expected: number): Promise<void> {
  if (daemon.connectionCount === expected) return Promise.resolve()
  return new Promise(resolve => {
    const check = () => {
      if (daemon.connectionCount === expected) resolve()
      else setTimeout(check, 10)
    }
    setTimeout(check, 10)
  })
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

    const socket = await dial(socketPath)
    await daemonSettled(daemon, 1)

    expect(accepted).toHaveLength(1)
    expect(daemon.connectionCount).toBe(1)
    socket.destroy()
    daemon.close()
  })

  it('drops the count back to zero on disconnect', async () => {
    const socketPath = uniqueSocket()
    const daemon = new AcpDaemon(() => {})
    await daemon.listen(socketPath)

    const socket = await dial(socketPath)
    await daemonSettled(daemon, 1)
    expect(daemon.connectionCount).toBe(1)

    socket.destroy()
    await daemonSettled(daemon, 0)
    expect(daemon.connectionCount).toBe(0)
    daemon.close()
  })

  it('refuses a second listener on the same socket', async () => {
    const socketPath = uniqueSocket()
    const first = new AcpDaemon(() => {})
    await first.listen(socketPath)

    const second = new AcpDaemon(() => {})
    // EADDRINUSE surfaces as an 'error' event on the server, which listen()
    // wires through its reject path; the failure is asynchronous.
    await expect(second.listen(socketPath)).rejects.toThrow()
    first.close()
  })
})
