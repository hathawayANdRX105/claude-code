import { describe, expect, test } from 'bun:test'
import {
  bareModelId,
  parseProviderModel,
  resolveProviderForModel,
} from '../routing.js'
import type { ProviderConfig } from '../types.js'

describe('parseProviderModel', () => {
  test('splits a simple prefix on the first slash', () => {
    expect(parseProviderModel('wildtoken/grok-4.7')).toEqual({
      providerId: 'wildtoken',
      model: 'grok-4.7',
    })
  })

  test('keeps internal slashes in the model id', () => {
    expect(parseProviderModel('wildtoken/deepseek/deepseek-v4-pro-0813-free')).toEqual({
      providerId: 'wildtoken',
      model: 'deepseek/deepseek-v4-pro-0813-free',
    })
  })

  test('a bare model id has no provider', () => {
    expect(parseProviderModel('grok-4.7')).toBeNull()
  })

  test('a leading slash is not a provider', () => {
    expect(parseProviderModel('/grok-4.7')).toBeNull()
  })

  test('an empty provider or model is not a reference', () => {
    expect(parseProviderModel('wildtoken/')).toBeNull()
  })
})

describe('bareModelId', () => {
  test('strips the provider prefix', () => {
    expect(bareModelId('wildtoken/grok-4.7')).toBe('grok-4.7')
    expect(bareModelId('grok-4.7')).toBe('grok-4.7')
  })
})

describe('resolveProviderForModel', () => {
  const wildtoken = {
    id: 'wildtoken',
    kind: 'openai-compat',
    baseUrl: 'http://localhost:3100/v1',
    apiKeyEnv: 'WILDTOKEN_API_KEY',
    defaultModel: 'grok-4.7',
    compatRule: 'permissive',
  } as unknown as ProviderConfig

  test('finds a configured provider by its prefix', () => {
    expect(resolveProviderForModel('wildtoken/grok-4.7', [wildtoken])?.id).toBe(
      'wildtoken',
    )
  })

  test('an unknown prefix resolves to undefined', () => {
    expect(resolveProviderForModel('other/x', [wildtoken])).toBeUndefined()
  })

  test('a bare model has no provider', () => {
    expect(resolveProviderForModel('grok-4.7', [wildtoken])).toBeUndefined()
  })
})
