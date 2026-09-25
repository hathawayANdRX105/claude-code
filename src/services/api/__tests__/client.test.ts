/**
 * g1: getAnthropicClient({baseURL}) must point the Anthropic SDK at the
 * provider's endpoint (spec 0003 follow-up) — the wire-protocol contract that
 * the live smoke otherwise only covers manually.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
// ponytail: MACRO is a compile-time define (dev/build only); getAnthropicClient
// reaches getUserAgent, so raw `bun test` needs a version shim.
;(globalThis as Record<string, unknown>).MACRO ??= { VERSION: '0.0.0-test' }

type ClientShape = { baseURL?: string }

beforeEach(() => {
  // The CI/test credential canary (getAnthropicApiKeyWithSource) fails fast
  // when no credentials are declared; a dummy OAuth token satisfies it
  // without making the session a subscriber (no scopes, not managed).
  process.env.CLAUDE_CODE_OAUTH_TOKEN = 'dummy-token-for-test'
})

afterEach(() => {
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN
  delete process.env.ANTHROPIC_BASE_URL
})

describe('getAnthropicClient — provider baseURL override', () => {
  test('explicit baseURL beats ANTHROPIC_BASE_URL env', async () => {
    process.env.ANTHROPIC_BASE_URL = 'https://env.example.com'
    const { getAnthropicClient } = await import('../client.js')
    const client = (await getAnthropicClient({
      maxRetries: 0,
      apiKey: 'provider-key',
      baseURL: 'https://relay.example.com',
    })) as unknown as ClientShape
    expect(client.baseURL).toBe('https://relay.example.com')
  })

  test('without the param the SDK keeps its env default', async () => {
    process.env.ANTHROPIC_BASE_URL = 'https://env.example.com'
    const { getAnthropicClient } = await import('../client.js')
    const client = (await getAnthropicClient({
      maxRetries: 0,
      apiKey: 'provider-key',
    })) as unknown as ClientShape
    expect(client.baseURL).toBe('https://env.example.com')
  })
})
