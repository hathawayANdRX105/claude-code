import { ClientApp, ndJsonStream } from '@agentclientprotocol/sdk'
import type {
  ActiveSession,
  ClientConnection,
  Stream,
} from '@agentclientprotocol/sdk'
import { Readable, Writable } from 'node:stream'
import { spawn } from 'node:child_process'
import { AcpConnectionError, type AcpDaemonOptions } from './types.js'

type OwnedChild = {
  kill: (signal?: NodeJS.Signals) => void
}

/**
 * Narrow view of ClientContext so callers don't depend on the full SDK type
 * (and tests can stub it).
 */
export interface ContextApi {
  request(method: string, params?: unknown): Promise<unknown>
  buildSession(cwd: string): { start(): Promise<ActiveSession> }
}

/**
 * Wraps a child process running `ccb --acp`. The process is owned by this
 * connection: close() kills it.
 *
 * Session work goes through withContext(), which hands out the SDK's context —
 * buildSession(cwd).start() returns an ActiveSession: prompt() to send,
 * nextUpdate() to receive. Keeping this class thin is deliberate: session
 * bookkeeping belongs to the UI state layer.
 */
export class AcpClientConnection {
  private readonly conn: ClientConnection
  private ctx: ContextApi
  private readonly child: OwnedChild | null
  private closed = false
  private crashError: AcpConnectionError | null = null

  constructor(conn: ClientConnection, child: OwnedChild | null) {
    this.conn = conn
    this.child = child
    // SDK 只在 connectWith 回调里公开 ClientContext，但该重载随 op 结束
    // 关闭连接，不适合长驻 daemon。ClientConnection 实例本身携带 context，
    // 按窄接口断言取得，调用面不依赖 SDK 内部形状。
    this.ctx = conn as unknown as ContextApi
  }

  isClosed(): boolean {
    return this.closed
  }

  /**
   * Record that the child died on its own. Throwing from the exit handler
   * would never reach a caller (event-emitter handlers don't propagate), so
   * instead the error is stored and every subsequent/pending op is rejected
   * with it.
   */
  markCrashed(error: AcpConnectionError): void {
    this.closed = true
    this.crashError = error
  }

  /**
   * Spawn a daemon and wire the JSON-RPC connection. If the child dies
   * outside a deliberate close(), the connection marks itself crashed and
   * later withContext() calls reject with AcpConnectionError.
   */
  static spawn(options: AcpDaemonOptions = {}): AcpClientConnection {
    const command = options.command ?? process.execPath
    const args = options.args ?? ['--acp']
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const connection = new AcpClientConnection(
      connectStream(child.stdout, child.stdin),
      { kill: signal => child.kill(signal) },
    )

    // close() flips this.closed before killing so this handler can tell a
    // deliberate shutdown from a crash. The error is stored, not thrown: a
    // throw inside an exit handler never reaches a caller and would instead
    // crash the host process as an uncaught exception.
    child.on('exit', (code, signal) => {
      if (connection.isClosed()) return
      connection.markCrashed(
        new AcpConnectionError(
          `ACP daemon exited (code=${code} signal=${signal})`,
          undefined,
          code,
          signal,
        ),
      )
    })

    return connection
  }

  /**
   * Attach to an already-open stream pair instead of spawning. Used by tests
   * with mock streams and by callers that manage the process themselves.
   */
  static connect(
    readable: NodeJS.ReadableStream,
    writable: NodeJS.WritableStream,
  ): AcpClientConnection {
    return new AcpClientConnection(connectStream(readable, writable), null)
  }

  /** Test seam: swap the context without a real connection. */
  setContextForTest(ctx: ContextApi): void {
    this.ctx = ctx
  }
  withContext<T>(op: (ctx: ContextApi) => Promise<T>): Promise<T> {
    if (this.crashError) return Promise.reject(this.crashError)
    if (this.closed) {
      return Promise.reject(new AcpConnectionError('connection closed'))
    }
    return op(this.ctx)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    try {
      this.child?.kill('SIGTERM')
    } catch {
      // Best effort: the stream teardown is what matters.
    }
    this.conn.close()
  }
}

function connectStream(
  readable: NodeJS.ReadableStream,
  writable: NodeJS.WritableStream,
): ClientConnection {
  const webReadable = Readable.toWeb(
    readable as typeof process.stdin,
  ) as unknown as ReadableStream<Uint8Array>
  const webWritable = Writable.toWeb(
    writable as typeof process.stdout,
  ) as unknown as WritableStream<Uint8Array>
  const stream: Stream = ndJsonStream(webWritable, webReadable)
  return new ClientApp().connect(stream)
}
