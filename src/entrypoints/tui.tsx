import { render } from 'ink';
import { AcpClientConnection } from '@claude-code-best/acp-client';
import { AcpTuiApp, SessionRegistry } from '@claude-code-best/acp-tui';
import { enableConfigs } from '../utils/config.js';
import { applySafeConfigEnvironmentVariables } from '../utils/managedEnv.js';

/**
 * `ccb tui`: a thin multi-session client over one shared `ccb --acp` daemon.
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

  const cwd = process.cwd();
  const connection = AcpClientConnection.spawn({
    command: process.execPath,
    args: ['--acp'],
    env: {
      // An empty MCP list is required: without it the agent answers session/new
      // with -32602.
      ACP_MCP_SERVERS: '[]',
    },
  });

  await connection.waitReady();
  await connection.initialize();

  const registry = new SessionRegistry();

  const instance = render(
    <AcpTuiApp connection={connection} registry={registry} daemonPid={connection.daemonPid} cwd={cwd} />,
  );

  // Any unhandled failure in the UI layer must still tear the daemon down —
  // otherwise the shared process is orphaned holding the socket-less pipes.
  const teardown = (signal: NodeJS.Signals) => {
    connection.close();
    instance.unmount();
    process.exit(signal === 'SIGINT' ? 130 : 0);
  };
  process.on('SIGINT', teardown);
  process.on('SIGTERM', teardown);

  await new Promise(resolve => {
    process.on('exit', resolve);
  });
}
