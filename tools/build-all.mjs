/**
 * 打包「一个 script 搞定」的全量浏览器包
 *
 *   node tools/build-all.mjs
 *   → dist/mdh.all.js   （约 650KB）
 *
 * ── 解决什么问题 ──
 * 用 mdh-kit 本来要引四个 script 再加一个 import：
 *
 *   <script src="mdh.browser.js"></script>
 *   <script src="mdh-render.browser.js"></script>
 *   <script src="mdh-interact-core.js"></script>
 *   <script src="mdh-interact.js"></script>
 *   <script type="module">import { mount } from 'mdh-kit/mount'</script>
 *
 * 顺序错一个就白屏，而且没有打包器的用户根本引不进来。
 * 这个文件把五样合成一样，暴露 `window.MdhKit`。
 *
 * ── 为什么是「拼接」而不是「esbuild 打成一个大 bundle」 ──
 * 这五个文件里，前四个是 IIFE（各自往 window 上挂东西），mount 是 ESM。
 * 如果全交给 esbuild 打包，它会把 mount 对 `window.Mdh` 的引用
 * 静态解析成模块依赖，反而拿不到运行时挂上去的全局。
 * 所以做法是：先各自打包成可以顺序执行的片段，再按依赖顺序拼起来。
 */
import { build } from 'esbuild';
import { readFileSync, writeFileSync, statSync } from 'node:fs';

const OUT = 'dist/mdh.all.js';

/* ---------- ① 四个 IIFE：引擎 / 渲染器 / 交互能力 / 交互手势 ---------- */

/**
 * 引擎（含 katex + mermaid + highlight.js + chart.js）
 *
 * ⚠️ 这里**不能**把 mermaid / highlight.js 列为 external（2026-11-25 修）：
 *    `mdh.all.js` 对外的承诺是「一个 script 搞定全部，什么都不用另装」，
 *    排除掉它们之后，一旦文档里出现 `***mermaid` 或代码高亮，
 *    运行时就会抛「缺少必需依赖：mermaid」—— 用户明明只引了一个 script。
 *
 *    教训：`mdh.browser.js`（四段式接入）可以外置依赖，
 *    因为那种用法本来就让宿主自己装；但 all-in-one 必须真的一体。
 */
async function buildEngine() {
  const r = await build({
    entryPoints: ['packages/mdh-compile/src/browser/standalone.ts'],
    bundle: true,
    format: 'iife',
    globalName: 'Mdh',
    target: ['es2020'],
    minify: true,
    legalComments: 'none',
    write: false,
    logLevel: 'warning',
  });
  return r.outputFiles[0].text;
}

/** 单块渲染器（编辑时用） */
async function buildRenderer() {
  const r = await build({
    entryPoints: ['packages/mdh-theme/src/browser-entry.ts'],
    bundle: true,
    format: 'iife',
    target: ['es2020'],
    minify: true,
    legalComments: 'none',
    write: false,
    logLevel: 'warning',
  });
  return r.outputFiles[0].text;
}

/* ---------- ② mount：打包成可直接执行的片段 ---------- */

/**
 * mount 原本是 ESM（`import { mount } from 'mdh-kit/mount'`）。
 * 这里把它打成 IIFE，并挂到 `window.MdhKit` 上。
 * 它依赖的 `window.Mdh` / `window.MDHRender` / `window.MDHInteract`
 * 由前面三段先跑出来，所以顺序必须在前。
 */
async function buildMount() {
  const r = await build({
    entryPoints: ['src/mount-entry.ts'],
    bundle: true,
    format: 'iife',
    globalName: 'MdhKit',
    target: ['es2020'],
    minify: true,
    legalComments: 'none',
    write: false,
    // 这两个是运行时全局，不参与打包
    external: [],
    logLevel: 'warning',
  });
  return r.outputFiles[0].text;
}

/* ---------- ③ 拼起来 ---------- */

const engine = await buildEngine();
const renderer = await buildRenderer();
const interactCore = readFileSync(
  'packages/mdh-theme/src/mdh-interact-core.js',
  'utf8',
);
const interact = readFileSync('packages/mdh-theme/src/mdh-interact.js', 'utf8');
const mount = await buildMount();

/**
 * 样式：直接内联进这个文件
 *
 * 一个 script 搞定，就不能再要求用户另引一份 CSS。
 * 用 `<style>` 注入到 `<head>`（而不是 import CSS），因为它要在
 * 任何宿主环境（Electron inline、iframe、纯 HTML）都能生效。
 */
const css = readFileSync('packages/mdh-theme/themes/default.css', 'utf8');
const cssInjector = `
/* ⑥ 默认主题样式（内联，避免用户还要引一份 CSS） */
(function () {
  if (typeof document === 'undefined') return;
  var id = 'mdh-kit-style';
  if (document.getElementById(id)) return;
  var st = document.createElement('style');
  st.id = id;
  st.textContent = ${JSON.stringify(css)};
  document.head.appendChild(st);
})();
`;

const parts = [
  '/* mdh-kit all-in-one */',
  '/* ① 引擎：解析 + 渲染 + 公式 + 图表 */',
  engine,
  '/* ② 单块渲染器（编辑时用） */',
  renderer,
  '/* ③ 交互能力：select / clear / copyId / edit */',
  interactCore,
  '/* ④ 交互手势：单击选中 + 双击复制 + Esc */',
  interact,
  '/* ⑤ 挂载入口：window.MdhKit.mount(el, setting, callbacks) */',
  mount,
  cssInjector,
];

writeFileSync(OUT, parts.join('\n'));

const kb = (statSync(OUT).size / 1024).toFixed(0);
console.log(`✅ ${OUT}  ${kb}KB  一个 script 搞定全部`);
