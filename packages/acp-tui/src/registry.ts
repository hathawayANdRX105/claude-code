import type { ActiveSession } from '@agentclientprotocol/sdk'

/**
 * One open session as the TUI sees it. The daemon owns the real state; this
 * is the local mirror the UI renders from.
 */
export interface ManagedSession {
  sessionId: string
  cwd: string
  title: string
  active: boolean
  /** SDK handle; present once session/new completed. */
  session?: ActiveSession
}

/**
 * Session bookkeeping for the TUI. Deliberately free of React: the state
 * transitions are what need testing, and keeping them out of the component
 * tree means they can be asserted without rendering.
 */
export class SessionRegistry {
  private sessions = new Map<string, ManagedSession>()
  private order: string[] = []
  private cursor = -1

  upsert(session: ManagedSession): void {
    const isFirst = this.sessions.size === 0
    if (!this.sessions.has(session.sessionId)) {
      this.order.push(session.sessionId)
    }
    if (isFirst) session.active = true
    this.sessions.set(session.sessionId, session)
    if (this.cursor < 0) this.cursor = 0
  }

  remove(sessionId: string): void {
    this.sessions.delete(sessionId)
    this.order = this.order.filter(id => id !== sessionId)
    if (this.order.length === 0) {
      this.cursor = -1
      return
    }
    if (this.cursor >= this.order.length) {
      this.cursor = this.order.length - 1
    }
  }

  /** Switch focus to an existing session by id. */
  focus(sessionId: string): boolean {
    const idx = this.order.indexOf(sessionId)
    if (idx < 0) return false
    for (const s of this.sessions.values()) s.active = false
    const target = this.sessions.get(sessionId)
    if (target) target.active = true
    this.cursor = idx
    return true
  }

  /** Cycle to the next session, wrapping. No-op with fewer than two. */
  next(): string | null {
    if (this.order.length === 0) return null
    this.cursor = (this.cursor + 1) % this.order.length
    const id = this.order[this.cursor]
    this.focus(id)
    return id
  }

  get current(): ManagedSession | null {
    return this.cursor < 0
      ? null
      : (this.sessions.get(this.order[this.cursor]) ?? null)
  }

  get count(): number {
    return this.sessions.size
  }

  list(): ManagedSession[] {
    return this.order
      .map(id => this.sessions.get(id))
      .filter((s): s is ManagedSession => !!s)
  }
}
