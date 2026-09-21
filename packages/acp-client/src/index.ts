export { AcpClientConnection, type ContextApi } from './connection.js'
export {
  AcpConnectionError,
  type AcpDaemonOptions,
  type AcpSessionInfo,
  type AcpSessionUpdate,
} from './types.js'

import type { ActiveSession } from '@agentclientprotocol/sdk'
import { AcpClientConnection } from './connection.js'
import type { AcpDaemonOptions } from './types.js'

/**
 * Spawn (or attach to) an ACP daemon and complete the initialize handshake.
 *
 * ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY must reach the child: pass them in
 * options.env, or have them already in process.env (spawn inherits it).
 */
export async function connectAcpDaemon(
  options: AcpDaemonOptions = {},
): Promise<AcpClientConnection> {
  const connection = AcpClientConnection.spawn(options)
  await connection.withContext(async ctx => {
    await ctx.request('initialize', {
      protocolVersion: 1,
      capabilities: {},
      clientInfo: { name: 'ccb-tui', version: '0.1.0' },
    })
  })
  return connection
}

/**
 * Create a session in an already-connected daemon. Returns the ActiveSession
 * the SDK builds around it — prompt() to send, nextUpdate() to receive.
 */
export async function createAcpSession(
  connection: AcpClientConnection,
  cwd: string,
): Promise<ActiveSession> {
  return connection.withContext(async ctx => {
    const session = await ctx.buildSession(cwd).start()
    return session
  })
}
