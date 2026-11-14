import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const release = args.includes('--release');
const moduleIndex = args.indexOf('--module');
const moduleId = moduleIndex >= 0 ? args[moduleIndex + 1] : undefined;

if (moduleIndex >= 0 && (!moduleId || !existsSync(join(root, 'definitions', 'modules', `${moduleId}.json`)))) {
  console.error(`Không tìm thấy định nghĩa module: ${moduleId ?? ''}`);
  process.exit(2);
}

const cargoArgs = ['run', '--manifest-path', join(root, 'server', 'Cargo.toml')];
if (release) cargoArgs.push('--release', '--no-default-features');
const env = {
  ...process.env,
  OSP_DEFS: join(root, 'definitions'),
  OSP_PUBLIC: join(root, 'client-dist'),
};
if (moduleId) env.OSP_MODULES = moduleId;

const child = spawn('cargo', cargoArgs, { cwd: root, env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', (error) => {
  console.error(`Không khởi động được cargo: ${error.message}`);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
