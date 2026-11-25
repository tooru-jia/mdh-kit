/**
 * 校验「ID-SPEC 文档里写的例子」和「实现的真实输出」是否一致
 *
 *   node --experimental-strip-types tools/verify-id-doc.mjs
 *
 * 文档是核心契约，例子写错比措辞不准更危险 ——
 * 别人照着例子实现，结果和 mdh-kit 对不上。
 */
import { parse } from '../packages/mdh-core/src/index.ts';

/** 文档里写的例子 → 期望的 ID 序列 */
const cases = [
  ['规则3 声明型 list', '***list\n- 项一\n- 项二\n***list-end', ['M1', 'M2', 'M3']],
  ['规则3 声明型 column', '***column(1fr/1fr)\n左栏\n@next-column\n右栏\n***column-end', ['M1', 'M2', 'M2-N1', 'M3', 'M3-N1']],
  ['规则3 内容型 table', '***table\nhead: a\n- 甲, 1\n***table-end', ['M1', 'M1-N1']],
  ['规则3 内容型 引用', '> 引用正文', ['M1', 'M1-N1']],
  ['规则4 顶格 table', '***list\n- 项一\n\n***table\nhead: a\n- 1\n***table-end\n\n- 项二\n***list-end', ['M1', 'M2', 'M3', 'M3-N1', 'M4']],
  ['规则4 缩进 table', '***list\n- 项一\n\n  ***table\n  head: a\n  - 1\n  ***table-end\n***list-end', ['M1', 'M2', 'M2-N1', 'M2-N1-O1']],
  ['规则5 裸列表', '- 项一\n- 项二', ['M1', 'M2']],
  ['规则5 显式 list', '***list\n- 项一\n- 项二\n***list-end', ['M1', 'M2', 'M3']],
  ['规则5 table 行', '***table\nhead: a\n- 甲, 1\n- 乙, 2\n***table-end', ['M1', 'M1-N1', 'M1-N2']],
  ['规则5补 分栏', '***column(1fr/1fr)\n左\n@next-column\n右\n***column-end', ['M1', 'M2', 'M2-N1', 'M3', 'M3-N1']],
  ['规则6 三层引用', '> 第一层\n>\n> > 第二层\n> >\n> > > 第三层', ['M1', 'M1-N1', 'M1-N2', 'M1-N2-O1', 'M1-N2-O2']],
  ['规则1 深嵌套压 O', '- a\n  - b\n    - c\n      - d', ['M1', 'M1-N1', 'M1-N1-O1', 'M1-N1-O2']],
  ['规则4补 夹块顺序', '***list\n- 项一\n\n***table\nhead: a\n- 1\n***table-end\n\n- 项二\n***list-end', ['M1', 'M2', 'M3', 'M3-N1', 'M4']],
];

const collect = (ast) => {
  const out = [];
  const w = (n) => {
    if (!n || !n.type) return;
    if (n.id) out.push(n.id);

    // 列表：项和夹在中间的块按源位置合并（和实现同一规则）
    const kids = n.children ?? [];
    const blocks = (n.blocks ?? []).filter((b) => b?.node);
    const itemPos = n.itemPos ?? [];
    if (n.type === 'list' && blocks.length && itemPos.length === kids.length) {
      const merged = [
        ...kids.map((c, i) => ({ at: itemPos[i] ?? 1e9, node: c })),
        ...blocks.map((b) => ({ at: b.pos ?? 1e9, node: b.node })),
      ].sort((a, b) => a.at - b.at);
      merged.forEach((x) => w(x.node));
    } else {
      kids.forEach(w);
      blocks.forEach((b) => w(b.node));
    }

    // 分栏：栏号在 columnIds 里（栏没有独立节点，只有 ID）
    if (Array.isArray(n.columnBlocks)) {
      const merged = [];
      const colIds = n.columnIds ?? [];
      n.columnBlocks.forEach((col, i) => {
        if (!Array.isArray(col)) return;
        merged.push({ col, colId: colIds[i] });
      });
      for (const { col, colId } of merged) {
        if (colId) out.push(colId);
        col.forEach(w);
      }
      return;
    }

    (n.rows ?? []).forEach(w);
    (n.slides ?? []).forEach(w);
  };
  w(ast);
  return out.filter((x) => x !== 'R'); // 根节点不参与比对
};

let fail = 0;
for (const [name, src, expected] of cases) {
  const got = collect(parse(src).ast);
  // 忽略裸列表分组节点的空 id
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) {
    fail++;
    console.log(`✖ ${name}`);
    console.log(`   期望 ${expected.join(' ')}`);
    console.log(`   实得 ${got.join(' ')}`);
  } else {
    console.log(`✔ ${name}  →  ${got.join(' ')}`);
  }
}
console.log(`\n${cases.length - fail} / ${cases.length} 与文档一致`);
process.exit(fail ? 1 : 0);
