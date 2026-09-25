import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { _invalidateProviderCache } from '../../providerRegistry/loader.js'

describe('provider-prefixed anthropic routing', () => {
  test('AC-6: an anthropic-kind provider with an unset key env var raises a provider-named error before any request', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'prov-ant-'))
    process.env.CLAUDE_CONFIG_DIR = tmp
    // VCR only wraps the queryModel generators; the missing-key throw must
    // happen before the cassette layer would need a fixture, so disable it.
    const prevNodeEnv = process.env.NODE_ENV
    delete process.env.NODE_ENV
    // CI/test canary: credential-presence must be declared or getAnthropic
    // key lookup fails fast. A dummy OAuth token satisfies it without
    // becoming a subscriber (no scopes, not managed, 3P gate unaffected).
    const prevOauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'dummy-token-for-test'
    delete process.env.PROVKEY_ANT
    writeFileSync(
      join(tmp, 'providers.json'),
      JSON.stringify([
        {
          id: 'prov',
          kind: 'anthropic',
          baseUrl: 'https://relay.example.com',
          apiKeyEnv: 'PROVKEY_ANT',
          defaultModel: 'claude-sonnet-4-5',
          compatRule: 'permissive',
          models: [{ id: 'claude-sonnet-4-5' }],
        },
      ]),
    )
    _invalidateProviderCache()

    const { queryModelWithStreaming } = await import('../claude.js')
    const gen = queryModelWithStreaming({
      messages: [],
      systemPrompt: [] as never,
      thinkingConfig: { type: 'disabled' } as never,
      tools: [],
      signal: new AbortController().signal,
      options: {
        model: 'prov/claude-sonnet-4-5',
        querySource: 'test',
      } as never,
    })

    try {
      await expect(gen.next()).rejects.toThrow(
        /Provider "prov" has no API key\. Set the PROVKEY_ANT environment variable/,
      )
    } finally {
      rmSync(tmp, { recursive: true, force: true })
      delete process.env.CLAUDE_CONFIG_DIR
      if (prevNodeEnv === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = prevNodeEnv
      }
      if (prevOauthToken === undefined) {
        delete process.env.CLAUDE_CODE_OAUTH_TOKEN
      } else {
        process.env.CLAUDE_CODE_OAUTH_TOKEN = prevOauthToken
      }
      _invalidateProviderCache()
    }
  })
})
