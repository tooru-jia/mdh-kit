/**
 * 超长文档性能测试
 *
 * 量三件事：解析、渲染、以及「带公式和表格的大文档」会不会卡。
 *
 *   node --experimental-strip-types --no-warnings tools/bench-longdoc.mjs
 */
import { parse } from '../packages/mdh-core/src/index.ts';
import { createRenderer, render } from '../packages/mdh-render/src/index.ts';

/** 造一份指定块数的文档（混合类型，接近真实长文档） */
function makeDoc(blocks) {
  const parts = [];
  for (let i = 0; i < blocks; i++) {
    const n = i % 10;
    if (n === 0) parts.push(`# 第 ${i} 节`);
    else if (n === 1) parts.push(`这是第 ${i} 段正文，包含 **粗体** 和 \`行内代码\`。`);
    else if (n === 2) parts.push('- 列表项一\n- 列表项二\n  - 子项');
    else if (n === 3) parts.push('> 引用内容');
    else if (n === 4) parts.push('***table\nhead: A, B\n- 1, 2\n- 3, 4\n***table-end');
    else if (n === 5) parts.push('```ts\nconst a = 1;\n```');
    else if (n === 6) parts.push('行内公式 $E=mc^2$ 的段落。');
    else if (n === 7) parts.push('---');
    else parts.push(`普通段落 ${i}。`);
  }
  return parts.join('\n\n');
}

function bench(label, fn) {
  const t0 = performance.now();
  const out = fn();
  const ms = performance.now() - t0;
  console.log(`${label.padEnd(28)} ${ms.toFixed(1).padStart(8)} ms`);
  return { ms, out };
}

const SIZES = [100, 500, 1000, 2000, 5000];

console.log('块数      解析(ms)   渲染(ms)   全部(ms)   HTML');
console.log('─'.repeat(58));

for (const n of SIZES) {
  const src = makeDoc(n);
  const p = bench('', () => parse(src));
  const r = bench('', () => render(p.out.ast));

  // 建 renderer + 取整篇 HTML（这是 mount() 的真实路径）
  const all = bench('', () => {
    const renderer = createRenderer(p.out.ast);
    return renderer.toHtml();
  });

  console.log(
    `${String(n).padEnd(10)}${p.ms.toFixed(0).padStart(8)}  ${r.ms.toFixed(0).padStart(8)}  ${all.ms
      .toFixed(0)
      .padStart(8)}  ${(all.out.length / 1024).toFixed(0)}KB`,
  );
}

// ID 唯一性（大文档最容易在这里翻车）
const big = makeDoc(2000);
const ast = parse(big).ast;
const ids = [];
const walk = (node) => {
  if (node && node.id) ids.push(node.id);
  for (const key of ['children', 'rows', 'slides']) {
    if (Array.isArray(node[key])) node[key].forEach(walk);
  }
  if (Array.isArray(node.columnBlocks)) node.columnBlocks.forEach((l) => l.forEach(walk));
};
walk(ast);
const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
console.log(`\n2000 块：ID 共 ${ids.length} 个，重复 ${dup.length} 个${dup.length ? ' ← ' + dup.slice(0, 5).join(',') : ' ✔'}`);
