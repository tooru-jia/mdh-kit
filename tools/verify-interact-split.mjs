/**
 * 验证 mdh-kit 自带第三层（mdh-interact.js）仍然正常
 *
 * 拆分后它应该仍然提供：
 *   单击选中 / 双击进编辑 / Esc 清除 / ID 徽标
 *
 * 用 stress 产物（内联了 core + interact + renderer）在 Chromium 里跑。
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const file = process.argv[2] ?? 'stress/test-features.html';
const html = readFileSync(file, 'utf8');

const checks = [];
const check = (n, ok, d = '') => {
  checks.push({ n, ok, d });
  console.log(`${ok ? '✔' : '✘'} ${n}${d ? ` — ${d}` : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto('file://' + process.cwd() + '/' + file);
await page.waitForTimeout(1200);

// 基础：两个全局都在
const globals = await page.evaluate(() => ({
  core: typeof window.MDHInteractCore,
  gesture: typeof window.MDHInteract,
  attachFn: typeof window.MDHInteract?.attach,
}));
check('MDHInteractCore 已加载', globals.core === 'object', globals.core);
check('MDHInteract 已加载', globals.gesture === 'object', globals.gesture);
check('attach 可调用', globals.attachFn === 'function');

// 单击选中（自带第三层应该绑好了）
await page.evaluate(() => {
  const h = document.querySelector('h1[data-mdh-id]');
  h.click();
});
await page.waitForTimeout(300);
const sel = await page.evaluate(() => {
  const el = document.querySelector('.mdh-selected');
  return {
    ok: !!el,
    id: el?.getAttribute('data-mdh-id') ?? null,
    badge: el?.querySelector('.mdh-id-badge code')?.textContent ?? null,
  };
});
check('单击选中（默认手势）', sel.ok, `id=${sel.id} badge=${sel.badge}`);

// 双击进编辑（自带第三层有编辑能力）
await page.evaluate(() => {
  const h = document.querySelector('h1[data-mdh-id]');
  const ev = new MouseEvent('dblclick', { bubbles: true });
  h.dispatchEvent(ev);
});
await page.waitForTimeout(600);
const editing = await page.evaluate(() => ({
  editor: document.querySelectorAll('.mdh-editor').length,
  textarea: document.querySelectorAll('.mdh-editor-input').length,
  editingClass: document.querySelectorAll('.mdh-editing').length,
}));
check('双击进入编辑（默认手势）', editing.textarea > 0, JSON.stringify(editing));

// Esc 关闭编辑
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
const afterEsc = await page.evaluate(() => ({
  editor: document.querySelectorAll('.mdh-editor').length,
  selected: document.querySelectorAll('.mdh-selected').length,
}));
check('Esc 关闭编辑并清除选中', afterEsc.editor === 0 && afterEsc.selected === 0,
  JSON.stringify(afterEsc));

check('无 JS 异常', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} 通过`);
if (failed.length) process.exit(1);
