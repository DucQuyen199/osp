import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { decryptBackup, parseBackupKey } from './backup-crypto.mjs';

process.umask(0o077);

const [sourceArg, destinationArg] = process.argv.slice(2);
if (!sourceArg || !destinationArg) {
  console.error('Usage: node tools/decrypt-backup.mjs <encrypted-backup> <output.dump>');
  process.exit(2);
}

const source = resolve(sourceArg);
const destination = resolve(destinationArg);
if (!existsSync(source)) {
  console.error(`Không tìm thấy bản sao lưu: ${source}`);
  process.exit(2);
}
if (existsSync(destination)) {
  console.error(`Đích đã tồn tại, không ghi đè: ${destination}`);
  process.exit(2);
}

let key;
try {
  key = parseBackupKey();
  mkdirSync(dirname(destination), { recursive: true });
  await decryptBackup(source, destination, key);
} catch (error) {
  console.error(`Không thể giải mã bản sao lưu: ${error.message}`);
  process.exit(2);
}

const verify = spawnSync(process.env.PG_RESTORE ?? 'pg_restore', ['--list', destination], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
if (verify.error || verify.status !== 0 || !statSync(destination).size) {
  rmSync(destination, { force: true });
  console.error(`Archive đã giải mã nhưng không vượt qua pg_restore --list${verify.error ? `: ${verify.error.message}` : ''}`);
  process.exit(2);
}
const entries = String(verify.stdout).split(/\r?\n/).filter((line) => line && !line.startsWith(';')).length;
console.log(`Đã xác minh archive giải mã: ${destination}`);
console.log(`  ${(statSync(destination).size / 1024).toFixed(0)} KB · ${entries} mục trong archive`);
console.log('  Đây là file dump rõ; hãy khôi phục ngay và xóa an toàn file tạm sau đó.');
