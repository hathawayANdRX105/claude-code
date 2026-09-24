import { afterAll, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { reapStaleAddress } from '../sharedClient.js'

const root = mkdtempSync(join(tmpdir(), 'shared-client-'))

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

test('a dead lock removes the stale address and lock file (AC-2)', async () => {
  const address = join(root, 'dead.sock')
  writeFileSync(address, 'dead-marker')
  writeFileSync(`${address}.lock`, JSON.stringify({ pid: 2_147_483_647 }))

  expect(await reapStaleAddress(address)).toBe(true)
  expect(existsSync(address)).toBe(false)
  expect(existsSync(`${address}.lock`)).toBe(false)
})

test('an unreadable lock leaves the address untouched (AC-2)', async () => {
  const address = join(root, 'unknown.sock')
  writeFileSync(address, 'keep-marker')
  writeFileSync(`${address}.lock`, '{')

  expect(await reapStaleAddress(address)).toBe(false)
  expect(existsSync(address)).toBe(true)
  expect(existsSync(`${address}.lock`)).toBe(true)
})
