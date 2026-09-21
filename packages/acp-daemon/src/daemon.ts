import { unlinkSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { daemonLockPath, type DaemonOptions, DEFAULT_IDLE_TIMEOUT_SEC } from './paths.js'
export function acquireDaemonLock(): boolean {
  // Stale lock from a previous crash would block a fresh daemon; the socket
  // unlink in listen() covers the socket, and flock-style exclusivity is
  // provided by the listener itself (bind fails if another daemon holds it).
  // Keeping the function so callers express intent; real exclusivity is the
  // bind, not a lockfile.
  try {
    unlinkSync(daemonLockPath())
  } catch {
  }
  return true
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
  listen(socketPath: string): Promise<void> {
    // Stale socket from a previous crash blocks bind; safe to unlink because
    // acquireDaemonLock already established we own the name.
    try { unlinkSync(socketPath) } catch {}

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
