/**
 * Smoke: drive the real ccb --acp process through our AcpClientConnection and
 * confirm the headline claim — N sessions cost one process.
 *
 * Spawns the child here (rather than via AcpClientConnection.spawn) purely so
 * the pid is available for the RSS measurement; the connection itself is
 * still exercised through the same connect() path tests use.
 *
 * Requires ANTHROPIC_BASE_URL and ANTHROPIC_API_KEY in the environment.
 * session/new does not call a model, so this costs no tokens.
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { AcpClientConnection } from '../packages/acp-client/src/connection.ts'
const base = process.env.ANTHROPIC_BASE_URL
if (!base || !process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY not set')
  process.exit(2)
}

const bin = process.env.CCB_BIN ?? `${process.env.HOME}/.npm-global/bin/ccb`
const child = spawn(bin, ['--acp'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    ANTHROPIC_BASE_URL: base,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  },
})

const conn = AcpClientConnection.connect(child.stdout, child.stdin)

function childRssMb(): number {
  const status = readFileSync(`/proc/${child.pid}/status`, 'utf8')
  const match = /VmRSS:\s+(\d+) kB/.exec(status)
  return match ? Number(match[1]) / 1024 : NaN
}

const cwds = ['/tmp/smoke-a', '/tmp/smoke-b', '/tmp/smoke-c']
try {
  // Settle: measure the cost of the shared process before any session exists.
  await new Promise(resolve => setTimeout(resolve, 3000))
  console.log(`baseline (0 sessions): ${childRssMb().toFixed(0)} MB`)

  for (const cwd of cwds) {
    const session = await conn.withContext(async ctx =>
      ctx.buildSession(cwd).start(),
    )
    console.log(
      `session created: ${(session as { sessionId: string }).sessionId} @ ${cwd}`,
    )
  }
  await new Promise(resolve => setTimeout(resolve, 2000))
  console.log(`with ${cwds.length} sessions:  ${childRssMb().toFixed(0)} MB`)
  console.log(`all ${cwds.length} sessions live in one process`)
} finally {
  conn.close()
  child.kill('SIGTERM')
}
