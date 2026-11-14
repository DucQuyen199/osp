import { readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const extensions = new Set(['.ts', '.tsx', '.mts', '.cts']);
const ignored = new Set(['node_modules', 'target', 'client-dist', 'dist', 'build', '.git']);
const found = [];

async function scan(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignored.has(entry.name)) await scan(path.join(directory, entry.name));
    } else if (entry.isFile() && extensions.has(path.extname(entry.name))) {
      found.push(path.join(directory, entry.name));
    }
  }
}

await scan('.');

if (found.length) {
  console.error(`TypeScript source files are not allowed:\n${found.sort().join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('TypeScript source scan: no .ts/.tsx/.mts/.cts files found.');
}
