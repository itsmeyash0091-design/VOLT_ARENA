import { spawnSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const python = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
const check = spawnSync(python, ['-c', 'import sys,numpy,pandas,yfinance,cvxpy; assert sys.version_info >= (3,13), "Python 3.13+ required"; print(sys.executable)'], { encoding: 'utf8' });
if (check.status !== 0) {
  console.error('Python setup is incomplete. Install Python 3.13+, then run: python -m pip install -r requirements.txt\nOn Linux/macOS use python3. Set PYTHON_BIN to the Python executable if needed.\n', check.stderr || check.error?.message);
  process.exit(1);
}
for (const file of ['artifacts/api-server/dist/index.mjs', 'artifacts/voltarena/dist/public/index.html', 'artifacts/api-server/python/data/demo-market/manifest.json']) {
  if (!existsSync(file)) { console.error(`Missing ${file}. Read SUBMISSION.md and run the release build.`); process.exit(1); }
}
const port = process.env.PORT || '3000';
console.log(`VoltArena college demo: http://localhost:${port}\nKeep this terminal open. Open that URL, not the HTML file. Demo prices are dated snapshots, not live.`);
const child = spawn(process.execPath, ['--enable-source-maps', 'artifacts/api-server/dist/index.mjs'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, PORT: port, NODE_ENV: 'production', PYTHON_BIN: check.stdout.trim() },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 1));
child.on('error', (error) => { console.error(error.message); process.exit(1); });
