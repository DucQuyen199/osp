import { cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'platform', 'server', 'public', 'app');
const target = join(root, 'client', 'public', 'app');
await mkdir(target, { recursive: true });
try {
  await access(join(source, 'styles'));
  await access(join(source, 'favicon.svg'));
  await cp(join(source, 'styles'), join(target, 'styles'), { recursive: true, force: true });
  await cp(join(source, 'favicon.svg'), join(target, 'favicon.svg'), { force: true });
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  await access(join(target, 'styles'));
  await access(join(target, 'favicon.svg'));
}
