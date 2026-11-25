/**
 * 用 Playwright 截图，做视觉验收
 *
 *   node tools/shot.mjs [文件] [输出图]
 *
 * 默认写到 screenshots/（该目录不进 git，截图属于一次性产物）
 */
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const file = process.argv[2] ?? 'showcase.html';
const out = process.argv[3] ?? 'screenshots/shot.png';

mkdirSync('screenshots', { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1000, height: 1400 },
  deviceScaleFactor: 2,
});

await page.goto('file://' + resolve(file));
await page.waitForTimeout(300);

// 全页截图
await page.screenshot({ path: out, fullPage: true });

// 几个关键元素的尺寸，用于确认排版生效
const metrics = await page.evaluate(() => {
  const doc = document.querySelector('.mdh-document');
  const h1 = document.querySelector('.mdh-heading-1');
  const table = document.querySelector('.mdh-table');
  const cs = (el, prop) => (el ? getComputedStyle(el)[prop] : null);
  return {
    文档宽: doc?.getBoundingClientRect().width,
    H1字号: cs(h1, 'fontSize'),
    H1字重: cs(h1, 'fontWeight'),
    正文行高: cs(doc, 'lineHeight'),
    表格边框: table ? cs(table.querySelector('td'), 'borderBottomColor') : null,
    页面总高: document.body.scrollHeight,
  };
});

console.log('截图:', out);
console.log('度量:', JSON.stringify(metrics, null, 1));

await browser.close();
