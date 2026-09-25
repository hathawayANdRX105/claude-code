import { render } from 'ink';
import { AcpClientConnection, AcpConnectionError } from '@claude-code-best/acp-client';
import { AcpTuiApp, SessionRegistry } from '@claude-code-best/acp-tui';
import { enableConfigs } from '../utils/config.js';
import { applySafeConfigEnvironmentVariables } from '../utils/managedEnv.js';

/**
 * `ccb client`: a thin multi-session client over one shared `ccb --acp` daemon.
 *
 * Every session lives in the single spawned daemon process; this process only
 * renders and forwards input — the split is what turns N×208MB into one
 * process. The status bar shows both halves so the win is observable.
 */
export async function runTui(): Promise<void> {
  enableConfigs();
  // Pull ANTHROPIC_BASE_URL / auth token from settings into env so the daemon
  // child can authenticate — same reason runAcpAgent does this.
  applySafeConfigEnvironmentVariables();

  // process.execPath is this very binary in a --compile bundle; CCB_BIN lets
  // a dev shell point at an installed ccb to act as the daemon.
  const spawnChild = () =>
    AcpClientConnection.spawn({
      command: process.env.CCB_BIN ?? process.execPath,
      args: ['--acp'],
      env: {
        // An empty MCP list is required: without it the agent answers
        // session/new with -32602.
        ACP_MCP_SERVERS: '[]',
      },
    });

  // A TTY that reports a zero size (bun's -e entrypoint, some containers) makes
  // ink measure a zero-width terminal and emit an empty frame, so the whole UI
  // renders as a blank screen. Fall back to a usable size before ink reads it.
  const stdout = process.stdout as typeof process.stdout & {
    columns?: number;
    rows?: number;
  };
  if (stdout.isTTY && (!stdout.columns || !stdout.rows)) {
    stdout.columns = stdout.columns || 80;
    stdout.rows = stdout.rows || 24;
  }

  const cwd = process.cwd();
  // Attach to the shared daemon so N terminals share one agent process
  // (spec 0002). CCB_TUI_SPAWN=1 forces the legacy per-window spawn, which
  // is also the fallback when the daemon cannot be reached.
  let connection: AcpClientConnection;
  let daemonPid: number | null = null;
  let socket: import('net').Socket | null = null;
  if (!process.env.CCB_TUI_SPAWN) {
    try {
      const shared = await import('../daemon/sharedClient.js');
      const address = process.env.CLAUDE_SHARED_SOCKET ?? shared.defaultSharedAddress();
      await shared.ensureSharedDaemon(address);
      socket = await shared.connectShared(address);
      daemonPid = await shared.readSharedLockPid(address);
      connection = AcpClientConnection.connect(socket, socket);
      // A dead daemon must surface as a crash instead of a silent hang —
      // spawn() gets this from child.on('exit'), a socket needs it wired.
      const sock = socket;
      sock.once('close', () => {
        if (!connection.isClosed()) {
          connection.markCrashed(new AcpConnectionError('shared daemon socket closed'));
        }
      });
    } catch {
      socket?.destroy();
      socket = null;
      connection = spawnChild();
    }
  } else {
    connection = spawnChild();
  }
  daemonPid ??= connection.daemonPid;

  await connection.waitReady();
  await connection.initialize();

  const registry = new SessionRegistry();

  const instance = render(<AcpTuiApp connection={connection} registry={registry} daemonPid={daemonPid} cwd={cwd} />);

  // Any unhandled failure in the UI layer must still tear the connection
  // down — the daemon itself keeps running for other terminals.
  const teardown = (signal: NodeJS.Signals) => {
    connection.close();
    socket?.destroy();
    instance.unmount();
    process.exit(signal === 'SIGINT' ? 130 : 0);
  };
  process.on('SIGINT', teardown);
  process.on('SIGTERM', teardown);

  await new Promise<void>(resolve => {
    process.on('exit', () => resolve());
  });
}
