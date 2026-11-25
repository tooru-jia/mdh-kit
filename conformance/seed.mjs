/**
 * 批量生成 conformance 用例文件（只含 source + 说明，ids 待填）
 *
 *   node conformance/seed.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES = join(HERE, 'cases');
mkdirSync(CASES, { recursive: true });

const cases = [
  ['01-top-level-order', '覆盖规则 2 —— 顶层块的顺序即序号：第 1 个块拿 M1，第 2 个拿 M2，与块类型无关',
    '# 标题\n\n第一段。\n\n第二段。'],

  ['02-nesting-depth', '覆盖规则 5 —— 嵌套关系决定层级：裸列表的分组节点不占号，项是 M1，子项进下一层 M1-N1',
    '- 项一\n- 项二\n  - 子项'],

  ['03-sibling-count', '覆盖规则 2 —— 每层独立计数：同一父节点下的兄弟按出现顺序 1,2,3',
    '- a\n- b\n- c\n- d'],

  ['04-o-pool-flat', '覆盖规则 1 —— 超过 3 层压回 O 池：第 4 层不再加段（不是 M1-N1-O1-P1），序号接着 O 排成 O2',
    '- a\n  - b\n    - c\n      - d'],

  ['05-quote-child', '覆盖规则 3 —— 引用是内容型：引用 M1，里面内容进 M1-N1',
    '> 引用一句'],

  ['06-quote-nested-list', '覆盖规则 3 —— 引用里的列表：引用 M1 → 列表 M1-N1 → 项 M1-N1-O1',
    '> - a\n> - b'],

  ['07-table-row', '覆盖规则 7 —— 表格是内容型：表格 M1，行是 M1-N1、M1-N2；单元格不生成 ID',
    '***table\nhead: A, B\n- 1, 2\n- 3, 4\n***table-end'],

  ['08-column-no-reset', '覆盖规则 5·补 —— 分栏是声明型：分栏 M1，栏是平级内容 M2，栏内内容进 M2-N1',
    '***column(1fr)\n\t- abc\n\n***column-end'],

  ['09-column-multi', '覆盖规则 5·补 —— 多栏：分栏 M1，每栏与它平级占 M2、M3、M4；栏内内容各进一层（M2-N1、M3-N1、M4-N1）',
    '***column(1fr/1fr/1fr)\n甲\n@next-column\n乙\n@next-column\n丙\n***column-end'],

  ['10-slides', '覆盖规则 3 —— slides：页是声明型顶层，页 M1、M2；页内内容与页平级编号',
    '@page(slides)\n# 一页\n正文\n@next-slide\n# 二页'],

  ['11-explicit-list-block', '覆盖规则 3 —— ***list 是声明型：声明 M1，项是平级内容 M2、M3；裸列表的项则是 M1、M2',
    '***list\n- 项一\n- 项二\n***list-end'],

  ['12-divider-is-block', '覆盖规则 8 —— 分割线是独立块，占一个 M 号，不是段落的一部分',
    '正文\n\n---\n\n正文'],

  ['13-mixed-document', '覆盖规则 2 —— 混合文档：各类块按出现顺序依次拿 M 号；块内内容进它的下一层',
    '# 标题\n\n段落。\n\n- 项一\n- 项二\n\n> 引用\n\n***table\nhead: A\n- 1\n***table-end\n\n---'],

  // 14：顶格写的块与列表项平级（都是声明型 list 平级的内容）
  ['14-list-contains-block', '覆盖规则 4·补 —— ***list 里顶格写 table：与列表项平级，依次拿 M2、M3、M4',
    '***list\n\n- 项一\n\n***table\nhead: A\n- 1\n***table-end\n\n- 项二\n\n***list-end'],

  ['15-list-nested-block', '覆盖规则 3 —— ***list 里再放 ***list：内层 list 也是平级内容，占下一个 M 号',
    '***list\n\n- 项一\n\n***list\n\n- 子项\n\n***list-end\n\n***list-end'],

  // 16/17：缩进写的块属于那一项，进它的下一层
  ['16-item-nested-table', '覆盖规则 4 —— 列表项下面缩进的 table 是项的子块：项 M2 → 表格 M2-N1 → 行 M2-N1-O1',
    '***list\n\n- 项一\n\n  ***table\n  head: a\n  - 1\n  ***table-end\n\n- 项二\n\n***list-end'],

  ['17-item-nested-multi', '覆盖规则 4 —— 一个项下面嵌多个块：按出现顺序依次拿子序号（M2-N1、M2-N2…）',
    '***list\n\n- 项一\n\n  ***math\nE=mc^2\n  ***math-end\n\n  ***table\n  head: a\n  - 1\n  ***table-end\n\n***list-end'],

  // 18：裸列表的分组节点不占号（id 为空串），项直接排到父级
  ['18-bare-list-no-slot', '覆盖规则 5 —— 裸列表的分组节点不占号（id 为空串），项直接是父级的子集',
    '正文\n\n- 甲\n- 乙'],

  // 19：slides 里的深层嵌套 —— 页占一段，页内 3 层就顶到 4 段
  ['19-slides-deep-nesting', '覆盖规则 6 —— slides 里页占一段，页内嵌套到第 3 层时压回 O 池（不出现第 4 段）',
    '@page(slides)\n> 第一层\n>\n> > 第二层\n> >\n> > > 第三层'],

  // 20：表格的单元格不生成 ID —— 只有行有，单元格没有
  ['20-table-cell-no-id', '覆盖规则 7 —— 表格只有行有 ID，单元格不生成 ID（表头行 + 数据行各占一个）',
    '***table\nhead: A, B, C\n- 1, 2, 3\n- 4, 5, 6\n***table-end'],

  // 21：顶格块与缩进块混在一起的完整编号
  ['21-mixed-sibling-and-child', '覆盖规则 4 —— 同一个列表里既有顶格块（与项平级）又有缩进块（项的子块），两者编号各归各位',
    '***list\n- 项一\n\n***table\nhead: a\n- 1\n***table-end\n\n- 项二\n\n  ***math\nE=mc^2\n  ***math-end\n\n***list-end'],
];

for (const [name, note, source] of cases) {
  writeFileSync(join(CASES, `${name}.json`), JSON.stringify({ name, note, source }, null, 2) + '\n');
}
console.log(`已生成 ${cases.length} 个用例`);
