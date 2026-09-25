import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { logMock } from '../../../../tests/mocks/log.js'
import { _invalidateProviderCache } from '../loader.js'

// Must mock log before any import that transitively loads log.ts
mock.module('src/utils/log.ts', logMock)

// bun:bundle must be mocked before imports that use feature()
mock.module('bun:bundle', () => ({ feature: () => false }))

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'provider-loader-test-'))
  process.env['CLAUDE_CONFIG_DIR'] = tmpDir
})

afterEach(() => {
  delete process.env['CLAUDE_CONFIG_DIR']
  rmSync(tmpDir, { recursive: true, force: true })
  // J1 fix: invalidate the per-process cache between tests so each test starts fresh
  _invalidateProviderCache()
})

describe('loadProviders', () => {
  test('returns 4 default providers when providers.json does not exist', async () => {
    const { loadProviders } = await import('../loader.js')
    const providers = loadProviders()
    expect(providers).toHaveLength(4)
    expect(providers.map(p => p.id)).toEqual([
      'cerebras',
      'groq',
      'qwen',
      'deepseek',
    ])
  })

  test('returns defaults when providers.json is empty', async () => {
    writeFileSync(join(tmpDir, 'providers.json'), '')
    const { loadProviders } = await import('../loader.js')
    const providers = loadProviders()
    expect(providers).toHaveLength(4)
  })

  test('returns defaults when providers.json is empty array', async () => {
    writeFileSync(join(tmpDir, 'providers.json'), '[]')
    const { loadProviders } = await import('../loader.js')
    const providers = loadProviders()
    expect(providers).toHaveLength(4)
  })

  test('returns defaults when providers.json is corrupt JSON', async () => {
    writeFileSync(join(tmpDir, 'providers.json'), '{not valid json')
    const { loadProviders } = await import('../loader.js')
    const providers = loadProviders()
    expect(providers).toHaveLength(4)
  })

  test('returns defaults when providers.json fails schema validation', async () => {
    writeFileSync(
      join(tmpDir, 'providers.json'),
      JSON.stringify([{ id: 123, kind: 'bad-kind', baseUrl: 'not-a-url' }]),
    )
    const { loadProviders } = await import('../loader.js')
    const providers = loadProviders()
    expect(providers).toHaveLength(4)
  })

  test('merges valid user providers on top of defaults', async () => {
    const customProvider = {
      id: 'myendpoint',
      kind: 'openai-compat',
      baseUrl: 'https://my.api.com/v1',
      apiKeyEnv: 'MY_API_KEY',
      defaultModel: 'my-model',
      compatRule: 'permissive',
    }
    writeFileSync(
      join(tmpDir, 'providers.json'),
      JSON.stringify([customProvider]),
    )
    const { loadProviders } = await import('../loader.js')
    const providers = loadProviders()
    // 4 defaults + 1 custom = 5
    expect(providers).toHaveLength(5)
    expect(providers.find(p => p.id === 'myendpoint')).toMatchObject({
      baseUrl: 'https://my.api.com/v1',
    })
  })

  test('user provider with same id as default replaces the default', async () => {
    const overrideCerebras = {
      id: 'cerebras',
      kind: 'openai-compat',
      baseUrl: 'https://custom-cerebras.example.com/v1',
      apiKeyEnv: 'CEREBRAS_API_KEY',
      defaultModel: 'llama-3.3-70b',
      compatRule: 'cerebras',
    }
    writeFileSync(
      join(tmpDir, 'providers.json'),
      JSON.stringify([overrideCerebras]),
    )
    const { loadProviders } = await import('../loader.js')
    const providers = loadProviders()
    // Still 4 providers (cerebras replaced, not added)
    expect(providers).toHaveLength(4)
    const cerebras = providers.find(p => p.id === 'cerebras')
    expect(cerebras?.baseUrl).toBe('https://custom-cerebras.example.com/v1')
  })

  test('findProvider returns undefined for unknown id', async () => {
    const { findProvider, DEFAULT_PROVIDERS } = await import('../loader.js')
    const result = findProvider('nonexistent', DEFAULT_PROVIDERS)
    expect(result).toBeUndefined()
  })

  test('findProvider returns correct provider for known id', async () => {
    const { findProvider, DEFAULT_PROVIDERS } = await import('../loader.js')
    const deepseek = findProvider('deepseek', DEFAULT_PROVIDERS)
    expect(deepseek?.baseUrl).toBe('https://api.deepseek.com/v1')
    expect(deepseek?.compatRule).toBe('deepseek')
  })
})

describe('saveProviders', () => {
  test('keeps a default provider override that carries models', async () => {
    const { DEFAULT_PROVIDERS, saveProviders, loadProviders } = await import(
      '../loader.js'
    )
    const cerebras = DEFAULT_PROVIDERS.find(p => p.id === 'cerebras')!
    saveProviders([
      {
        ...cerebras,
        baseUrl: 'https://my-cerebras.example.com/v1',
        models: [{ id: 'llama-3.3-70b', contextWindow: 128000 }],
      },
    ])
    _invalidateProviderCache()
    const reloaded = loadProviders().find(p => p.id === 'cerebras')
    expect(reloaded?.baseUrl).toBe('https://my-cerebras.example.com/v1')
    expect(reloaded?.models).toEqual([
      { id: 'llama-3.3-70b', contextWindow: 128000 },
    ])
  })

  test('does not rewrite a default that only differs in key order', async () => {
    const { DEFAULT_PROVIDERS, saveProviders } = await import('../loader.js')
    const groq = DEFAULT_PROVIDERS.find(p => p.id === 'groq')!
    const reordered = Object.fromEntries(
      Object.entries(groq).reverse(),
    ) as typeof groq
    saveProviders([reordered])
    const raw = readFileSync(join(tmpDir, 'providers.json'), 'utf-8')
    expect(raw).not.toContain('groq')
  })
})
