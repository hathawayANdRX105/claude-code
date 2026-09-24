import { QueryEngine } from '../QueryEngine.js'
import { getDefaultAppState, type AppState } from '../state/AppStateStore.js'
import { getCommands } from '../commands.js'
import { getTools } from '../tools.js'
import { getEmptyToolPermissionContext } from '../Tool.js'
import { FileStateCache } from '../utils/fileStateCache.js'
import { getAssistantMessageText } from '../utils/messages.js'
import type { Message } from '../types/message.js'
import { setSharedTurnRunner } from './sharedSession.js'

const engines = new Map<string, QueryEngine>()

export function installSharedTurnRunner(): void {
  setSharedTurnRunner(async ({ sessionId, cwd, input, signal, onChunk }) => {
    if (signal.aborted) throw new Error('aborted')
    let engine = engines.get(sessionId)
    if (!engine) {
      const appState: AppState = getDefaultAppState()
      const permissionContext = getEmptyToolPermissionContext()
      engine = new QueryEngine({
        cwd,
        tools: getTools(permissionContext),
        commands: await getCommands(cwd),
        mcpClients: [],
        agents: [],
        canUseTool: async () => ({ behavior: 'allow' as const }),
        getAppState: () => appState,
        setAppState: updater => Object.assign(appState, updater(appState)),
        readFileCache: new FileStateCache(100, 10 * 1024 * 1024),
        abortController: new AbortController(),
      })
      engines.set(sessionId, engine)
    }
    signal.addEventListener('abort', () => engine?.interrupt(), { once: true })
    let text = ''
    for await (const event of engine.submitMessage(input)) {
      if (signal.aborted) throw new Error('aborted')
      if (event.type !== 'assistant') continue
      const next = getAssistantMessageText(event as Message) ?? ''
      if (!next.startsWith(text)) continue
      const chunk = next.slice(text.length)
      text = next
      if (chunk) onChunk(chunk)
    }
    return text
  })
}

export function releaseSharedTurn(sessionId: string): void {
  const engine = engines.get(sessionId)
  engine?.interrupt()
  engine?.resetAbortController()
  engines.delete(sessionId)
}
export function resetSharedTurnEngines(): void {
  engines.clear()
}
