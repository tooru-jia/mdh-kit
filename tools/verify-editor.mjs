import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

await page.goto('file:///Users/toru/Private/Workspace/mdj_project/mdh-kit/stress/test-html.html');
await page.waitForTimeout(600);

const results = [];
const check = (n, ok, d) => results.push({ n, ok, d });

const cases = [
  ['代码块', 'pre.mdh-code'],
  ['分割线', 'hr.mdh-divider'],
  ['公式', '.mdh-math'],
];

for (const [name, sel] of cases) {
  const el = page.locator(sel).first();
  if (!(await el.count())) { check(name, false, '元素不存在'); continue; }

  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  await el.dblclick();
  await page.waitForTimeout(400);

  const r = await page.evaluate(() => {
    const ed = document.querySelector('.mdh-editor');
    if (!ed) return { noEditor: true };
    const b = ed.getBoundingClientRect();
    const ta = ed.querySelector('.mdh-editor-input');
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return {
      inViewport: b.x >= 0 && b.y >= 0 && b.right <= vw && b.bottom <= vh,
      box: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) },
      vp: { vw, vh },
      srcLen: (ta?.value || '').length,
      srcHead: (ta?.value || '').slice(0, 40),
      textareaFits: ta ? ta.scrollHeight <= ta.clientHeight + 2 : false,
      parentIsBody: ed.parentElement === document.body,
    };
  });

  check(`${name}：编辑器出现`, !r.noEditor, r.noEditor ? '未出现' : '');
  if (!r.noEditor) {
    check(`${name}：完整在视口内`, r.inViewport, JSON.stringify(r.box));
    check(`${name}：挂在 body 上（不被裁）`, r.parentIsBody);
    check(`${name}：源码可见`, r.srcLen > 0, r.srcHead);
    check(`${name}：内容不被截断`, r.textareaFits);
  }

  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const gone = await page.evaluate(() => !document.querySelector('.mdh-editor'));
  check(`${name}：Esc 关闭`, gone);
}

check('无 JS 错误', errs.length === 0, errs.join(' | '));

await browser.close();

console.log('\n══════ 编辑器验证 ══════');
for (const r of results) console.log(`${r.ok ? '✔' : '✖'} ${r.n}${r.d ? '  → ' + r.d : ''}`);
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} 通过`);
process.exit(fail ? 1 : 0);
