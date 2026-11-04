/* 四路由体检: 控制台错误、横向滚动、关键节点数量、文本摘要
 * 用法: node tools/check-routes.cjs <dir-1.html> [...]
 */
const path = require('path');
const { chromium } = require('C:/Users/HuoHanDu/.dsh/skills/huashu-design/node_modules/playwright');

(async () => {
  const files = process.argv.slice(2);
  const browser = await chromium.launch({ headless: true });
  for (const f of files) {
    const html = path.resolve(f);
    const url = 'file:///' + html.replace(/\\/g, '/').replace(/ /g, '%20');
    console.log('\n### ' + path.basename(html));
    for (const route of ['keyboard', 'mouse', 'stats', 'settings']) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
      await page.goto(url + '#/' + route, { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(1200);
      const info = await page.evaluate(() => {
        const vis = [...document.querySelectorAll('section, .page, [data-page]')].filter((el) => {
          const s = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 100 && r.height > 100;
        });
        return {
          title: document.title,
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          bodyText: document.body.innerText.slice(0, 160).replace(/\s+/g, ' '),
          visiblePanels: vis.length,
          keys: document.querySelectorAll('.key, .kb-key, [data-key], .keycap').length,
          svg: document.querySelectorAll('svg').length,
          canvases: document.querySelectorAll('canvas').length,
          fontLoaded: document.fonts ? document.fonts.status : 'n/a'
        };
      });
      console.log(JSON.stringify({ route, ...info, errors }));
      await page.close();
    }
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
