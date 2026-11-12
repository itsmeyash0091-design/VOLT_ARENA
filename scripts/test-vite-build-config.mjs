import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const require = createRequire(new URL('../artifacts/voltarena/package.json', import.meta.url));
const { loadConfigFromFile } = await import(pathToFileURL(require.resolve('vite')).href);

async function loadConfig(folder, command, overrides = {}) {
  const keys = ['PORT', 'BASE_PATH', 'NODE_ENV'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    delete process.env.PORT;
    delete process.env.BASE_PATH;
    process.env.NODE_ENV = 'production';
    Object.assign(process.env, overrides);
    const configPath = fileURLToPath(new URL(`../artifacts/${folder}/vite.config.ts`, import.meta.url));
    const loaded = await loadConfigFromFile({ command, mode: 'production' }, configPath);
    assert.ok(loaded, 'Vite config must load');
    return loaded.config;
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

for (const [folder, defaultPort] of [['voltarena', 5173], ['mockup-sandbox', 5174]]) {
  await test(`${folder}: build and local dev need no injected environment`, async () => {
    for (const command of ['build', 'serve']) {
      const config = await loadConfig(folder, command);
      assert.equal(config.base, '/');
      assert.equal(config.server.port, defaultPort);
      assert.equal(config.preview.port, defaultPort);
    }
  });

  await test(`${folder}: managed port and base path are preserved`, async () => {
    const config = await loadConfig(folder, 'serve', { PORT: '32123', BASE_PATH: '/component-preview/' });
    assert.equal(config.server.port, 32123);
    assert.equal(config.base, '/component-preview/');
  });

  await test(`${folder}: invalid explicit ports fail clearly`, async () => {
    for (const PORT of ['nope', '0', '-1', '65536', '1.5']) {
      await assert.rejects(() => loadConfig(folder, 'serve', { PORT }), /Invalid PORT value/);
    }
  });
}
