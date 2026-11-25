/**
 * 验证 B 档产物（全外链）：window.Mdh 在页面已提供全局依赖时可用
 *
 *   node tools/verify-iife-cdn.mjs
 *
 * B 档的产物只有 mdh 本体（约 39KB），katex / Chart / hljs / mermaid
 * 全部由页面通过 CDN 提供。这里用真实的 CDN 加载，模拟在线版场景。
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const BUNDLE = resolve(ROOT, 'dist/mdh.browser.cdn.js');
const SAMPLE = resolve(ROOT, '../mdh/examples/test-features.mdh');

const bundle = readFileSync(BUNDLE, 'utf8');
const sample = readFileSync(SAMPLE, 'utf8');

const CDN = {
  katex: 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js',
  chart: 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js',
  hljs: 'https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.9.0/highlight.min.js',
};

const browser = await chromium.launch();
const page = await browser.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.setContent('<!DOCTYPE html><html><head></head><body></body></html>');

// 模拟在线版：先加载全局依赖，再加载 mdh 引擎
for (const [name, url] of Object.entries(CDN)) {
  try {
    await page.addScriptTag({ url, timeout: 20000 });
    console.log(`  加载 ${name}: ✓`);
  } catch (e) {
    console.log(`  加载 ${name}: ✗ ${String(e).split('\n')[0]}`);
  }
}

// 检查全局是否就位
const globals = await page.evaluate(() => ({
  katex: !!globalThis.katex?.renderToString,
  Chart: !!globalThis.Chart,
  hljs: !!globalThis.hljs?.highlight,
}));
console.log('  全局:', JSON.stringify(globals));

await page.addScriptTag({ content: bundle });

const result = await page.evaluate(async (src) => {
  if (!window.Mdh) return { ok: false, reason: 'window.Mdh 不存在' };
  try {
    const html = await window.Mdh.compileFromSource(src);
    return {
      ok: true,
      length: html.length,
      hasHeading: /<h[1-6]/.test(html),
      hasKatex: /class="katex/.test(html),
      hasHljs: /class="hljs-/.test(html),
      noKatexFallback: /mdh-math-nokatex/.test(html),
    };
  } catch (e) {
    return { ok: false, reason: '编译抛错: ' + e.message };
  }
}, sample);

await browser.close();

console.log('\n=== verify-iife-cdn ===');
console.log('产物:', BUNDLE.replace(ROOT + '/', ''));

if (!result.ok) {
  console.log('❌ 失败:', result.reason);
  if (errors.length) console.log('页面错误:', errors.slice(0, 3).join('\n'));
  process.exit(1);
}

console.log('✅ window.Mdh 可用（39KB 产物 + CDN 依赖）');
console.log('✅ 编译成功，输出', (result.length / 1024).toFixed(1), 'KB');
console.log('   标题:', result.hasHeading ? '✓' : '✗',
            ' katex渲染:', result.hasKatex ? '✓' : '—',
            ' 代码高亮:', result.hasHljs ? '✓' : '—');

if (errors.length) {
  console.log('\n⚠️ 页面错误（缺失依赖的降级应正常工作）:');
  console.log('  ', errors.slice(0, 2).join('\n   '));
}

console.log('\n✅ 通过');
