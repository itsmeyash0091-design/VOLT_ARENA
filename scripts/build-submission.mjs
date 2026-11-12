import { spawnSync } from 'node:child_process';
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
for (const args of [
  ['run', 'typecheck:libs'],
  ['--filter', '@workspace/voltarena', 'run', 'build'],
  ['--filter', '@workspace/api-server', 'run', 'build'],
]) {
  const run = spawnSync(pnpm, args, { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, PORT: '3000', BASE_PATH: '/' } });
  if (run.status !== 0) process.exit(run.status ?? 1);
}
