import * as React from 'react';
import { Text } from 'ink';
import { formatMb, ownRss, processRss } from './memory.js';

/**
 * The two-part memory readout that makes the shared-process win visible.
 *
 * `daemon` is the ccb --acp child carrying every session; `tui` is this thin
 * client. Before the split these were one 208MB process per session — here the
 * daemon total is divided across all live sessions, which is the number that
 * justifies the architecture.
 */
export function MemoryStatusBar({
  daemonPid,
  sessionCount,
}: {
  daemonPid: number | null;
  sessionCount: number;
}): React.ReactElement {
  // Re-read both each render; the parent polls on an interval and re-renders.
  const daemonRss = processRss(daemonPid);
  const tuiRss = ownRss();

  const perSession = daemonRss !== null && sessionCount > 0 ? daemonRss / sessionCount : null;

  return (
    <Text dimColor>
      ⚡ daemon {daemonRss === null ? '—' : formatMb(daemonRss)}
      {perSession !== null ? ` · ${sessionCount} sess (${formatMb(perSession)}/sess)` : ` · ${sessionCount} sess`}
      {' · '}
      tui {formatMb(tuiRss)}
    </Text>
  );
}
