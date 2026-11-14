import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = {
  ...process.env,
  OSP_DEFS: join(root, 'definitions'),
  OSP_PUBLIC: join(root, 'platform', 'server', 'public'),
  OSP_PORT: process.env.OSP_PORT || '3000',
};
const server = spawn('cargo', ['run', '--manifest-path', join(root, 'server', 'Cargo.toml',), '--bin', 'osp-server'], {
  cwd: root,
  env,
  stdio: 'inherit',
});
const client = spawn('npm', ['exec', 'vite', '--', '--config', join(root, 'client', 'vite.config.js')], {
  cwd: root,
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
let stopping = false;
function stop(signal = 'SIGINT') {
  if (stopping) return;
  stopping = true;
  server.kill(signal);
  client.kill(signal);
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(signal));
server.once('error', (error) => { console.error(`Rust server failed to start: ${error.message}`); stop(); process.exitCode = 1; });
client.once('error', (error) => { console.error(`Vite failed to start: ${error.message}`); stop(); process.exitCode = 1; });
server.once('exit', (code) => { if (!stopping) { process.exitCode = code ?? 1; stop(); } });
client.once('exit', (code) => { if (!stopping) { process.exitCode = code ?? 1; stop(); } });
