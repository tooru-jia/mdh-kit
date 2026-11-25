import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../src/index.ts';
import type {
  ColumnNode,
  HeadingNode,
  ListNode,
  ParagraphNode,
  TableNode,
  GenericBlockNode,
} from '../../src/index.ts';

const asHeading = (n: unknown): HeadingNode => {
  assert.equal((n as HeadingNode).type, 'heading');
  return n as HeadingNode;
};
const asParagraph = (n: unknown): ParagraphNode => {
  assert.equal((n as ParagraphNode).type, 'paragraph');
  return n as ParagraphNode;
};
const asList = (n: unknown): ListNode => {
  assert.equal((n as ListNode).type, 'list');
  return n as ListNode;
};
const asTable = (n: unknown): TableNode => {
  assert.equal((n as TableNode).type, 'table');
  return n as TableNode;
};
const asColumn = (n: unknown): ColumnNode => {
  assert.equal((n as ColumnNode).type, 'column');
  return n as ColumnNode;
};
const asBlock = (n: unknown): GenericBlockNode => {
  assert.equal((n as GenericBlockNode).type, 'block');
  return n as GenericBlockNode;
};

// ---------- 基础语法 ----------

test('标题：# 后不要求空格，带空格也识别', () => {
  assert.equal(asHeading(parse('#我的笔记').ast.children[0]).text, '我的笔记');
  assert.equal(asHeading(parse('# 我的笔记').ast.children[0]).text, '我的笔记');
  assert.equal(asHeading(parse('### 三级').ast.children[0]).level, 3);
});

test('段落：1 回车换行，空行分段', () => {
  const { ast } = parse('第一行\n第二行\n\n新段落');
  assert.equal(ast.children.length, 2);
  assert.deepEqual(asParagraph(ast.children[0]).lines, ['第一行', '第二行']);
  assert.deepEqual(asParagraph(ast.children[1]).lines, ['新段落']);
});

test('注释：// 开头不产生节点（单行与多行）', () => {
  assert.equal(parse('// 注释\n正文').ast.children.length, 1);
  assert.equal(parse('// 一\n// 二\n正文').ast.children.length, 1);
});

test('分割线', () => {
  const { ast } = parse('上面\n\n-----\n\n下面');
  assert.equal(ast.children.length, 3);
  assert.equal(asBlock(ast.children[1]).blockName, 'divider');
});

test('引用块：连续 > 行属于同一引用，内容解析成子块', () => {
  const q = parse('> 第一行\n> 第二行\n\n正文').ast.children[0] as any;
  assert.equal(q.type, 'quote');
  // 两行属于同一引用，内容是一个段落
  assert.ok(Array.isArray(q.children), '应有 children');
  assert.equal(q.children.length, 1);
  assert.equal(q.children[0].type, 'paragraph');
  assert.deepEqual(q.children[0].lines, ['第一行', '第二行']);
});

test('引用块：内部列表被解析成 list 结构', () => {
  const q = parse('> 说明：\n> - 第一点\n> - 第二点').ast.children[0] as any;
  assert.equal(q.type, 'quote');
  const list = q.children.find((c: any) => c.type === 'list');
  assert.ok(list, '应解析出 list');
  assert.equal(list.children.length, 2);
  assert.deepEqual(list.children[0].lines, ['第一点']);
});

test('引用块：内部代码块被解析', () => {
  const F = String.fromCharCode(96, 96, 96);
  const src = `> ${F}ts\n> const a = 1;\n> ${F}`;
  const q = parse(src).ast.children[0] as any;
  const code = q.children.find((c: any) => c.type === 'code');
  assert.ok(code, '应解析出 code');
  assert.equal(code.lang, 'ts');
});

test('未知块名：不报错，但内容保留', () => {
  // 宽松解析的边界：认不得的块名不报错，但**不能把内容吞掉**。
  // 早先的实现整块跳过、什么都不产出，用户写的内容就消失了。
  const { ast, diagnostics } = parse('***random\n内容\n***random-end');
  assert.equal(diagnostics.length, 0, '不该报错');
  assert.equal(ast.children.length, 1, '内容应保留为一个段落');
  assert.equal(ast.children[0].type, 'paragraph');
});

test('块未闭合：报 error 诊断但不崩溃', () => {
  const { ast, diagnostics } = parse('***column(1fr/1fr)\n左栏\n@next-column\n右栏');
  assert.equal(ast.children.length, 1);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].level, 'error');
});

// ---------- 列表 ----------

test('列表：MD 式（不写块）', () => {
  const list = asList(parse('- 一项\n- 二项').ast.children[0]);
  assert.equal(list.explicit, false);
  assert.equal(list.children.length, 2);
  assert.deepEqual(list.children[0].lines, ['一项']);
});

test('列表：***list 块式', () => {
  const { ast, diagnostics } = parse('***list\n- 一项\n- 二项\n***list-end');
  assert.equal(diagnostics.length, 0);
  const list = asList(ast.children[0]);
  assert.equal(list.explicit, true);
  assert.equal(list.children.length, 2);
});

test('列表：缩进嵌套与三级嵌套', () => {
  const l1 = asList(parse('***list\n- 一\n\t- 二\n\t\t- 三\n***list-end').ast.children[0]);
  assert.equal(l1.children.length, 1);
  const l2 = l1.children[0].children[0];
  assert.deepEqual(l2.children[0].lines, ['三']);
});

test('列表：缩进回退到同层', () => {
  const list = asList(parse('***list\n- 父\n\t- 子\n- 父2\n***list-end').ast.children[0]);
  assert.equal(list.children.length, 2);
  assert.equal(list.children[0].children.length, 1);
});

test('task 列表', () => {
  const list = asList(parse('***list\n- [ ] 未完成\n- [x] 已完成\n***list-end').ast.children[0]);
  assert.equal(list.children[0].task, false);
  assert.equal(list.children[1].task, true);
});

test('有序列表：数字不连续也照收', () => {
  const list = asList(parse('***list\n1. 一\n5. 二\n9. 三\n***list-end').ast.children[0]);
  assert.equal(list.children.length, 3);
  assert.equal(list.children.every((c) => c.ordered), true);
});

// ---------- 表格（P3） ----------

test('表格：表头 + 数据行', () => {
  const src = `***table ref="员工"
head: 姓名, 薪资, 学历
- 张三, 20k, 本科
- 李四, 18k, 硕士
***table-end`;
  const t = asTable(parse(src).ast.children[0]);
  assert.equal(t.name, '员工');
  assert.deepEqual(t.headers, [['姓名', '薪资', '学历']]);
  assert.equal(t.rows.length, 2);
  assert.deepEqual(t.rows[0].cells, ['张三', '20k', '本科']);
});

test('表格：无表头', () => {
  const t = asTable(parse('***table\n- 甲, 乙\n- 丙, 丁\n***table-end').ast.children[0]);
  assert.deepEqual(t.headers, []);
  assert.equal(t.rows.length, 2);
});

test('表格：多个 head 视为多行表头', () => {
  const t = asTable(parse('***table\nhead: A, B\nhead: C, D\n- 1, 2\n***table-end').ast.children[0]);
  assert.deepEqual(t.headers, [
    ['A', 'B'],
    ['C', 'D'],
  ]);
});

test('表格：反引号内的逗号不分列', () => {
  const t = asTable(parse('***table\n- 张三, `本科, 硕士`, 工程师\n***table-end').ast.children[0]);
  assert.deepEqual(t.rows[0].cells, ['张三', '`本科, 硕士`', '工程师']);
});

test('表格：行有独立 ID（DECISION-3：块 ID + B 段）', () => {
  const t = asTable(parse('***table\n- 甲, 乙\n- 丙, 丁\n***table-end').ast.children[0]);
  assert.equal(t.rows[0].id, `${t.id}-N1`);
  assert.equal(t.rows[1].id, `${t.id}-N2`);
});

// ---------- 分栏（P3） ----------

test('分栏：fr 参数解析为宽度比', () => {
  const c = asColumn(parse('***column(1fr/2fr)\n左\n@next-column\n右\n***column-end').ast.children[0]);
  assert.deepEqual(c.ratios, [1, 2]);
  assert.equal(c.columns.length, 2);
  assert.deepEqual(c.columns[0], ['左']);
  assert.deepEqual(c.columns[1], ['右']);
});

test('分栏：三栏', () => {
  const c = asColumn(
    parse('***column(1fr/1fr/1fr)\na\n@next-column\nb\n@next-column\nc\n***column-end').ast.children[0],
  );
  assert.deepEqual(c.ratios, [1, 1, 1]);
  assert.equal(c.columns.length, 3);
});

test('分栏：*** 少于声明栏数时补齐空栏', () => {
  const c = asColumn(parse('***column(1fr/1fr/1fr)\n只有一栏\n***column-end').ast.children[0]);
  assert.equal(c.columns.length, 3);
  assert.deepEqual(c.columns[1], []);
  assert.deepEqual(c.columns[2], []);
});

test('分栏：*** 多于声明栏数时取前面的', () => {
  const c = asColumn(
    parse('***column(1fr/1fr)\na\n@next-column\nb\n@next-column\n多余\n***column-end').ast.children[0],
  );
  assert.equal(c.columns.length, 2);
  assert.deepEqual(c.columns[1], ['b']);
});

test('分栏：带名字', () => {
  const c = asColumn(
    parse('***column(1fr/1fr) ref="对比"\n左\n@next-column\n右\n***column-end').ast.children[0],
  );
  assert.equal(c.name, '对比');
});

// ---------- 公式（P6） ----------

test('公式：latex 内容保留；对象不携带编号', () => {
  const n = parse('***math ref="emc"\nE = mc^2\n***math-end').ast.children[0] as any;
  assert.equal(n.type, 'math');
  assert.equal(n.latex, 'E = mc^2');
  assert.equal(n.name, 'emc');
  assert.equal(n.number, undefined, '编号由渲染层计算，AST 不应携带');
});

test('公式：多行 LaTeX 完整保留', () => {
  const src = `***math ref="align"
\\begin{aligned}
f(x) &= x
\\end{aligned}
***math-end`;
  const n = parse(src).ast.children[0] as any;
  assert.ok(n.latex.includes('\\begin{aligned}'));
  assert.ok(n.latex.includes('f(x) &= x'));
  assert.equal(n.number, undefined);
});

// ---------- 图表（P6） ----------

test('图表：bar 解析表头与数据', () => {
  const n = parse('***chart(bar) ref="销量"\nhead: 月份, A\n- 一月, 100\n***chart-end').ast
    .children[0] as any;
  assert.equal(n.type, 'chart');
  assert.equal(n.chartType, 'bar');
  assert.deepEqual(n.headers, ['月份', 'A']);
  assert.deepEqual(n.rows, [['一月', '100']]);
});

test('图表：只支持 bar/line/pie，其它降级为 bar 并告警', () => {
  const { ast, diagnostics } = parse('***chart(scatter)\nhead: A, B\n- 1, 2\n***chart-end');
  assert.equal((ast.children[0] as any).chartType, 'bar');
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].level, 'warning');
});

// ---------- 页面与幻灯片（P6） ----------

test('页面：不写 @page 时为普通 html 流（无 page 节点）', () => {
  const ast = parse('# 标题\n正文').ast;
  assert.equal(ast.children.length, 2);
  assert.equal(ast.children[0].type, 'heading');
});

test('幻灯片：@page(slides) + @next-slide 切页', () => {
  const p = parse('@page(slides)\n第一页\n@next-slide\n第二页\n@next-slide\n第三页').ast
    .children[0] as any;
  assert.equal(p.type, 'page');
  assert.equal(p.preset, 'slides');
  assert.equal(p.slides.length, 3);
  assert.deepEqual(p.slides[1].lines, ['第二页']);
});

test('幻灯片：单页不需要任何标记', () => {
  const p = parse('@page(slides)\n只有一页内容').ast.children[0] as any;
  assert.equal(p.slides.length, 1);
});

test('页面：@page 不需要闭合，写结尾标记也不报错', () => {
  const { ast, diagnostics } = parse('@page(slides)\n第一页');
  assert.equal(ast.children[0].type, 'page');
  assert.deepEqual(diagnostics, []);
});

// ---------- 修复回归测试 ----------

test('列表：空行后的缩进正文渲染为该项的补充内容', () => {
  const src = `***list
2. 完成英语
	- 整理要点

	- 嘿嘿
	  如果没写，那么应该是空行隔断
3. 找大象
***list-end`;
  const list = parse(src).ast.children[0] as any;
  const parent = list.children[0];
  const heihei = parent.children[1];
  assert.equal(heihei.lines[0], '嘿嘿');
  assert.equal(heihei.lines[1], '如果没写，那么应该是空行隔断');
});

test('列表：ID 不重复', () => {
  const src = `***list
1. 完成 mdh
	- 定义语法
	- 列出专属语法
2. 学英语
	- 整理要点

	- 嘿嘿
	  补充
3. 找大象
***list-end`;
  const list = parse(src).ast.children[0] as any;
  const ids: string[] = [];
  const walk = (items: any[]) => {
    for (const it of items) {
      ids.push(it.id);
      walk(it.children);
    }
  };
  walk(list.children);
  assert.equal(new Set(ids).size, ids.length, `ID 应唯一，实际：${ids.join(', ')}`);
});

test('表格：单元格不生成 ID（DECISION-3：最多到行）', () => {
  const t = parse('***table\nhead: A, B, C\n- 1, 2, 3\n***table-end').ast.children[0] as any;
  const row = t.rows[0];
  assert.deepEqual(row.cellIds, [], '单元格不生成 ID');
});

test('列表：空行隔断标记 blankBefore', () => {
  const src = `***list
1. 完成 mdh
	- 定义语法
	- 列出专属语法

	- 嘿嘿
	  补充内容
***list-end`;
  const list = parse(src).ast.children[0] as any;
  const items = list.children[0].children;
  assert.equal(items[0].blankBefore, undefined, '第一项无空行');
  // blankBefore 记的是「有几个空行」（2026-11-21 由 boolean 改为数字）
  assert.equal(items[2].blankBefore, 1, '「嘿嘿」前有 1 个空行');
});

test('分栏：每栏有独立 ID，可单独选中', () => {
  const c = parse('***column(1fr/2fr)\n左\n@next-column\n右\n***column-end').ast.children[0] as any;
  // 分栏是声明型：分栏 M1，栏是平级内容 M2、M3
  assert.deepEqual(c.columnIds, ['M2', 'M3']);
});

test('幻灯片：页内支持块语法（table 等）', () => {
  const p = parse('@page(slides)\n# 封面\n@next-slide\n***table\nhead: A, B\n- 1, 2\n***table-end').ast
    .children[0] as any;
  assert.equal(p.slides.length, 2);
  const t = p.slides[1].children[0];
  assert.equal(t.type, 'table');
  assert.deepEqual(t.headers, [['A', 'B']]);
});

test('幻灯片：页内块有独立 ID，可选中', () => {
  const p = parse('@page(slides)\n# 标题\n正文').ast.children[0] as any;
  const kids = p.slides[0].children;
  assert.ok(kids.length >= 2);
  kids.forEach((k: any) => assert.ok(k.id, '每个块都有 id'));
});

// ---------- 无标记行的归属规则 ----------

test('无标记行：归属于它前面最近的列表项（同缩进）', () => {
  const src = `***list
- a
	- a-b
	a-b 的补充内容
- a-c
***list-end`;
  const list = parse(src).ast.children[0] as any;
  const a = list.children[0];
  const ab = a.children[0];
  const ac = list.children[1];
  assert.deepEqual(ab.lines, ['a-b', 'a-b 的补充内容'], '补充内容属于 a-b');
  assert.deepEqual(ac.lines, ['a-c'], 'a-c 不含补充内容');
});

test('无标记行：缩进与父项相同时归属父项', () => {
  const src = `***list
- a
	- a-b
- a-c
	a-c 补充
***list-end`;
  const list = parse(src).ast.children[0] as any;
  assert.deepEqual(list.children[0].children[0].lines, ['a-b'], 'a-b 无补充');
  assert.deepEqual(list.children[1].lines, ['a-c', 'a-c 补充'], '补充属于 a-c 本身');
});

test('无标记行：空行后仍按同一规则归属', () => {
  const src = `***list
- 语法层
	- 空白、符号、块三层
	三层之间可以自由组合。
- 解析层
***list-end`;
  const list = parse(src).ast.children[0] as any;
  const sub = list.children[0].children[0];
  assert.deepEqual(sub.lines, ['空白、符号、块三层', '三层之间可以自由组合。']);
});

// ---------- Mermaid ----------

test('mermaid：源码原样保留，不做缩进解析', () => {
  const src = `***mermaid ref="login"
graph TD
    A[开始] --> B{判断}
    B -->|是| C[成功]
***mermaid-end`;
  const n = parse(src).ast.children[0] as any;
  assert.equal(n.type, 'mermaid');
  assert.ok(n.source.includes('A[开始] --> B{判断}'));
  assert.ok(n.source.includes('    '), '保留原始缩进');
});

test('mermaid：带 name 时保留名字，对象不携带编号', () => {
  const n = parse('***mermaid ref="flow"\ngraph TD\nA-->B\n***mermaid-end').ast.children[0] as any;
  assert.equal(n.name, 'flow');
  assert.equal(n.number, undefined, '编号由渲染层计算');
});

test('mermaid：无名时 name 与编号都为空', () => {
  const n = parse('***mermaid\ngraph TD\nA-->B\n***mermaid-end').ast.children[0] as any;
  assert.equal(n.name, undefined);
  assert.equal(n.number, undefined);
});

test('mermaid：caption 解析', () => {
  const n = parse('***mermaid ref="flow" caption="登录流程"\ngraph TD\nA-->B\n***mermaid-end')
    .ast.children[0] as any;
  assert.equal(n.caption, '登录流程');
});

test('chart 与 mermaid：对象都不携带编号', () => {
  const src = `***chart(bar) ref="c1"
head: A, B
- 1, 2
***chart-end

***mermaid ref="m1"
graph TD
A-->B
***mermaid-end`;
  const nodes = parse(src).ast.children as any[];
  for (const n of nodes) {
    assert.ok(n.name, `${n.type} 应保留 name`);
    assert.equal(n.number, undefined, `${n.type} 不应携带编号`);
  }
});

test('chart：caption 被正确写入节点', () => {
  const n = parse('***chart(bar) ref="c" caption="销量对比"\nhead: A,B\n- 1,2\n***chart-end')
    .ast.children[0] as any;
  assert.equal(n.caption, '销量对比', 'caption 必须进入 AST');
});

// ---------- 代码块 ----------

test('代码块：三反引号被解析为 code 节点', () => {
  const src = '```ts\nexport function f() {}\n```';
  const n = parse(src).ast.children[0] as any;
  assert.equal(n.type, 'code');
  assert.equal(n.lang, 'ts');
  assert.equal(n.content, 'export function f() {}');
});

test('代码块：title 解析为文件名', () => {
  const src = '```ts title="src/parser.ts"\nconst a = 1\n```';
  const n = parse(src).ast.children[0] as any;
  assert.equal(n.title, 'src/parser.ts');
  assert.equal(n.lang, 'ts');
});

test('代码块：无语言也能解析', () => {
  const src = '```\nplain\n```';
  const n = parse(src).ast.children[0] as any;
  assert.equal(n.type, 'code');
  assert.equal(n.lang, undefined);
  assert.equal(n.content, 'plain');
});

test('代码块：内容内的语法不解析', () => {
  const src = '```\n# 不是标题\n- 不是列表\n::table\n```';
  const n = parse(src).ast.children[0] as any;
  assert.equal(n.type, 'code');
  assert.ok(n.content.includes('# 不是标题'));
});

test('代码块：未闭合时告警但不崩溃', () => {
  const { ast, diagnostics } = parse('```ts\nconst a = 1');
  assert.equal((ast.children[0] as any).type, 'code');
  assert.ok(diagnostics.some((d) => d.level === 'warning'));
});

test('代码块：多行内容逐字保留（含缩进）', () => {
  const src = '```py\ndef f():\n    return 1\n```';
  const n = parse(src).ast.children[0] as any;
  assert.equal(n.content, 'def f():\n    return 1');
});

// ---------- 命名闭合校验（2026-11-25）----------

test('命名闭合：***list-abc 配 ***list-abc-end 正常', () => {
  const { diagnostics } = parse('***list-abc\n\n- 项\n\n***list-abc-end\n');
  assert.equal(diagnostics.length, 0);
});

test('命名闭合：名字对不上要报错', () => {
  const { diagnostics } = parse('***list-abc\n\n- 项\n\n***list-xyz-end\n');
  assert.ok(
    diagnostics.some((d) => d.message.includes('名字对不上')),
    '应提示名字不匹配',
  );
});

test('命名闭合：闭合不带名时保持宽松', () => {
  const { diagnostics } = parse('***list-abc\n\n- 项\n\n***list-end\n');
  assert.equal(diagnostics.length, 0);
});

test('命名闭合：全部块类型都支持 -标签', () => {
  for (const [open, close] of [
    ['***table-t', '***table-t-end'],
    ['***math-m', '***math-m-end'],
    ['***mermaid-g', '***mermaid-g-end'],
  ]) {
    const src =
      open.includes('table')
        ? `${open}\nhead: a\n- 1\n${close}\n`
        : open.includes('math')
          ? `${open}\nE=mc^2\n${close}\n`
          : `${open}\ngraph TD\nA-->B\n${close}\n`;
    assert.equal(parse(src).diagnostics.length, 0, `${open} 应正常闭合`);
  }
});

test('命名闭合：-标签 优先于 ref 名', () => {
  // -甲 是位置标记，ref 是引用名；闭合写位置标记必须能配对
  const { diagnostics } = parse('***table-甲 ref="员工"\nhead: a\n- 1\n***table-甲-end\n');
  assert.equal(diagnostics.length, 0);
});

test('命名闭合：不叠报「未闭合」', () => {
  const { diagnostics } = parse('***list-abc\n\n- 项\n\n***list-xyz-end\n');
  const msgs = diagnostics.map((d) => d.message);
  assert.ok(msgs.some((m) => m.includes('名字对不上')));
  assert.ok(!msgs.some((m) => m.includes('未闭合')), '同一件事不该报两遍');
});

// ---------- list 内嵌块（2026-11-25）----------

test('list 内可放 table', () => {
  const src = '***list\n\n- 项一\n\n***table\nhead: a\n- 1\n***table-end\n\n- 项二\n\n***list-end\n';
  const { ast, diagnostics } = parse(src);
  assert.equal(diagnostics.length, 0, JSON.stringify(diagnostics));
  const list = ast.children[0] as any;
  assert.equal(list.type, 'list');
  assert.ok(
    list.blocks?.some((b: any) => b.node.type === 'table'),
    'table 应该成为 list 的子块',
  );
});

test('list 内可嵌套 list', () => {
  const src = '***list\n\n- 项\n\n***list\n\n- 子项\n\n***list-end\n\n***list-end\n';
  assert.equal(parse(src).diagnostics.length, 0);
});

test('list 内的块不打断外层列表', () => {
  // 早先表格会被挤出去，列表被拆成两个
  const src = '***list\n\n- 甲\n\n***table\nhead: a\n- 1\n***table-end\n\n- 乙\n\n***list-end\n';
  const { ast } = parse(src);
  const lists = ast.children.filter((c: any) => c.type === 'list');
  assert.equal(lists.length, 1, '应该还是一个列表，不是两个');
});

// ---------- 列表项里的缩进块：成为子块（2026-11-25）----------

test('列表项后面缩进的块 → 成为该项的子块（嵌套）', () => {
  const src = '- 项一\n\n  ***table\n  head: a\n  - 1\n  ***table-end\n\n- 项二\n';
  const { ast, diagnostics } = parse(src);
  assert.equal(diagnostics.length, 0, '不该报错');

  const lists = ast.children.filter((c: any) => c.type === 'list');
  assert.equal(lists.length, 1, '列表不能被拆成两个');

  const first = (lists[0] as any).children[0];
  assert.equal(first.lines[0], '项一');
  assert.ok(first.blocks?.length, '项一应该有子块');
  assert.equal(first.blocks[0].node.type, 'table');
  // 裸列表不占「组」这一层：项直接是顶层的 M1，项里的块进下一层 M1-N1
  assert.equal(first.id, 'M1');
  assert.equal(first.blocks[0].node.id, 'M1-N1');
});

test('缩进的块不该变成顶层独立块', () => {
  const src = '- 项一\n\n  ***table\n  head: a\n  - 1\n  ***table-end\n';
  const { ast } = parse(src);
  assert.ok(
    !ast.children.some((c: any) => c.type === 'table'),
    'table 不该成为顶层块',
  );
});
