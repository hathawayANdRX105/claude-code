import { describe, expect, it } from 'bun:test'
import { SessionRegistry } from '../registry.js'

function makeRegistry(...cwds: string[]): SessionRegistry {
  const registry = new SessionRegistry()
  for (const cwd of cwds) {
    registry.upsert({
      sessionId: `id-${cwd}`,
      cwd,
      title: cwd,
      active: false,
    })
  }
  return registry
}

describe('SessionRegistry', () => {
  it('tracks inserted sessions in order', () => {
    const registry = makeRegistry('a', 'b', 'c')
    expect(registry.count).toBe(3)
    expect(registry.list().map(s => s.cwd)).toEqual(['a', 'b', 'c'])
  })

  it('focuses the first session on insert', () => {
    const registry = makeRegistry('a')
    expect(registry.current?.cwd).toBe('a')
    expect(registry.current?.active).toBe(true)
  })

  it('cycles next() and wraps around', () => {
    const registry = makeRegistry('a', 'b', 'c')
    expect(registry.next()).toBe('id-b')
    expect(registry.next()).toBe('id-c')
    expect(registry.next()).toBe('id-a')
  })

  it('focus() marks exactly one active', () => {
    const registry = makeRegistry('a', 'b', 'c')
    expect(registry.focus('id-c')).toBe(true)
    expect(
      registry
        .list()
        .filter(s => s.active)
        .map(s => s.cwd),
    ).toEqual(['c'])
    expect(registry.current?.cwd).toBe('c')
  })

  it('focus() rejects unknown ids', () => {
    const registry = makeRegistry('a')
    expect(registry.focus('nope')).toBe(false)
  })

  it('removes a session and keeps the cursor valid', () => {
    const registry = makeRegistry('a', 'b', 'c')
    registry.focus('id-b')
    registry.remove('id-b')
    expect(registry.count).toBe(2)
    expect(registry.list().map(s => s.cwd)).toEqual(['a', 'c'])
    // cursor pointed at index 1, which is still valid ('c' shifted in)
    expect(registry.current?.cwd).toBe('c')
  })

  it('emptying the registry resets the cursor', () => {
    const registry = makeRegistry('a')
    registry.remove('id-a')
    expect(registry.count).toBe(0)
    expect(registry.current).toBeNull()
    expect(registry.next()).toBeNull()
  })

  it('upsert() updates an existing session in place', () => {
    const registry = makeRegistry('a')
    registry.upsert({
      sessionId: 'id-a',
      cwd: 'a',
      title: 'renamed',
      active: false,
    })
    expect(registry.count).toBe(1)
    expect(registry.list()[0].title).toBe('renamed')
  })
})
