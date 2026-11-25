/**
 * 行内格式：12 种两层嵌套组合
 *
 * 四种格式（粗 ** / 斜 / / 下划 __ / 删 --）两两组合，方向也算一种写法：
 * 外层 A 内层 B 与 外层 B 内层 A 是两条不同的规则，必须都覆盖。
 *
 * 作者 2026-11-21 的边界：
 *   - 四种格式之间**互相继承**（`**__粗下__**` 里的「粗下」既粗又下划线）
 *   - 但**不穿透**行内代码与行内公式：`**有 \`code\`**` 里 code 不变粗
 *     （后者在主题层用 CSS 隔离，这里只验结构没被打散）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../mdh-core/src/index.ts';
import { render } from '../src/index.ts';

const R = (s: string) => render(parse(s).ast, { source: s });
/** 取段落内部 HTML */
const inner = (s: string): string => {
  const m = R(s).match(/<p[^>]*>([\s\S]*?)<\/p>/);
  return m ? m[1] : '';
};

/** 断言：外层是一个标签、内层是另一个标签、内容完整 */
function assertNested(
  src: string,
  outer: string,
  innerTag: string,
  label: string,
): void {
  const html = inner(src);
  const outerRe = new RegExp(`<${outer}[^>]*>\\s*<${innerTag}[^>]*>([^<]+)</${innerTag}>\\s*</${outer}>`);
  const m = html.match(outerRe);
  assert.ok(m, `${label}：期望 <${outer}><${innerTag}>…</${innerTag}></${outer}>，实际 ${html}`);
  assert.ok(m![1].trim().length > 0, `${label}：内层内容为空`);
}

// ---------- ** 粗体打头 ----------

test('嵌套：** 外层，__ 内层（粗 + 下划线）', () => {
  assertNested('**__文字__**', 'strong', 'u', '**__x__**');
});

test('嵌套：** 外层，/ 内层（粗 + 斜体）', () => {
  assertNested('**/文字/**', 'strong', 'em', '**/x/**');
});

test('嵌套：** 外层，-- 内层（粗 + 删除线）', () => {
  assertNested('**--文字--**', 'strong', 'del', '**--x--**');
});

// ---------- __ 下划线打头 ----------

test('嵌套：__ 外层，** 内层（下划线 + 粗）', () => {
  assertNested('__**文字**__', 'u', 'strong', '__**x**__');
});

test('嵌套：__ 外层，/ 内层（下划线 + 斜体）', () => {
  assertNested('__/文字/__', 'u', 'em', '__/x/__');
});

test('嵌套：__ 外层，-- 内层（下划线 + 删除线）', () => {
  assertNested('__--文字--__', 'u', 'del', '__--x--__');
});

// ---------- / 斜体打头 ----------

test('嵌套：/ 外层，** 内层（斜体 + 粗）', () => {
  assertNested('/**文字**/', 'em', 'strong', '/**x**/');
});

test('嵌套：/ 外层，__ 内层（斜体 + 下划线）', () => {
  assertNested('/__文字__/', 'em', 'u', '/__x__/');
});

test('嵌套：/ 外层，-- 内层（斜体 + 删除线）', () => {
  assertNested('/--文字--/', 'em', 'del', '/--x--/');
});

// ---------- -- 删除线打头 ----------

test('嵌套：-- 外层，** 内层（删除线 + 粗）', () => {
  assertNested('--**文字**--', 'del', 'strong', '--**x**--');
});

test('嵌套：-- 外层，__ 内层（删除线 + 下划线）', () => {
  assertNested('--__文字__--', 'del', 'u', '--__x__--');
});

test('嵌套：-- 外层，/ 内层（删除线 + 斜体）', () => {
  assertNested('--/文字/--', 'del', 'em', '--/x/--');
});

// ---------- 不穿透：代码与公式 ----------

test('嵌套边界：加粗里的行内代码结构保持独立', () => {
  const html = inner('**加粗里有 `code`**');
  // 结构上 code 嵌套在 strong 内，但它是独立标签（视觉由主题层隔离为正常字重）
  assert.ok(/<strong[^>]*>[\s\S]*<code[^>]*>code<\/code>[\s\S]*<\/strong>/.test(html), html);
});

test('嵌套边界：加粗里的行内公式结构保持独立', () => {
  const html = inner('**加粗里有 $x^2$**');
  assert.ok(/<strong[^>]*>[\s\S]*<span class="mdh-inline-math"[^>]*>[\s\S]*<\/strong>/.test(html), html);
});

test('嵌套边界：下划线里的代码不被打散', () => {
  const html = inner('__下划里有 `code`__');
  assert.ok(/<u[^>]*>[\s\S]*<code[^>]*>code<\/code>[\s\S]*<\/u>/.test(html), html);
});

// ---------- 边界：不该嵌套的情形 ----------

test('嵌套边界：三个以上符号不构成格式', () => {
  const html = inner('***三星号***');
  // 不该出现 strong 套 strong 之类的产物
  const strongCount = (html.match(/<strong/g) ?? []).length;
  assert.ok(strongCount <= 1, `三星号不该产生多层 strong：${html}`);
});

test('嵌套边界：未闭合的符号保持字面量', () => {
  const html = inner('这里有 ** 但没有闭合');
  assert.ok(!html.includes('<strong'), `未闭合不该生成 strong：${html}`);
});

test('嵌套边界：两层以上不支持（第三层按字面量处理）', () => {
  const html = inner('**__/三层/**__/');
  // 至少不能崩，产物里 strong 与 u 不能同时完整闭合三次
  const opens = (html.match(/<(strong|u|em|del)[ >]/g) ?? []).length;
  assert.ok(opens <= 3, `层数异常：${html}`);
});
