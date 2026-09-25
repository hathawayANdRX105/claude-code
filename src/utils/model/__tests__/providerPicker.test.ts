import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { _invalidateProviderCache } from '../../../services/providerRegistry/loader.js'

let tmpDir: string | undefined
const saved = {
  config: process.env.CLAUDE_CONFIG_DIR,
  base: process.env.ANTHROPIC_BASE_URL,
  openai: process.env.OPENAI_BASE_URL,
  key: process.env.ANTHROPIC_API_KEY,
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'provider-picker-'))
  process.env.CLAUDE_CONFIG_DIR = tmpDir
  delete process.env.ANTHROPIC_BASE_URL
  delete process.env.OPENAI_BASE_URL
  process.env.ANTHROPIC_API_KEY = 'test-key'
})

afterEach(() => {
  if (saved.config === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = saved.config
  if (saved.base === undefined) delete process.env.ANTHROPIC_BASE_URL
  else process.env.ANTHROPIC_BASE_URL = saved.base
  if (saved.openai === undefined) delete process.env.OPENAI_BASE_URL
  else process.env.OPENAI_BASE_URL = saved.openai
  if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = saved.key
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  _invalidateProviderCache()
})

function writeProviders() {
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
        models: [
          { id: 'grok-4.7', name: 'grok-4.7 (reasoning)', contextWindow: 500000 },
          { id: 'kimi-k3' },
        ],
      },
      {
        id: 'grokx',
        kind: 'openai-compat',
        baseUrl: 'http://localhost:3101/v1',
        apiKeyEnv: 'GROKX_API_KEY',
        defaultModel: 'deepseek-v4-flash',
        compatRule: 'permissive',
        models: [{ id: 'deepseek-v4-flash', contextWindow: 500000 }],
      },
    ]),
  )
  _invalidateProviderCache()
}

describe('provider model picker', () => {
  test('lists every configured provider models, each prefixed, plus built-in options', async () => {
    writeProviders()
    const { getModelOptions } = await import('../modelOptions.js')
    const values = getModelOptions().map(option => option.value)

    // AC-1: every configured provider model is present, prefixed with its
    // provider id, so a session can mix providers freely.
    expect(values).toContain('wildtoken/grok-4.7')
    expect(values).toContain('wildtoken/kimi-k3')
    expect(values).toContain('grokx/deepseek-v4-flash')

    // Built-in options are retained, not hidden when providers.json is present.
    const builtIns = ['opus', 'sonnet', 'haiku'].filter(value =>
      values.includes(value),
    )
    expect(builtIns.length).toBeGreaterThan(0)
  })

  test('providers without a models list are not offered in the picker', async () => {
    writeFileSync(
      join(tmpDir!, 'providers.json'),
      JSON.stringify([
        {
          id: 'noisy',
          kind: 'openai-compat',
          baseUrl: 'http://localhost:3102/v1',
          apiKeyEnv: 'NOISY_API_KEY',
          defaultModel: 'some-model',
          compatRule: 'permissive',
        },
      ]),
    )
    _invalidateProviderCache()
    const { getModelOptions } = await import('../modelOptions.js')
    const values = getModelOptions().map(option => option.value)
    expect(values).not.toContain('noisy/some-model')
  })
})
