import type { ActiveSession } from '@agentclientprotocol/sdk'
import type { SessionRegistry } from './registry.js'
import { renderUpdate } from './renderUpdate.js'

/**
 * Pump one session's update stream into the registry for the session's
 * lifetime.
 *
 * Kept outside React on purpose: an async loop owned by a component would be
 * torn down and restarted on every re-render. This runs for the session's
 * lifetime and pushes lines into the registry, which notifies subscribers to
 * re-render — the same path keystrokes use.
 */
export async function drainSession(
  session: ActiveSession,
  registry: SessionRegistry,
): Promise<void> {
  for (;;) {
    let message
    try {
      message = await session.nextUpdate()
    } catch {
      // dispose() or the connection closing ends the loop; the registry
      // already reflects the crash via the connection's error path.
      return
    }
    for (const line of renderUpdate(message)) {
      registry.appendLine(session.sessionId, line)
    }
    // 'stop' ends one turn, not the session: nextUpdate() blocks until the
    // next prompt produces updates again.
  }
}
