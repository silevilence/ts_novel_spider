import path from 'node:path';

import { createServerApp } from './app';

export interface ServerListenOptions {
  port: number;
  host: string;
}

export function resolveServerListenOptions(
  env: NodeJS.ProcessEnv = process.env,
): ServerListenOptions {
  const port = Number(env.PORT ?? 3000);
  const host = env.HOST?.trim() || '0.0.0.0';

  return { port, host };
}

export function startServer(env: NodeJS.ProcessEnv = process.env) {
  const { port, host } = resolveServerListenOptions(env);
  const app = createServerApp();

  return app.listen(port, host, () => {
    console.log(`Server listening on http://${host}:${port}`);
  });
}

export function isServerEntrypointInvocation(
  entryPath = process.argv[1],
  currentFilePath = __filename,
): boolean {
  if (!entryPath) {
    return false;
  }

  return path.resolve(entryPath) === path.resolve(currentFilePath);
}

/** Emits the first fatal process-level error into the dev diagnostic wrapper. */
export function registerServerProcessDiagnostics(): void {
  process.on('uncaughtException', (error) => {
    console.error('[dev-diagnostics] Uncaught server exception:', error.stack ?? error.message);
    setImmediate(() => process.exit(1));
  });
  process.on('unhandledRejection', (reason) => {
    const detail = reason instanceof Error ? errorDetail(reason) : String(reason);
    console.error('[dev-diagnostics] Unhandled server rejection:', detail);
    setImmediate(() => process.exit(1));
  });
  process.on('exit', (code) => {
    console.info(`[dev-diagnostics] Server process exiting with code=${code}`);
  });
}

function errorDetail(error: Error): string {
  return error.stack ?? error.message;
}

if (isServerEntrypointInvocation()) {
  registerServerProcessDiagnostics();
  startServer();
}
