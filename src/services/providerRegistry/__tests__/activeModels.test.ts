import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { _invalidateProviderCache } from '../loader.js'
import { activeProviderModels } from '../activeModels.js'

let tmpDir: string | undefined
const saved = {
  config: process.env.CLAUDE_CONFIG_DIR,
  base: process.env.ANTHROPIC_BASE_URL,
  openai: process.env.OPENAI_BASE_URL,
}

afterEach(() => {
  if (saved.config === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = saved.config
  if (saved.base === undefined) delete process.env.ANTHROPIC_BASE_URL
  else process.env.ANTHROPIC_BASE_URL = saved.base
  if (saved.openai === undefined) delete process.env.OPENAI_BASE_URL
  else process.env.OPENAI_BASE_URL = saved.openai
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  _invalidateProviderCache()
})

describe('active provider models (endpoint match, removed in spec 0003 cutover)', () => {
  test('a matching provider exposes its models list', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'provider-models-'))
    process.env.CLAUDE_CONFIG_DIR = tmpDir
    process.env.ANTHROPIC_BASE_URL = 'http://localhost:3100'
    delete process.env.OPENAI_BASE_URL
    writeFileSync(
      join(tmpDir, 'providers.json'),
      JSON.stringify([
        {
          id: 'wildtoken',
          kind: 'openai-compat',
          baseUrl: 'http://localhost:3100/v1',
          apiKeyEnv: 'WILDTOKEN_API_KEY',
          defaultModel: 'grok-4.7',
          compatRule: 'permissive',
          models: [
            { id: 'grok-4.7', contextWindow: 500000 },
            { id: 'kimi-k3', name: 'Kimi', contextWindow: 500000 },
          ],
        },
      ]),
    )
    _invalidateProviderCache()

    expect(activeProviderModels()?.map(model => model.id)).toEqual([
      'grok-4.7',
      'kimi-k3',
    ])
  })
})
