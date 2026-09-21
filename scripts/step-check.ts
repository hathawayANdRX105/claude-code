// Isolate the connection handshake from the ink render, logging to stderr.
import { AcpClientConnection } from '../packages/acp-client/src/connection.ts'

const log = (m: string) => console.error(`[step] ${m}`)

log('spawning')
const conn = AcpClientConnection.spawn({
  command: process.env.CCB_BIN ?? process.execPath,
  args: ['--acp'],
  env: { ACP_MCP_SERVERS: '[]' },
})
log(`spawned, daemonPid=${conn.daemonPid}`)

await conn.waitReady()
log('waitReady done')

await conn.initialize()
log('initialize done')

const session = await conn.withContext(async ctx =>
  ctx.buildSession('/tmp').start(),
)
log(`session created: ${session.sessionId}`)

await session.prompt('say only the word OK')
log('prompt sent, draining text')
const text = await session.readText()
log(`text: ${text.slice(0, 120)}`)

conn.close()
log('closed')
process.exit(0)
