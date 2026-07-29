import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const scriptName = process.argv[2];

if (!scriptName) {
  throw new Error('Usage: node scripts/dev/diagnostic-command.mjs <npm-script-name>');
}
if (!/^[a-z][a-z0-9:_-]*$/iu.test(scriptName)) {
  throw new Error(`Invalid npm script name: ${scriptName}`);
}

const logDirectory = path.resolve('.data', 'dev-logs');
const logFile = path.join(logDirectory, `${scriptName.replace(/[^a-z0-9_-]/giu, '-')}.log`);
mkdirSync(logDirectory, { recursive: true });

function record(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  appendFileSync(logFile, line, 'utf8');
}

function forward(chunk, stream) {
  const text = chunk.toString();
  stream.write(text);
  appendFileSync(logFile, text, 'utf8');
}

record(`diagnostic wrapper started; script=${scriptName}; node=${process.version}; platform=${process.platform}; pid=${process.pid}`);
const windows = process.platform === 'win32';
const child = spawn(
  windows ? (process.env.ComSpec ?? 'cmd.exe') : 'npm',
  windows ? ['/d', '/s', '/c', `npm run ${scriptName}`] : ['run', scriptName],
  { stdio: ['inherit', 'pipe', 'pipe'] },
);

child.stdout.on('data', (chunk) => forward(chunk, process.stdout));
child.stderr.on('data', (chunk) => forward(chunk, process.stderr));
child.on('error', (error) => {
  record(`child spawn error: ${error.stack ?? error.message}`);
  process.exitCode = 1;
});
child.on('close', (code, signal) => {
  record(`child closed; exitCode=${code ?? 'null'}; signal=${signal ?? 'none'}`);
  process.exit(code ?? 1);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    record(`wrapper received ${signal}; forwarding to child pid=${child.pid ?? 'unknown'}`);
    child.kill(signal);
  });
}
