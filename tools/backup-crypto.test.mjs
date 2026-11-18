import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { decryptBackup, encryptBackup, parseBackupKey } from './backup-crypto.mjs';

test('AES-GCM backup round trip preserves a PostgreSQL archive stream', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'osp-backup-crypto-'));
  try {
    const source = join(directory, 'source.dump');
    const encrypted = join(directory, 'source.dump.enc');
    const restored = join(directory, 'restored.dump');
    const contents = Buffer.concat([Buffer.from('PGDMP'), randomBytes(1024 * 32)]);
    await writeFile(source, contents);
    const key = randomBytes(32);
    await encryptBackup(source, encrypted, key);
    const originalArchive = await readFile(encrypted);
    await assert.rejects(encryptBackup(source, encrypted, key));
    assert.deepEqual(await readFile(encrypted), originalArchive);
    await decryptBackup(encrypted, restored, key);
    assert.deepEqual(await readFile(restored), contents);
    await assert.rejects(decryptBackup(encrypted, restored, key));
    assert.deepEqual(await readFile(restored), contents);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('AES-GCM rejects modified ciphertext and incorrect keys', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'osp-backup-tamper-'));
  try {
    const source = join(directory, 'source.dump');
    const encrypted = join(directory, 'source.dump.enc');
    const modified = join(directory, 'modified.dump.enc');
    const output = join(directory, 'restored.dump');
    await writeFile(source, Buffer.concat([Buffer.from('PGDMP'), randomBytes(128)]));
    const key = randomBytes(32);
    await encryptBackup(source, encrypted, key);
    const bytes = await readFile(encrypted);
    bytes[bytes.length - 1] ^= 1;
    await writeFile(modified, bytes);
    await assert.rejects(decryptBackup(modified, output, key));
    await assert.rejects(decryptBackup(encrypted, output, randomBytes(32)));
    assert.throws(() => parseBackupKey('not-a-key'), /32-byte key/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
