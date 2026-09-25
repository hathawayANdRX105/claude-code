import { loadProviders } from './loader.js'
import type { ProviderModel } from './types.js'

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '').replace(/\/v1$/, '')
}

// Match the running session to a providers.json entry by base URL.
// A listed `models` array replaces the built-in Opus/Sonnet/Haiku picker.
export function activeProviderModels(): ProviderModel[] | undefined {
  const base =
    process.env.OPENAI_BASE_URL || process.env.ANTHROPIC_BASE_URL || ''
  if (!base) return undefined
  const needle = normalizeBaseUrl(base)
  try {
    const hit = loadProviders().find(
      provider =>
        provider.models &&
        provider.models.length > 0 &&
        normalizeBaseUrl(provider.baseUrl) === needle,
    )
    return hit?.models
  } catch {
    return undefined
  }
}

export function providerContextWindow(model: string): number | undefined {
  const window = activeProviderModels()?.find(
    item => item.id === model,
  )?.contextWindow
  return window && window > 0 ? window : undefined
}
