import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { parse } from '../../src/index.ts';

const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020').default;
const addFormats = require('ajv-formats').default;

const ROOT = new URL('../../../..', import.meta.url).pathname.replace(/verify\/schema\/$/, '');
const SCHEMA_PATH = join(ROOT, 'schema/ast-1.0.json');
const SCHEMA = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
// 样例文档跟着本仓库走：verify/examples/（原先在仓库外的 mdh/examples）
const EXAMPLES = join(ROOT, 'verify/examples');

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

/** 每个 type 对应哪个 schema 定义 */
const TYPE_TO_DEF: Record<string, string> = {
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
  quote: 'quote',
};

const validatorFor = (def: string) =>
  ajv.compile({ $schema: SCHEMA.$schema, $defs: SCHEMA.$defs, $ref: `#/$defs/${def}` });

/** 逐节点校验，返回所有不符的节点 */
const validateTree = (ast: any) => {
  const bad: Array<{ path: string; type: string; id: string; errors: any[] }> = [];
  const unknown = new Set<string>();

  const walk = (n: any, path: string) => {
    /*
     * 裸列表的分组节点不占位（2026-11-25）：它的 id 是首项的别名，
     * 两者在渲染时是一体的，不当作独立节点校验。
     */
    const isBareListGroup = n.type === 'list' && n.explicit === false;
    if (n.type !== 'root' && !isBareListGroup) {
      const def = TYPE_TO_DEF[n.type];
      if (!def) {
        unknown.add(n.type);
      } else {
        const v = validatorFor(def);
        if (!v(n)) bad.push({ path, type: n.type, id: n.id, errors: v.errors ?? [] });
      }
    }
    if (Array.isArray(n.children)) n.children.forEach((c: any, i: number) => walk(c, `${path}/children/${i}`));
    if (n.type === 'table' && Array.isArray(n.rows)) {
      n.rows.forEach((c: any, i: number) => walk(c, `${path}/rows/${i}`));
    }
    (n.columnBlocks ?? []).forEach((col: any[], ci: number) =>
      col.forEach((c, i) => walk(c, `${path}/columnBlocks/${ci}/${i}`)),
    );
    (n.slides ?? []).forEach((s: any, i: number) => walk(s, `${path}/slides/${i}`));
  };

  walk(ast, '/ast');
  return { bad, unknown };
};

// ---------- Schema 自身 ----------

test('Schema：合法 JSON 且为 2020-12 草案', () => {
  assert.ok(SCHEMA.$schema.includes('2020-12'));
  assert.ok(SCHEMA.$id);
  assert.ok(SCHEMA.$defs);
});

test('Schema：15 种节点类型齐全', () => {
  for (const def of Object.values(TYPE_TO_DEF)) {
    assert.ok(SCHEMA.$defs[def], `$defs 缺 ${def}`);
  }
});

test('Schema：可被 AJV 编译（无语法错误）', () => {
  assert.doesNotThrow(() => ajv.compile(SCHEMA));
});

// ---------- 真实样例 ----------

const files = readdirSync(EXAMPLES).filter((f) => f.endsWith('.mdh'));

test(`Schema：${files.length} 份真实样例全部符合契约`, () => {
  for (const f of files) {
    const { ast } = parse(readFileSync(join(EXAMPLES, f), 'utf8'));
    const { bad, unknown } = validateTree(ast);
    assert.deepEqual([...unknown], [], `${f} 出现未知 type`);
    assert.deepEqual(
      bad.map((b) => `${b.path} (${b.type})`),
      [],
      `${f} 有不符节点`,
    );
  }
});

// ---------- 各节点类型 ----------

const okFor = (type: string, node: any) => {
  const v = validatorFor(TYPE_TO_DEF[type]);
  return v(node);
};

test('Schema：root 必须是 R（DECISION-3）', () => {
  assert.ok(okFor('root', { type: 'root', id: 'R', description: 'x', children: [] }));
  assert.ok(!okFor('root', { type: 'root', id: 'M1', description: 'x', children: [] }));
});

test('Schema：heading 的 level 限 1-6', () => {
  assert.ok(okFor('heading', { type: 'heading', id: 'M1', description: 'x', level: 1, text: 'a' }));
  assert.ok(okFor('heading', { type: 'heading', id: 'M1', description: 'x', level: 6, text: 'a' }));
  assert.ok(!okFor('heading', { type: 'heading', id: 'M1', description: 'x', level: 7, text: 'a' }));
  assert.ok(!okFor('heading', { type: 'heading', id: 'M1', description: 'x', level: 0, text: 'a' }));
});

test('Schema：chart 类型限 bar/line/pie', () => {
  const base = { type: 'chart', id: 'M1', description: 'x', headers: ['A'], rows: [['1']] };
  assert.ok(okFor('chart', { ...base, chartType: 'bar' }));
  assert.ok(okFor('chart', { ...base, chartType: 'pie' }));
  assert.ok(!okFor('chart', { ...base, chartType: 'scatter' }));
});

test('Schema：column 最多 3 栏', () => {
  const mk = (n: number) => ({
    type: 'column',
    id: 'M1',
    description: 'x',
    ratios: Array(n).fill(1),
    columnBlocks: Array(n).fill([]),
    columnIds: Array.from({ length: n }, (_, i) => `M1-N${i + 1}`),
  });
  assert.ok(okFor('column', mk(2)));
  assert.ok(okFor('column', mk(3)));
  assert.ok(!okFor('column', mk(4)));
});

test('Schema：page 预设限 html/slides', () => {
  const mk = (p: string) => ({
    type: 'page', id: 'M1', description: 'x', preset: p, slides: [], children: [],
  });
  assert.ok(okFor('page', mk('html')));
  assert.ok(okFor('page', mk('slides')));
  assert.ok(!okFor('page', mk('a4')));
});

// ---------- ID 规则 ----------

const idRe = new RegExp(SCHEMA.$defs.id.pattern);

test('ID：合法形态全部通过（DECISION-3）', () => {
  for (const id of [
    'R',
    'M1', 'M2', 'M135',
    'M1-N1', 'M1-O1',
    // FIX-2：第 3 层之后不再加段，序号在 O 上累加
    'M1-N1-O1', 'M1-N1-O2', 'M1-N1-O3', 'M1-N1-O12',
    // 分栏：栏是第 2 层，栏内内容第 3 层起都是 O
    'M1-N1-O1', 'M1-N2-O1',
    // slides：页是 M，页内内容 N
    'M2-N1', 'M2-N2',
    // 空串：该节点不占 ID（如 slides 页面容器）
    '',
  ]) {
    assert.ok(idRe.test(id), `应通过：${id}`);
  }
});

test('ID：非法形态全部拒绝', () => {
  for (const id of ['O', 'O0', 'A', 'M0', 'a1', 'M1-', 'M1-D1', 'M1-N0', 'X1-Y1', 'A1']) {
    assert.ok(!idRe.test(id), `应拒绝：${id}`);
  }
});

test('ID：实际产物全部符合正则', () => {
  const { ast } = parse(
    '***column(1fr/1fr)\n***table\nhead: A\n- 1\n***table-end\n@next-column\n右\n***column-end\n',
  );
  const ids: string[] = [];
  const walk = (n: any) => {
    if (n.id) ids.push(n.id);
    (n.cellIds ?? []).forEach((x: string) => ids.push(x));
    if (Array.isArray(n.children)) n.children.forEach(walk);
    if (n.type === 'table' && Array.isArray(n.rows)) n.rows.forEach(walk);
    (n.columnBlocks ?? []).forEach((col: any[]) => col.forEach(walk));
  };
  walk(ast);
  assert.ok(ids.length > 3);
  for (const id of ids) assert.ok(idRe.test(id), `实际产物 ID 不符：${id}`);
});

// ---------- v0.2：对象不携带编号 ----------

test('v0.2：带 name 的对象也没有 number 字段', () => {
  const src = `***table ref="t"
head: A
- 1
***table-end

***chart(bar) ref="c"
head: A
- 1
***chart-end

***mermaid ref="m"
graph TD
A-->B
***mermaid-end

***math ref="x"
E = mc^2
***math-end`;
  const { ast } = parse(src);
  for (const n of ast.children as any[]) {
    assert.ok(n.name, `${n.type} 应保留 name`);
    assert.equal(n.number, undefined, `${n.type} 不应携带 number`);
  }
});

test('v0.2：Schema 的节点定义里没有 number 属性', () => {
  for (const def of ['table', 'chart', 'mermaid', 'math']) {
    const props = SCHEMA.$defs[def].properties ?? {};
    assert.equal(props.number, undefined, `$defs.${def} 仍含 number`);
  }
});
