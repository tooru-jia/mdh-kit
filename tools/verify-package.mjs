/**
 * 验证打包产物能被「外部项目」正常导入
 *
 * 模拟一个独立项目：不是从源码 import，而是从 dist 产物 import。
 *
 *   node tools/verify-package.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ok = [];
const check = (n, f) => { try { f(); ok.push(n); } catch (e) { console.error('✖', n, e.message); throw e; } };

// ── 1. ESM 导入 ──
const coreEsm = await import('@mdh/core');
const renderEsm = await import('@mdh/render');

check('ESM：@mdh/core 导出 parse', () => assert.equal(typeof coreEsm.parse, 'function'));
check('ESM：@mdh/core 导出 serialize / serializeNode / parseNode', () => {
  assert.equal(typeof coreEsm.serialize, 'function');
  assert.equal(typeof coreEsm.serializeNode, 'function');
  assert.equal(typeof coreEsm.parseNode, 'function');
});
check('ESM：@mdh/render 导出 render / createRenderer', () => {
  assert.equal(typeof renderEsm.render, 'function');
  assert.equal(typeof renderEsm.createRenderer, 'function');
});

// ── 2. 端到端：解析 → 渲染 ──
check('端到端：parse → render', () => {
  const ast = coreEsm.parse('# 标题\n\n- 一项\n- 二项').ast;
  const html = renderEsm.render(ast);
  assert.ok(html.includes('<h1'), '有 h1');
  assert.ok(html.includes('<li'), '有列表项');
});

// ── 3. 反向序列化 ──
check('反向序列化：AST → 源码', () => {
  // 属性名是 ref（见 SYNTAX.md「带引用名」），不是 name
  const ast = coreEsm.parse('***table ref="t"\nhead: A\n- 1\n***table-end').ast;
  const src = coreEsm.serialize(ast);
  assert.ok(src.includes('ref="t"'), '保留 ref');
  assert.ok(src.includes('***table-end'), '闭合正确');
});

// ── 4. CJS 导入 ──
const coreCjs = require('@mdh/core');
const renderCjs = require('@mdh/render');
check('CJS：require 可用', () => {
  assert.equal(typeof coreCjs.parse, 'function');
  assert.equal(typeof renderCjs.render, 'function');
});
check('CJS：解析渲染正常', () => {
  const ast = coreCjs.parse('# CJS 测试').ast;
  const html = renderCjs.render(ast);
  assert.ok(html.includes('CJS 测试'));
});

// ── 5. 类型声明存在且非空 ──
check('类型声明：.d.ts 存在', () => {
  const d1 = readFileSync('packages/mdh-core/dist/index.d.ts', 'utf8');
  const d2 = readFileSync('packages/mdh-render/dist/index.d.ts', 'utf8');
  assert.ok(d1.length > 1000, 'core 类型声明过小');
  assert.ok(d2.length > 500, 'render 类型声明过小');
  assert.ok(d1.includes('parseNode'), 'core 类型含 parseNode');
  assert.ok(d2.includes('createRenderer'), 'render 类型含 createRenderer');
});

// ── 6. package.json 字段正确 ──
check('package.json：main/module/types/exports 齐全', () => {
  for (const p of ['packages/mdh-core/package.json', 'packages/mdh-render/package.json']) {
    const pkg = JSON.parse(readFileSync(p, 'utf8'));
    assert.ok(pkg.main, `${p} 缺 main`);
    assert.ok(pkg.module, `${p} 缺 module`);
    assert.ok(pkg.types, `${p} 缺 types`);
    assert.ok(pkg.exports['.'].import, `${p} 缺 exports.import`);
    assert.ok(pkg.exports['.'].require, `${p} 缺 exports.require`);
    assert.ok(!pkg.main.endsWith('.ts'), `${p} main 仍指向 .ts`);
  }
});

// ── 7. 产物不含源码路径 ──
check('产物：dist 中不引用 .ts 源码', () => {
  const js = readFileSync('packages/mdh-core/dist/index.js', 'utf8');
  assert.ok(!js.includes('../src/'), '产物仍引用 src');
});

console.log(`\n✔ ${ok.length} 项全部通过`);
ok.forEach((n) => console.log('  ·', n));
