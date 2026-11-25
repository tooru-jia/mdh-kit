/**
 * 按 type 分组校验：只有 type 与其结构不符才是真问题
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

/** 每个 type 对应的 schema 定义名 */
const TYPE_TO_DEF = {
  root: 'root',
  heading: 'heading',
  paragraph: 'paragraph',
  list: 'list',
  listItem: 'listItem',
  table: 'table',
  tableRow: 'tableRow',
  column: 'column',
  math: 'math',
  chart: 'chart',
  mermaid: 'mermaid',
  code: 'code',
  page: 'page',
  slide: 'slide',
  block: 'genericBlock',
};

/** 基础字段检查（所有节点共有） */
const base = {
  type: 'object',
  required: ['type', 'id', 'description'],
  properties: {
    id: SCHEMA.$defs.id,
    description: { type: 'string' },
  },
};

const validateBase = ajv.compile({ $schema: SCHEMA.$schema, $defs: SCHEMA.$defs, ...base });
const cache = new Map();
const validatorFor = (type) => {
  const def = TYPE_TO_DEF[type];
  if (!def) return null;
  if (!cache.has(def)) {
    cache.set(
      def,
      ajv.compile({
        $schema: SCHEMA.$schema,
        $defs: SCHEMA.$defs,
        $ref: `#/$defs/${def}`,
      }),
    );
  }
  return cache.get(def);
};

const file = process.argv[2];
const r = parse(readFileSync(file, 'utf8'));

const bad = [];
const unknownTypes = new Set();

const walk = (n, path) => {
  if (!validateBase(n)) {
    bad.push({ path, type: n.type, id: n.id, reason: '基础字段不符', errors: validateBase.errors });
  }
  // root 只校验 children 是不是数组，不整体校验（否则 oneOf 会把内部节点错误也归到 root）
  if (n.type !== 'root') {
    const v = validatorFor(n.type);
    if (!v) {
      unknownTypes.add(n.type);
    } else if (!v(n)) {
      bad.push({ path, type: n.type, id: n.id, reason: '结构不符', errors: v.errors });
    }
  }
  // rows 只在 table 里是节点（tableRow）；chart 的 rows 是纯字符串数组
  if (Array.isArray(n.children)) n.children.forEach((c, i) => walk(c, `${path}/children/${i}`));
  if (n.type === 'table' && Array.isArray(n.rows)) {
    n.rows.forEach((c, i) => walk(c, `${path}/rows/${i}`));
  }
  (n.columnBlocks ?? []).forEach((col, ci) =>
    col.forEach((c, i) => walk(c, `${path}/columnBlocks/${ci}/${i}`)),
  );
  (n.slides ?? []).forEach((s, i) => walk(s, `${path}/slides/${i}`));
};

walk(r.ast, '/ast');

console.log(`不符节点：${bad.length}    未知 type：${[...unknownTypes].join(', ') || '无'}`);
for (const b of bad.slice(0, 5)) {
  console.log(`\n${b.path}  type=${b.type} id=${b.id}  ${b.reason}`);
  for (const e of b.errors ?? []) {
    console.log(`  ${e.instancePath || '(self)'} ${e.message} ${JSON.stringify(e.params)}`);
  }
}
process.exit(bad.length === 0 && unknownTypes.size === 0 ? 0 : 1);
