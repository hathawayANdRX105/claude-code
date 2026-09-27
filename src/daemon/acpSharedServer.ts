import { createServer, type Server, type Socket } from 'node:net'
import { chmod, mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { AgentSideConnection, ndJsonStream } from '@agentclientprotocol/sdk'
import type { Stream } from '@agentclientprotocol/sdk'
import { Readable, Writable } from 'node:stream'
import { AcpAgent } from '../services/acp/agent.js'
import { enableConfigs } from '../utils/config.js'
import { applySafeConfigEnvironmentVariables } from '../utils/managedEnv.js'
import { reapStaleAddress } from './sharedClient.js'

// ponytail: one AcpAgent per connection, not one agent shared by all of them.
// AcpAgent holds a single AgentSideConnection and pushes sessionUpdate through
// it, so a shared instance would send every event to whichever client connected
// first. The instance itself is thin (a conn plus a session map); the memory
// that matters — the Bun runtime and the module graph behind QueryEngine, the
// tool registry and the command table — loads once per process either way.

/** Wrap a duplex socket in the ACP SDK's ndjson Stream shape. */
function socketStream(socket: Socket): Stream {
  const readable = Readable.toWeb(
    socket,
  ) as unknown as ReadableStream<Uint8Array>
  const writable = Writable.toWeb(
    socket,
  ) as unknown as WritableStream<Uint8Array>
  return ndJsonStream(writable, readable)
}

const lockPathFor = (address: string): string => `${address}.lock`

/**
 * Record the holder pid next to the socket so a later start can tell a live
 * process from a crashed one and clear the leftover address.
 */
export async function writeSharedLock(
  address: string,
  pid = process.pid,
): Promise<void> {
  if (!address.startsWith('\\\\.\\pipe\\')) {
    await mkdir(dirname(address), { recursive: true })
  }
  const path = lockPathFor(address)
  const temporary = `${path}.${pid}.tmp`
  await writeFile(temporary, JSON.stringify({ pid }), { mode: 0o600 })
  await rename(temporary, path)
}

/**
 * Serve AcpAgent over a local socket, one agent per connecting client.
 *
 * The process outlives any single connection: a client disconnecting closes
 * only its own agent, the server keeps running for the next one. That is what
 * lets N terminals share one runtime instead of each paying for its own.
 */
export async function startAcpSharedServer(address: string): Promise<Server> {
  enableConfigs()
  applySafeConfigEnvironmentVariables()
  await reapStaleAddress(address)

  const server = createServer((socket: Socket) => {
    let agent: AcpAgent
    let connection: AgentSideConnection
    try {
      connection = new AgentSideConnection(conn => {
        agent = new AcpAgent(conn)
        return agent
      }, socketStream(socket))
    } catch (error) {
      // A malformed client must not take the shared process down with it.
      console.error('acp shared: connection setup failed', error)
      socket.destroy()
      return
    }

    socket.on('error', error => {
      console.error('acp shared: socket error', error)
    })

    // Give up only the sessions this client took, then let the shared store
    // decide their fate: with another terminal still attached they stay put,
    // otherwise they start the idle countdown. Closing every session here would
    // kill conversations other clients are still using.
    void connection.closed
      .catch(() => undefined)
      .finally(() => {
        agent.detachSessions()
        socket.destroy()
      })
  })

  const { promise, resolve, reject } = Promise.withResolvers<void>()
  server.once('error', reject)
  server.listen(address, () => {
    // Owner only: another user on this machine must not attach to our agent.
    if (!address.startsWith('\\\\.\\pipe\\')) {
      void chmod(address, 0o600).catch(() => undefined)
    }
    resolve()
  })
  await promise
  return server
}

/** Drop the socket and its lock on the way out so the next start is clean. */
export async function stopAcpSharedServer(
  server: Server,
  address: string,
): Promise<void> {
  await new Promise<void>(resolve => {
    server.close(() => resolve())
  })
  if (!address.startsWith('\\\\.\\pipe\\')) {
    await unlink(address).catch(() => undefined)
  }
  await unlink(lockPathFor(address)).catch(() => undefined)
}
