import { existsSync, linkSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { encryptBackup, parseBackupKey } from './backup-crypto.mjs';

process.umask(0o077);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Cần cấu hình DATABASE_URL PostgreSQL trước khi sao lưu.');
  process.exit(1);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const key = process.env.OSP_BACKUP_ENCRYPTION_KEY ? parseBackupKey() : null;
const destination = resolve(process.argv[2] ?? `data/backup/osp-${timestamp}.dump${key ? '.enc' : ''}`);
const temporary = `${destination}.${process.pid}.plain.tmp`;
const encryptedTemporary = `${destination}.${process.pid}.enc.tmp`;
if (existsSync(destination)) {
  console.error(`Đích đã tồn tại, không ghi đè: ${destination}`);
  process.exit(1);
}
if (existsSync(temporary) || existsSync(encryptedTemporary)) {
  console.error('Có file tạm của lần sao lưu trước; kiểm tra và xử lý thủ công trước khi chạy lại.');
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
const entries = String(verify.stdout).split(/\r?\n/).filter((line) => line && !line.startsWith(';')).length;
if (key) {
  try {
    await encryptBackup(temporary, encryptedTemporary, key);
    linkSync(encryptedTemporary, destination);
    rmSync(encryptedTemporary);
    rmSync(temporary);
  } catch (error) {
    for (const path of [temporary, encryptedTemporary]) if (existsSync(path)) rmSync(path);
    console.error(`Không thể mã hóa bản sao lưu: ${error.message}`);
    process.exit(2);
  }
} else {
  console.warn('Cảnh báo: bản sao lưu chưa được mã hóa. Đặt OSP_BACKUP_ENCRYPTION_KEY để mã hóa AES-256-GCM.');
  linkSync(temporary, destination);
  rmSync(temporary);
}
console.log(`Đã sao lưu và xác minh PostgreSQL: ${destination}`);
if (key) console.log('  Mã hóa AES-256-GCM đã bật. Lưu khóa riêng khỏi bản sao lưu; mất khóa sẽ không thể khôi phục.');
console.log(`  ${(statSync(destination).size / 1024).toFixed(0)} KB · ${entries} mục trong archive`);
