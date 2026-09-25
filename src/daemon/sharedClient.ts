import { readFile, unlink } from 'fs/promises'
import { createConnection, type Socket } from 'net'
import { homedir, tmpdir } from 'os'
import { join } from 'path'

export function defaultSharedAddress(): string {
  if (process.platform === 'win32') return '\\\\.\\pipe\\claude-shared'
  return join(
    process.env.XDG_RUNTIME_DIR ?? join(tmpdir(), `claude-${homedir().length}`),
    'claude.sock',
  )
}

export async function connectShared(address: string): Promise<Socket> {
  const { promise, resolve, reject } = Promise.withResolvers<Socket>()
  const socket = createConnection(address)
  socket.once('connect', () => resolve(socket))
  socket.once('error', reject)
  return promise
}

export async function sharedAddressLive(address: string): Promise<boolean> {
  try {
    const socket = await connectShared(address)
    socket.end()
    return true
  } catch {
    return false
  }
}

/** Spawn `shared serve` when the address is dead and wait for it to listen. */
export async function ensureSharedDaemon(
  address: string,
  timeoutMs = 5000,
): Promise<void> {
  if (await sharedAddressLive(address)) return
  await reapStaleAddress(address)
  const { spawn } = await import('child_process')
  const child = spawn(
    process.execPath,
    [process.argv[1] ?? '', 'shared', 'serve'],
    { detached: true, stdio: 'ignore', env: process.env },
  )
  child.unref()
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await sharedAddressLive(address)) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`shared daemon did not start at ${address}`)
}

/** PID recorded by the daemon in `<address>.lock`, for memory accounting. */
export async function readSharedLockPid(
  address: string,
): Promise<number | null> {
  try {
    const lock = JSON.parse(await readFile(`${address}.lock`, 'utf8')) as {
      pid?: unknown
    }
    return typeof lock.pid === 'number' && lock.pid > 0 ? lock.pid : null
  } catch {
    return null
  }
}
export async function reapStaleAddress(address: string): Promise<boolean> {
  let lock: { pid?: unknown }
  try {
    lock = JSON.parse(await readFile(`${address}.lock`, 'utf8')) as {
      pid?: unknown
    }
  } catch {
    return false
  }
  if (!Number.isInteger(lock.pid) || Number(lock.pid) <= 0) return false
  try {
    process.kill(Number(lock.pid), 0)
    return false
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return false
  }
  if (!address.startsWith('\\\\.\\pipe\\'))
    await unlink(address).catch(() => undefined)
  await unlink(`${address}.lock`).catch(() => undefined)
  return true
}
