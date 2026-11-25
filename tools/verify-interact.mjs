/**
 * 验证交互：点击选中、双击编辑、改完保存
 *
 *   node tools/verify-interact.mjs
 */
import { chromium } from 'playwright';
import { resolve } from 'node:path';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });

const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});

await page.goto('file://' + resolve('showcase.html'));
await page.waitForTimeout(500);

const results = [];
const check = (name, ok, detail) => results.push({ name, ok, detail });

// 1. 运行时是否加载
const hasRuntime = await page.evaluate(
  () => typeof window.MDHRender === 'function' && typeof window.MDHCore === 'object',
);
check('运行时加载', hasRuntime);

// 2. 点击选中
const heading = page.locator('.mdh-heading-2').first();
await heading.click();
await page.waitForTimeout(150);

const selected = await page.evaluate(() => {
  const el = document.querySelector('.mdh-selected');
  const badge = el?.querySelector('.mdh-id-badge');
  return {
    hasSelected: !!el,
    id: el?.getAttribute('data-mdh-id'),
    badgeText: badge?.textContent || '',
    badgeVisible: badge ? badge.getBoundingClientRect().height > 0 : false,
  };
});
check('点击选中', selected.hasSelected);
check('显示 ID 徽标', selected.badgeVisible, selected.badgeText);

// 3. 双击进入编辑
await heading.dblclick();
await page.waitForTimeout(200);

const editorState = await page.evaluate(() => {
  const ed = document.querySelector('.mdh-editor');
  const ta = ed?.querySelector('.mdh-editor-input');
  return {
    hasEditor: !!ed,
    content: ta?.value || '',
    visible: ed ? ed.getBoundingClientRect().height > 0 : false,
  };
});
check('双击打开编辑器', editorState.hasEditor && editorState.visible);
check('编辑器载入源码', editorState.content.startsWith('##'), JSON.stringify(editorState.content));

// 4. 修改内容并保存
await page.fill('.mdh-editor-input', '## 改过的标题（交互测试）');
await page.click('.mdh-editor-bar button[data-act="save"]');
await page.waitForTimeout(300);

const afterSave = await page.evaluate(() => ({
  hasEditor: !!document.querySelector('.mdh-editor'),
  text: document.querySelector('.mdh-heading-2')?.textContent || '',
  html: document.querySelector('.mdh-document')?.innerHTML.length || 0,
}));
check('保存后编辑器关闭', !afterSave.hasEditor);
check('内容已更新', afterSave.text.includes('改过的标题'), afterSave.text);

// 5. 截图
await page.screenshot({ path: 'screenshots/shot-interact.png', fullPage: false });

// 6. 无 JS 错误
check('无 JS 错误', errors.length === 0, errors.join(' | '));

await browser.close();

console.log('\n══════ 交互验证 ══════');
for (const r of results) {
  console.log(`${r.ok ? '✔' : '✖'} ${r.name}${r.detail ? '  → ' + r.detail : ''}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} 通过`);
process.exit(failed === 0 ? 0 : 1);
