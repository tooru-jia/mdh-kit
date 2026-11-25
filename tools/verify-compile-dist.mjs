/**
 * 验证 @mdh-kit/compile 两个宿主入口的构建产物
 *
 * 重点：
 *   1. ESM / CJS 都能 import
 *   2. browser 入口不带 playwright（打包进浏览器不会炸）
 *   3. node 入口才带 playwright
 *   4. 两个入口导出面一致
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require_ = createRequire(import.meta.url);
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const DIST = 'packages/mdh-compile/dist';

// ── 1. ESM 导入 ──
const nodeEsm = await import(`../${DIST}/node/index.js`);
const browserEsm = await import(`../${DIST}/browser/index.js`);

check(
  'node 入口 ESM 可导入',
  typeof nodeEsm.compileFromSource === 'function',
  Object.keys(nodeEsm).length + ' 个导出',
);
check(
  'browser 入口 ESM 可导入',
  typeof browserEsm.compileFromSource === 'function',
  Object.keys(browserEsm).length + ' 个导出',
);

// ── 2. 导出面一致 ──
const nodeKeys = Object.keys(nodeEsm).sort();
const browserKeys = Object.keys(browserEsm).sort();
const sameKeys = JSON.stringify(nodeKeys) === JSON.stringify(browserKeys);
check('两个入口导出名一致', sameKeys, sameKeys ? `${nodeKeys.length} 个` : `node=${nodeKeys} browser=${browserKeys}`);

for (const fn of ['compile', 'compileAst', 'compileFromSource', 'fullPlugins',
  'katexPlugin', 'highlightPlugin', 'mermaidPlugin', 'chartPlugin',
  'disposeMermaid', 'disposeChart']) {
  check(`导出 ${fn}`, typeof nodeEsm[fn] === 'function' && typeof browserEsm[fn] === 'function');
}

// ── 3. env 字段正确 ──
const nodePlugins = nodeEsm.fullPlugins();
const browserPlugins = browserEsm.fullPlugins();
check('node 插件 env 全为 node', nodePlugins.every((p) => p.env === 'node'),
  nodePlugins.map((p) => `${p.name}:${p.env}`).join(' '));
check('browser 插件 env 全为 browser', browserPlugins.every((p) => p.env === 'browser'),
  browserPlugins.map((p) => `${p.name}:${p.env}`).join(' '));

// ── 4. CJS 导入 ──
const nodeCjs = require_(`../${DIST}/node/index.cjs`);
const browserCjs = require_(`../${DIST}/browser/index.cjs`);
check('node 入口 CJS 可导入', typeof nodeCjs.compileFromSource === 'function');
check('browser 入口 CJS 可导入', typeof browserCjs.compileFromSource === 'function');

// ── 5. 关键：browser 产物不该引用 playwright ──
const browserCode = readFileSync(`${DIST}/browser/index.js`, 'utf8');
check(
  'browser 产物不含 playwright',
  !browserCode.includes('playwright'),
  browserCode.includes('playwright') ? '❌ 泄漏了' : '干净',
);

const nodeCode = readFileSync(`${DIST}/node/index.js`, 'utf8');
const nodeTouchesPlaywright =
  nodeCode.includes('playwright') || nodeCode.includes('import(');
check('node 产物保留 playwright 引用', nodeCode.includes('playwright'),
  nodeCode.includes('playwright') ? '有（按需动态加载）' : '❌ 丢了');

// ── 6. 第三方库不该被打进产物 ──
const thirdParty = ['katex', 'highlight.js', 'mermaid', 'chart.js'];
for (const lib of thirdParty) {
  const inBrowser = new RegExp(`node_modules/${lib.replace('.', '\\.')}`).test(browserCode);
  check(`${lib} 未被打进 browser 产物`, !inBrowser);
}

// ── 7. 实际编译一次（browser 入口，纯字符串部分）──
const src = `# 标题

行内公式 $E=mc^2$

\`\`\`ts
const x = 1;
\`\`\`
`;
const html = await browserEsm.compileFromSource(src, {}, [
  browserEsm.katexPlugin(),
  browserEsm.highlightPlugin(),
]);
check('browser 入口能编译（KaTeX + 代码高亮）',
  html.includes('class="katex"') && html.includes('code class="hljs"'));

// 骨架必须还在
check('骨架结构正确', html.includes('mdh-document') && html.includes('<h1'));

console.log('');
const failed = checks.filter((c) => !c.ok);
console.log(`${checks.length - failed.length}/${checks.length} 通过`);
if (failed.length) {
  failed.forEach((f) => console.log(`  ✘ ${f.name} ${f.detail}`));
  process.exit(1);
}
