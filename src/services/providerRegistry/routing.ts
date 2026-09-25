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
// model and for a prefix whose provider id is not configured.
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
