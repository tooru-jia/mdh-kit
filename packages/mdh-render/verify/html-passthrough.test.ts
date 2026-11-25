/**
 * HTML 直写验证（SYNTAX.md §21 / BUG-8）
 *
 * 作者拍定的规则（方案 A）：
 *   - 认得的标签 → 过滤属性后渲染
 *   - 认不得的标签 → **当纯文字**（转义输出，不会执行、不会消失）
 *   - 认得的属性保留，认不得的丢弃
 *   - style 里的结构破坏型声明剥离
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../mdh-core/src/index.ts';
import { render } from '../src/index.ts';

const html = (src: string) => render(parse(src).ast);

// ---------- 白名单标签正常渲染 ----------

test('HTML：div + style 原样渲染', () => {
  const out = html('<div style="background:red">红</div>');
  assert.ok(out.includes('<div style="background:red">红</div>'));
});

test('HTML：details/summary 折叠可用', () => {
  const out = html('<details><summary>展开</summary>内容</details>');
  assert.ok(out.includes('<details>'));
  assert.ok(out.includes('<summary>展开</summary>'));
});

test('HTML：行内 mark 生效', () => {
  const out = html('这是 <mark>高亮</mark> 文字');
  assert.ok(out.includes('<mark>高亮</mark>'));
});

test('HTML：a 的 href 与 target 保留', () => {
  const out = html('<a href="https://x.com" target="_blank">站</a>');
  assert.ok(out.includes('href="https://x.com"'));
  assert.ok(out.includes('target="_blank"'));
});

// ---------- 认不得 → 当纯文字 ----------

test('HTML：未知标签当纯文字（转义，不渲染、不消失）', () => {
  const out = html('<blink>闪</blink>');
  assert.ok(out.includes('&lt;blink&gt;'), '应显示字面量开始标签');
  assert.ok(out.includes('&lt;/blink&gt;'), '应显示字面量结束标签');
  assert.ok(out.includes('闪'), '内容不能丢');
  assert.ok(!out.includes('<blink>'), '不应生成真标签');
});

test('HTML：script 当纯文字，不执行', () => {
  const out = html('<script>alert(1)</script>');
  assert.ok(out.includes('&lt;script&gt;'));
  assert.ok(!out.includes('<script>'), '不能出现真的 script 标签');
});

test('HTML：不双重转义', () => {
  const out = html('<blink>x</blink>');
  assert.ok(!out.includes('&amp;lt;'), '不能出现 &amp;lt; 这种二次转义');
});

// ---------- 属性过滤 ----------

test('HTML：on* 事件属性被丢弃，标签保留', () => {
  const out = html('<div onclick="alert(1)">点我</div>');
  assert.ok(out.includes('<div>'), '标签保留');
  assert.ok(!out.includes('onclick'), '事件属性应丢弃');
});

test('HTML：javascript: 协议的 href 被丢弃', () => {
  const out = html('<a href="javascript:alert(1)">链接</a>');
  assert.ok(!out.includes('javascript:'));
  assert.ok(out.includes('链接'));
});

// ---------- style 净化 ----------

test('HTML：position:fixed 被剥离，其余声明保留', () => {
  const out = html('<div style="position:fixed;color:red">坏</div>');
  assert.ok(!out.includes('position'), 'position 应剥离');
  assert.ok(out.includes('color:red'), '其余声明保留');
});

test('HTML：z-index 被剥离', () => {
  const out = html('<div style="z-index:999;padding:4px">x</div>');
  assert.ok(!out.includes('z-index'));
  assert.ok(out.includes('padding:4px'));
});

// ---------- 表格与定义列表（白名单补齐）----------

test('HTML：table 系列标签全部支持', () => {
  const out = html('<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table>');
  for (const tag of ['<table>', '<thead>', '<tbody>', '<tr>', '<th>', '<td>']) {
    assert.ok(out.includes(tag), `应含 ${tag}`);
  }
});

test('HTML：colspan / rowspan / scope 保留', () => {
  const out = html('<table><tr><th colspan="2" scope="col">标题</th></tr><tr><td>a</td><td>b</td></tr></table>');
  assert.ok(out.includes('colspan="2"'), out);
  assert.ok(out.includes('scope="col"'), out);
});

test('HTML：dl / dt / dd 支持', () => {
  const out = html('<dl><dt>术语</dt><dd>解释</dd></dl>');
  for (const tag of ['<dl>', '<dt>', '<dd>']) {
    assert.ok(out.includes(tag), `应含 ${tag}`);
  }
});

test('HTML：table 里的 caption / colgroup 支持', () => {
  const out = html('<table><caption>表名</caption><colgroup><col></colgroup><tr><td>a</td></tr></table>');
  for (const tag of ['<caption>', '<colgroup>', '<col>']) {
    assert.ok(out.includes(tag), `应含 ${tag}`);
  }
});
