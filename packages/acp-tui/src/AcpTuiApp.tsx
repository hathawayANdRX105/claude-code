import * as React from 'react';
import { Box, Text, useInput } from 'ink';
import type { AcpClientConnection } from '@claude-code-best/acp-client';
import { SessionRegistry, type ManagedSession } from './registry.js';
import { drainSession } from './drainSession.js';
import { MemoryStatusBar } from './MemoryStatusBar.js';
import { SessionSwitcher } from './SessionSwitcher.js';

/**
 * Root of the multi-session TUI. Owns no daemon state: the connection and
 * registry are handed in, this component only renders and forwards input.
 */
export function AcpTuiApp({
  connection,
  registry,
  daemonPid,
  cwd,
}: {
  connection: AcpClientConnection;
  registry: SessionRegistry;
  daemonPid: number | null;
  cwd: string;
}): React.ReactElement {
  const [, force] = React.useReducer(x => x + 1, 0);
  const [input, setInput] = React.useState('');
  const [showSwitcher, setShowSwitcher] = React.useState(false);
  // useInput's handler is registered once and would otherwise close over the
  // input value from that first render; the ref keeps the latest draft alive.
  const inputRef = React.useRef(input);
  inputRef.current = input;

  React.useEffect(() => registry.subscribe(force), [registry]);
  // Refresh the memory readout on a cadence; it is the whole point of this UI.
  React.useEffect(() => {
    const id = setInterval(force, 2000);
    return () => clearInterval(id);
  }, []);

  const current = registry.current;

  useInput(
    (ch, key) => {
      // ink hands a whole pasted chunk as one `ch`, so "/new<Enter>" arrives as
      // a single event with key.return === false. Per-character replay would
      // race the async setInput updates, so handle the text as one edit and
      // treat a trailing Enter as the submit trigger.
      const endsWithEnter = ch.endsWith('\r') || ch.endsWith('\n');
      const text = endsWithEnter ? ch.slice(0, -1) : ch;
      if (key.return || ch === '\r') {
        void submit(inputRef.current);
        setInput('');
        return;
      }
      if (endsWithEnter) {
        void submit((inputRef.current + text).trim());
        setInput('');
        return;
      }
      handleChar(ch, key);
    },
    { isActive: !showSwitcher },
  );

  function handleChar(
    ch: string,
    key: { return?: boolean; backspace?: boolean; delete?: boolean; ctrl?: boolean; meta?: boolean },
  ): void {
    if (key.backspace || key.delete) {
      setInput(s => s.slice(0, -1));
      return;
    }
    // ctrl+t toggles the switcher; plain ctrl/meta chords are not text.
    if (key.ctrl && ch === 't') {
      setShowSwitcher(s => !s);
      return;
    }
    if (key.ctrl || key.meta) return;
    if (ch && ch !== '\r' && ch !== '\n') setInput(s => s + ch);
  }

  async function submit(text: string): Promise<void> {
    const trimmed = text.trim();
    if (trimmed === '') return;
    if (trimmed === '/new') {
      await createSession(cwd);
      return;
    }
    const session = registry.current?.session;
    if (!session) return;
    // Echo the user's line so the transcript reads as a conversation.
    registry.appendLine(session.sessionId, { text: `▸ ${trimmed}` });
    await session.prompt(trimmed).catch(err => {
      registry.appendLine(session.sessionId, {
        text: `✗ ${err instanceof Error ? err.message : String(err)}`,
      });
    });
  }

  async function createSession(dir: string): Promise<void> {
    const session = await connection.withContext(async ctx => ctx.buildSession(dir).start());
    const managed: ManagedSession = {
      sessionId: session.sessionId,
      cwd: dir,
      title: dir,
      active: false,
      lines: [],
      session,
    };
    registry.upsert(managed);
    void drainSession(session, registry);
  }

  return (
    <Box flexDirection="column" height="100%">
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {current === null ? (
          <Text dimColor>No session yet — type /new to start one</Text>
        ) : (
          current.lines.map((line, i) => (
            <Text key={i} wrap="wrap" dimColor={line.dim}>
              {line.text}
            </Text>
          ))
        )}
      </Box>
      {showSwitcher ? (
        <SessionSwitcher
          registry={registry}
          onSelect={id => {
            registry.focus(id);
            setShowSwitcher(false);
          }}
          onClose={() => setShowSwitcher(false)}
        />
      ) : null}
      <MemoryStatusBar daemonPid={daemonPid} sessionCount={registry.count} />
      <Box>
        <Text color="cyan">❯ </Text>
        <Text>{input}</Text>
        <Text dimColor> {showSwitcher ? '' : '· /new 建会话 · ctrl+t 切换'}</Text>
      </Box>
    </Box>
  );
}
