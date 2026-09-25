import { findProvider, loadProviders } from './loader.js'
import type { ProviderConfig } from './types.js'

export type ProviderModelRef = {
  providerId: string
  model: string
}

// A model value may carry a provider prefix, for example "wildtoken/grok-4.7".
// The provider id is everything before the FIRST slash. A model id that
// itself contains a slash keeps it, because only the first slash separates
// the provider from the model.
export function parseProviderModel(value: string): ProviderModelRef | null {
  const slash = value.indexOf('/')
  if (slash <= 0) return null
  const providerId = value.slice(0, slash)
  const model = value.slice(slash + 1)
  if (!providerId || !model) return null
  return { providerId, model }
}

// The provider a model value routes to, or undefined for a bare or built in
// model and for a prefix that names no configured provider.
export function resolveProviderForModel(
  value: string,
  providers?: ProviderConfig[],
): ProviderConfig | undefined {
  const ref = parseProviderModel(value)
  if (!ref) return undefined
  return findProvider(ref.providerId, providers ?? loadProviders())
}

// The bare model id to send on the wire. A prefixed value returns the part
// after the first slash; a bare value is returned unchanged.
export function bareModelId(value: string): string {
  const ref = parseProviderModel(value)
  return ref ? ref.model : value
}

// True when the value carries a provider prefix that resolves to a configured
// provider.
export function isProviderModelValue(value: string): boolean {
  return resolveProviderForModel(value) !== undefined
}

export type RoutedEndpoint = {
  kind: ProviderConfig['kind']
  baseUrl: string
  apiKey: string | undefined
  bareModel: string
  providerId: string
}

// Resolve the provider and endpoint a model value routes to, or null for a
// bare or built in model and for a prefix that names no configured provider.
// The API key is read from that provider's key env var.
export function routeModel(
  value: string,
  providers?: ProviderConfig[],
): RoutedEndpoint | null {
  const provider = resolveProviderForModel(value, providers)
  if (!provider) return null
  return {
    kind: provider.kind,
    baseUrl: provider.baseUrl,
    apiKey: process.env[provider.apiKeyEnv],
    bareModel: bareModelId(value),
    providerId: provider.id,
  }
}
