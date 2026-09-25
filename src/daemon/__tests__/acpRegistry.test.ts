import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'fs'
import { unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  AcpDaemonRegistry,
  type AgentTransport,
  type RegistryClient,
} from '../acpRegistry.js'
import { connectShared, readSharedLockPid } from '../sharedClient.js'
import { startSharedServer, writeSharedLock } from '../sharedSession.js'

type Json = Record<string, unknown>

const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))
/** Flush the registry chain plus transport round-trip microtasks. */
async function flush(registry: AcpDaemonRegistry): Promise<void> {
  await registry.whenIdle()
  await tick()
  await tick()
}

class FakeTransport implements AgentTransport {
  readonly sent: Json[] = []
  private handlers: Array<(msg: Json) => void> = []
  /** Return a result for a prompt request, or leave it pending. */
  onPrompt: ((msg: Json) => Json | null) | null = null

  send(msg: Json): void {
    this.sent.push(msg)
    if (msg.id === undefined || typeof msg.method !== 'string') return
    const result = this.respond(msg)
    if (result === undefined) return
    queueMicrotask(() =>
      this.emit({ jsonrpc: '2.0', id: msg.id as string | number, result }),
    )
  }

  onMessage(handler: (msg: Json) => void): void {
    this.handlers.push(handler)
  }

  emit(msg: Json): void {
    for (const handler of this.handlers) handler(msg)
  }

  private respond(msg: Json): Json | undefined {
    const params = (msg.params ?? {}) as Json
    switch (msg.method) {
      case 'initialize':
        return { protocolVersion: 1, authMethods: [] }
      case 'session/new':
        return {
          sessionId: 'sess-1',
          modes: { availableModes: [], currentModeId: 'default' },
          configOptions: [],
        }
      case 'session/resume':
      case 'session/load':
        return {
          sessionId: params.sessionId,
          modes: { availableModes: [], currentModeId: 'default' },
          configOptions: [],
        }
      case 'session/close':
      case 'session/delete':
        return {}
      case 'session/prompt':
        return this.onPrompt?.(msg) ?? undefined
      default:
        return undefined
    }
  }
}

class FakeClient implements RegistryClient {
  readonly lines: Json[] = []
  destroyed = false
  write(line: string): void {
    this.lines.push(JSON.parse(line) as Json)
  }
  last(): Json | undefined {
    return this.lines[this.lines.length - 1]
  }
}

function request(id: number, method: string, params?: Json): Json {
  return params === undefined
    ? { jsonrpc: '2.0', id, method }
    : { jsonrpc: '2.0', id, method, params }
}

function update(sessionId: string, text: string): Json {
  return {
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text },
      },
    },
  }
}

async function newSession(
  registry: AcpDaemonRegistry,
  client: FakeClient,
  id: number,
): Promise<void> {
  registry.handleSocketMessage(
    client,
    request(id, 'session/new', { cwd: '/tmp/demo' }),
  )
  await flush(registry)
}

describe('AcpDaemonRegistry', () => {
  test('fans updates out to every attached client on the session (AC-1)', async () => {
    const transport = new FakeTransport()
    const registry = new AcpDaemonRegistry({
      transportFactory: () => transport,
    })
    const a = new FakeClient()
    const b = new FakeClient()

    registry.handleSocketMessage(a, request(1, 'initialize'))
    registry.handleSocketMessage(b, request(1, 'initialize'))
    await newSession(registry, a, 2)
    registry.handleSocketMessage(
      b,
      request(2, 'session/resume', { sessionId: 'sess-1', cwd: '/tmp/demo' }),
    )
    await flush(registry)

    expect(registry.snapshot()).toEqual([
      { sessionId: 'sess-1', attachments: 2, turnOwner: null, tail: 0 },
    ])

    transport.emit(update('sess-1', 'hello'))
    await flush(registry)
    const matches = (c: FakeClient) =>
      c.lines.filter(l => l.method === 'session/update')
    expect(matches(a)).toHaveLength(1)
    expect(matches(b)).toHaveLength(1)
  })

  test('connection close removes only that attachment (AC-2)', async () => {
    const transport = new FakeTransport()
    const registry = new AcpDaemonRegistry({
      releaseMs: 60_000,
      transportFactory: () => transport,
    })
    const a = new FakeClient()
    const b = new FakeClient()

    await newSession(registry, a, 1)
    registry.handleSocketMessage(
      b,
      request(1, 'session/resume', { sessionId: 'sess-1', cwd: '/tmp/demo' }),
    )
    await flush(registry)

    registry.detachSocket(a)
    await flush(registry)

    expect(registry.snapshot()).toEqual([
      { sessionId: 'sess-1', attachments: 1, turnOwner: null, tail: 0 },
    ])
    transport.emit(update('sess-1', 'after-detach'))
    await flush(registry)
    expect(a.lines.filter(l => l.method === 'session/update')).toHaveLength(0)
    expect(b.lines.filter(l => l.method === 'session/update')).toHaveLength(1)
  })

  test('idle session releases after the window and closes through the agent (AC-3)', async () => {
    const transport = new FakeTransport()
    const registry = new AcpDaemonRegistry({
      releaseMs: 50,
      transportFactory: () => transport,
    })
    const a = new FakeClient()
    await newSession(registry, a, 1)

    registry.detachSocket(a)
    await flush(registry)
    // Inside the window the session is still warm.
    expect(registry.snapshot()).toHaveLength(1)

    await new Promise(resolve => setTimeout(resolve, 90))
    await flush(registry)
    expect(registry.snapshot()).toHaveLength(0)
    expect(
      transport.sent.some(
        m =>
          m.method === 'session/close' &&
          (m.params as Json).sessionId === 'sess-1',
      ),
    ).toBe(true)
  })

  test('a running turn blocks release, survives owner detach, and releases after it ends (AC-3, AC-8)', async () => {
    const transport = new FakeTransport()
    const registry = new AcpDaemonRegistry({
      releaseMs: 50,
      transportFactory: () => transport,
    })
    const a = new FakeClient()
    await newSession(registry, a, 1)

    registry.handleSocketMessage(
      a,
      request(2, 'session/prompt', {
        sessionId: 'sess-1',
        prompt: [{ type: 'text', text: 'run' }],
      }),
    )
    await flush(registry)
    expect(registry.snapshot()[0].turnOwner).not.toBeNull()

    // Owner detaches mid-turn: the turn keeps running, no release is scheduled.
    registry.detachSocket(a)
    await flush(registry)
    await new Promise(resolve => setTimeout(resolve, 90))
    expect(registry.snapshot()).toHaveLength(1)
    expect(registry.snapshot()[0].turnOwner).not.toBeNull()

    // Turn output keeps buffering for a reconnect while detached.
    transport.emit(update('sess-1', 'ownerless-chunk'))
    await flush(registry)
    expect(registry.snapshot()[0].tail).toBe(1)

    // The turn ends; with no attachments the release window starts now.
    const promptDaemonId = (
      transport.sent.find(m => m.method === 'session/prompt') as Json
    ).id as number
    transport.emit({
      jsonrpc: '2.0',
      id: promptDaemonId,
      result: { stopReason: 'end_turn' },
    })
    await flush(registry)
    expect(registry.snapshot()[0].turnOwner).toBeNull()
    await new Promise(resolve => setTimeout(resolve, 90))
    expect(registry.snapshot()).toHaveLength(0)
  })

  test('reconnect replays the bounded tail before live events (AC-12)', async () => {
    const transport = new FakeTransport()
    const registry = new AcpDaemonRegistry({
      transportFactory: () => transport,
    })
    const a = new FakeClient()
    await newSession(registry, a, 1)

    for (let i = 0; i < 205; i++) transport.emit(update('sess-1', `chunk-${i}`))
    await flush(registry)
    registry.detachSocket(a)
    await flush(registry)

    const b = new FakeClient()
    registry.handleSocketMessage(
      b,
      request(1, 'session/resume', { sessionId: 'sess-1', cwd: '/tmp/demo' }),
    )
    await flush(registry)

    const replayed = b.lines.filter(l => l.method === 'session/update')
    // Tail is capped at 200, so the oldest 5 chunks are gone.
    expect(replayed).toHaveLength(200)
    expect((replayed[0].params as Json).update).toMatchObject({
      content: { type: 'text', text: 'chunk-5' },
    })
    // The resume response arrives with the original client id restored.
    expect(b.lines.some(l => l.id === 1 && l.result !== undefined)).toBe(true)
  })

  test('permissions go only to the turn owner; others get a read-only notice (AC-11)', async () => {
    const transport = new FakeTransport()
    const registry = new AcpDaemonRegistry({
      transportFactory: () => transport,
    })
    const a = new FakeClient()
    const b = new FakeClient()
    await newSession(registry, a, 1)
    registry.handleSocketMessage(
      b,
      request(1, 'session/resume', { sessionId: 'sess-1', cwd: '/tmp/demo' }),
    )
    await flush(registry)

    registry.handleSocketMessage(
      a,
      request(2, 'session/prompt', {
        sessionId: 'sess-1',
        prompt: [{ type: 'text', text: 'run' }],
      }),
    )
    await flush(registry)

    transport.emit(
      request(77, 'session/request_permission', {
        sessionId: 'sess-1',
        toolCall: { toolCallId: 'tc-1' },
        options: [],
      }),
    )
    await flush(registry)

    expect(
      a.lines.some(
        l => l.method === 'session/request_permission' && l.id === 77,
      ),
    ).toBe(true)
    expect(b.lines.some(l => l.method === 'session/request_permission')).toBe(
      false,
    )
    expect(
      b.lines.some(l => l.method === '$/claudeCode/permissionPending'),
    ).toBe(true)
  })

  test('owner disconnect mid-permission fails the request, never approves (AC-11)', async () => {
    const transport = new FakeTransport()
    const registry = new AcpDaemonRegistry({
      transportFactory: () => transport,
    })
    const a = new FakeClient()
    await newSession(registry, a, 1)
    registry.handleSocketMessage(
      a,
      request(2, 'session/prompt', {
        sessionId: 'sess-1',
        prompt: [{ type: 'text', text: 'run' }],
      }),
    )
    await flush(registry)
    transport.emit(
      request(88, 'session/request_permission', {
        sessionId: 'sess-1',
        toolCall: { toolCallId: 'tc-9' },
        options: [],
      }),
    )
    await flush(registry)

    registry.detachSocket(a)
    await flush(registry)

    const failure = transport.sent.find(m => m.id === 88) as Json | undefined
    expect(failure).toBeDefined()
    expect(failure?.error).toBeDefined()
    expect(failure?.result).toBeUndefined()
  })

  test('during a turn only the owner may prompt, cancel, or change config (AC-13)', async () => {
    const transport = new FakeTransport()
    const registry = new AcpDaemonRegistry({
      transportFactory: () => transport,
    })
    const a = new FakeClient()
    const b = new FakeClient()
    await newSession(registry, a, 1)
    registry.handleSocketMessage(
      b,
      request(1, 'session/resume', { sessionId: 'sess-1', cwd: '/tmp/demo' }),
    )
    await flush(registry)

    registry.handleSocketMessage(
      a,
      request(2, 'session/prompt', {
        sessionId: 'sess-1',
        prompt: [{ type: 'text', text: 'run' }],
      }),
    )
    await flush(registry)

    // Non-owner prompt: rejected with an error, never reaches the agent.
    registry.handleSocketMessage(
      b,
      request(3, 'session/prompt', {
        sessionId: 'sess-1',
        prompt: [{ type: 'text', text: 'hijack' }],
      }),
    )
    // Non-owner cancel: dropped, sender gets a write-denied notice.
    registry.handleSocketMessage(b, {
      jsonrpc: '2.0',
      method: 'session/cancel',
      params: { sessionId: 'sess-1' },
    })
    await flush(registry)

    const rejected = b.lines.find(l => l.id === 3)
    expect(rejected?.error).toMatchObject({ code: -32000 })
    expect(b.lines.some(l => l.method === '$/claudeCode/writeDenied')).toBe(
      true,
    )
    expect(
      transport.sent.filter(m => m.method === 'session/prompt'),
    ).toHaveLength(1)
    expect(transport.sent.some(m => m.method === 'session/cancel')).toBe(false)
  })

  test('ownership clears when the turn ends, so another client takes the next turn (AC-13)', async () => {
    const transport = new FakeTransport()
    let promptCalls = 0
    transport.onPrompt = () => {
      promptCalls += 1
      return { stopReason: 'end_turn' }
    }
    const registry = new AcpDaemonRegistry({
      transportFactory: () => transport,
    })
    const a = new FakeClient()
    const b = new FakeClient()
    await newSession(registry, a, 1)
    registry.handleSocketMessage(
      b,
      request(1, 'session/resume', { sessionId: 'sess-1', cwd: '/tmp/demo' }),
    )
    await flush(registry)

    registry.handleSocketMessage(
      a,
      request(2, 'session/prompt', {
        sessionId: 'sess-1',
        prompt: [{ type: 'text', text: 'first' }],
      }),
    )
    await flush(registry)
    expect(registry.snapshot()[0].turnOwner).toBeNull()

    registry.handleSocketMessage(
      b,
      request(3, 'session/prompt', {
        sessionId: 'sess-1',
        prompt: [{ type: 'text', text: 'second' }],
      }),
    )
    await flush(registry)

    expect(promptCalls).toBe(2)
    expect(b.lines.some(l => l.id === 3 && l.result !== undefined)).toBe(true)
  })

  test('daemon/status answers from the registry without touching the agent (AC-6)', async () => {
    const transport = new FakeTransport()
    const registry = new AcpDaemonRegistry({
      transportFactory: () => transport,
    })
    const a = new FakeClient()

    registry.handleSocketMessage(a, request(9, 'daemon/status'))
    await flush(registry)

    const reply = a.lines.find(l => l.id === 9)
    expect(reply?.result).toMatchObject({
      pid: process.pid,
      sessions: 0,
      attachments: 0,
    })
    const result = (reply as { result: Json }).result
    expect(typeof result.rssBytes).toBe('number')
    expect(transport.sent).toHaveLength(0)
  })
})

describe('shared server migration window (AC-14)', () => {
  test('legacy hello still answers on a server that also routes ACP', async () => {
    const root = mkdtempSync(join(tmpdir(), 'acp-registry-'))
    const address = join(root, 'claude.sock')
    const server = await startSharedServer(address)
    await writeSharedLock(address)
    try {
      const socket = await connectShared(address)
      socket.write(
        `${JSON.stringify({ op: 'hello', kind: 'interactive', cwd: process.cwd() })}\n`,
      )
      const first = await new Promise<Json>(resolve => {
        let buffer = ''
        socket.on('data', chunk => {
          buffer += chunk.toString('utf8')
          const end = buffer.indexOf('\n')
          if (end !== -1) resolve(JSON.parse(buffer.slice(0, end)) as Json)
        })
      })
      expect(first).toMatchObject({ op: 'hello' })
      expect(typeof first.sessionId).toBe('string')

      // The lock file carries the daemon pid for client-side RSS display.
      expect(await readSharedLockPid(address)).toBe(process.pid)

      socket.destroy()
    } finally {
      server.close()
      await unlink(address).catch(() => undefined)
      await unlink(`${address}.lock`).catch(() => undefined)
    }
  })
})
