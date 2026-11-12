import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
for (const args of [
  ['run', 'typecheck:libs'],
  ['--filter', '@workspace/voltarena', 'run', 'build'],
  ['--filter', '@workspace/api-server', 'run', 'build'],
]) {
  const run = spawnSync(pnpm, args, { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, PORT: '3000', BASE_PATH: '/' } });
  if (run.status !== 0) process.exit(run.status ?? 1);
}
