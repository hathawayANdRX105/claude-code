import { afterAll, beforeEach, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { getProjectDir } from '../../utils/sessionStoragePortable.js'
import { ensureSharedDaemon, sharedAddressLive } from '../sharedClient.js'
import {
  connectShared,
  defaultSharedAddress,
  loggedIn,
  reapStaleAddress,
  resetSharedSessions,
  setSharedTurnRunner,
  sharedSessions,
  socketMode,
  startSharedServer,
  writeSharedLock,
} from '../sharedSession.js'

const root = mkdtempSync(join(tmpdir(), 'shared-session-'))

beforeEach(() => {
  resetSharedSessions()
  process.env.CLAUDE_CONFIG_DIR = root
  const cached = getClaudeConfigHomeDir as unknown as {
    cache?: { clear?: () => void }
  }
  cached.cache?.clear?.()
  const projects = getProjectDir as unknown as {
    cache?: { clear?: () => void }
  }
  projects.cache?.clear?.()
})

afterAll(() => {
  delete process.env.CLAUDE_CONFIG_DIR
  rmSync(root, { recursive: true, force: true })
})

function open(address: string): Promise<{
  ask: (message: Record<string, unknown>) => Promise<Record<string, unknown>>
  next: () => Promise<Record<string, unknown>>
  close: () => void
}> {
  const { promise, resolve, reject } = Promise.withResolvers<{
    ask: (message: Record<string, unknown>) => Promise<Record<string, unknown>>
    next: () => Promise<Record<string, unknown>>
    close: () => void
  }>()
  void connectShared(address).then(socket => {
    let buffer = ''
    const pending: Array<(value: Record<string, unknown>) => void> = []
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      let newline = buffer.indexOf('\n')
      while (newline !== -1 && pending.length > 0) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        pending.shift()?.(JSON.parse(line) as Record<string, unknown>)
        newline = buffer.indexOf('\n')
      }
    })
    socket.on('error', reject)
    const next = (): Promise<Record<string, unknown>> => {
      const result = Promise.withResolvers<Record<string, unknown>>()
      pending.push(result.resolve)
      return result.promise
    }
    resolve({
      ask: message => {
        const result = next()
        socket.write(`${JSON.stringify(message)}\n`)
        return result
      },
      next,
      close: () => socket.end(),
    })
  }, reject)
  return promise
}

test('occupied sessions fork, detach releases memory, and resume reloads jsonl', async () => {
  const address = join(root, 'claude.sock')
  const server = await startSharedServer(address)
  const first = await open(address)
  const second = await open(address)
  const firstHello = await first.ask({
    op: 'hello',
    kind: 'interactive',
    cwd: root,
  })
  const secondHello = await second.ask({
    op: 'hello',
    kind: 'interactive',
    cwd: root,
  })
  const turn = await second.ask({
    op: 'turn',
    sessionId: secondHello.sessionId,
    input: 'ping',
  })
  const fork = await first.ask({
    op: 'hello',
    kind: 'interactive',
    cwd: root,
    sessionId: secondHello.sessionId,
  })

  expect(firstHello.sessionId).not.toBe(secondHello.sessionId)
  expect(turn.text).toBe('echo:ping')
  expect(fork.forked).toBe(true)
  expect(fork.sessionId).not.toBe(secondHello.sessionId)
  expect(sharedSessions()).toHaveLength(3)

  const childPath = join(getProjectDir(root), `${String(fork.sessionId)}.jsonl`)
  expect(readFileSync(childPath, 'utf8')).toContain('"content":"echo:ping"')

  await second.ask({ op: 'detach', connectionId: secondHello.connectionId })
  expect(
    sharedSessions().some(
      session => session.sessionId === secondHello.sessionId,
    ),
  ).toBe(false)
  const third = await open(address)
  const resumed = await third.ask({
    op: 'resume',
    sessionId: secondHello.sessionId,
    cwd: root,
  })
  expect(resumed.transcript).toContain('ping')
  expect(
    sharedSessions().some(
      session => session.sessionId === secondHello.sessionId,
    ),
  ).toBe(true)

  first.close()
  second.close()
  third.close()
  server.close()
})

test('a turn error stops only that session and logout blocks the next model call', async () => {
  const address = join(root, 'errors.sock')
  const server = await startSharedServer(address)
  setSharedTurnRunner(async ({ input, signal }) => {
    if (signal.aborted) throw new Error('aborted')
    if (input === 'boom') throw new Error('session exploded')
    return `echo:${input}`
  })
  const client = await open(address)
  const other = await open(address)
  const broken = await client.ask({
    op: 'hello',
    kind: 'interactive',
    cwd: root,
  })
  const healthy = await other.ask({
    op: 'hello',
    kind: 'interactive',
    cwd: root,
  })
  const failed = await client.ask({
    op: 'turn',
    sessionId: broken.sessionId,
    input: 'boom',
  })
  const stillWorks = await other.ask({
    op: 'turn',
    sessionId: healthy.sessionId,
    input: 'ok',
  })

  expect(failed).toEqual({ op: 'error', message: 'session exploded' })
  expect(
    sharedSessions().find(session => session.sessionId === broken.sessionId)
      ?.state,
  ).toBe('stopped')
  expect(stillWorks.text).toBe('echo:ok')

  await client.ask({ op: 'logout' })
  expect(loggedIn()).toBe(false)
  const denied = await other.ask({
    op: 'turn',
    sessionId: healthy.sessionId,
    input: 'again',
  })
  expect(denied).toEqual({ op: 'error', message: 'logged out' })

  client.close()
  other.close()
  server.close()
})

test('ensureSharedDaemon returns fast against a live server', async () => {
  const address = join(root, 'ensure.sock')
  const server = await startSharedServer(address)
  const started = Date.now()
  await ensureSharedDaemon(address)
  // Live fast path: no spawn, no polling loop.
  expect(Date.now() - started).toBeLessThan(1_000)
  expect(await sharedAddressLive(address)).toBe(true)
  server.close()
})

test('a vanished client cannot kill the server (ECONNRESET)', async () => {
  const address = join(root, 'rst.sock')
  const server = await startSharedServer(address)
  // The client never reads the hello response, so destroy() sends RST with
  // data still in flight — the server receives an ECONNRESET error event.
  // Without a socket error listener that event is fatal to the process.
  const rude = await connectShared(address)
  rude.write(
    `${JSON.stringify({ op: 'hello', kind: 'interactive', cwd: root })}\n`,
  )
  rude.destroy()
  await new Promise(resolve => setTimeout(resolve, 50))

  // The daemon survives and keeps answering new clients.
  const client = await open(address)
  const hello = await client.ask({
    op: 'hello',
    kind: 'interactive',
    cwd: root,
  })
  expect(typeof hello.sessionId).toBe('string')
  client.close()
  server.close()
})

test('disconnect drops a partial line and a dead lock can be reaped', async () => {
  const address = join(root, 'cancel.sock')
  const server = await startSharedServer(address)
  let releaseTurn: (() => void) | undefined
  setSharedTurnRunner(
    ({ signal, started, onChunk }) =>
      new Promise((resolve, reject) => {
        onChunk('partial line')
        signal.addEventListener('abort', () => reject(new Error('aborted')), {
          once: true,
        })
        void started.then(() => {
          releaseTurn = () => resolve('finished\n')
        })
      }),
  )
  const client = await open(address)
  const hello = await client.ask({
    op: 'hello',
    kind: 'interactive',
    cwd: root,
  })
  const started = client.ask({
    op: 'turn',
    sessionId: hello.sessionId,
    input: 'slow',
  })
  client.close()
  await started.catch(() => undefined)
  releaseTurn?.()
  await new Promise<void>(resolve => setImmediate(resolve))

  const path = join(getProjectDir(root), `${String(hello.sessionId)}.jsonl`)
  expect(() => readFileSync(path, 'utf8')).toThrow()
  expect(sharedSessions()).toHaveLength(0)

  expect(await socketMode(address)).toBe(0o600)
  await writeSharedLock(address, 2_147_483_647)
  expect(await reapStaleAddress(address)).toBe(true)
  expect(defaultSharedAddress()).toContain(
    process.platform === 'win32' ? 'claude-shared' : 'claude.sock',
  )
  server.close()
})

test('background work stays in this process and remote work requires a credential (AC-8, AC-9)', async () => {
  const address = join(root, 'modes.sock')
  const server = await startSharedServer(address)
  const client = await open(address)
  const started = await client.ask({
    op: 'bg',
    command: 'start',
    cwd: root,
    input: 'ping',
  })
  let finished = await client.next()
  while (finished.streamed === true) finished = await client.next()

  expect(started).toEqual({
    op: 'bg',
    command: 'start',
    sessionId: expect.any(String),
  })
  expect(finished.text).toBe('echo:ping')
  expect(
    sharedSessions().find(session => session.sessionId === started.sessionId)
      ?.state ?? 'released',
  ).toBe('released')
  const transcript = readFileSync(
    join(getProjectDir(root), `${String(started.sessionId)}.jsonl`),
    'utf8',
  )
  expect(transcript).toContain('ping')

  const remote = await client.ask({
    op: 'hello',
    kind: 'remote',
    cwd: root,
    credential: ' ',
  })
  expect(remote).toEqual({ op: 'error', message: 'invalid remote credential' })
  setSharedTurnRunner(async () => {
    throw new Error('background failed')
  })
  const failed = await client.ask({
    op: 'bg',
    command: 'start',
    cwd: root,
    input: 'boom',
  })
  expect(failed).toEqual({ op: 'error', message: 'background failed' })
  expect(sharedSessions()).toHaveLength(0)
  const accepted = await client.ask({
    op: 'hello',
    kind: 'remote',
    cwd: root,
    credential: 'remote-token',
  })

  client.close()
  server.close()
})
