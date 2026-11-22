// Regenerates docs/*.png from scripted scenarios. Fails on any console error.
// Usage: npm run screenshots
import { createRequire } from 'node:module';
import { start } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const base = 'index.html?today=2026-11-24&now=09:40';
const shots = [
  { file: 'overview.png', url: `${base}&run=sick`, size: [1440, 900] },
  { file: 'plan-applied.png', url: `${base}&run=sick&confirm=1&tab=outbox`, size: [1440, 900] },
  { file: 'double-booking.png', url: `${base}&run=double`, size: [1440, 900] },
  { file: 'ranked-slots.png', url: `${base}&q=${encodeURIComponent('When can Marco do a sports massage this week?')}`, size: [1440, 900] },
  { file: 'week.png', url: `${base}&view=week`, size: [1440, 900] },
  { file: 'evidence.png', url: `${base}&evidence=1`, size: [1280, 900], wait: 600 },
  { file: 'mobile.png', url: `${base}&run=sick&pane=side`, device: 'iPhone 13' },
];

const server = await start(5197);
const browser = await chromium.launch();
let failed = false;
for (const s of shots) {
  const ctx = s.device ? await browser.newContext({ ...devices[s.device] }) : await browser.newContext({ viewport: { width: s.size[0], height: s.size[1] }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:5197/${s.url}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(s.wait || 400);
  await page.screenshot({ path: new URL(`../docs/${s.file}`, import.meta.url).pathname });
  if (errors.length) { failed = true; console.error(s.file, errors); } else console.log('ok', s.file);
  await ctx.close();
}
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
