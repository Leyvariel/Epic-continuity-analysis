import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const out = process.argv[2];
if (!out) throw new Error('Укажите каталог браузерных свидетельств.');
await mkdir(out, { recursive: true });
const directory = await mkdtemp(path.join(os.tmpdir(), 'restart-browser-'));
const probe = http.createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['--import', 'tsx', 'tests/restart-fixture.ts', directory, String(port), '--seed'], { stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = ''; server.stdout.on('data', value => { serverLog += value; }); server.stderr.on('data', value => { serverLog += value; });
let browser;
const checks = [], errors = [];
try {
  const until = Date.now() + 10000;
  let ready = false;
  while (Date.now() < until) {
    try { if ((await fetch(`${base}/api/runtime`)).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, serverLog);
  const original = await readFile(path.join(directory, 'dataset.json'));
  const { chromium } = await import(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'));
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  const button = () => page.getByRole('button', { name: 'Перезапустить приложение', exact: true });
  const shot = name => page.screenshot({ path: path.join(out, `${name}.png`) });
  await page.goto(base, { waitUntil: 'networkidle' });
  await button().waitFor(); assert.equal(await page.locator('.epic-row').count(), 1);
  await page.getByRole('button', { name: 'Раскрыть A-1', exact: true }).click();
  for (const zoom of ['День', 'Неделя', 'Месяц']) {
    await page.getByRole('button', { name: zoom, exact: true }).click();
    await page.locator('.timeline-scroll').evaluate(element => { element.scrollLeft = 300; element.scrollTop = 30; });
    await shot(`01-wide-${zoom}`);
  }
  checks.push('Кнопка, раскрытие, прокрутка и три масштаба на сохранённом контрольном наборе');
  for (const width of [1100, 800, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const bounds = await button().boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await shot(`02-width-${width}`);
  }
  checks.push('Панель помещается на ширине 1100, 800 и 390 без горизонтального переполнения');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route('**/api/restart', route => route.fulfill({ status: 409, json: { error: { code: 'BUSY', message: 'Дождитесь завершения текущего действия.' } } }));
  await button().click(); await page.getByRole('alert').waitFor();
  assert.equal(await page.locator('.epic-row').count(), 1); assert.ok(await button().isEnabled());
  await shot('03-rejected'); await page.unroute('**/api/restart');
  checks.push('Отказ оставляет анализ на экране и разрешает повтор');
  const before = await (await page.request.get(`${base}/api/runtime`)).json();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/runtime', async route => { await gate; await route.continue(); });
  await button().click();
  await page.getByText('Приложение перезапускается. Сохранённый анализ откроется автоматически.', { exact: true }).waitFor();
  assert.ok(await page.getByRole('button', { name: 'Перезапуск…', exact: true }).isDisabled());
  assert.ok(await page.getByRole('button', { name: 'Сбросить все данные', exact: true }).isDisabled());
  assert.ok(await page.locator('input[type=file]').isDisabled());
  await shot('04-restarting');
  const navigated = page.waitForEvent('framenavigated', frame => frame === page.mainFrame());
  release(); await navigated; await button().waitFor();
  await page.unroute('**/api/runtime');
  const after = await (await page.request.get(`${base}/api/runtime`)).json();
  assert.notEqual(after.instanceId, before.instanceId);
  assert.equal(await page.locator('.epic-row').count(), 1);
  assert.equal((await (await page.request.get(`${base}/api/dataset`)).json()).dataset.id, 'restart-fixture');
  assert.deepEqual(await readFile(path.join(directory, 'dataset.json')), original);
  const pids = [...serverLog.matchAll(/WORKER_PID=(\d+)/g)].map(match => match[1]);
  assert.equal(pids.length, 2); assert.notEqual(pids[0], pids[1]);
  await shot('05-restored');
  checks.push('Реальный перезапуск: другой PID и instanceId, автоматическое обновление страницы, тот же анализ и неизменный файл');
  assert.deepEqual(errors, []);
  await writeFile(path.join(out, 'browser-report.json'), JSON.stringify({ status: 'passed', checks, errors, workerPids: pids }, null, 2));
  console.log(JSON.stringify({ status: 'passed', checks: checks.length }));
} catch (error) {
  await writeFile(path.join(out, 'failure.json'), JSON.stringify({ error: String(error), checks, errors, serverLog }, null, 2));
  throw error;
} finally {
  await browser?.close();
  if (server.exitCode === null) { const exited = once(server, 'exit'); server.kill('SIGTERM'); await exited; }
  await rm(directory, { recursive: true, force: true });
}
