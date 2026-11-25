/**
 * 编辑能力查询验证（FIX-4）
 *
 * 第三层在动手改之前就要知道「能不能改」，而不是 update() 返回 false 才知道。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../mdh-core/src/index.ts';
import { createRenderer } from '../src/index.ts';

const SRC = `# 标题

正文段落。

***table ref="表"
head: a, b
- 1, 2
***table-end

***math ref="式"
E = mc^2
***math-end

***chart(bar) ref="图"
head: x, y
- 1, 2
***chart-end

***mermaid ref="流程"
graph TD
A-->B
***mermaid-end

---

@toc
`;

const FENCE = '```';
const SRC_WITH_CODE = SRC + `\n${FENCE}ts\nconst a = 1;\n${FENCE}\n`;

const R = (src = SRC) => createRenderer(parse(src).ast);

/** 按 ID 找节点 */
const find = (n: any, id: string): any => {
  if (n.id === id) return n;
  for (const k of [
    ...(n.children ?? []),
    ...(n.rows ?? []),
    ...(n.columnBlocks ?? []).flat(),
    ...(n.slides ?? []),
  ]) {
    const x = find(k, id);
    if (x) return x;
  }
};

/** 找某种类型的第一个 ID */
const idOfType = (r: ReturnType<typeof R>, type: string): string => {
  let found = '';
  const walk = (n: any) => {
    if (!found && n.type === type && n.id) found = n.id;
    for (const k of [
      ...(n.children ?? []),
      ...(n.rows ?? []),
      ...(n.columnBlocks ?? []).flat(),
      ...(n.slides ?? []),
    ]) walk(k);
  };
  walk(r.getAst());
  return found;
};

// ---------- 基本告知 ----------

test('getEditability：段落可改，模式为 inline', () => {
  const r = R();
  const e = r.getEditability(idOfType(r, 'paragraph'));
  assert.ok(e);
  assert.equal(e.editable, true);
  assert.equal(e.mode, 'inline');
});

test('getEditability：标题可改，模式为 inline', () => {
  const r = R();
  const e = r.getEditability(idOfType(r, 'heading'));
  assert.ok(e);
  assert.equal(e.editable, true);
  assert.equal(e.mode, 'inline');
});

test('getEditability：表格可改，模式为 source', () => {
  const r = R();
  const e = r.getEditability(idOfType(r, 'table'));
  assert.ok(e);
  assert.equal(e.editable, true);
  assert.equal(e.mode, 'source');
});

test('getEditability：表格行可改', () => {
  const r = R();
  const e = r.getEditability(idOfType(r, 'tableRow'));
  assert.ok(e);
  assert.equal(e.editable, true);
});

test('getEditability：公式 / 图表 / Mermaid / 代码块都是 source 模式', () => {
  const r = R(SRC_WITH_CODE);
  for (const type of ['math', 'chart', 'mermaid', 'code']) {
    const e = r.getEditability(idOfType(r, type));
    assert.ok(e, `${type} 应能查到`);
    assert.equal(e.editable, true, `${type} 应可改`);
    assert.equal(e.mode, 'source', `${type} 应走源码编辑`);
  }
});

// ---------- 不可改 ----------

test('getEditability：根节点不可改，且有原因', () => {
  const r = R();
  const e = r.getEditability('R');
  assert.ok(e);
  assert.equal(e.editable, false);
  assert.equal(e.mode, 'none');
  assert.ok(e.reason, '必须给出原因');
});

test('getEditability：分割线不可改，且有原因', () => {
  const r = R();
  const ast = r.getAst();
  // 找 divider 块
  let dividerId = '';
  const walk = (n: any) => {
    if (n.type === 'block' && n.blockName === 'divider') dividerId = n.id;
    for (const k of [...(n.children ?? [])]) walk(k);
  };
  walk(ast);
  assert.ok(dividerId, '应有分割线节点');

  const e = r.getEditability(dividerId);
  assert.ok(e);
  assert.equal(e.editable, false);
  assert.ok(e.reason?.includes('分割线'), e.reason ?? '(无原因)');
});

test('getEditability：目录不可改，且有原因', () => {
  const r = R();
  let tocId = '';
  const walk = (n: any) => {
    if (n.type === 'block' && n.blockName === 'toc') tocId = n.id;
    for (const k of [...(n.children ?? [])]) walk(k);
  };
  walk(r.getAst());
  assert.ok(tocId, '应有目录节点');

  const e = r.getEditability(tocId);
  assert.ok(e);
  assert.equal(e.editable, false);
  assert.ok(e.reason?.includes('目录'), e.reason ?? '(无原因)');
});

// ---------- 边界 ----------

test('getEditability：不存在的 ID 返回 null', () => {
  const r = R();
  assert.equal(r.getEditability('M999'), null);
});

test('getEditability：修改后仍能正确查询', () => {
  const r = R();
  const pid = idOfType(r, 'paragraph');
  assert.equal(r.getEditability(pid)?.editable, true);

  // 删除后应查不到
  r.remove(pid);
  assert.equal(r.getEditability(pid), null);
});

test('getEditability：每个节点都能给出明确答案', () => {
  const r = R(SRC_WITH_CODE);
  const ids: string[] = [];
  const walk = (n: any) => {
    if (n.id) ids.push(n.id);
    for (const k of [
      ...(n.children ?? []),
      ...(n.rows ?? []),
      ...(n.columnBlocks ?? []).flat(),
    ]) walk(k);
  };
  walk(r.getAst());

  assert.ok(ids.length > 0);
  for (const id of ids) {
    const e = r.getEditability(id);
    assert.ok(e, `${id} 应有编辑能力结论`);
    assert.equal(typeof e.editable, 'boolean', `${id} 的 editable 应为布尔`);
    assert.ok(['inline', 'source', 'none'].includes(e.mode), `${id} 的 mode 非法`);
    if (!e.editable) assert.ok(e.reason, `${id} 不可改时必须给原因`);
  }
});

// ---------- 只读模式（editing: 'readonly'）----------

const collectIds = (n: any, acc: string[] = []): string[] => {
  if (n.id) acc.push(n.id);
  for (const k of [
    ...(n.children ?? []),
    ...(n.rows ?? []),
    ...(n.columnBlocks ?? []).flat(),
  ]) collectIds(k, acc);
  return acc;
};

test('只读模式：所有块一律不可改', () => {
  const r = createRenderer(parse(SRC_WITH_CODE).ast, { editing: 'readonly' });
  const ids = collectIds(r.getAst());
  assert.ok(ids.length > 0);

  for (const id of ids) {
    const e = r.getEditability(id);
    assert.ok(e, `${id} 应有结论`);
    assert.equal(e.editable, false, `${id} 在只读模式下应不可改`);
    assert.equal(e.mode, 'none');
    assert.equal(e.reason, '当前为只读模式');
  }
});

test('只读模式：不存在的 ID 仍返回 null', () => {
  const r = createRenderer(parse(SRC).ast, { editing: 'readonly' });
  assert.equal(r.getEditability('M999'), null);
});

test('默认模式（不传 editing）行为不变：段落可改', () => {
  const r = R();
  const e = r.getEditability(idOfType(r, 'paragraph'));
  assert.ok(e);
  assert.equal(e.editable, true);
  assert.equal(e.mode, 'inline');
});
