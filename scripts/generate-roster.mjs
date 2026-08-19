#!/usr/bin/env node
/**
 * Emit `dist/roster.data.js` from `monitors.json`.
 *
 * Serverless functions cannot read the roster off disk: a bundler has no way to
 * see through `readFile(cwd + '/monitors.json')`, so the file never makes it into
 * the deployment. Baking it into a real module at build time means the import is
 * statically visible and the roster ships with the function.
 *
 * Runs as part of `npm run build`.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'monitors.json');
const target = path.join(root, 'dist', 'roster.data.js');

let roster;
try {
  roster = JSON.parse(await readFile(source, 'utf8'));
} catch (err) {
  if (err.code === 'ENOENT') {
    console.warn(`generate-roster: no monitors.json found, emitting an empty roster`);
    roster = { targets: [] };
  } else {
    console.error(`generate-roster: ${source} is not valid JSON — ${err.message}`);
    process.exit(1);
  }
}

if (!Array.isArray(roster.targets)) {
  console.error('generate-roster: monitors.json must define a "targets" array');
  process.exit(1);
}

await mkdir(path.dirname(target), { recursive: true });
await writeFile(
  target,
  `// Generated from monitors.json by scripts/generate-roster.mjs — do not edit.\n` +
    `export const ROSTER = ${JSON.stringify(roster, null, 2)};\n`,
  'utf8',
);

console.log(`generate-roster: ${roster.targets.length} target(s) → dist/roster.data.js`);
