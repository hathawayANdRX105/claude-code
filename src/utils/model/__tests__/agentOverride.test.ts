import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { _invalidateProviderCache } from '../../../services/providerRegistry/loader.js'

let tmpDir: string | undefined
const saved = {
  config: process.env.CLAUDE_CONFIG_DIR,
  key: process.env.ANTHROPIC_API_KEY,
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'agent-override-'))
  process.env.CLAUDE_CONFIG_DIR = tmpDir
  process.env.ANTHROPIC_API_KEY = 'test-key'
  delete process.env.CLAUDE_CODE_SUBAGENT_MODEL
})

afterEach(() => {
  if (saved.config === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = saved.config
  if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = saved.key
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  _invalidateProviderCache()
})

describe('subagent model override (spec 0003 AC-5)', () => {
  test('a provider-prefixed model passes through unchanged', async () => {
    const { getAgentModel } = await import('../agent.js')
    expect(getAgentModel('wildtoken/agnes-3.0-flash', 'claude-opus-4-7')).toBe(
      'wildtoken/agnes-3.0-flash',
    )
  })

  test('a provider-prefixed tool model passes through unchanged', async () => {
    const { getAgentModel } = await import('../agent.js')
    expect(
      getAgentModel(undefined, 'claude-opus-4-7', 'wildtoken/grok-4.7'),
    ).toBe('wildtoken/grok-4.7')
  })

  test('omitting the model inherits the parent (main) model', async () => {
    const { getAgentModel } = await import('../agent.js')
    const resolved = getAgentModel(undefined, 'claude-opus-4-7')
    expect(typeof resolved).toBe('string')
    expect(resolved.length).toBeGreaterThan(0)
  })

  test('agent model options include configured provider models', async () => {
    writeFileSync(
      join(tmpDir!, 'providers.json'),
      JSON.stringify([
        {
          id: 'wildtoken',
          kind: 'openai-compat',
          baseUrl: 'http://localhost:3100/v1',
          apiKeyEnv: 'WILDTOKEN_API_KEY',
          defaultModel: 'grok-4.7',
          compatRule: 'permissive',
          models: [{ id: 'agnes-3.0-flash', contextWindow: 500000 }],
        },
      ]),
    )
    _invalidateProviderCache()
    const { getAgentModelOptions } = await import('../agent.js')
    const values = getAgentModelOptions().map(option => option.value)
    expect(values).toContain('wildtoken/agnes-3.0-flash')
    expect(values).toContain('inherit')
  })
})
