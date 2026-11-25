/**
 * 看看渲染层产出的 HTML 长什么样
 *
 *   node tools/preview-render.mjs
 */
import { parse } from '../packages/mdh-core/src/index.ts';
import { createRenderer, render } from '../packages/mdh-render/src/index.ts';

const SRC = `# 时态对比

三个月内把日常对话撑下来。

***table name="时态" caption="三种最常见的时态"
head: 时态, 结构
- 一般现在时, do
- 过去时, did
***table-end

见表 @时态 可知。

***math name="emc"
E = mc^2
***math-end

***chart(bar) name="销量"
head: 月份, 值
- 一月, 100
***chart-end
`;

const ast = parse(SRC).ast;

console.log('══════════ 1. 完整 HTML ══════════\n');
console.log(render(ast));

console.log('\n══════════ 2. 编号查询 ══════════\n');
const r = createRenderer(ast);
for (const name of ['时态', 'emc', '销量']) {
  const id = r.resolveReference(name);
  console.log(`${name.padEnd(6)} → ${id}  编号：${r.getNumber(id)}`);
}

console.log('\n══════════ 3. 引用索引 ══════════\n');
console.log('「时态」被这些节点引用：', r.getReferrers('时态'));

console.log('\n══════════ 4. 删掉第一张表后，编号怎么变 ══════════\n');
const tableId = r.resolveReference("时态");
r.remove(tableId);
console.log('删除后，受影响的节点：', r.lastAffected().join(', '));
console.log('\n' + r.toHtml());
