import type { AgentRequestResponsesByMethod, SessionId } from '@agentclientprotocol/sdk'

/**
 * A session managed by the ACP daemon.
 */
export interface AcpSessionInfo {
  sessionId: SessionId
  cwd: string
  title?: string
}

/**
 * Subset of session/update params the frontend renders. Keeping this narrow
 * avoids coupling the UI to the full SDK notification shape.
 */
export interface AcpSessionUpdate {
  sessionId: SessionId
  update: unknown
}

/**
 * Result of session/new — mirrors the SDK response plus the cwd we asked for,
 * which the SDK response does not echo back.
 */
export type NewSessionResult = AgentRequestResponsesByMethod['session/new'] & {
  cwd: string
}

/**
 * Options for spawning or attaching to a daemon process.
 */
export interface AcpDaemonOptions {
  /** Binary to spawn. Defaults to the current executable (process.execPath). */
  command?: string
  /** Args appended after the binary. Defaults to ['--acp']. */
  args?: string[]
  /** Working directory the daemon inherits. */
  cwd?: string
  /** Extra env for the child. ANTHROPIC_* keys usually live here. */
  env?: Record<string, string>
}

/**
 * Connection-level error that keeps the child's exit signal reachable by
 * callers, so the UI can tell "daemon crashed" from "request rejected".
 */
export class AcpConnectionError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
    readonly exitCode?: number | null,
    readonly signal?: NodeJS.Signals | null,
  ) {
    super(message)
    this.name = 'AcpConnectionError'
  }
}
