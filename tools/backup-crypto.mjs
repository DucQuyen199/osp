import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, link, open, rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

const MAGIC = Buffer.from('OSPENC01');
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + IV_BYTES;

export function parseBackupKey(value = process.env.OSP_BACKUP_ENCRYPTION_KEY) {
  if (!value || !/^(?:[0-9a-fA-F]{64}|[A-Za-z0-9+/]{43}=)$/.test(value)) {
    throw new Error('OSP_BACKUP_ENCRYPTION_KEY must be a 32-byte key encoded as 64 hex characters or base64.');
  }
  const key = Buffer.from(value, value.length === 64 ? 'hex' : 'base64');
  if (key.length !== 32) throw new Error('OSP_BACKUP_ENCRYPTION_KEY must decode to exactly 32 bytes.');
  return key;
}

export async function encryptBackup(input, output, key) {
  const iv = randomBytes(IV_BYTES);
  let outputCreated = false;
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const destinationHandle = await open(output, 'wx', 0o600);
    outputCreated = true;
    const destination = destinationHandle.createWriteStream();
    const header = Buffer.concat([MAGIC, iv]);
    await new Promise((resolve, reject) => destination.write(header, (error) => error ? reject(error) : resolve()));
    await pipeline(createReadStream(input), cipher, destination);
    await appendFile(output, cipher.getAuthTag());
  } catch (error) {
    if (outputCreated) await rm(output, { force: true });
    throw error;
  }
}

export async function decryptBackup(input, output, key) {
  const file = await open(input, 'r');
  const temporary = `${output}.${process.pid}.${randomBytes(6).toString('hex')}.plain`;
  try {
    const size = (await file.stat()).size;
    if (size <= HEADER_BYTES + TAG_BYTES) throw new Error('Encrypted backup is truncated.');
    const header = Buffer.alloc(HEADER_BYTES);
    const headRead = await file.read(header, 0, header.length, 0);
    if (headRead.bytesRead !== header.length || !header.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error('Encrypted backup has an unsupported format.');
    }
    const tag = Buffer.alloc(TAG_BYTES);
    const tagRead = await file.read(tag, 0, tag.length, size - TAG_BYTES);
    if (tagRead.bytesRead !== TAG_BYTES) throw new Error('Encrypted backup is truncated.');
    const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(MAGIC.length));
    decipher.setAuthTag(tag);
    await file.close();
    await pipeline(
      createReadStream(input, { start: HEADER_BYTES, end: size - TAG_BYTES - 1 }),
      decipher,
      createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
    );
    await link(temporary, output);
    await rm(temporary);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  } finally {
    await file.close().catch(() => {});
  }
}
