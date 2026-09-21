/**
 * Where the daemon listens. One per user: $XDG_RUNTIME_DIR or ~/.claude.
 */
export function daemonSocketPath(): string {
  const runtime = process.env.XDG_RUNTIME_DIR
  const base = runtime && runtime.startsWith('/')
    ? runtime
    : `${process.env.HOME ?? '/tmp'}/.claude`
  return `${base}/ccb-acp-daemon.sock`
}

/**
 * Lockfile companion to the socket. flock on this file is what makes
 * "is a daemon already running" reliable: a stale socket file survives a
 * crash, a held lock does not.
 */
export function daemonLockPath(): string {
  return `${daemonSocketPath()}.lock`
}

export interface DaemonOptions {
  /** Idle seconds with zero sessions before the daemon exits. Default 300. */
  idleTimeoutSec?: number
  /** Override socket path (tests). */
  socketPath?: string
}

export const DEFAULT_IDLE_TIMEOUT_SEC = 300
