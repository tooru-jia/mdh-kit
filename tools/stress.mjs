/**
 * 压测：把 mdh/examples 下的真实文档渲染成 HTML
 *
 *   node tools/stress.mjs                         全部
 *   node tools/stress.mjs test-html test-longdoc  指定文件
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '../packages/mdh-core/src/index.ts';
import { compile, fullPlugins, disposeMermaid, disposeChart } from '../packages/mdh-compile/src/index.ts';
import { getKatexCss } from './lib/katex-css.mjs';

const SRC_DIR = '/Users/toru/Private/Workspace/mdj_project/mdh/examples';
const OUT_DIR = 'stress';
mkdirSync(OUT_DIR, { recursive: true });

/** 把旧语法转成新语法 */
function migrate(src) {
  let s = src;
  // :::list → ***list（旧样例可能残留）
  s = s.replace(/^:::([a-z]+)/gm, '***$1');
  s = s.replace(/^:::([a-z]+)-end$/gm, '***$1-end');
  // ----- → ---
  s = s.replace(/^-{5,}$/gm, '---');
  // ***page(...) → @page(...)；去掉 page-end
  s = s.replace(/^\*\*\*page\(([^)]*)\)[^\n]*$/gm, (m, p) =>
    p.startsWith('slides') ? '@page(slides)' : '',
  );
  s = s.replace(/^\*\*\*page-end\s*$/gm, '');
  // ***slide 块 → @next-slide
  s = s.replace(/^\s*\*\*\*slide[^\n]*$/gm, '@next-slide');
  s = s.replace(/^\s*\*\*\*slide-end\s*$/gm, '');
  // ***slide 分页（裸 *** 在 page 内）→ @next-slide
  s = s.replace(/^\s*\*\*\*\s*$/gm, '@next-slide');
  return s;
}

const css = readFileSync(
  new URL('../packages/mdh-theme/themes/default.css', import.meta.url),
  'utf8',
);
const katexCss = getKatexCss();

const args = process.argv.slice(2);
const files = args.length
  ? args.map((a) => (a.endsWith('.mdh') ? a : a + '.mdh'))
  : readdirSync(SRC_DIR).filter((f) => f.endsWith('.mdh'));

console.log('══════ 压测 ══════\n');

for (const f of files) {
  const raw = readFileSync(join(SRC_DIR, f), 'utf8');
  const src = migrate(raw);
  const t0 = performance.now();

  let ast, html, err = null;
  try {
    const r = parse(src);
    ast = r.ast;
    const errs = r.diagnostics.filter((d) => d.level === 'error');
    if (errs.length) err = `解析错误 ${errs.length} 条：` + errs.slice(0, 3).map((e) => `L${e.line} ${e.message}`).join('; ');
    html = await compile(ast, { plugins: fullPlugins() });
  } catch (e) {
    err = e.message;
  }
  const ms = performance.now() - t0;

  const out = f.replace(/\.mdh$/, '.html');
  if (html && ast) {
    const runtime = readFileSync(
      new URL('../packages/mdh-theme/dist/mdh-render.browser.js', import.meta.url),
      'utf8',
    );
    // core 是纯能力层，interact 是默认手势层，必须先 core 后 interact
    const interactCore = readFileSync(
      new URL('../packages/mdh-theme/src/mdh-interact-core.js', import.meta.url),
      'utf8',
    );
    const interact = readFileSync(
      new URL('../packages/mdh-theme/src/mdh-interact.js', import.meta.url),
      'utf8',
    );
    const page = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>${f}</title><style>${katexCss}</style><style>${css}</style></head>
<body>${html}
<script>${runtime}</script>
<script>${interactCore}</script>
<script>${interact}</script>
<script>
  var ast = ${JSON.stringify(ast)};
  var renderer = window.MDHRender(ast);
  MDHInteract.attach(document.querySelector('.mdh-document'), renderer, {
    serializeNode: window.MDHCore.serializeNode,
    parseNode: window.MDHCore.parseNode
  });
</script>
</body></html>`;
    writeFileSync(join(OUT_DIR, out), page, 'utf8');
  }

  const size = html ? (html.length / 1024).toFixed(0) : '-';
  console.log(
    `${err ? '✖' : '✔'} ${f.padEnd(26)} ${String(ms.toFixed(0)).padStart(5)}ms  ${String(size).padStart(5)}KB  ${err || ''}`,
  );
}

// 释放 Playwright 浏览器，否则进程挂住不退出
await disposeMermaid();
await disposeChart();

console.log(`\n产物在 ${OUT_DIR}/`);
