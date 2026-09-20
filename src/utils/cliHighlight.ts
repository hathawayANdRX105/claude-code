// highlight.js's type defs carry `/// <reference lib="dom" />`. SSETransport,
// mcp/client, ssh, dumpPrompts use DOM types (TextDecodeOptions, RequestInfo)
// that only typecheck because the hljs import below pulls lib.dom in.
// tsconfig has lib: ["ESNext"] only — this ref preserves the status quo.
/// <reference lib="dom" />

import { extname } from 'path'

export type CliHighlight = {
  highlight: typeof import('cli-highlight').highlight
  supportsLanguage: typeof import('cli-highlight').supportsLanguage
}

// One promise shared by Fallback.tsx, markdown.ts, events.ts, getLanguageName.
let cliHighlightPromise: Promise<CliHighlight | null> | undefined

let loadedGetLanguage:
  | ((name: string) => { name?: string } | undefined)
  | undefined

async function loadCliHighlight(): Promise<CliHighlight | null> {
  try {
    const [cliHighlight, hljsMod] = await Promise.all([
      import('cli-highlight'),
      // Dynamic: resolves under Bun --compile (bytecode+esm, oven-sh/bun#26402);
      // import.meta.require does NOT (bunfs path has no node_modules).
      import('highlight.js'),
    ])
    // highlight.js CJS interop: `export =` wraps in .default under ESM
    const hljs = hljsMod as {
      getLanguage?: typeof loadedGetLanguage
      default?: { getLanguage?: typeof loadedGetLanguage }
    }
    loadedGetLanguage = hljs.getLanguage ?? hljs.default?.getLanguage
    return {
      highlight: cliHighlight.highlight,
      supportsLanguage: cliHighlight.supportsLanguage,
    }
  } catch {
    return null
  }
}

export function getCliHighlightPromise(): Promise<CliHighlight | null> {
  cliHighlightPromise ??= loadCliHighlight()
  return cliHighlightPromise
}

/**
 * eg. "foo/bar.ts" → "TypeScript". Awaits the shared cli-highlight load,
 * then reads highlight.js's language registry. All callers are telemetry
 * (OTel counter attributes, permission-dialog unary events) — none block
 * on this, they fire-and-forget or the consumer already handles Promise<string>.
 */
export async function getLanguageName(file_path: string): Promise<string> {
  await getCliHighlightPromise()
  const ext = extname(file_path).slice(1)
  if (!ext) return 'unknown'
  return loadedGetLanguage?.(ext)?.name ?? 'unknown'
}
