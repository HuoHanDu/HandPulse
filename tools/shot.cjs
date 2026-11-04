/* 用法: node tools/shot.cjs <url> <out.png> [width] [height] [--full] [--wait=ms] [--transparent]
 * 依赖 skill 的 playwright；本机已有 chromium。 */
const path = require('path');

const PLAYWRIGHT = 'C:/Users/HuoHanDu/.dsh/skills/huashu-design/node_modules/playwright';
const { chromium } = require(PLAYWRIGHT);

(async () => {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('usage: node shot.cjs <url> <out.png> [width] [height] [--full] [--wait=ms]');
    process.exit(2);
  }
  const url = args[0];
  const out = path.resolve(args[1]);
  const positional = args.slice(2).filter((a) => !a.startsWith('--'));
  const width = parseInt(positional[0] || '1440', 10);
  const height = parseInt(positional[1] || '900', 10);
  const full = args.includes('--full');
  const waitArg = args.find((a) => a.startsWith('--wait='));
  const waitMs = waitArg ? parseInt(waitArg.split('=')[1], 10) : 1000;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(waitMs);
  await page.screenshot({ path: out, fullPage: full });
  await browser.close();
  console.log(JSON.stringify({ out, width, height, full, errors }, null, 2));
  if (errors.length) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exit(1); });
