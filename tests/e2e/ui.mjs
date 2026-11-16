// Kiểm thử giao diện đầu-cuối bằng Chrome thật: luồng chức năng + kiểm tra accessibility (axe-core, WCAG 2.1 AA).
//   npm run e2e            (cần Chrome/Edge; đặt CHROME_PATH nếu không ở vị trí mặc định)
//   E2E_SHOTS=./shots npm run e2e   (lưu ảnh chụp các màn hình chính)
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CANDIDATES = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
const chrome = CANDIDATES.find((p) => existsSync(p));
if (!chrome) {
  console.log('Bỏ qua E2E: không tìm thấy Chrome/Edge (đặt CHROME_PATH).');
  process.exit(0);
}

const SHOTS = process.env.E2E_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const axeSrc = readFileSync(join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');

async function freePort() {
  const socket = createServer();
  await new Promise((resolve, reject) => socket.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = socket.address();
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  return port;
}

const appPort = await freePort();
const postgresPort = await freePort();
const pgDir = join(tmpdir(), `osp-e2e-${process.pid}`);
const serverEnvironment = {
  ...process.env,
  OSP_ENV: 'test',
  NODE_ENV: 'test',
  OSP_DEFS: join(ROOT, 'definitions'),
  OSP_PUBLIC: join(ROOT, 'client-dist'),
  OSP_PORT: String(appPort),
  OSP_PG_PORT: String(postgresPort),
  OSP_PG_DIR: pgDir,
  OSP_DEMO: '1',
  OSP_SIGNUP: '1',
  OSP_RATE_LIMIT: '100000',
  OSP_JOBS_INTERVAL_SEC: '0',
  OSP_OUTBOX_INTERVAL_SEC: '0',
  OSP_COMM_INTERVAL_SEC: '0',
  OSP_EINVOICE_INTERVAL_SEC: '0',
};
// Tests always own their temporary database, even if a developer has configured
// DATABASE_URL in the parent environment.
delete serverEnvironment.DATABASE_URL;
const build = spawnSync('cargo', ['build', '--manifest-path', 'server/Cargo.toml', '--bin', 'osp-server'], {
  cwd: ROOT,
  stdio: 'inherit',
});
if (build.status !== 0) throw new Error(`Rust server build failed (${build.status ?? build.signal})`);
const serverExecutable = join(ROOT, 'server', 'target', 'debug', process.platform === 'win32' ? 'osp-server.exe' : 'osp-server');
const serverProcess = spawn(serverExecutable, [], {
  cwd: ROOT,
  env: serverEnvironment,
  stdio: 'inherit',
});
let serverClosed = false;
function assertOwnedDirectory() {
  const resolved = resolve(pgDir);
  const child = relative(resolve(tmpdir()), resolved);
  if (!child || child.startsWith('..') || isAbsolute(child) || child !== `osp-e2e-${process.pid}`) {
    throw new Error('Refusing to clean a path outside the owned E2E database directory');
  }
  return resolved;
}
function stopWindowsPostgres() {
  if (process.platform !== 'win32') return;
  const data = join(assertOwnedDirectory(), 'data');
  if (!existsSync(join(data, 'postmaster.pid'))) return;
  const options = readFileSync(join(data, 'postmaster.opts'), 'utf8');
  const binary = options.match(/^(?:"([^"]+postgres(?:\.exe)?)"|(\S+postgres(?:\.exe)?))(?=\s|$)/i);
  const executable = binary?.[1] || binary?.[2];
  if (!executable) throw new Error('Cannot locate the owned PostgreSQL control binary');
  const stop = spawnSync(join(dirname(executable), 'pg_ctl.exe'), ['stop', '-D', data, '-m', 'fast', '-w', '-t', '20'], {
    stdio: 'pipe', windowsHide: true, timeout: 25_000,
  });
  if (stop.status !== 0) throw new Error(`Owned PostgreSQL shutdown failed (${stop.status})`);
}
process.once('exit', () => {
  if (!serverClosed) {
    try { stopWindowsPostgres(); } catch (error) { console.error(error.message); }
    serverProcess.kill('SIGINT');
  }
});
const BASE = `http://127.0.0.1:${appPort}`;
const readyUntil = Date.now() + 120_000;
while (Date.now() < readyUntil) {
  if (serverProcess.exitCode !== null) throw new Error(`Rust server exited (${serverProcess.exitCode})`);
  try {
    const response = await fetch(`${BASE}/api/health`);
    if (response.ok) break;
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 500));
}
if (Date.now() >= readyUntil) throw new Error('Rust server did not become healthy within 120 seconds');
const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

const problems = [];
let expectedRouteFailure = false;
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() !== 'error' || /status of 4/.test(m.text())) return;
  if (expectedRouteFailure && (/Failed to load resource/.test(m.text()) || /Failed to fetch dynamically imported module/.test(m.text()) || /Route failed to render/.test(m.text()))) return;
  problems.push(`console.error: ${m.text()}`);
});
page.on('response', (r) => { if (r.status() >= 400 && r.status() !== 422 && !r.url().includes('/auth/login')) problems.push(`http ${r.status()} ${r.url()}`); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (n) => (SHOTS ? page.screenshot({ path: join(SHOTS, `${n}.png`) }) : null);
const clickText = (text, sel = 'button, a') => page.evaluate((t, s) => {
  const el = [...document.querySelectorAll(s)].find((e) => e.textContent.trim().replace(/^[＋+]\s*/, '') === t && e.offsetParent !== null);
  if (el) el.click();
  return !!el;
}, text, sel);
let failed = 0;
const step = async (label, fn) => {
  try { await fn(); console.log('✔', label); } catch (e) { failed++; console.log('✖', label, '-', e.message); }
};
const must = (cond, msg) => { if (!cond) throw new Error(msg); };

async function axe(label) {
  await sleep(450); // chờ animation drawer/dialog kết thúc để đo màu đúng (độ mờ = 1)
  await page.evaluate(axeSrc);
  const v = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } }))
    .violations.map((x) => `${x.id} (${x.impact}): ${x.nodes[0].target.join(' ')}`));
  must(!v.length, `${label}: ${v.join(' | ')}`);
}

await step('đăng nhập + tạo doanh nghiệp: accessibility', async () => {
  await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.landing');
  await axe('đăng nhập');
  await clickText('Tạo doanh nghiệp', 'button.tab');
  await sleep(200);
  await axe('tạo doanh nghiệp');
});

await step('dùng thử -> trang chủ có số liệu', async () => {
  await page.goto(`${BASE}/?demo=retail&go=/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.stat');
  must((await page.$$('.stat')).length >= 4, 'thiếu thẻ số liệu');
  await axe('trang chủ');
  await shot('home');
});

await step('ngôn ngữ giao diện: chuyển đổi và lưu lựa chọn', async () => {
  await page.click('.menu > button');
  must(await clickText('Tiếng Anh', 'button'), 'không có lựa chọn tiếng Anh');
  await page.waitForFunction(() => document.querySelector('#main h1')?.textContent.startsWith('Hello'));
  must(await page.$eval('#nav', (nav) => nav.getAttribute('aria-label') === 'Main navigation'), 'điều hướng chưa chuyển sang tiếng Anh');
  await axe('trang chủ tiếng Anh');
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelector('#main h1')?.textContent.startsWith('Hello'));
  await page.goto(`${BASE}/#/e/master-data/party`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('table.table');
  must((await page.$eval('#main h1', (heading) => heading.textContent)) === 'Customer', 'danh sách CRUD chưa dịch đúng thuật ngữ ngành');
  must(await clickText('Create customer', 'button'), 'nút tạo hồ sơ chưa dịch');
  await page.waitForSelector('dialog.drawer[open] form');
  must((await page.$eval('#entity-form-title', (heading) => heading.textContent)).startsWith('Create customer'), 'biểu mẫu chưa dịch tiêu đề');
  must(await page.$eval('label[for="entity-field-name"]', (label) => label.textContent.includes('Name')), 'biểu mẫu chưa dịch nhãn trường');
  await axe('biểu mẫu CRUD tiếng Anh');
  await page.keyboard.press('Escape');
  await page.goto(`${BASE}/#/pos`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#main h1');
  must((await page.$eval('#main h1', (heading) => heading.textContent)) === 'POS terminal', 'POS workbench chưa được dịch');
  await axe('POS workbench tiếng Anh');
  await page.goto(`${BASE}/#/returns`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#main h1');
  must((await page.$eval('#main h1', (heading) => heading.textContent)) === 'Returns and revenue adjustments', 'màn hình trả hàng chưa được dịch');
  await axe('sales returns workbench tiếng Anh');
  await page.goto(`${BASE}/#/wholesale`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#main h1');
  must((await page.$eval('#main h1', (heading) => heading.textContent)) === 'Sales, quotations, and delivery', 'màn hình bán buôn chưa được dịch');
  await axe('wholesale sales desk tiếng Anh');
  await page.goto(`${BASE}/#/sourcing`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#main h1');
  must((await page.$eval('#main h1', (heading) => heading.textContent)) === 'RFQ and quote comparison', 'màn hình tìm nguồn mua chưa được dịch');
  await axe('purchasing sourcing workbench tiếng Anh');
  await page.goto(`${BASE}/#/purchasing`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#main h1');
  must((await page.$eval('#main h1', (heading) => heading.textContent)) === 'Purchasing and receiving', 'màn hình mua hàng chưa được dịch');
  await axe('purchasing workbench tiếng Anh');
  await page.goto(`${BASE}/#/reports/inventory/replenishment`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#main h1');
  must((await page.$eval('#main h1', (heading) => heading.textContent)) === 'Inventory replenishment suggestions', 'màn hình bổ sung tồn kho chưa được dịch');
  await axe('inventory replenishment workbench tiếng Anh');
  await page.goto(`${BASE}/#/inventory-counts`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#main h1');
  must((await page.$eval('#main h1', (heading) => heading.textContent)) === 'Stock counts', 'màn hình kiểm kê kho chưa được dịch');
  await axe('stock count workbench tiếng Anh');
  await page.goto(`${BASE}/#/reports/inventory/location-stock`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#main h1');
  must((await page.$eval('#main h1', (heading) => heading.textContent)) === 'Stock by location', 'màn hình tồn theo vị trí chưa được dịch');
  await axe('inventory location stock workbench tiếng Anh');
  await page.goto(`${BASE}/#/reports/inventory/quality-holds`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#main h1');
  must((await page.$eval('#main h1', (heading) => heading.textContent)) === 'Inventory on quality hold', 'màn hình tồn giữ QC chưa được dịch');
  await axe('inventory quality hold workbench tiếng Anh');
  await page.goto(`${BASE}/#/settings/inventory`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#main h1');
  must((await page.$eval('#main h1', (heading) => heading.textContent)) === 'Settings', 'inventory settings title is not translated');
  must((await page.$eval('#main h2', (heading) => heading.textContent)) === 'Inventory costing method', 'inventory costing policy is not translated');
  must((await page.$eval('[role="tab"][aria-selected="true"]', (tab) => tab.textContent)) === 'Inventory', 'inventory settings tab is not translated');
  await axe('inventory settings tiếng Anh');
  await page.goto(`${BASE}/#/settings/budget`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#main h2');
  must((await page.$eval('#main h2', (heading) => heading.textContent)) === 'Block postings over budget', 'budget controls are not translated');
  await axe('budget settings tiếng Anh');
  await page.goto(`${BASE}/#/period-close`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#main h1');
  must((await page.$eval('#main h1', (heading) => heading.textContent)) === 'Accounting period close', 'accounting period close title is not translated');
  await axe('accounting period close tiếng Anh');
  await page.goto(`${BASE}/#/quality`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#main h1');
  must((await page.$eval('#main h1', (heading) => heading.textContent)) === 'Nonconformance register', 'quality workbench title is not translated');
  await axe('quality workbench tiếng Anh');
  await page.goto(`${BASE}/#/m/inventory`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#main h1');
  await axe('inventory module overview tiếng Anh');
  await page.goto(`${BASE}/#/reports/marketing/campaign-performance`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#main h1');
  must((await page.$eval('#main h1', (heading) => heading.textContent)) === 'Campaign performance', 'campaign performance report is not translated');
  await axe('marketing campaign report tiếng Anh');
  await page.goto(`${BASE}/#/events`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#main h1');
  must((await page.$eval('#main h1', (heading) => heading.textContent)) === 'Event stream', 'event stream title is not translated');
  await axe('event stream tiếng Anh');
  await page.goto(`${BASE}/#/settings/audit`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#main h2');
  must((await page.$eval('#main h2', (heading) => heading.textContent)) === 'Audit log', 'audit log is not translated');
  await axe('audit settings tiếng Anh');
  await page.goto(`${BASE}/#/unknown`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#main h1');
  must((await page.$eval('#main h1', (heading) => heading.textContent)) === 'Page not found', 'not-found page is not translated');
  await axe('not-found page tiếng Anh');
  await page.goto(`${BASE}/#/reports/inventory/lot-expiry`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#main h1');
  must((await page.$eval('#main h1', (heading) => heading.textContent)) === 'Expiring lots', 'màn hình lô cận hạn chưa được dịch');
  await axe('inventory lot expiry workbench tiếng Anh');
  await step('lot traceability: tiếng Anh và accessibility', async () => {
    const lotId = await page.evaluate(async () => {
      const session = JSON.parse(sessionStorage.getItem('osp.session') || localStorage.getItem('osp.session') || '{}');
      const response = await fetch(`/api/t/${encodeURIComponent(session.tenantId)}/data/inventory/lot?limit=1`, { headers: { authorization: `Bearer ${session.token}` } });
      return (await response.json()).items?.[0]?.id || '';
    });
    if (!lotId) return;
    await page.goto(`${BASE}/#/reports/inventory/lots/${encodeURIComponent(lotId)}/traceability`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#main h1');
    must((await page.$eval('#main h1', (heading) => heading.textContent)) === 'Lot traceability', 'màn hình truy xuất lô chưa được dịch');
    await axe('lot traceability tiếng Anh');
  });
  await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle0' });
  await page.click('.menu > button');
  must(await clickText('Vietnamese', 'button'), 'không có lựa chọn tiếng Việt sau khi chuyển ngôn ngữ');
  await page.waitForFunction(() => document.querySelector('#main h1')?.textContent.startsWith('Xin chào'));
});

await step('danh sách -> chi tiết -> xác nhận kéo theo luồng liên module', async () => {
  await page.goto(`${BASE}/#/e/sales/sales_order`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('table.table');
  await axe('danh sách');
  await page.evaluate(() => [...document.querySelectorAll('tbody tr')].find((r) => r.textContent.includes('Nháp')).click());
  await page.waitForSelector('dialog.drawer[open] .dl');
  await axe('chi tiết');
  must(await clickText('Xác nhận', 'dialog button'), 'không có nút Xác nhận');
  await page.waitForSelector('.toast');
  await sleep(700);
  const text = await page.evaluate(() => document.querySelector('dialog.drawer').textContent);
  must(/Kế toán/.test(text) && /Kho/.test(text), 'tab hệ quả thiếu Kế toán/Kho');
  await shot('flow');
});

await step('form: validate thân thiện, tạo thành công', async () => {
  await page.keyboard.press('Escape');
  await page.goto(`${BASE}/#/e/master-data/party`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('table.table');
  must(await clickText('Tạo khách hàng', 'button'), 'không có nút tạo khách hàng');
  await page.waitForSelector('dialog.drawer[open] form');
  await axe('form');
  await clickText('Tạo mới', 'dialog button');
  await sleep(500);
  const err = await page.evaluate(() => document.querySelector('dialog .error-text:not(.hidden)')?.textContent || '');
  must(/Vui lòng nhập|Thiếu trường bắt buộc: Tên/.test(err), `thông báo lỗi chưa thân thiện: "${err}"`);
  await page.type('dialog input[type=text]', 'Khách E2E');
  await clickText('Tạo mới', 'dialog button');
  await page.waitForSelector('.toast');
  await page.waitForFunction(() => document.querySelector('tbody')?.textContent.includes('Khách E2E'));
});

await step('cài đặt, dòng sự kiện: accessibility', async () => {
  for (const [hash, sel, label] of [['#/settings/users', 'table.table', 'người dùng'], ['#/settings/modules', 'table.table', 'module'], ['#/settings/data', '.card', 'dữ liệu'], ['#/events', '.timeline', 'sự kiện']]) {
    await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector(sel);
    await axe(label);
  }
  await page.goto(`${BASE}/#/settings/audit`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('table.table');
});

const retailScreens = [
  ['#/pos', 'POS'], ['#/sales', 'Sales'], ['#/purchasing', 'Purchasing'], ['#/sourcing', 'Sourcing'],
  ['#/loyalty', 'Loyalty'], ['#/reports/crm/pipeline', 'CRM pipeline'],
  ['#/reports/marketing/campaign-performance', 'Marketing performance'], ['#/ecommerce', 'Ecommerce'],
  ['#/communications', 'Communication'], ['#/reports/accounting', 'Accounting reports'],
  ['#/bank-reconciliation', 'Bank reconciliation'], ['#/einvoices', 'E-invoice'], ['#/people', 'HRM'],
  ['#/recruitment', 'Recruitment'], ['#/payroll', 'Payroll'], ['#/expenses', 'Expenses'],
  ['#/reports/bi', 'BI reports'], ['#/inventory-counts', 'Inventory counts'],
  ['#/reports/inventory/replenishment', 'Replenishment'], ['#/reports/inventory/lot-expiry', 'Lot expiry'],
];
for (const [hash, label] of retailScreens) {
  await step(`${label} workbench: route and accessibility`, async () => {
    await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('h1');
    must(!(await page.$('.route-error')), `${label} route failed to render`);
    must(!(await page.$('.not-found-page')), `${label} route resolved to not found`);
    await axe(`${label} workbench`);
  });
}

const verticalScreens = [
  ['agriculture', '#/agriculture', 'Agriculture', 'agriculture.crop_cycle', 'agriculture.farm'], ['automotive', '#/workshop', 'Automotive', 'auto-service.repair_order', 'master-data.party'],
  ['beauty-wellness', '#/wellness', 'Beauty and wellness', 'booking.booking', 'booking.service'], ['construction', '#/construction', 'Construction', 'construction.site', 'project.project'],
  ['ecommerce', '#/ecommerce', 'Ecommerce', 'ecommerce.web_order', 'master-data.party'], ['education', '#/education', 'Education', 'school.student', 'master-data.party'],
  ['events-media', '#/event-ops', 'Events and media', 'events.event', 'events.event'], ['finance', '#/finance', 'Finance', 'lending.loan', 'master-data.party'],
  ['fnb', '#/restaurant', 'Food and beverage', 'restaurant.table_order', 'restaurant.table'], ['healthcare', '#/clinic', 'Healthcare', 'clinic.encounter', 'master-data.party'],
  ['home-services', '#/field-service', 'Home services', 'field-service.work_order', 'booking.service'], ['hospitality', '#/hotel', 'Hospitality', 'hotel.reservation', 'hotel.room_type'],
  ['logistics', '#/reports/logistics/delivery-board', 'Logistics', 'logistics.shipment', 'master-data.party'],
  ['manufacturing', '#/reports/manufacturing/wip', 'Manufacturing', 'manufacturing.production_order', 'master-data.product'],
  ['ngo-government', '#/charity', 'Nonprofit', 'charity.program', 'charity.program'], ['pharmacy', '#/pharmacy', 'Pharmacy', 'pharmacy.prescription', 'master-data.party'],
  ['professional-services', '#/cases', 'Professional services', 'case-management.case', 'master-data.party'], ['real-estate', '#/real-estate', 'Real estate', 'real-estate.property', 'real-estate.property'],
  ['retail', '#/pos', 'Retail', 'pos.pos_order', 'master-data.party'], ['saas-technology', '#/subscriptions', 'SaaS', 'subscription.subscription', 'subscription.plan'],
  ['utilities-isp', '#/utilities', 'Utilities', 'utilities.meter', 'master-data.party'], ['wholesale', '#/wholesale', 'Wholesale', 'crm.deal', 'master-data.party'],
];
const requestedVerticals = new Set((process.env.E2E_VERTICALS || '').split(',').map((name) => name.trim()).filter(Boolean));
for (const [vertical, hash, label, summaryEntity, setupEntity] of verticalScreens.filter(([name]) => !requestedVerticals.size || requestedVerticals.has(name))) {
  await step(`${label} vertical: route and accessibility`, async () => {
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.goto(`${BASE}/?demo=${encodeURIComponent(vertical)}&go=${encodeURIComponent(hash.slice(1))}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('h1');
    must(!(await page.$('.route-error')), `${label} vertical route failed to render`);
    must(!(await page.$('.not-found-page')), `${label} vertical route resolved to not found`);
    await axe(`${label} vertical`);
    if (vertical === 'ngo-government') {
      await page.evaluate(() => localStorage.setItem('osp.uiLocale', 'en-US'));
      await page.reload({ waitUntil: 'networkidle0' });
      await page.goto(`${BASE}/#/reports/budget/variance`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('#main h1');
      must((await page.$eval('#main h1', (heading) => heading.textContent)) === 'Budget performance', 'budget performance report is not translated');
      await axe('budget performance tiếng Anh');
      await page.evaluate(() => localStorage.setItem('osp.uiLocale', 'vi-VN'));
      await page.reload({ waitUntil: 'networkidle0' });
    }
  });
  await step(`${label} dashboard uses vertical summary entities`, async () => {
    await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.stats');
    const href = `#/e/${summaryEntity.replace('.', '/')}`;
    const visible = await page.$$eval('.stats a', (links, expected) => links.some((link) => link.getAttribute('href') === expected), href);
    must(visible, `${label} dashboard is missing ${summaryEntity}`);
  });
  await step(`${label} exposes vertical onboarding entities`, async () => {
    const setupEntities = await page.evaluate(async () => {
      const session = JSON.parse(sessionStorage.getItem('osp.session') || localStorage.getItem('osp.session') || '{}');
      const response = await fetch(`/api/t/${encodeURIComponent(session.tenantId)}/meta`, { headers: { authorization: `Bearer ${session.token}` } });
      return (await response.json()).setupEntities || [];
    });
    must(setupEntities.includes(setupEntity), `${label} onboarding is missing ${setupEntity}`);
  });
  if (process.env.E2E_ALL_NAV === '1') {
    const navigationRoutes = await page.$$eval('.sidebar a.nav-link', (links) => [...new Set(links
      .map((link) => link.getAttribute('href'))
      .filter((href) => href?.startsWith('#/') && href !== '#/' && !href.startsWith('#/m/') && !href.startsWith('#/e/')))]);
    for (const navHash of navigationRoutes) {
      await step(`${label} navigation ${navHash}: route and accessibility`, async () => {
        await page.goto(`${BASE}/${navHash}`, { waitUntil: 'networkidle0' });
        await page.waitForSelector('h1');
        must(!(await page.$('.route-error')), `${navHash} route failed to render`);
        must(!(await page.$('.not-found-page')), `${navHash} route resolved to not found`);
        await axe(`${label} ${navHash}`);
      });
    }
  }
}

await step('lazy route load failure: recovery boundary', async () => {
  let blocked = false;
  const intercept = (request) => {
    if (!blocked && /PharmacyWorkbenchPage-[^/]+\.js(?:\?|$)/.test(request.url())) {
      blocked = true;
      request.abort('failed');
    } else {
      request.continue();
    }
  };
  expectedRouteFailure = true;
  await page.setBypassServiceWorker(true);
  await page.setRequestInterception(true);
  page.on('request', intercept);
  try {
    await page.goto(`${BASE}/#/pharmacy`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.route-error', { timeout: 10000 });
    must(blocked, 'Pharmacy lazy chunk was not intercepted');
    await axe('lazy route error fallback');
    must(await page.$eval('.route-error h1', (heading) => heading.textContent.includes('Không thể tải màn hình')), 'recovery message is missing');
    await page.click('.route-error a[href="#/"]');
    await page.waitForFunction(() => location.hash === '#/' && document.querySelector('#main h1')?.textContent.includes('Xin chào'));
  } finally {
    expectedRouteFailure = false;
    page.off('request', intercept);
    await page.setRequestInterception(false);
    await page.setBypassServiceWorker(false);
  }
});

await step('giao diện tối: accessibility', async () => {
  await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('h1');
  await page.click('button[aria-label^="Chuyển sang giao diện tối"]');
  await sleep(300);
  await axe('trang chủ (tối)');
  await shot('dark');
});

await step('di động 390px: không tràn ngang, mở được menu', async () => {
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(`${BASE}/#/e/master-data/product`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('table.table');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  must(!overflow, 'trang bị cuộn ngang');
  await page.click('button[aria-controls="nav"]');
  await sleep(350);
  must(await page.evaluate(() => document.querySelector('.sidebar').classList.contains('open')), 'menu không mở');
  await shot('mobile-nav');
});

await step('đăng xuất', async () => {
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle0' });
  await page.click('.menu > button');
  await clickText('Đăng xuất', 'button');
  await page.waitForSelector('.landing');
});

await browser.close();
stopWindowsPostgres();
const exited = serverProcess.exitCode !== null ? Promise.resolve() : new Promise((resolve) => serverProcess.once('exit', resolve));
serverClosed = true;
serverProcess.kill('SIGINT');
await exited;
rmSync(assertOwnedDirectory(), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
for (const p of [...new Set(problems)]) { failed++; console.log('✖', p); }
console.log(failed ? `\n${failed} lỗi` : '\nE2E đạt: chức năng + accessibility (axe) không lỗi.');
process.exit(failed ? 1 : 0);
