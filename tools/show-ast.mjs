/**
 * 生成 AST 的可视化结果，供人查看
 */
import { parse, serialize } from '../packages/mdh-core/src/index.ts';

const sample = `===
title = 我的第一篇 mdh
author = toru
===

# 英语学习笔记

三个月内把日常对话撑下来。

***list
1. 时态
	- 一般现在时
	- 现在进行时
2. 词汇
	- 日常
		- breakfast
		- commute
***list-end

***table name="时态对比"
head: 时态, 结构, 例句
- 一般现在时, 主语+动词原形, I work every day
- 过去时, 主语+动词过去式, I worked
***table-end

***column(1fr/1fr)
左栏内容
@next-column
右栏内容
***column-end

> 这是引用
`;

const { ast, meta, diagnostics } = parse(sample);

// ---------- 1. 树形视图 ----------
const tree = [];
const walk = (n, depth = 0) => {
  const pad = '  '.repeat(depth);
  const label = describe(n);
  tree.push(`${pad}${n.id.padEnd(12)} ${n.type.padEnd(12)} ${label}`);
  const kids = [
    ...(n.children ?? []),
    ...(n.rows ?? []),
  ];
  for (const k of kids) walk(k, depth + 1);
  for (const c of n.columnBlocks ?? []) for (const b of c) walk(b, depth + 1);
  for (const s of n.slides ?? []) walk(s, depth + 1);
};

const describe = (n) => {
  if (n.type === 'heading') return `H${n.level} "${n.text}"`;
  if (n.type === 'paragraph') return JSON.stringify(n.lines.join(' / '));
  if (n.type === 'list') return n.explicit ? `块式，${n.children.length} 项` : `${n.children.length} 项`;
  if (n.type === 'listItem') {
    const mark = n.task !== undefined ? (n.task ? '[x]' : '[ ]') : n.ordered ? `${n.marker}.` : '-';
    return `${mark} ${JSON.stringify(n.lines.join(' / '))}`;
  }
  if (n.type === 'table') return n.name ? `name="${n.name}" ${n.rows.length} 行` : `${n.rows.length} 行`;
  if (n.type === 'tableRow') return JSON.stringify(n.cells);
  if (n.type === 'column') return `${n.ratios.join(':')} 两栏`;
  if (n.type === 'block') return `${n.blockName} ${JSON.stringify(n.lines.join(' / '))}`;
  return '';
};

walk(ast);

console.log('══════════ 1. 树形视图（ID / 类型 / 内容） ══════════\n');
console.log(tree.join('\n'));

// ---------- 2. 元信息 ----------
console.log('\n══════════ 2. 文档元信息 ══════════\n');
console.log(JSON.stringify(meta, null, 2));

// ---------- 3. 单块 JSON 明细 ----------
console.log('\n══════════ 3. 某个列表项的完整对象（看嵌套） ══════════\n');
const list = ast.children.find((c) => c.type === 'list');
console.log(JSON.stringify(list.children[1], null, 2));

// ---------- 4. 序列化回去 ----------
console.log('\n══════════ 4. 反向序列化（AST → 源码） ══════════\n');
console.log(serialize(ast, { meta }));

// ---------- 5. 诊断 ----------
console.log('\n══════════ 5. 诊断信息 ══════════');
console.log(diagnostics.length === 0 ? '无错误' : JSON.stringify(diagnostics, null, 2));
