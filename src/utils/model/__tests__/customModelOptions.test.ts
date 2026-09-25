import { afterEach, describe, expect, test } from 'bun:test'
import { getModelOptions } from '../modelOptions.js'
import { validateModel } from '../validateModel.js'

const KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_CUSTOM_MODEL_OPTIONS',
  'ANTHROPIC_CUSTOM_MODEL_OPTION',
  'ANTHROPIC_CUSTOM_MODEL_OPTION_NAME',
] as const

afterEach(() => {
  for (const key of KEYS) delete process.env[key]
})

describe('custom model options', () => {
  test('comma list becomes picker entries', () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    process.env.ANTHROPIC_CUSTOM_MODEL_OPTIONS = 'gpt-5.6-sol, agnes-3.0-flash'
    const values = getModelOptions().map(option => option.value)
    expect(values).toContain('gpt-5.6-sol')
    expect(values).toContain('agnes-3.0-flash')
  })

  test('singular option still uses the display name', () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    process.env.ANTHROPIC_CUSTOM_MODEL_OPTION = 'only-one'
    process.env.ANTHROPIC_CUSTOM_MODEL_OPTION_NAME = 'Only One'
    const option = getModelOptions().find(item => item.value === 'only-one')
    expect(option?.label).toBe('Only One')
  })

  test('listed models skip the live probe', async () => {
    process.env.ANTHROPIC_CUSTOM_MODEL_OPTIONS = 'space-bunny-free'
    expect(await validateModel('space-bunny-free')).toEqual({ valid: true })
  })
})
