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

if (isServerEntrypointInvocation()) {
  startServer();
}