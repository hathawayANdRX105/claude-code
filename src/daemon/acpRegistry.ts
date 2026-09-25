/**
 * ACP session registry for the shared daemon (spec 0002).
 *
 * One daemon hosts one AcpAgent behind a stream-level multiplexer: every
 * client socket speaks standard ACP JSON-RPC, the registry owns attachments,
 * per-turn write ownership, permission routing, a bounded tail buffer for
 * reconnect replay, and the idle release timer. The agent itself is
 * unchanged — it still believes it has exactly one client.
 *
 * Attachment model: a client becomes attached to a session when its
 * session/new, session/load, session/resume, or session/fork succeeds.
 * Socket close removes only that attachment (AC-2); the session is released
 * after the release window once it has no attachments and no running turn
 * (AC-3), and a later session/resume reloads it from the transcript (AC-4).
 */
type Json = Record<string, unknown>
type JsonRpcId = string | number

/** Minimal sink the registry needs; net.Socket satisfies it structurally. */
export type RegistryClient = {
  write: (line: string) => unknown
  destroyed?: boolean
}

/** Object-level JSON-RPC transport between the registry and the agent. */
export type AgentTransport = {
  send: (msg: Json) => void
  onMessage: (handler: (msg: Json) => void) => void
}

type Attachment = {
  connId: string
  // Non-null while a reconnect replay is in flight: live events queue here
  // until the tail has been written, so the client sees tail-then-live order.
  queue: Json[] | null
}

type SessionRoute = {
  sessionId: string
  attachments: Map<string, Attachment>
  turnOwner: string | null
  tail: Json[]
  releaseTimer: NodeJS.Timeout | null
}

type PendingClientRequest = {
  connId: string | null
  clientId: JsonRpcId
  method: string
  sessionId: string | null
  // True when the request attaches the client on success
  // (session/new, session/load, session/resume, session/fork).
  attach: boolean
}

const TAIL_LIMIT = 200
const ERR_NOT_OWNER = -32000
const ERR_CLIENT_GONE = -32001

const DEFAULT_RELEASE_MS = 60_000

function releaseWindowMs(): number {
  const raw = Number(process.env.CLAUDE_SHARED_RELEASE_SECONDS)
  return Number.isFinite(raw) && raw > 0 ? raw * 1000 : DEFAULT_RELEASE_MS
}

/**
 * Real transport: one AcpAgent behind an AgentSideConnection over an
 * in-memory object stream pair. Imported lazily so a legacy-only daemon
 * never pays the agent module graph.
 */
async function createRealTransport(): Promise<AgentTransport> {
  const { AgentSideConnection } = await import('@agentclientprotocol/sdk')
  type AnyMessage = import('@agentclientprotocol/sdk').AnyMessage
  const { AcpAgent } = await import('../services/acp/agent.js')
  const toAgent = new TransformStream<AnyMessage, AnyMessage>()
  const fromAgent = new TransformStream<AnyMessage, AnyMessage>()
  const writer = toAgent.writable.getWriter()
  const reader = fromAgent.readable.getReader()
  const handlers: Array<(msg: Json) => void> = []
  // The connection must stay referenced for the process lifetime.
  const connection = new AgentSideConnection(
    conn => new AcpAgent(conn),
    // SDK Stream: writable = outgoing (agent -> registry),
    // readable = incoming (registry -> agent).
    { writable: fromAgent.writable, readable: toAgent.readable },
  )
  void connection.closed.catch(() => undefined)
  void (async () => {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      for (const handler of handlers) handler(value as Json)
    }
  })()
  return {
    send: msg => void writer.write(msg as unknown as AnyMessage),
    onMessage: handler => handlers.push(handler),
  }
}

function sendJson(client: RegistryClient, msg: Json): void {
  if (!client.destroyed) client.write(`${JSON.stringify(msg)}\n`)
}

const WRITE_METHODS = new Set([
  'session/prompt',
  'session/set_mode',
  'session/set_config_option',
])
const ATTACH_METHODS = new Set([
  'session/new',
  'session/load',
  'session/resume',
  'session/fork',
])

export class AcpDaemonRegistry {
  private transportPromise: Promise<AgentTransport> | null = null
  private readonly transportFactory: () => Promise<AgentTransport>
  private readonly releaseMs: number
  private nextDaemonId = 1
  private nextConnId = 1
  private readonly clients = new Map<string, RegistryClient>()
  private readonly connBySocket = new Map<RegistryClient, string>()
  private readonly routes = new Map<string, SessionRoute>()
  private readonly pendingClient = new Map<JsonRpcId, PendingClientRequest>()
  private readonly pendingAgent = new Map<JsonRpcId, string>()
  // Serializes client message handling so interleaved sockets cannot reorder.
  private chain: Promise<void> = Promise.resolve()

  constructor(
    options: {
      releaseMs?: number
      transportFactory?: () => Promise<AgentTransport> | AgentTransport
    } = {},
  ) {
    this.releaseMs = options.releaseMs ?? releaseWindowMs()
    this.transportFactory = () =>
      Promise.resolve(
        options.transportFactory
          ? options.transportFactory()
          : createRealTransport(),
      )
  }

  private ensureTransport(): Promise<AgentTransport> {
    this.transportPromise ??= this.transportFactory().then(transport => {
      transport.onMessage(msg => this.onAgentMessage(msg))
      return transport
    })
    return this.transportPromise
  }

  /** Handle one parsed JSON-RPC line from a client socket. */
  handleSocketMessage(socket: RegistryClient, msg: Json): void {
    // Chaining preserves ordering across interleaved sockets.
    this.chain = this.chain.then(() => this.process(socket, msg))
  }

  /** Socket closed: drop the attachment, fail its pending work (AC-2). */
  detachSocket(socket: RegistryClient): void {
    const connId = this.connBySocket.get(socket)
    if (connId === undefined) return
    this.connBySocket.delete(socket)
    this.clients.delete(connId)

    // Fail agent -> client requests that targeted the dead connection. A
    // pending permission dies unanswered here and the turn is cancelled
    // below — nothing is ever silently approved when the turn owner vanishes
    // mid-decision (AC-11).
    for (const [id, target] of this.pendingAgent) {
      if (target !== connId) continue
      this.pendingAgent.delete(id)
      this.sendToAgent({
        jsonrpc: '2.0',
        id,
        error: { code: ERR_CLIENT_GONE, message: 'client disconnected' },
      })
    }
    // Late responses to the dead connection's requests go nowhere.
    for (const pending of this.pendingClient.values()) {
      if (pending.connId === connId) pending.connId = null
    }

    for (const route of this.routes.values()) {
      if (!route.attachments.has(connId)) continue
      route.attachments.delete(connId)
      // A detached owner does NOT kill the turn (AC-8): output keeps
      // buffering into the tail for a reconnect. Only client-bound requests
      // already waiting on the dead socket were failed above (AC-11).
      this.maybeScheduleRelease(route)
    }
  }

  // ── Client -> agent ─────────────────────────────────────────────

  private async process(socket: RegistryClient, msg: Json): Promise<void> {
    const connId = this.connIdFor(socket)
    const method = typeof msg.method === 'string' ? msg.method : null
    const isRequest = method !== null && msg.id !== undefined
    const isResponse = method === null && msg.id !== undefined

    if (isResponse) {
      // Response to an agent -> client request; forward untouched.
      if (this.pendingAgent.get(msg.id as JsonRpcId) === connId) {
        this.pendingAgent.delete(msg.id as JsonRpcId)
        this.sendToAgent(msg)
      }
      return
    }

    if (method === null) return // malformed; ignore

    if (isRequest && method === 'daemon/status') {
      sendJson(socket, {
        jsonrpc: '2.0',
        id: msg.id as JsonRpcId,
        result: {
          pid: process.pid,
          rssBytes: process.memoryUsage().rss,
          sessions: this.routes.size,
          attachments: [...this.routes.values()].reduce(
            (n, route) => n + route.attachments.size,
            0,
          ),
        },
      })
      return
    }

    const sessionId =
      msg.params && typeof (msg.params as Json).sessionId === 'string'
        ? ((msg.params as Json).sessionId as string)
        : null

    if (sessionId !== null) {
      const route = this.routes.get(sessionId)
      if (route?.turnOwner && route.turnOwner !== connId) {
        if (WRITE_METHODS.has(method)) {
          // AC-13: during a turn only the owner may write.
          if (isRequest) {
            sendJson(socket, {
              jsonrpc: '2.0',
              id: msg.id as JsonRpcId,
              error: {
                code: ERR_NOT_OWNER,
                message:
                  'not turn owner: another attached client owns the running turn',
              },
            })
          }
          return
        }
        if (method === 'session/cancel') {
          // Notifications carry no response; tell the sender it was refused.
          sendJson(socket, {
            jsonrpc: '2.0',
            method: '$/claudeCode/writeDenied',
            params: { sessionId, reason: 'not turn owner' },
          })
          return
        }
      }
      if (method === 'session/prompt' && isRequest && route) {
        route.turnOwner = connId
        this.cancelRelease(route)
      }
    }

    // Tentative attach: load/resume replay must reach this client, so it
    // joins the route (queueing) before the agent starts emitting.
    const tentative =
      isRequest &&
      sessionId !== null &&
      (method === 'session/load' || method === 'session/resume')
    if (tentative && sessionId !== null) this.tentativeAttach(sessionId, connId)

    if (!isRequest) {
      // Pure notification (e.g. session/cancel): forward as-is.
      this.sendToAgent(msg)
      return
    }

    try {
      await this.ensureTransport()
    } catch {
      sendJson(socket, {
        jsonrpc: '2.0',
        id: msg.id as JsonRpcId,
        error: { code: -32603, message: 'agent failed to start' },
      })
      return
    }

    const daemonId = this.nextDaemonId++
    this.pendingClient.set(daemonId, {
      connId,
      clientId: msg.id as JsonRpcId,
      method,
      sessionId,
      attach: ATTACH_METHODS.has(method),
    })
    this.sendToAgent({ ...msg, id: daemonId })
  }

  // ── Agent -> client ─────────────────────────────────────────────

  private onAgentMessage(msg: Json): void {
    const method = typeof msg.method === 'string' ? msg.method : null

    if (method === null && msg.id !== undefined) {
      this.onAgentResponse(msg)
      return
    }

    if (method !== null && msg.id !== undefined) {
      this.onAgentRequest(msg, method)
      return
    }

    if (method !== null) this.onAgentNotification(msg)
  }

  private onAgentResponse(msg: Json): void {
    const pending = this.pendingClient.get(msg.id as JsonRpcId)
    this.pendingClient.delete(msg.id as JsonRpcId)
    if (!pending) return // daemon-originated (release close) or already dropped

    const failed = msg.error !== undefined
    const route = pending.sessionId
      ? this.routes.get(pending.sessionId)
      : undefined

    // A finished turn (success or error) releases write ownership (AC-13).
    // When the owner had detached mid-turn, the session may now be idle and
    // attachment-free: that is the first moment the release timer may start.
    if (pending.method === 'session/prompt' && route?.turnOwner) {
      if (pending.connId === null || route.turnOwner === pending.connId) {
        route.turnOwner = null
        this.maybeScheduleRelease(route)
      }
    }

    if (pending.connId === null) return
    const client = this.clients.get(pending.connId)
    if (!client) return

    if (pending.attach) {
      // session/new and session/fork learn the id from the result; load and
      // resume already attached tentatively against params.sessionId.
      const targetId =
        typeof (msg.result as Json | undefined)?.sessionId === 'string'
          ? ((msg.result as Json).sessionId as string)
          : pending.sessionId
      if (targetId) {
        if (failed) {
          const target = this.routes.get(targetId)
          if (target) this.dropAttachment(target, pending.connId)
        } else {
          this.tentativeAttach(targetId, pending.connId)
          const target = this.routes.get(targetId)
          // session/load replays full history through the queue, so the tail
          // would duplicate; resume/new/fork need it (AC-12).
          if (target)
            this.commitAttach(
              target,
              pending.connId,
              pending.method !== 'session/load',
            )
        }
      }
    }

    if (
      (pending.method === 'session/close' ||
        pending.method === 'session/delete') &&
      !failed &&
      pending.sessionId
    ) {
      const target = this.routes.get(pending.sessionId)
      if (target) this.dropRoute(target)
    }

    sendJson(client, { ...msg, id: pending.clientId })
  }

  private onAgentRequest(msg: Json, method: string): void {
    const params = (msg.params ?? {}) as Json
    const sessionId =
      typeof params.sessionId === 'string' ? params.sessionId : null
    const route = sessionId ? this.routes.get(sessionId) : undefined
    // Permissions and other client-bound requests go to the turn owner only
    // (AC-11); outside a turn, fall back to the first attachment.
    const target =
      route?.turnOwner ?? route?.attachments.keys().next().value ?? null
    if (target === null) {
      // No client can answer: fail safe, never silently approve.
      this.sendToAgent({
        jsonrpc: '2.0',
        id: msg.id as JsonRpcId,
        error: { code: ERR_CLIENT_GONE, message: 'no attached client' },
      })
      return
    }
    this.pendingAgent.set(msg.id as JsonRpcId, target)
    const client = this.clients.get(target)
    if (client) sendJson(client, msg)
    if (method === 'session/request_permission' && route) {
      for (const connId of route.attachments.keys()) {
        if (connId === target) continue
        const other = this.clients.get(connId)
        if (other)
          sendJson(other, {
            jsonrpc: '2.0',
            method: '$/claudeCode/permissionPending',
            params: { sessionId: route.sessionId },
          })
      }
    }
  }

  private onAgentNotification(msg: Json): void {
    if (msg.method !== 'session/update') return
    const params = (msg.params ?? {}) as Json
    const sessionId =
      typeof params.sessionId === 'string' ? params.sessionId : null
    if (sessionId === null) return
    const route = this.routes.get(sessionId)
    if (!route) return
    route.tail.push(msg)
    if (route.tail.length > TAIL_LIMIT) route.tail.shift()
    for (const [connId, attachment] of route.attachments) {
      const client = this.clients.get(connId)
      if (!client) continue
      if (attachment.queue) attachment.queue.push(msg)
      else sendJson(client, msg)
    }
  }

  // ── Attachments, routes, release ────────────────────────────────

  private connIdFor(socket: RegistryClient): string {
    let connId = this.connBySocket.get(socket)
    if (connId === undefined) {
      connId = `c${this.nextConnId++}`
      this.connBySocket.set(socket, connId)
      this.clients.set(connId, socket)
    }
    return connId
  }

  private tentativeAttach(sessionId: string, connId: string): void {
    let route = this.routes.get(sessionId)
    if (!route) {
      route = {
        sessionId,
        attachments: new Map(),
        turnOwner: null,
        tail: [],
        releaseTimer: null,
      }
      this.routes.set(sessionId, route)
    }
    this.cancelRelease(route)
    if (!route.attachments.has(connId))
      route.attachments.set(connId, { connId, queue: [] })
  }

  private commitAttach(
    route: SessionRoute,
    connId: string,
    replayTail: boolean,
  ): void {
    const client = this.clients.get(connId)
    if (!client) return
    let attachment = route.attachments.get(connId)
    if (!attachment) {
      attachment = { connId, queue: [] }
      route.attachments.set(connId, attachment)
    }
    // Replay the bounded tail, then anything that arrived mid-replay (AC-12).
    const queued = attachment.queue ?? []
    if (replayTail) for (const event of route.tail) sendJson(client, event)
    for (const event of queued) sendJson(client, event)
    attachment.queue = null
    this.cancelRelease(route)
  }

  private dropAttachment(route: SessionRoute, connId: string): void {
    route.attachments.delete(connId)
    if (
      route.attachments.size === 0 &&
      route.tail.length === 0 &&
      !route.turnOwner
    )
      this.routes.delete(route.sessionId)
  }

  private dropRoute(route: SessionRoute): void {
    clearTimeout(route.releaseTimer ?? undefined)
    this.routes.delete(route.sessionId)
  }

  private cancelRelease(route: SessionRoute): void {
    clearTimeout(route.releaseTimer ?? undefined)
    route.releaseTimer = null
  }

  private maybeScheduleRelease(route: SessionRoute): void {
    // A running turn or a live attachment blocks the idle timer (AC-3).
    if (route.attachments.size > 0 || route.turnOwner) return
    if (route.releaseTimer) return
    route.releaseTimer = setTimeout(() => {
      route.releaseTimer = null
      if (route.attachments.size > 0 || route.turnOwner) return
      // Close through the agent so QueryEngine state tears down cleanly.
      const id = this.nextDaemonId++
      this.pendingClient.set(id, {
        connId: null,
        clientId: id,
        method: 'session/close',
        sessionId: route.sessionId,
        attach: false,
      })
      this.sendToAgent({
        jsonrpc: '2.0',
        id,
        method: 'session/close',
        params: { sessionId: route.sessionId },
      })
      this.routes.delete(route.sessionId)
    }, this.releaseMs)
    route.releaseTimer.unref?.()
  }

  private sendToAgent(msg: Json): void {
    // .then on the (possibly pending) transport keeps cross-source ordering:
    // callbacks run in call order once the transport resolves.
    void this.ensureTransport().then(
      transport => transport.send(msg),
      () => undefined,
    )
  }

  /** Test seam: resolves when every queued client message is processed. */
  whenIdle(): Promise<void> {
    return this.chain
  }

  /** Test/inspection seam: current routes with attachment counts. */
  snapshot(): Array<{
    sessionId: string
    attachments: number
    turnOwner: string | null
    tail: number
  }> {
    return [...this.routes.values()].map(route => ({
      sessionId: route.sessionId,
      attachments: route.attachments.size,
      turnOwner: route.turnOwner,
      tail: route.tail.length,
    }))
  }
}
