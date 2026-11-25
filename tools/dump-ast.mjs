/**
 * mdh 源码 → AST JSON
 *
 *   node tools/dump-ast.mjs --sample [out.json]
 *   node tools/dump-ast.mjs <输入.mdh> [out.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parse } from '../packages/mdh-core/src/index.ts';

const SAMPLE = `===
title = 我的第一篇 mdh
author = toru
date = 2026-11-19
===

# 英语学习笔记

三个月内把日常对话撑下来。
不追求口音完美，只求**敢开口、听得懂**。

***list
1. 时态
	- 一般现在时
	- 现在进行时
2. 词汇
	- 日常
		- breakfast
		- commute
***list-end

***table name="时态对比" caption="三种最常见的时态"
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

---

***math name="emc"
E = mc^2
***math-end
`;

const [input, output] = process.argv.slice(2);
const useSample = !input || input === '--sample';
const outFile = output ?? (useSample ? 'ast-sample.json' : basename(input).replace(/\.mdh$/, '') + '.ast.json');

const { ast, meta, diagnostics } = parse(useSample ? SAMPLE : readFileSync(input, 'utf8'));
const result = { meta, diagnostics, ast };

writeFileSync(outFile, JSON.stringify(result, null, 2));

const count = (n) =>
  1 +
  ['children', 'rows'].flatMap((k) => n[k] ?? []).reduce((s, x) => s + count(x), 0) +
  (n.columnBlocks ?? []).flat().reduce((s, x) => s + count(x), 0) +
  (n.slides ?? []).reduce((s, x) => s + count(x), 0);

console.log(`${outFile}
  节点 ${count(ast)} · 元信息 ${Object.keys(meta).length} · 诊断 ${diagnostics.length}
  ${(JSON.stringify(result, null, 2).length / 1024).toFixed(1)} KB`);
