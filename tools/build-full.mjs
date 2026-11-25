/**
 * 完整编译演示：骨架 + 公式 + 代码高亮 + Mermaid
 *
 *   node tools/build-full.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from '../packages/mdh-core/src/index.ts';
import { compile } from '../packages/mdh-compile/src/index.ts';

const F = String.fromCharCode(96);

const DOC = `# 完整能力演示

这段包含 **加粗**、/斜体/、__下划线__、--删除线-- 和行内代码 ${F}const x = 1${F}。

行内公式 $E = mc^2$ 与块级公式：

***math name="emc"
\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}
***math-end

## 代码

${F}${F}${F}ts title="greet.ts"
interface User {
  id: number;
  name: string;
}

export function greet(user: User): string {
  return "Hello, " + user.name;
}
${F}${F}${F}

## Mermaid 流程图

***mermaid name="流程" caption="登录流程"
graph TD
  A[开始] --> B{已登录?}
  B -->|是| C[首页]
  B -->|否| D[登录页]
***mermaid-end
`;

const t0 = performance.now();
const ast = parse(DOC).ast;
const html = await compile(ast);
const t1 = performance.now();

const css = readFileSync(
  new URL('../packages/mdh-theme/themes/default.css', import.meta.url),
  'utf8',
);
const katexCss = readFileSync(
  new URL('../node_modules/katex/dist/katex.min.css', import.meta.url),
  'utf8',
);

const page = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>mdh 完整能力</title>
<style>${katexCss}</style>
<style>${css}</style>
</head><body>
${html}
</body></html>`;

writeFileSync('full.html', page, 'utf8');

console.log(`编译耗时：${(t1 - t0).toFixed(0)} ms`);
console.log(`产物大小：${(page.length / 1024).toFixed(1)} KB`);
console.log('检查：');
console.log('  KaTeX 排版   ', html.includes('class="katex"') ? '✔' : '✖');
console.log('  代码高亮     ', html.includes('class="hljs"') ? '✔' : '✖');
console.log('  Mermaid SVG  ', html.includes('<svg') ? '✔' : '✖');
console.log('  粗体标签     ', html.includes('<strong') ? '✔' : '✖');
