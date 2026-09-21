import { unlinkSync } from 'node:fs'
import { createConnection, createServer, type Socket } from 'node:net'
import { type DaemonOptions, DEFAULT_IDLE_TIMEOUT_SEC } from './paths.js'

/**
 * True if something is accepting connections on the socket path. Used to tell
 * a crashed daemon's dangling file (safe to reclaim) from a live daemon's
 * socket (must not be stolen). The connect error is asynchronous, so this
 * awaits it rather than relying on a synchronous throw.
 */
async function isSocketLive(path: string): Promise<boolean> {
  const { promise, resolve } = Promise.withResolvers<boolean>()
  const socket = createConnection(path)
  socket.on('connect', () => {
    socket.destroy()
    resolve(true)
  })
  socket.on('error', () => resolve(false))
  return promise
}

export class AcpDaemon {
  private readonly server
  private readonly idleTimeoutSec: number
  private connections = new Set<Socket>()
  private idleTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly onConnection: (socket: Socket) => void,
    options: DaemonOptions = {},
  ) {
    this.idleTimeoutSec = options.idleTimeoutSec ?? DEFAULT_IDLE_TIMEOUT_SEC
    this.server = createServer(socket => this.handleConnection(socket))
  }

  /**
   * Bind and start serving. Returns once listening. Also arms the idle timer:
   * with zero connections the daemon has nothing to keep it alive.
   */
  async listen(socketPath: string): Promise<void> {
    // Only clear a leftover socket file if nothing is actually listening on
    // it. A live daemon answers the probe; a crashed one leaves a dangling
    // file that the unlink below legitimately reclaims. Without this check a
    // second daemon would silently steal the socket of a running one.
    if (await isSocketLive(socketPath)) {
      throw new Error(`daemon already listening at ${socketPath}`)
    }
    try {
      unlinkSync(socketPath)
    } catch {}

    return new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(socketPath, () => {
        this.server.removeListener('error', reject)
        this.armIdleTimer()
        resolve()
      })
    })
  }

  private handleConnection(socket: Socket): void {
    this.connections.add(socket)
    this.disarmIdleTimer()
    socket.on('close', () => {
      this.connections.delete(socket)
      if (this.connections.size === 0) this.armIdleTimer()
    })
    this.onConnection(socket)
  }

  /**
   * Exit after idleTimeoutSec with no connections. jcode uses the same
   * pattern (300s): a daemon nobody is talking to is pure overhead.
   */
  private armIdleTimer(): void {
    this.disarmIdleTimer()
    this.idleTimer = setTimeout(() => this.close(), this.idleTimeoutSec * 1000)
    // Don't keep the event loop alive alone — a pending idle exit should not
    // outlive an in-flight connection handshake.
    this.idleTimer.unref?.()
  }

  private disarmIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  get connectionCount(): number {
    return this.connections.size
  }

  close(): void {
    this.disarmIdleTimer()
    for (const socket of this.connections) socket.destroy()
    this.connections.clear()
    this.server.close()
  }
}
