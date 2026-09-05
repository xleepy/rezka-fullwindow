import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

export async function validate() {
  const manifest = JSON.parse(await readFile(new URL('../src/manifest.json', import.meta.url)));
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, pkg.version, 'Manifest and package versions must match');
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting']);
  assert.deepEqual(manifest.content_scripts[0].matches, ['*://*.rezka.ag/*']);
  for (const file of [manifest.background.service_worker, ...manifest.content_scripts.flatMap(s => s.js)]) {
    await access(new URL(`../src/${file}`, import.meta.url));
  }
  return manifest;
}

await validate();
