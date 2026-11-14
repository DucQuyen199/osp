import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Cần cấu hình DATABASE_URL PostgreSQL trước khi sao lưu.');
  process.exit(1);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const destination = resolve(process.argv[2] ?? `data/backup/osp-${timestamp}.dump`);
const temporary = `${destination}.${process.pid}.tmp`;
if (existsSync(destination)) {
  console.error(`Đích đã tồn tại, không ghi đè: ${destination}`);
  process.exit(1);
}
mkdirSync(dirname(destination), { recursive: true });

const dump = spawnSync(process.env.PG_DUMP ?? 'pg_dump', [
  '--format=custom',
  '--no-owner',
  '--no-privileges',
  '--file', temporary,
  databaseUrl,
], { stdio: 'inherit' });
if (dump.error || dump.status !== 0) {
  if (existsSync(temporary)) rmSync(temporary);
  console.error(`pg_dump thất bại${dump.error ? `: ${dump.error.message}` : ''}`);
  process.exit(dump.status || 1);
}

const verify = spawnSync(process.env.PG_RESTORE ?? 'pg_restore', ['--list', temporary], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
if (verify.error || verify.status !== 0 || !statSync(temporary).size) {
  if (existsSync(temporary)) rmSync(temporary);
  console.error(`Không xác minh được bản dump${verify.error ? `: ${verify.error.message}` : ''}`);
  process.exit(2);
}
renameSync(temporary, destination);
const entries = String(verify.stdout).split(/\r?\n/).filter((line) => line && !line.startsWith(';')).length;
console.log(`Đã sao lưu và xác minh PostgreSQL: ${destination}`);
console.log(`  ${(statSync(destination).size / 1024).toFixed(0)} KB · ${entries} mục trong archive`);
