import { readFileSync } from 'node:fs'

/**
 * RSS of another process, in bytes. Linux only — /proc is the portable way to
 * account a child whose memory we do not share. Returns null off Linux or for
 * a dead pid so the caller hides that part rather than showing a stale zero.
 */
export function processRss(pid: number | null): number | null {
  if (pid === null || process.platform !== 'linux') return null
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8')
    const match = /VmRSS:\s+(\d+) kB/.exec(status)
    return match ? Number(match[1]) * 1024 : null
  } catch {
    return null
  }
}

/** RSS of this process — the thin TUI client. */
export function ownRss(): number {
  return process.memoryUsage().rss
}

export function formatMb(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)}MB`
}
