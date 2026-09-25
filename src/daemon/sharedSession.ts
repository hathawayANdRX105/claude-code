import { randomUUID } from 'crypto'
import {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from 'fs/promises'
import { createServer, type Server, type Socket } from 'net'
import { dirname, join } from 'path'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { attachNdjsonFramer } from '../utils/ndjsonFramer.js'
import { getProjectDir } from '../utils/sessionStoragePortable.js'
import { AcpDaemonRegistry } from './acpRegistry.js'
import {
  connectShared,
  defaultSharedAddress,
  sharedAddressLive,
} from './sharedClient.js'

export { connectShared, defaultSharedAddress, sharedAddressLive }

export type SharedRequest =
  | {
      op: 'hello'
      kind: 'interactive' | 'background' | 'remote'
      cwd: string
      sessionId?: string
      credential?: string
    }
  | { op: 'resume'; sessionId: string; cwd: string }
  | { op: 'fork'; sessionId: string }
  | { op: 'turn'; sessionId: string; input: string }
  | { op: 'cancel'; sessionId: string; turnId: string }
  | { op: 'detach'; connectionId: string }
  | { op: 'logout' }
  | {
      op: 'bg'
      command: 'start' | 'list' | 'logs' | 'kill'
      cwd: string
      sessionId?: string
      input?: string
    }

export type SharedEvent =
  | { op: 'hello'; connectionId: string; sessionId: string; forked?: boolean }
  | { op: 'resume'; sessionId: string; transcript: string }
  | { op: 'fork'; sessionId: string; parentSessionId: string }
  | {
      op: 'turn'
      sessionId: string
      turnId: string
      text: string
      streamed?: boolean
    }
  | { op: 'cancel'; sessionId: string; turnId: string }
  | { op: 'detach'; sessionId: string; released: boolean }
  | { op: 'logout' }
  | {
      op: 'bg'
      command: 'start' | 'list' | 'logs' | 'kill'
      sessionId?: string
      sessions?: SharedSession[]
      transcript?: string
    }
  | { op: 'error'; message: string }

type SessionState = 'idle' | 'running' | 'stopped'

type SharedSession = {
  sessionId: string
  parentSessionId?: string
  cwd: string
  kind: 'interactive' | 'background' | 'remote'
  state: SessionState
  connectionId?: string
  turn?: { turnId: string; streamed: string; controller: AbortController }
}

type LockFile = { pid: number }

type TurnRunner = (input: {
  sessionId: string
  cwd: string
  input: string
  signal: AbortSignal
  started: Promise<void>
  onChunk: (text: string) => void
}) => Promise<string>

const sessions = new Map<string, SharedSession>()
const connections = new Map<string, { sessionId: string; socket: Socket }>()
let auth: { loggedIn: true } | null = { loggedIn: true }
let turnRunner: TurnRunner = async ({ input, started }) => {
  void started
  return `echo:${input}`
}

export function sharedSessions(): SharedSession[] {
  return [...sessions.values()]
}

export function resetSharedSessions(): void {
  sessions.clear()
  connections.clear()
  auth = { loggedIn: true }
  turnRunner = async ({ input, started }) => {
    void started
    return `echo:${input}`
  }
}

export function setSharedTurnRunner(runner: TurnRunner): void {
  turnRunner = runner
}

export function loggedIn(): boolean {
  return auth !== null
}

function completeLines(text: string): string {
  const end = text.lastIndexOf('\n')
  return end === -1 ? '' : text.slice(0, end + 1)
}

function transcriptPath(cwd: string, sessionId: string): string {
  return join(getProjectDir(cwd), `${sessionId}.jsonl`)
}

async function readTranscript(cwd: string, sessionId: string): Promise<string> {
  try {
    return completeLines(await readFile(transcriptPath(cwd, sessionId), 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}

async function appendLine(
  cwd: string,
  sessionId: string,
  role: 'user' | 'assistant',
  text: string,
): Promise<void> {
  const path = transcriptPath(cwd, sessionId)
  await mkdir(dirname(path), { recursive: true })
  const line = {
    type: role,
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    message: { role, content: text },
  }
  const handle = await open(path, 'a')
  try {
    await handle.write(`${JSON.stringify(line)}\n`)
  } finally {
    await handle.close()
  }
}

function liveSession(sessionId: string): SharedSession {
  const session = sessions.get(sessionId)
  if (!session) throw new Error(`session not in this process: ${sessionId}`)
  return session
}

function release(session: SharedSession, keepInteractive = false): void {
  session.turn?.controller.abort()
  session.turn = undefined
  session.connectionId = undefined
  if (
    !(
      keepInteractive &&
      session.kind === 'interactive' &&
      session.state === 'running'
    )
  ) {
    sessions.delete(session.sessionId)
  }
  void import('./sharedTurn.js')
    .then(turns => turns.releaseSharedTurn(session.sessionId))
    .catch(() => undefined)
}

function writeEvent(socket: Socket, event: SharedEvent): void {
  if (!socket.destroyed) socket.write(`${JSON.stringify(event)}\n`)
}

async function attach(
  socket: Socket,
  session: SharedSession,
  forked = false,
  emit = true,
): Promise<SharedEvent> {
  const connectionId = randomUUID()
  session.connectionId = connectionId
  connections.set(connectionId, { sessionId: session.sessionId, socket })
  return {
    op: 'hello',
    connectionId,
    sessionId: session.sessionId,
    ...(forked ? { forked: true } : {}),
    ...(emit ? {} : { connectionId: '' }),
  }
}

async function forkSession(parent: SharedSession): Promise<SharedSession> {
  const transcript = completeLines(
    await readTranscript(parent.cwd, parent.sessionId),
  )
  const streamed = parent.turn?.streamed ?? ''
  const sessionId = randomUUID()
  const session: SharedSession = {
    sessionId,
    parentSessionId: parent.sessionId,
    cwd: parent.cwd,
    kind: parent.kind,
    state: 'idle',
  }
  sessions.set(sessionId, session)
  const path = transcriptPath(parent.cwd, sessionId)
  await mkdir(dirname(path), { recursive: true })
  const streamedLine = streamed
    ? `${JSON.stringify({ type: 'assistant', uuid: randomUUID(), timestamp: new Date().toISOString(), message: { role: 'assistant', content: streamed } })}\n`
    : ''
  await writeFile(path, transcript + streamedLine)
  return session
}

async function handle(
  request: SharedRequest,
  socket: Socket,
): Promise<SharedEvent | null> {
  switch (request.op) {
    case 'hello': {
      if (request.kind === 'remote' && !request.credential?.trim())
        throw new Error('invalid remote credential')
      if (request.sessionId && sessions.has(request.sessionId)) {
        const child = await forkSession(liveSession(request.sessionId))
        return attach(socket, child, true)
      }
      const stored = request.sessionId
        ? await readTranscript(request.cwd, request.sessionId)
        : ''
      const sessionId = stored ? request.sessionId! : randomUUID()
      const session: SharedSession = {
        sessionId,
        cwd: request.cwd,
        kind: request.kind,
        state: 'idle',
      }
      sessions.set(sessionId, session)
      if (request.kind === 'background')
        await attach(socket, session, false, false)
      return request.kind === 'background'
        ? { op: 'hello', connectionId: '', sessionId }
        : attach(socket, session)
    }
    case 'resume': {
      const transcript = await readTranscript(request.cwd, request.sessionId)
      if (!transcript)
        throw new Error(`session file not found: ${request.sessionId}`)
      if (sessions.has(request.sessionId)) {
        const child = await forkSession(liveSession(request.sessionId))
        const hello = await attach(socket, child, true)
        return hello
      }
      const session: SharedSession = {
        sessionId: request.sessionId,
        cwd: request.cwd,
        kind: 'interactive',
        state: 'idle',
      }
      sessions.set(request.sessionId, session)
      await attach(socket, session)
      return { op: 'resume', sessionId: request.sessionId, transcript }
    }
    case 'fork': {
      const parent = liveSession(request.sessionId)
      const child = await forkSession(parent)
      await attach(socket, child, true)
      return {
        op: 'fork',
        sessionId: child.sessionId,
        parentSessionId: parent.sessionId,
      }
    }
    case 'turn': {
      if (!auth) throw new Error('logged out')
      const session = liveSession(request.sessionId)
      if (session.kind !== 'background' && session.connectionId === undefined)
        throw new Error('session is not attached')
      if (session.state === 'running')
        throw new Error(`session is not idle: ${request.sessionId}`)
      const connection =
        session.kind === 'background'
          ? { sessionId: session.sessionId, socket }
          : [...connections.values()].find(
              item =>
                item.sessionId === session.sessionId && item.socket === socket,
            )
      if (!connection)
        throw new Error('session is attached to another connection')
      const turnId = randomUUID()
      const controller = new AbortController()
      session.state = 'running'
      session.turn = { turnId, streamed: '', controller }
      const run = async (): Promise<void> => {
        try {
          const started = Promise.withResolvers<void>()
          const text = await turnRunner({
            sessionId: session.sessionId,
            cwd: session.cwd,
            input: request.input,
            signal: controller.signal,
            started: started.promise,
            onChunk: chunk => {
              if (session.turn?.turnId !== turnId || controller.signal.aborted)
                return
              session.turn.streamed += chunk
              writeEvent(socket, {
                op: 'turn',
                sessionId: session.sessionId,
                turnId,
                text: chunk,
                streamed: true,
              })
              started.resolve()
            },
          })
          if (session.turn?.turnId !== turnId || controller.signal.aborted)
            return
          if (!text.trim()) return
          await appendLine(
            session.cwd,
            session.sessionId,
            'user',
            request.input,
          )
          await appendLine(
            session.cwd,
            session.sessionId,
            'assistant',
            text.trimEnd(),
          )
          session.turn = undefined
          session.state = 'stopped'
          writeEvent(socket, {
            op: 'turn',
            sessionId: session.sessionId,
            turnId,
            text: text.trimEnd(),
          })
          if (session.kind === 'background') release(session)
        } catch (error) {
          if (session.turn?.turnId === turnId) {
            session.turn = undefined
            session.state = 'stopped'
          }
          writeEvent(socket, {
            op: 'error',
            message: error instanceof Error ? error.message : 'turn failed',
          })
          if (session.kind === 'background') release(session)
        }
      }
      if (session.kind === 'background') await run()
      else void run()
      return null
    }
    case 'cancel': {
      const session = liveSession(request.sessionId)
      if (session.turn?.turnId !== request.turnId)
        throw new Error('turn is not running')
      session.turn.controller.abort()
      session.turn = undefined
      session.state = 'stopped'
      return {
        op: 'cancel',
        sessionId: session.sessionId,
        turnId: request.turnId,
      }
    }
    case 'detach': {
      const connection = connections.get(request.connectionId)
      if (!connection || connection.socket !== socket)
        throw new Error('connection is already gone')
      const session = liveSession(connection.sessionId)
      connections.delete(request.connectionId)
      release(session)
      return { op: 'detach', sessionId: session.sessionId, released: true }
    }
    case 'logout':
      if (!auth) throw new Error('already logged out')
      auth = null
      return { op: 'logout' }
    case 'bg': {
      if (request.command === 'list')
        return { op: 'bg', command: 'list', sessions: sharedSessions() }
      if (request.command === 'start') {
        const event = await handle(
          { op: 'hello', kind: 'background', cwd: request.cwd },
          socket,
        )
        if (!event || event.op !== 'hello') return event
        if (request.input)
          void handle(
            { op: 'turn', sessionId: event.sessionId, input: request.input },
            socket,
          )
        else {
          const session = sessions.get(event.sessionId)
          if (session) release(session)
        }
        return { op: 'bg', command: 'start', sessionId: event.sessionId }
      }
      if (!request.sessionId) throw new Error('session is required')
      if (request.command === 'logs') {
        const live = sessions.get(request.sessionId)
        const cwd = live?.cwd ?? request.cwd
        return {
          op: 'bg',
          command: 'logs',
          sessionId: request.sessionId,
          transcript: await readTranscript(cwd, request.sessionId),
        }
      }
      const session = liveSession(request.sessionId)
      release(session)
      return { op: 'bg', command: 'kill', sessionId: session.sessionId }
    }
  }
}

export async function startSharedServer(address: string): Promise<Server> {
  await mkdirFor(address)
  // Cheap: the registry module has no runtime imports; the ACP agent module
  // graph loads lazily on the first session request, so a legacy-only daemon
  // never pays for it.
  const acpRegistry = new AcpDaemonRegistry()
  const server = createServer(socket => {
    // A peer that vanishes mid-write (killed client, crashed terminal)
    // raises EPIPE as an 'error' event; without a listener that error is
    // fatal to the whole daemon. 'close' always follows and runs the
    // detach cleanup, so the handler only needs to swallow the event.
    socket.on('error', () => undefined)
    attachNdjsonFramer<SharedRequest | { jsonrpc: string }>(socket, request => {
      // ACP clients speak standard JSON-RPC; the legacy protocol uses `op`.
      // Both share this socket during the migration window (AC-14).
      if (
        request &&
        typeof request === 'object' &&
        (request as { jsonrpc?: string }).jsonrpc === '2.0'
      ) {
        acpRegistry.handleSocketMessage(
          socket,
          request as unknown as Record<string, unknown>,
        )
        return
      }
      void handle(request as SharedRequest, socket)
        .then(event => {
          if (event) writeEvent(socket, event)
        })
        .catch((error: unknown) => {
          const message =
            error instanceof Error ? error.message : 'request failed'
          writeEvent(socket, { op: 'error', message })
        })
    })
    socket.on('close', () => {
      acpRegistry.detachSocket(socket)
      for (const [connectionId, connection] of connections) {
        if (connection.socket !== socket) continue
        connections.delete(connectionId)
        const session = sessions.get(connection.sessionId)
        if (session?.connectionId === connectionId) release(session)
      }
    })
  })
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  server.once('error', reject)
  server.listen(address, () => {
    if (!address.startsWith('\\\\.\\pipe\\')) {
      void import('fs/promises')
        .then(({ chmod }) => chmod(address, 0o600))
        .catch(() => undefined)
    }
    resolve()
  })
  await promise
  return server
}

async function mkdirFor(address: string): Promise<void> {
  if (address.startsWith('\\\\.\\pipe\\')) return
  await mkdir(dirname(address), { recursive: true })
}

const lockPathFor = (address: string): string => `${address}.lock`

export async function reapStaleAddress(address: string): Promise<boolean> {
  let lock: LockFile
  try {
    lock = JSON.parse(await readFile(lockPathFor(address), 'utf8')) as LockFile
  } catch {
    return false
  }
  if (!Number.isInteger(lock.pid) || lock.pid <= 0) return false
  try {
    process.kill(lock.pid, 0)
    return false
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return false
  }
  if (!address.startsWith('\\\\.\\pipe\\'))
    await unlink(address).catch(() => undefined)
  await unlink(lockPathFor(address)).catch(() => undefined)
  return true
}

export async function writeSharedLock(
  address: string,
  pid = process.pid,
): Promise<void> {
  const path = lockPathFor(address)
  await mkdirFor(address)
  const temporary = `${path}.${pid}.tmp`
  await writeFile(temporary, JSON.stringify({ pid }), { mode: 0o600 })
  await rename(temporary, path)
}

export function sharedConfigHome(): string {
  return getClaudeConfigHomeDir()
}

export async function socketMode(address: string): Promise<number | null> {
  if (address.startsWith('\\\\.\\pipe\\')) return null
  return (await stat(address)).mode & 0o777
}
