/**
 * 验证 SYNTAX-INTRODUCTION.md 里的例子能跑
 *
 * 文档里的每个示例都要真实解析 + 渲染一遍，不能「看着对」。
 */
import { readFileSync } from 'node:fs';
import { parse } from '../packages/mdh-core/src/index.ts';
import { render } from '../packages/mdh-render/src/index.ts';

const doc = readFileSync('docs/SYNTAX-INTRODUCTION.md', 'utf8');

// 挖出所有 ```mdh 代码块
const blocks = [...doc.matchAll(/```mdh\n([\s\S]*?)```/g)].map((m) => m[1]);

let bad = 0;
blocks.forEach((src, i) => {
  try {
    const r = parse(src);
    const html = render(r.ast);
    const errs = (r.diagnostics || []).filter((d) => d.level === 'error');
    const badge = errs.length ? `⚠ 错误 ${errs.length}` : '✔';
    console.log(`示例 ${i + 1}: ${badge}  AST ${r.ast.children.length} 块 / HTML ${html.length} 字符`);
    if (!html) {
      console.log('  ✖ 渲染为空');
      bad++;
    }
  } catch (e) {
    console.log(`示例 ${i + 1}: ✖ 抛错 ${e.message.slice(0, 60)}`);
    bad++;
  }
});

console.log(`\n共 ${blocks.length} 个示例，${bad === 0 ? '全部可跑' : bad + ' 个有问题'}`);
if (bad) process.exit(1);
