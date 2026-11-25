import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../src/index.ts';
import { serialize } from '../../src/index.ts';

/** 往返：parse → serialize → parse，两次 AST 必须等价 */
const roundtrip = (src: string) => {
  const a = parse(src);
  const out = serialize(a.ast, { meta: a.meta });
  const b = parse(out);
  return { out, a, b };
};

/**
 * 比较两棵 AST
 *
 * ⚠️ 忽略**位置字段**（itemPos / blocks[].pos）：
 *    它们是「源码第几行」，用于渲染时还原「项与块的交错顺序」。
 *    序列化会重新排版（缩进、空行），行号必然变 —— 但语义没变。
 *    真正该比的是 structure + id，不是行号。
 */
const stripPos = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(stripPos);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (k === 'itemPos' || k === 'pos' || k === 'itemStart') continue;
      out[k] = stripPos(val);
    }
    return out;
  }
  return v;
};

const equivalent = (x: unknown, y: unknown): boolean =>
  JSON.stringify(stripPos(x)) === JSON.stringify(stripPos(y));

// ---------- 基础块 ----------

test('往返：标题', () => {
  const { out, a, b } = roundtrip('# 一级\n## 二级\n');
  assert.ok(out.includes('# 一级'));
  assert.ok(out.includes('## 二级'));
  assert.ok(equivalent(a.ast, b.ast), '二次解析应等价');
});

test('往返：段落与换行', () => {
  const { a, b } = roundtrip('第一行\n第二行\n\n新段落\n');
  assert.ok(equivalent(a.ast, b.ast));
});

test('往返：列表（MD 式）', () => {
  const { a, b } = roundtrip('- 一\n- 二\n\t- 二子\n');
  assert.ok(equivalent(a.ast, b.ast));
});

test('往返：列表（***list 块式）', () => {
  const { out, a, b } = roundtrip('***list\n1. 甲\n2. 乙\n***list-end\n');
  assert.ok(out.includes('***list'));
  assert.ok(out.includes('***list-end'));
  assert.ok(equivalent(a.ast, b.ast));
});

test('往返：任务列表', () => {
  const { a, b } = roundtrip('- [ ] 未做\n- [x] 已做\n');
  assert.ok(equivalent(a.ast, b.ast));
});

// ---------- 数据块 ----------

test('往返：表格（含 name）', () => {
  const { out, a, b } = roundtrip(
    '***table ref="员工"\nhead: 姓名, 薪资\n- 张三, 20k\n- 李四, 18k\n***table-end\n',
  );
  assert.ok(out.includes('***table ref="员工"'));
  assert.ok(out.includes('head: 姓名, 薪资'));
  assert.ok(equivalent(a.ast, b.ast));
});

test('往返：单元格含逗号用反引号包住', () => {
  const { out, b } = roundtrip('***table\n- 张三, `本科, 硕士`\n***table-end\n');
  assert.ok(out.includes('`本科, 硕士`'), '含逗号的单元格应被反引号包住');
  const cells = (b.ast.children[0] as any).rows[0].cells;
  assert.equal(cells.length, 2, '反引号内的逗号不应被当作分列符');
  assert.equal(cells[0], '张三');
  assert.ok(cells[1].includes('本科'), '第二格含「本科」');
  assert.ok(cells[1].includes('硕士'), '第二格含「硕士」');
});

test('往返：图表', () => {
  const { out, a, b } = roundtrip(
    '***chart(bar) ref="销量"\nhead: 月份, A\n- 一月, 100\n***chart-end\n',
  );
  assert.ok(out.includes('***chart(bar)'));
  assert.ok(equivalent(a.ast, b.ast));
});

test('往返：公式', () => {
  const { out, a, b } = roundtrip('***math ref="emc"\nE = mc^2\n***math-end\n');
  assert.ok(out.includes('***math ref="emc"'));
  assert.ok(out.includes('E = mc^2'));
  assert.ok(equivalent(a.ast, b.ast));
});

test('往返：Mermaid', () => {
  const { a, b } = roundtrip('***mermaid\ngraph TD\n  A --> B\n***mermaid-end\n');
  assert.ok(equivalent(a.ast, b.ast));
});

test('往返：代码块（含语言与文件名）', () => {
  const { out, a, b } = roundtrip('```ts title="a.ts"\nconst x = 1;\n```\n');
  assert.ok(out.includes('```ts title="a.ts"'));
  assert.ok(out.includes('const x = 1;'));
  assert.ok(equivalent(a.ast, b.ast));
});

// ---------- 结构块 ----------

test('往返：分栏（@next-column）', () => {
  const { out, a, b } = roundtrip(
    '***column(1fr/2fr)\n左\n@next-column\n右\n***column-end\n',
  );
  assert.ok(out.includes('***column(1fr/2fr)'));
  assert.ok(out.includes('@next-column'), '应输出 @next-column 分隔');
  assert.ok(equivalent(a.ast, b.ast));
});

test('往返：分栏内放 mermaid / math（内容不额外缩进）', () => {
  // 回归：曾经序列化时给块内容加缩进，导致往返后 source 多一层 tab
  const src =
    '***column(1fr/1fr)\n' +
    '***mermaid\n' +
    'graph LR\n' +
    '    A --> B\n' +
    '***mermaid-end\n' +
    '@next-column\n' +
    '***math\n' +
    'E = mc^2\n' +
    '***math-end\n' +
    '***column-end\n';
  const { out, a, b } = roundtrip(src);
  assert.ok(equivalent(a.ast, b.ast), '分栏内块内容往返后不一致');
  assert.ok(!out.includes('\tgraph LR'), 'mermaid 内容不该被加缩进');
  assert.ok(!out.includes('\tE = mc^2'), 'math 内容不该被加缩进');
});

test('往返：分割线', () => {
  const { out, b } = roundtrip('上文\n\n---\n\n下文\n');
  assert.ok(out.includes('---'));
  assert.equal(b.ast.children.filter((c: any) => c.blockName === 'divider').length, 1);
});

test('往返：引用', () => {
  const { a, b } = roundtrip('> 引用行\n\n正文\n');
  assert.ok(equivalent(a.ast, b.ast));
});

// ---------- 文档级 ----------

test('往返：元信息', () => {
  const { out, b } = roundtrip('===\ntitle = 我的文档\nauthor = toru\n===\n\n# 标题\n');
  assert.ok(out.includes('==='), '应输出元信息边界');
  assert.ok(out.includes('title = 我的文档'));
  assert.deepEqual(b.meta, { title: '我的文档', author: 'toru' });
});

test('往返：slides（@page + @next-slide）', () => {
  const { out, a, b } = roundtrip('@page(slides)\n# A\n@next-slide\n# B\n');
  assert.ok(out.includes('@page(slides)'));
  assert.ok(out.includes('@next-slide'));
  assert.ok(equivalent(a.ast, b.ast));
});

test('往返：综合文档', () => {
  const src = `===
title = 综合测试
===

# 标题

正文段落

***list
- 一
	- 一子
***list-end

***table ref="表"
head: A, B
- 1, 2
***table-end

---

***column(1fr/1fr)
左
@next-column
右
***column-end
`;
  const { a, b } = roundtrip(src);
  assert.ok(equivalent(a.ast, b.ast), '综合文档二次解析应等价');
});

test('序列化：结果可被再次序列化且稳定', () => {
  const src = '# 标题\n\n- 一\n- 二\n';
  const once = serialize(parse(src).ast);
  const twice = serialize(parse(once).ast);
  assert.equal(once, twice, '序列化应幂等');
});

// ---------- 真实样例往返 ----------

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// 样例文档跟着本仓库走：verify/examples/
const dir = new URL('../../../../verify/examples/', import.meta.url).pathname;
const files = readdirSync(dir).filter((f) => f.endsWith('.mdh'));

/**
 * 比较 AST 时忽略仅供渲染与调试的呈现性字段
 *
 * - columns：每栏原始文本，重排后自然不同
 * - blankBefore：渲染间距提示，往返后可能变化
 * - quote.lines：引用的原始行，块间空行会被规范化
 * - itemPos / pos / itemStart：**源码行号**，用于还原「项与块的交错顺序」。
 *   序列化会重新排版（缩进、空行），行号必然变，但结构没变 —— 不该比。
 */
const canonical = (node: unknown): unknown => {
  const walk = (v: any): any => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: any = {};
      for (const [k, val] of Object.entries(v)) {
        if (k === 'columns' || k === 'blankBefore') continue;
        if (k === 'itemPos' || k === 'pos' || k === 'itemStart') continue;
        if (k === 'lines' && v.type === 'quote') continue;
        out[k] = walk(val);
      }
      return out;
    }
    return v;
  };
  return walk(JSON.parse(JSON.stringify(node)));
};

for (const f of files) {
  test(`真实样例往返：${f}`, () => {
    const src = readFileSync(join(dir, f), 'utf8');
    const a = parse(src);
    const out = serialize(a.ast, { meta: a.meta });
    const b = parse(out);

    assert.deepEqual(
      canonical(b.ast),
      canonical(a.ast),
      `${f} 往返后 AST 不一致`,
    );
    assert.deepEqual(
      b.diagnostics.filter((d: any) => d.level === 'error'),
      [],
      `${f} 往返后出现错误`,
    );
  });
}
