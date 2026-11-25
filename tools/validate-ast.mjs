/**
 * 用 JSON Schema 校验 AST
 *
 *   node tools/validate-ast.mjs <文件.mdh|文件.json>
 *   node tools/validate-ast.mjs --sample
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parse } from '../packages/mdh-core/src/index.ts';

const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020').default;
const addFormats = require('ajv-formats').default;

const SCHEMA = JSON.parse(readFileSync(new URL('../schema/ast-1.0.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(SCHEMA);

const SAMPLE = `===
title = 示例
author = toru
===

# 标题

正文段落。

***list
- 一
	- 一子
***list-end

***table name="表"
head: A, B
- 1, 2
***table-end

***column(1fr/1fr)
左
@next-column
右
***column-end

> 引用

---

***math name="m"
E = mc^2
***math-end
`;

const arg = process.argv[2];
let doc;

if (!arg || arg === '--sample') {
  const r = parse(SAMPLE);
  doc = { meta: r.meta, diagnostics: r.diagnostics, ast: r.ast };
} else if (arg.endsWith('.json')) {
  doc = JSON.parse(readFileSync(arg, 'utf8'));
} else {
  const r = parse(readFileSync(arg, 'utf8'));
  doc = { meta: r.meta, diagnostics: r.diagnostics, ast: r.ast };
}

if (validate(doc)) {
  console.log('✔ 符合 mdh AST 0.3 契约');
  process.exit(0);
}

console.error('✖ 不符合契约：');
for (const e of validate.errors ?? []) {
  console.error(`  ${e.instancePath || '(root)'} ${e.message}`);
  if (e.params) console.error(`    ${JSON.stringify(e.params)}`);
}
process.exit(1);
