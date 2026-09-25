import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { _invalidateProviderCache } from '../../../providerRegistry/loader.js'

describe('provider-prefixed openai routing', () => {
  test('AC-6: a provider with an unset key env var raises a provider-named error', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'prov-route-'))
    process.env.CLAUDE_CONFIG_DIR = tmp
    delete process.env.PROVKEY_UNSET
    writeFileSync(
      join(tmp, 'providers.json'),
      JSON.stringify([
        {
          id: 'prov',
          kind: 'openai-compat',
          baseUrl: 'http://localhost:9/v1',
          apiKeyEnv: 'PROVKEY_UNSET',
          defaultModel: 'm',
          compatRule: 'permissive',
          models: [{ id: 'm' }],
        },
      ]),
    )
    _invalidateProviderCache()

    const { queryModelOpenAI } = await import('../index.js')
    const gen = queryModelOpenAI(
      [],
      [] as never,
      [],
      new AbortController().signal,
      { model: 'prov/m', querySource: 'test' } as never,
    )

    try {
      await expect(gen.next()).rejects.toThrow(
        /Provider "prov" has no API key\. Set the PROVKEY_UNSET environment variable/,
      )
    } finally {
      rmSync(tmp, { recursive: true, force: true })
      _invalidateProviderCache()
    }
  })
})
