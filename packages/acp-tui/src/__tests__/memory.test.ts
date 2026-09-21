import { describe, expect, it } from 'bun:test'
import { formatMb, ownRss, processRss } from '../memory.js'

describe('memory accounting', () => {
  it('reads own RSS as a live number', () => {
    const rss = ownRss()
    expect(typeof rss).toBe('number')
    expect(rss).toBeGreaterThan(0)
  })

  it('accounts this very process via /proc', () => {
    // A process can always read itself, so this is a real end-to-end check of
    // the same code path used for the daemon.
    const rss = processRss(process.pid)
    if (process.platform !== 'linux') {
      expect(rss).toBeNull()
      return
    }
    expect(rss).not.toBeNull()
    // /proc reports kB; own RSS comes from the V8 API. Same order of magnitude.
    expect(rss!).toBeGreaterThan(0)
  })

  it('returns null for a dead pid rather than a misleading zero', () => {
    // 4194303 is the max pid ceiling on default Linux kernels; unused.
    expect(processRss(4194303)).toBeNull()
  })

  it('formats bytes as whole megabytes', () => {
    expect(formatMb(0)).toBe('0MB')
    expect(formatMb(1024 * 1024)).toBe('1MB')
    expect(formatMb(221 * 1024 * 1024)).toBe('221MB')
  })
})
