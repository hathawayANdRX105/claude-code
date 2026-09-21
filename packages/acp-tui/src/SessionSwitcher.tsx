import React from 'react';
import { Text, useInput } from 'ink';
import { SessionRegistry } from './registry.js';

/**
 * Session switcher overlay. Rendered on top of the conversation when the user
 * hits the switch key; arrow/j/k move, enter or the key again selects.
 *
 * Key handling is the only interactive part; the list itself is a pure render
 * of the registry, so correctness rests on registry transitions (tested
 * directly) plus this component's key wiring (covered by smoke).
 */
export function SessionSwitcher({
  registry,
  onSelect,
  onClose,
}: {
  registry: SessionRegistry;
  onSelect: (sessionId: string) => void;
  onClose: () => void;
}): React.ReactElement {
  const [, force] = React.useReducer(x => x + 1, 0);
  const [highlight, setHighlight] = React.useState(0);
  const sessions = registry.list();

  useInput((input, key) => {
    if (input === 'q' || input === 'escape') {
      onClose();
      return;
    }
    if (sessions.length === 0) return;
    if (key.downArrow || input === 'j') {
      setHighlight(h => Math.min(h + 1, sessions.length - 1));
    } else if (key.upArrow || input === 'k') {
      setHighlight(h => Math.max(h - 1, 0));
    } else if (key.return) {
      onSelect(sessions[highlight].sessionId);
    }
  });

  // Re-render on registry mutation so new sessions appear without props change.
  React.useEffect(() => {
    const interval = setInterval(force, 200);
    return () => clearInterval(interval);
  }, []);

  if (sessions.length === 0) {
    return <Text dimColor>No sessions yet — start one with /new</Text>;
  }

  return (
    <>
      {sessions.map((s, i) => (
        <Text key={s.sessionId} color={i === highlight ? 'cyan' : undefined} bold={s.active}>
          {i === highlight ? '▸' : ' '} {s.title || s.sessionId.slice(0, 8)} · {s.cwd}
        </Text>
      ))}
      <Text dimColor>j/k 移动 · enter 切换 · q 关闭</Text>
    </>
  );
}
