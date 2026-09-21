import { ClientApp, ndJsonStream } from '@agentclientprotocol/sdk'
import type { ActiveSession, Stream } from '@agentclientprotocol/sdk'
import { Readable, Writable } from 'node:stream'
import { spawn } from 'node:child_process'
import { AcpConnectionError, type AcpDaemonOptions } from './types.js'

export type OwnedChild = {
  pid: number | null
  kill: (signal?: NodeJS.Signals) => void
}
export interface ContextApi {
  request(method: string, params?: unknown): Promise<unknown>
  buildSession(cwd: string): { start(): Promise<ActiveSession> }
}

/**
 * A long-lived connection to a `ccb --acp` process.
 *
 * The SDK only hands out a ClientContext inside connectWith()'s callback, and
 * tears the connection down when that callback returns. To survive across
 * requests the callback stores the context and then awaits a done promise
 * that only close() resolves — the connection lives exactly as long as we
 * need it, no longer.
 *
 * Session work goes through withContext(): buildSession(cwd).start() returns
 * an ActiveSession with prompt()/nextUpdate(). Keeping this class thin is
 * deliberate; session bookkeeping belongs to the UI state layer.
 */
export class AcpClientConnection {
  private ctx: ContextApi | null = null
  private readonly child: OwnedChild | null = null
  private ready!: Promise<void>
  private closed = false
  private crashError: AcpConnectionError | null = null
  private done: { resolve: () => void } | null = null

  constructor(child: OwnedChild | null = null) {
    this.child = child
  }

  /** OS pid of the spawned daemon, for memory accounting. */
  get daemonPid(): number | null {
    return this.child?.pid ?? null
  }

  isClosed(): boolean {
    return this.closed
  }

  /**
   * Start the SDK handshake. Separated from the constructor so tests can
   * build a bare instance and inject a context instead of using a stream.
   */
  attach(app: ClientApp, stream: Stream): void {
    this.ready = app.connectWith(stream, async ctx => {
      this.ctx = ctx as unknown as ContextApi
      await new Promise<void>(resolve => {
        this.done = { resolve }
      })
    })
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
   * Wait for the SDK handshake to deliver the context. Callers that want a
   * usable connection await this before withContext().
   */
  async waitReady(): Promise<void> {
    await this.ready
  }

  /**
   * Send the ACP initialize handshake. The agent refuses session work until
   * the client has introduced itself.
   */
  async initialize(
    clientInfo = { name: 'ccb-tui', version: '0.1.0' },
  ): Promise<void> {
    await this.withContext(async ctx =>
      ctx.request('initialize', {
        protocolVersion: 1,
        capabilities: {},
        clientInfo,
      }),
    )
  }

  /** Run an op against the connection's context. */
  withContext<T>(op: (ctx: ContextApi) => Promise<T>): Promise<T> {
    if (this.crashError) return Promise.reject(this.crashError)
    if (this.closed) {
      return Promise.reject(new AcpConnectionError('connection closed'))
    }
    if (!this.ctx) {
      return Promise.reject(new AcpConnectionError('connection not ready'))
    }
    return op(this.ctx)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.done?.resolve()
    try {
      this.child?.kill('SIGTERM')
    } catch {
      // Best effort: the stream teardown is what matters.
    }
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
    const { stream, app } = connectStream(child.stdout, child.stdin)
    const connection = new AcpClientConnection({
      pid: child.pid ?? null,
      kill: signal => child.kill(signal),
    })
    connection.attach(app, stream)

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
    const { stream, app } = connectStream(readable, writable)
    const connection = new AcpClientConnection(null)
    connection.attach(app, stream)
    return connection
  }

  /** Test seam: swap the context without a real connection. */
  setContextForTest(ctx: ContextApi): void {
    this.ctx = ctx
  }
}

function connectStream(
  readable: NodeJS.ReadableStream,
  writable: NodeJS.WritableStream,
): { stream: Stream; app: ClientApp } {
  const webReadable = Readable.toWeb(
    readable as typeof process.stdin,
  ) as unknown as ReadableStream<Uint8Array>
  const webWritable = Writable.toWeb(
    writable as typeof process.stdout,
  ) as unknown as WritableStream<Uint8Array>
  const stream: Stream = ndJsonStream(webWritable, webReadable)
  return { stream, app: new ClientApp() }
}
