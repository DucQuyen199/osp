// Isolated Linux deployment rehearsal; never reads the project's .env or uses
// existing Compose resources. All credentials and volumes belong to this run.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const project = `osp-verify-${process.pid}-${randomBytes(4).toString('hex')}`;
const temporary = mkdtempSync(join(tmpdir(), `${project}-`));
const file = join(temporary, 'compose.json');
const image = process.env.OSP_VERIFY_IMAGE || 'osp-suite:rust-web-verification';
const password = randomBytes(32).toString('hex');
const environment = { ...process.env };
for (const name of ['COMPOSE_FILE', 'COMPOSE_PROJECT_NAME', 'COMPOSE_PROFILES', 'COMPOSE_ENV_FILES']) delete environment[name];

function docker(args, { input, binary = false } = {}) {
  const result = spawnSync('docker', args, {
    cwd: root, env: environment, input, encoding: binary ? undefined : 'utf8',
    maxBuffer: 30 * 1024 * 1024, windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    // Docker/Compose errors can include environment values; keep test secrets
    // out of logs even when a subprocess reports its full configuration.
    const message = String(result.stderr || result.stdout || '').replaceAll(password, '[redacted]');
    throw new Error(`Docker command failed (${result.status}): ${message}`);
  }
  return result.stdout;
}
const compose = (args, options) => docker(['compose', '--project-name', project, '--file', file, ...args], options);
const config = {
  services: {
    postgres: {
      build: { context: join(root, 'docker', 'postgres') },
      environment: { POSTGRES_DB: 'osp', POSTGRES_USER: 'postgres', POSTGRES_PASSWORD: password, OSP_DB_USER: 'osp_app', OSP_DB_PASSWORD: password },
      volumes: ['verification-data:/var/lib/postgresql/data'],
      healthcheck: { test: ['CMD', 'pg_isready', '-U', 'postgres', '-d', 'osp'], interval: '2s', timeout: '5s', retries: 30 },
    },
    osp: {
      image,
      environment: {
        DATABASE_URL: `postgresql://osp_app:${password}@postgres:5432/osp`,
        OSP_ENV: 'production', OSP_DEMO: '1', OSP_SIGNUP: '0',
        OSP_JOBS_INTERVAL_SEC: '0', OSP_OUTBOX_INTERVAL_SEC: '0', OSP_COMM_INTERVAL_SEC: '0', OSP_EINVOICE_INTERVAL_SEC: '0',
      },
      depends_on: { postgres: { condition: 'service_healthy' } },
      ports: ['127.0.0.1::3000'], read_only: true, tmpfs: ['/tmp:rw,noexec,nosuid,size=64m'],
      cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'], init: true,
      healthcheck: { test: ['CMD', 'curl', '--fail', '--silent', 'http://127.0.0.1:3000/api/health'], interval: '2s', timeout: '5s', retries: 30, start_period: '5s' },
    },
  },
  volumes: { 'verification-data': {} },
};
const save = () => writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
let base;
let token;
async function api(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000),
  });
  const value = await response.json();
  assert.ok(response.ok, `${method} ${path}: ${JSON.stringify(value)}`);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.ok(response.headers.get('x-request-id'));
  return value;
}
function address() {
  return `http://${compose(['port', 'osp', '3000']).trim()}`;
}

try {
  save();
  console.log(`Starting isolated verification project ${project}`);
  compose(['config', '--quiet']);
  compose(['up', '--build', '--detach', '--wait', '--wait-timeout', '120']);
  base = address();
  assert.equal((await api('/api/health')).status, 'ok');
  assert.equal((await api('/api/catalog')).modules.length, 49);
  const page = await fetch(base, { method: 'HEAD' });
  assert.equal(page.status, 200);
  assert.ok(page.headers.get('content-security-policy'));
  const demo = await api('/api/demo', 'POST', { vertical: 'retail' });
  token = demo.token;
  const data = `/api/t/${demo.tenantId}/data`;
  const orders = await api(`${data}/sales/sales_order`);
  const order = orders.items.find((row) => row.status === 'draft');
  assert.ok(order?.warehouse && order.lines?.length, 'demo must provide a confirmable draft');
  await api(`${data}/sales/sales_order/${order.id}/confirmed`, 'POST');
  const invoices = await api(`${data}/accounting/invoice?source_id=${order.id}`);
  assert.equal(invoices.items.length, 1);
  assert.equal(invoices.items[0].status, 'posted');
  console.log('Linux image, non-superuser PostgreSQL/RLS, static HEAD and transactional sales flow passed.');

  const dump = compose(['exec', '-T', 'postgres', 'pg_dump', '-U', 'postgres', '-d', 'osp', '-Fc'], { binary: true });
  assert.ok(dump.length > 1000, 'backup must contain database records');
  compose(['exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE DATABASE osp_restore OWNER osp_app']);
  compose(['exec', '-T', 'postgres', 'pg_restore', '-U', 'postgres', '--exit-on-error', '--dbname=osp_restore'], { input: dump });
  config.services.osp.environment.DATABASE_URL = `postgresql://osp_app:${password}@postgres:5432/osp_restore`;
  save();
  compose(['up', '--detach', '--wait', '--wait-timeout', '120', 'osp']);
  base = address();
  const restored = await api(`${data}/sales/sales_order/${order.id}`);
  assert.equal(restored.status, 'confirmed');
  assert.equal((await api(`${data}/accounting/invoice?source_id=${order.id}`)).items.length, 1);
  console.log('pg_dump/pg_restore, application restart, session persistence and restored financial data passed.');
} finally {
  try {
    // Explicit project identity confines removal to this run's containers,
    // network and verification volume. Never invokes a global Docker prune.
    assert.match(project, /^osp-verify-\d+-[a-f0-9]{8}$/);
    compose(['down', '--volumes', '--remove-orphans']);
  } finally {
    const child = relative(resolve(tmpdir()), resolve(temporary));
    assert.ok(child && !child.startsWith('..') && !isAbsolute(child) && child.startsWith(project));
    rmSync(temporary, { recursive: true, force: true });
  }
}
