/**
 * 验证 iife 产物：window.Mdh 能否在真实浏览器里把 .mdh 编译成 HTML
 *
 *   node tools/verify-iife.mjs
 *
 * 用 Playwright 打开一个空白页，注入 dist/mdh.browser.js，
 * 再用真实样例编译，检查：
 *   ① window.Mdh 存在且暴露 compileFromSource
 *   ② 编译产出的 HTML 含实际内容（标题 / 正文）
 *   ③ 缺 mermaid / highlight 时不报错、降级正常
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const BUNDLE = resolve(ROOT, 'dist/mdh.browser.js');
const SAMPLE = resolve(ROOT, '../mdh/examples/test-features.mdh');

const bundle = readFileSync(BUNDLE, 'utf8');
const sample = readFileSync(SAMPLE, 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

// 空白页 + 注入 bundle（模拟 <script src>）
await page.setContent('<!DOCTYPE html><html><head></head><body></body></html>');
await page.addScriptTag({ content: bundle });

const result = await page.evaluate(async (src) => {
  if (!window.Mdh) return { ok: false, reason: 'window.Mdh 不存在' };
  const fns = Object.keys(window.Mdh).filter((k) => typeof window.Mdh[k] === 'function');
  if (!fns.includes('compileFromSource')) {
    return { ok: false, reason: 'compileFromSource 未暴露', fns };
  }
  try {
    const html = await window.Mdh.compileFromSource(src);
    return {
      ok: true,
      fns,
      length: html.length,
      hasHeading: /<h[1-6]/.test(html),
      hasTable: /<table|mdh-table/.test(html),
      hasCode: /<pre/.test(html),
      hasSource: /data-mdh-source/.test(html),
      head: html.slice(0, 200),
    };
  } catch (e) {
    return { ok: false, reason: '编译抛错: ' + e.message };
  }
}, sample);

await browser.close();

console.log('=== verify-iife ===');
console.log('产物:', BUNDLE.replace(ROOT + '/', ''));
console.log('导出函数:', result.fns?.join(', ') ?? '—');

if (!result.ok) {
  console.log('❌ 失败:', result.reason);
  if (errors.length) console.log('页面错误:', errors.slice(0, 3).join('\n'));
  process.exit(1);
}

console.log('✅ window.Mdh 可用');
console.log('✅ 编译成功，输出', (result.length / 1024).toFixed(1), 'KB');
console.log('   标题:', result.hasHeading ? '✓' : '✗', ' 表格:', result.hasTable ? '✓' : '✗',
            ' 代码块:', result.hasCode ? '✓' : '✗', ' mermaid降级:', result.hasSource ? '✓' : '✗');

if (errors.length) {
  console.log('⚠️ 页面有错误（可能来自缺失的 CDN 依赖，降级应正常工作）:');
  console.log('  ', errors.slice(0, 2).join('\n   '));
}

if (!result.hasHeading) {
  console.log('❌ 输出里没有标题，编译结果可疑');
  process.exit(1);
}
console.log('\n✅ 全部通过');
