import { chromium } from 'playwright';
import { resolve } from 'node:path';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('file://' + resolve('showcase.html'));
await page.waitForTimeout(400);

const results = [];
const check = (n, ok, d) => results.push({ n, ok, d });

async function clickId(id) {
  const el = page.locator(`[data-mdh-id="${id}"]`).first();
  if (!(await el.count())) return { found: false };
  await el.click();
  await page.waitForTimeout(120);
  return page.evaluate(() => {
    const s = document.querySelector('.mdh-selected');
    return {
      found: true,
      selectedId: s?.getAttribute('data-mdh-id'),
      selectedType: s?.getAttribute('data-mdh-type'),
      hasBadge: !!s?.querySelector('.mdh-id-badge'),
    };
  });
}

// 1. 右栏（O12-D2）里的段落
const r1 = await clickId('O12-D2-1');
check('右栏段落可选中', r1.found && r1.selectedId === 'O12-D2-1', JSON.stringify(r1));

// 2. 栏本身不参与选中（布局容器），点它应选中内部元素
const colEl = page.locator('[data-mdh-id="O12-D2"]').first();
const cb = await colEl.boundingBox();
let r2 = { found: false };
if (cb) {
  await page.mouse.click(cb.x + 3, cb.y + 3);
  await page.waitForTimeout(150);
  r2 = await page.evaluate(() => {
    const s = document.querySelector('.mdh-selected');
    return { found: true, selectedId: s?.getAttribute('data-mdh-id'), selectedType: s?.getAttribute('data-mdh-type') };
  });
}
check('栏内点击命中内容（栏本身不选）', r2.found && !!r2.selectedType && r2.selectedType !== 'columnItem', JSON.stringify(r2));

// 2b. 两栏都能选到内容
const leftP = await clickId('O12-D1-1');
const rightP = await clickId('O12-D2-1');
check('左栏内容可选中', leftP.selectedId === 'O12-D1-1', JSON.stringify(leftP));
check('右栏内容可选中', rightP.selectedId === 'O12-D2-1', JSON.stringify(rightP));

// 3. O6 下面的列表项
const r3 = await clickId('O7-D1');
check('列表项可选中', r3.found && r3.selectedId === 'O7-D1', JSON.stringify(r3));

// 4. 列表项双击编辑
const li = page.locator('[data-mdh-id="O7-D1"]').first();
await page.waitForTimeout(100);
await li.dblclick();
await page.waitForTimeout(250);
const ed = await page.evaluate(() => {
  const e = document.querySelector('.mdh-editor');
  return { has: !!e, content: e?.querySelector('.mdh-editor-input')?.value || '' };
});
check('列表项可双击编辑', ed.has, JSON.stringify(ed.content));

if (ed.has) {
  await page.fill('.mdh-editor-input', '- **一般现在时** —— 改过的内容');
  await page.click('.mdh-editor-bar button[data-act="save"]');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({
    editorClosed: !document.querySelector('.mdh-editor'),
    text: document.querySelector('[data-mdh-id="O7-D1"]')?.textContent || '',
  }));
  check('列表项保存生效', after.editorClosed && after.text.includes('改过的内容'), after.text);
}

check('无 JS 错误', errs.length === 0, errs.join(' | '));

await page.screenshot({ path: 'screenshots/shot-col.png', fullPage: false });
await browser.close();

console.log('\n══════ 栏 / 列表项 验证 ══════');
for (const r of results) console.log(`${r.ok ? '✔' : '✖'} ${r.n}${r.d ? '  → ' + r.d : ''}`);
const f = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - f}/${results.length} 通过`);
process.exit(f ? 1 : 0);
