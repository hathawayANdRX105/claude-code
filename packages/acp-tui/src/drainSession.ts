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
    } catch (err) {
      // A dead daemon kills the update stream with a rejection. The registry
      // has no other path to the UI, so the failure has to be written as a
      // line or the session goes silent mid-conversation with no clue why.
      registry.appendLine(session.sessionId, {
        text: `✗ ${err instanceof Error ? err.message : String(err)}`,
      })
      return
    }
    for (const line of renderUpdate(message)) {
      registry.appendLine(session.sessionId, line)
    }
    // 'stop' ends one turn, not the session: nextUpdate() blocks until the
    // next prompt produces updates again.
  }
}
