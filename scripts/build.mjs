import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
import { validate } from './validate.mjs';

const root = new URL('../', import.meta.url);
const manifest = await validate();
await rm(new URL('dist/', root), { recursive: true, force: true });
await cp(new URL('src/', root), new URL('dist/', root), { recursive: true });
await mkdir(new URL('artifacts/', root), { recursive: true });
const files = {};
for (const name of (await readdir(new URL('dist/', root))).sort()) {
  files[name] = await readFile(new URL(`dist/${name}`, root));
}
const artifact = `artifacts/rezka-fullwindow-${manifest.version}.zip`;
await writeFile(new URL(artifact, root), zipSync(files, {
  level: 9,
  mtime: new Date(1980, 0, 1),
}));
console.log(`Built dist/ and ${artifact}`);
