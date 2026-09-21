import type { ActiveSession } from '@agentclientprotocol/sdk'
import type { DisplayLine } from './renderUpdate.js'

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
  /** Conversation rendered so far, in order. */
  lines: DisplayLine[]
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
  private listeners = new Set<() => void>()

  upsert(session: ManagedSession): void {
    const isFirst = this.sessions.size === 0
    if (!this.sessions.has(session.sessionId)) {
      this.order.push(session.sessionId)
    }
    const record: ManagedSession = { ...session, lines: session.lines ?? [] }
    if (isFirst) record.active = true
    this.sessions.set(session.sessionId, record)
    if (this.cursor < 0) this.cursor = 0
    this.notify()
  }

  /** Append one rendered line to a session's conversation and notify. */
  appendLine(sessionId: string, line: DisplayLine): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.lines.push(line)
    this.notify()
  }

  remove(sessionId: string): void {
    this.sessions.delete(sessionId)
    this.order = this.order.filter(id => id !== sessionId)
    if (this.order.length === 0) {
      this.cursor = -1
    } else if (this.cursor >= this.order.length) {
      this.cursor = this.order.length - 1
    }
    this.notify()
  }

  /** Switch focus to an existing session by id. */
  focus(sessionId: string): boolean {
    const idx = this.order.indexOf(sessionId)
    if (idx < 0) return false
    for (const s of this.sessions.values()) s.active = false
    const target = this.sessions.get(sessionId)
    if (target) target.active = true
    this.cursor = idx
    this.notify()
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

  /**
   * Register a change callback. Lets the UI re-render on mutation instead of
   * polling. Returns an unsubscribe.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}
