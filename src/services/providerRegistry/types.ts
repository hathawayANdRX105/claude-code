import { z } from 'zod'

/**
 * Compat rule identifiers. Each maps to a CompatProfile in providerCompatMatrix.ts.
 */
export const CompatRuleSchema = z.enum([
  'cerebras',
  'groq',
  'deepseek',
  'strict-openai',
  'permissive',
])

export type CompatRule = z.infer<typeof CompatRuleSchema>

/**
 * The provider wire protocol.
 * - 'openai-compat': OpenAI Chat Completions; routed through the
 *   OpenAI-compatible layer with a per-provider compat profile.
 * - 'anthropic': Anthropic Messages API (relay/proxy serving /v1/messages);
 *   routed through the native Anthropic path against the provider's
 *   baseUrl with that provider's key.
 */
export const ProviderKindSchema = z.enum(['openai-compat', 'anthropic'])
export type ProviderKind = z.infer<typeof ProviderKindSchema>

/**
 * Zod schema for a single provider configuration entry.
 *
 * Rules:
 * - id: kebab-case identifier used in /provider use <id>
 * - kind: wire protocol — 'openai-compat' or 'anthropic'
 * - baseUrl: full base URL including /v1 suffix if needed
 * - apiKeyEnv: name of the env var that holds the API key
 * - defaultModel: model string passed as OPENAI_MODEL or ANTHROPIC_MODEL,
 *   depending on kind
 * - compatRule: selects CompatProfile from providerCompatMatrix; ignored
 *   for kind 'anthropic' (the native Anthropic wire has no compat profile)
 */
export const ProviderModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  contextWindow: z.number().int().positive().optional(),
})

export type ProviderModel = z.infer<typeof ProviderModelSchema>

export const ProviderConfigSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, 'id must be kebab-case'),
  kind: ProviderKindSchema,
  baseUrl: z.string().url(),
  apiKeyEnv: z.string().min(1),
  defaultModel: z.string().min(1),
  compatRule: CompatRuleSchema,
  models: z.array(ProviderModelSchema).optional(),
  fastModel: z.string().min(1).optional(),
})

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>

/**
 * Schema for the entire ~/.claude/providers.json file.
 * Top-level must be an array of ProviderConfig.
 */
export const ProvidersFileSchema = z.array(ProviderConfigSchema)
