import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../src/index.ts';

/** 收集 AST 里所有节点（含嵌套、分栏、表格行） */
function collectIds(node: any, out: Array<{ id: string; type: string }> = []) {
  if (!node || !node.type) return out;
  if (node.id) out.push({ id: node.id, type: node.type });
  (node.children ?? []).forEach((c: any) => collectIds(c, out));
  (node.blocks ?? []).forEach((b: any) => collectIds(b.node, out));
  (node.columnBlocks ?? []).forEach((col: any[]) => col.forEach((c) => collectIds(c, out)));
  (node.slides ?? []).forEach((s: any) => collectIds(s, out));
  (node.rows ?? []).forEach((r: any) => collectIds(r, out));
  return out;
}

/** 断言：全文档 ID 唯一 */
function assertUniqueIds(ast: any, label: string) {
  const all = collectIds(ast);
  const seen = new Map<string, string>();
  for (const { id, type } of all) {
    const prev = seen.get(id);
    if (prev) {
      assert.fail(
        `[${label}] ID 重复：${id} 同时给了 <${prev}> 和 <${type}>\n` +
          `全部 ID：${all.map((x) => x.id).join(' ')}`,
      );
    }
    seen.set(id, type);
  }
}

test('ID 唯一性：list → column → list 三层嵌套', () => {
  const src = `***list
- 外层项
***column(1fr/1fr)
左栏文字
@next-column

***list
- 内层项
***list-end

***column-end
***list-end`;
  const { ast } = parse(src);
  assertUniqueIds(ast, '三层');
});

test('ID 唯一性：四层嵌套', () => {
  const src = `***list
- 第一层项
***column(1fr/1fr)
左栏
@next-column

***list
- 第三层项

***table caption="第四层"
head: a
- 1
***table-end

***list-end

***column-end
***list-end`;
  const { ast } = parse(src);
  assertUniqueIds(ast, '四层');
});

test('ID 唯一性：缩进块 + 列表项混排', () => {
  const src = `***list
- 顶格项

***table caption="顶格表"
head: 名称, 数量
- 甲, 1
***table-end

- 缩进项

  ***table caption="缩进表"
  head: 名称, 数量
  - 丙, 3
  ***table-end

  \`\`\`js
  const a = 1;
  \`\`\`

  > 项里的引用

***list-end`;
  const { ast } = parse(src);
  assertUniqueIds(ast, '缩进混排');
});

test('ID 唯一性：引用内的段落不与引用本身同号', () => {
  const src = `> 引用正文`;
  const { ast } = parse(src);
  assertUniqueIds(ast, '引用');
});

// ---------- 块嵌套总深度上限（3 层）----------

test('嵌套上限：3 层内的结构正常解析', () => {
  const src = `***list
- 层一
  ***column(1fr/1fr)
  左
  @next-column
  ***list
  - 层三
  ***list-end
  ***column-end
***list-end`;
  const { ast } = parse(src);
  const all: any[] = [];
  const w = (n: any) => {
    if (!n || !n.type) return;
    all.push(n);
    (n.children ?? []).forEach(w);
    (n.blocks ?? []).forEach((b: any) => w(b.node));
    (n.columnBlocks ?? []).forEach((c: any[]) => c.forEach(w));
  };
  w(ast);
  assert.ok(all.some((n) => n.type === 'list' && n.id === 'M2-N3-O1'), '3 层的 list 应当正常解析');
});

test('嵌套上限：第 4 层整块降级为普通文本', () => {
  const src = `***list
- 层一
  ***column(1fr/1fr)
  左
  @next-column
  ***list
  - 层三
    ***table caption="第四层"
    head: a
    - 1
    ***table-end
  ***list-end
  ***column-end
***list-end`;
  const { ast } = parse(src);
  const all: any[] = [];
  const w = (n: any) => {
    if (!n || !n.type) return;
    all.push(n);
    (n.children ?? []).forEach(w);
    (n.blocks ?? []).forEach((b: any) => w(b.node));
    (n.columnBlocks ?? []).forEach((c: any[]) => c.forEach(w));
  };
  w(ast);

  assert.ok(!all.some((n) => n.type === 'table'), '第 4 层的 table 不该被解析成块');
  const para = all.find((n) => n.type === 'paragraph' && n.lines?.includes('head: a'));
  assert.ok(para, '超限块的内容要以纯文本保留');
  assert.ok(para.lines.includes('- 1'), '内容行不能丢');
});

// ---------- 裸列表 vs ***list：项的编号必须一致 ----------

test('裸列表不占「组」这一层：项和声明都在 M 段', () => {
  const collectItemIds = (src: string) => {
    const { ast } = parse(src);
    const ids: string[] = [];
    const w = (n: any) => {
      if (!n || !n.type) return;
      if (n.type === 'listItem') ids.push(n.id);
      (n.children ?? []).forEach(w);
      (n.blocks ?? []).forEach((b: any) => w(b.node));
    };
    w(ast);
    return ids;
  };

  const bare = collectItemIds('- 甲\n- 乙');
  const explicit = collectItemIds('***list\n- 甲\n- 乙\n***list-end');

  // 两种写法的项都必须是 M 段（不能掉进 N 段）—— 这是「不嵌层」的核心
  for (const id of [...bare, ...explicit]) {
    assert.match(id, /^M\d+$/, `列表项必须在 M 段，实际是 ${id}`);
  }

  // 裸列表没有声明占号，所以项从 M1 起
  assert.deepEqual(bare, ['M1', 'M2']);

  // ***list 的声明自己占 M1，项从 M2 起，但仍然在 M 段
  assert.deepEqual(explicit, ['M2', 'M3']);
});

test('引用里的裸列表：项是引用的子集，不多嵌一层', () => {
  const { ast } = parse('> 说明\n>\n> - 甲\n> - 乙');
  const ids: string[] = [];
  const w = (n: any) => {
    if (!n || !n.type) return;
    if (n.type === 'listItem') ids.push(n.id);
    (n.children ?? []).forEach(w);
    (n.blocks ?? []).forEach((b: any) => w(b.node));
  };
  w(ast);
  // 引用 M1 → 段落 M1-N1 → 项 M1-N2、M1-N3（不是 M1-N2-O1）
  assert.deepEqual(ids, ['M1-N2', 'M1-N3']);
});

// ---------- 列表项与夹在中间的块：编号必须按源码顺序 ----------

test('列表里夹的块：编号顺序跟着源码走，不是项排完才排块', () => {
  const src = `***list

- 项一

***table caption="顶格"
head: a
- 1
***table-end

- 项二

***list-end`;
  const { ast } = parse(src);
  const list = ast.children[0] as any;

  // 项一 M2 → 夹在中间的 table M3 → 项二 M4
  assert.equal(list.children[0].id, 'M2', '项一');
  assert.equal(list.blocks[0].node.id, 'M3', '夹在中间的 table');
  assert.equal(list.children[1].id, 'M4', '项二');

  // 数字顺序必须和源码位置顺序一致
  assert.ok(
    parseInt(list.children[0].id.slice(1), 10) <
      parseInt(list.blocks[0].node.id.slice(1), 10),
    '项一的号必须小于块的号',
  );
  assert.ok(
    parseInt(list.blocks[0].node.id.slice(1), 10) <
      parseInt(list.children[1].id.slice(1), 10),
    '块的号必须小于项二的号',
  );
});
