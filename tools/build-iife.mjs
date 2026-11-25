/**
 * 打包浏览器端可直接 <script src> 引入的引擎
 *
 *   node tools/build-iife.mjs
 *
 * 产出两个文件，对应四档导出的技术配置：
 *
 *   dist/mdh.browser.js       mdh + katex + chart.js，约 500KB
 *                             → A 档（单文件内嵌）/ C 档（多文件共用一份）
 *                             mermaid 与 highlight 从 CDN 或本地文件加载
 *
 *   dist/mdh.browser.cdn.js   只有 mdh 本体，约 35KB
 *                             → B 档（在线版）：全部第三方库走 CDN
 *
 * 全局变量 window.Mdh，用法：
 *
 *   const html = await Mdh.compileFromSource(source)
 *   document.querySelector('#root').innerHTML = html
 *
 * 为什么 mermaid / highlight 不内嵌：
 *   mermaid 及其依赖（elkjs 1.5MB、cytoscape 447KB）合计近 6MB，
 *   highlight 全量版 800KB —— 两者都足够稳定，外链即可。
 *   加载失败时降级：mermaid 显示源码、highlight 输出纯文本，内容不受影响。
 */
import { build } from 'esbuild';
import { statSync, mkdirSync } from 'node:fs';

const ENTRY = 'packages/mdh-compile/src/browser/index.ts';
const OUT_DIR = 'dist';

// esbuild 的 outfile 不会自动建目录
mkdirSync(OUT_DIR, { recursive: true });

/** 外链依赖：由页面的 MDH_CONFIG 提供 */
const EXTERNAL = ['mermaid', 'highlight.js', 'highlight.js/lib/common'];

const base = {
  bundle: true,
  format: 'iife',
  globalName: 'Mdh',
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
};

const targets = [
  {
    entryPoints: ['packages/mdh-compile/src/browser/standalone.ts'],
    outfile: `${OUT_DIR}/mdh.browser.js`,
    // 内嵌 katex + chart.js，外链 mermaid + highlight
    external: EXTERNAL,
    label: 'A/C 档：内嵌 公式+图表',
  },
  {
    entryPoints: [ENTRY],
    outfile: `${OUT_DIR}/mdh.browser.cdn.js`,
    // 全部第三方库外链（页面提供 window.katex / window.Chart / window.hljs / window.mermaid）
    external: [...EXTERNAL, 'katex', 'chart.js', 'chart.js/auto'],
    label: 'B 档：全外链',
  },
];

for (const t of targets) {
  await build({
    ...base,
    entryPoints: t.entryPoints,
    outfile: t.outfile,
    external: t.external,
  });
  const kb = (statSync(t.outfile).size / 1024).toFixed(0);
  console.log(`✅ ${t.outfile.padEnd(30)} ${kb.padStart(5)} KB   ${t.label}`);
}
