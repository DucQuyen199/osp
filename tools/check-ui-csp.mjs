import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root = join(import.meta.dirname, '..', 'client', 'src');
const violations = [];

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await visit(path);
    } else if (entry.isFile() && entry.name.endsWith('.jsx')) {
      const source = await readFile(path, 'utf8');
      const pattern = /(?<![\w-])style\s*=/g;
      let match;
      while ((match = pattern.exec(source))) {
        const line = source.slice(0, match.index).split('\n').length;
        violations.push(`${relative(join(root, '..', '..'), path)}:${line}`);
      }
    }
  }
}

await visit(root);
if (violations.length) {
  console.error(`React style props violate the strict style-src policy:\n${violations.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('No inline style props found in client/src.');
}
