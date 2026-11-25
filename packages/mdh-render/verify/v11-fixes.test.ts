/**
 * v1.1 修复的回归测试
 *
 * 覆盖：
 *   BUG-1   `***list` 容器不得带 .mdh-list（22.4px 多余缩进）
 *   DESIGN-1 失效引用 → mdh-ref-broken
 *   DESIGN-2 行内空格保留 + 行尾裁剪
 *   DESIGN-3 不可见字符 → mdh-invisible（且不误伤 emoji）
 *   DESIGN-4 @tag() 关闭，原样输出
 *   TODO-1  Tab 缩进视为顶级，不产生嵌套
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../mdh-core/src/index.ts';
import { render } from '../src/index.ts';

const R = (src: string) => render(parse(src).ast, { source: src });

// ---------- BUG-1：***list 容器不带 .mdh-list ----------

test('BUG-1：***list 的容器是 mdh-list-block，不带 mdh-list', () => {
  // 容器只在「块内混入非列表块」时才出现（如标题、代码块），
  // 纯列表项 + 空行不会包容器。这里用标题触发容器分支。
  const html = R('***list\n### 标题\n- A\n***list-end');
  assert.ok(html.includes('mdh-list-block'), `容器类不对：${html}`);
  const wrapper = html.match(/<div[^>]*data-mdh-type="listBlock"[^>]*>/)?.[0] ?? '';
  assert.ok(wrapper, `没找到 listBlock 容器：${html}`);
  // 容器上不该有独立的 mdh-list 类（mdh-list-block 不算）
  const afterStrip = wrapper.replace('mdh-list-block', '');
  assert.ok(!/\bmdh-list\b/.test(afterStrip), `容器仍带 mdh-list：${wrapper}`);
});

test('BUG-1：***list 块内与外部列表结构一致（不含多余容器类）', () => {
  const inner = R('***list\n- A\n***list-end');
  const outer = R('- A');
  const ulInner = inner.match(/<ul[^>]*>/)?.[0] ?? '';
  const ulOuter = outer.match(/<ul[^>]*>/)?.[0] ?? '';
  // 两个 <ul> 的类名应相同（只差 data/id 属性）
  assert.ok(ulInner.includes('mdh-list'), ulInner);
  assert.ok(ulOuter.includes('mdh-list'), ulOuter);
});

// ---------- DESIGN-1：失效引用 ----------

test('DESIGN-1：引用目标不存在 → mdh-ref-broken，且无 href', () => {
  const html = R('见表 @不存在 可知');
  assert.ok(html.includes('mdh-ref-broken'), `缺失效标记：${html}`);
  assert.ok(html.includes('@不存在'), `原文应保留：${html}`);
  const tag = html.match(/<span[^>]*mdh-ref-broken[^>]*>/)?.[0] ?? '';
  assert.ok(!tag.includes('href='), `失效引用不该有 href：${tag}`);
});

test('DESIGN-1：引用目标存在 → 正常 <a>，不误伤', () => {
  const html = R('***table ref="员工表"\nhead: a\n- 1\n***table-end\n\n见表 @员工表');
  assert.ok(html.includes('href="#'), `应有跳转：${html}`);
  assert.ok(!html.includes('mdh-ref-broken'), `不该标成失效：${html}`);
});

// ---------- DESIGN-2：行内空格 ----------

test('DESIGN-2：行内连续空格原样保留', () => {
  const html = R('A    B');
  assert.ok(html.includes('A    B'), `空格没保留：${html}`);
});

test('DESIGN-2：行尾空格被裁掉', () => {
  const html = R('A  ');
  assert.ok(html.includes('>A<') || html.includes('>A</p>'), `行尾空格未裁：${html}`);
  assert.ok(!html.includes('A  </p>'), `行尾空格残留：${html}`);
});

test('DESIGN-2：段内多行时 <br> 前无残留空格', () => {
  const html = R('A  \nB');
  assert.ok(!/A\s+<br>/.test(html), `<br> 前有空格：${html}`);
  assert.ok(html.includes('<br>'), `应保留换行：${html}`);
});

test('DESIGN-2：列表项补充段的行尾空格也裁掉', () => {
  const html = R('- 项\n  补充  ');
  assert.ok(!/补充\s+<\/span>/.test(html), `补充段行尾空格残留：${html}`);
});

// ---------- DESIGN-3：不可见字符 ----------

test('DESIGN-3：零宽空格渲染成 [U+200B] 标记', () => {
  const html = R('正\u200B文');
  assert.ok(html.includes('mdh-invisible'), `缺不可见标记：${html}`);
  assert.ok(html.includes('[U+200B]'), `码点显示不对：${html}`);
  assert.ok(!html.includes('\u200B'), `原始零宽字符不该留在输出里：${html}`);
});

test('DESIGN-3：RTL 覆盖符也被标记', () => {
  const html = R('文字\u202E结尾');
  assert.ok(html.includes('[U+202E]'), `RTL 未标记：${html}`);
});

test('DESIGN-3：emoji 与符号不被误伤', () => {
  const html = R('图标 😀 ✅ ★ 正常');
  assert.ok(html.includes('😀'), `emoji 被吞了：${html}`);
  assert.ok(html.includes('✅'), `符号被吞了：${html}`);
  assert.ok(!html.includes('mdh-invisible'), `不该标记 emoji：${html}`);
});

test('DESIGN-3：解析层给出不可见字符诊断', () => {
  const r = parse('正\u200B文');
  const d = r.diagnostics.find((x) => x.message.includes('不可见字符'));
  assert.ok(d, `缺诊断：${JSON.stringify(r.diagnostics)}`);
  assert.equal(d.level, 'warning');
  assert.equal(d.line, 1);
});

test('DESIGN-3：正常文本不产生不可见字符诊断', () => {
  const r = parse('普通正文，含 😀 与 ✅');
  assert.ok(!r.diagnostics.some((x) => x.message.includes('不可见字符')),
    JSON.stringify(r.diagnostics));
});

// ---------- DESIGN-4：@tag 关闭 ----------

test('DESIGN-4：@tag() 原样输出，不渲染成标签', () => {
  const html = R('打标签 @tag(英语) 结束');
  assert.ok(!html.includes('mdh-tag'), `不该渲染标签：${html}`);
  assert.ok(html.includes('@tag(英语)'), `应原样输出：${html}`);
});

test('DESIGN-4：多个 @tag 都不渲染', () => {
  const html = R('@tag(英语) @tag(学习)');
  assert.ok(!html.includes('mdh-tag'), html);
  assert.ok(html.includes('@tag(英语)'), html);
  assert.ok(html.includes('@tag(学习)'), html);
});

// ---------- TODO-1：Tab 缩进视为顶级 ----------

test('TODO-1：Tab 缩进的列表项与顶格同级，不产生嵌套', () => {
  const tab = R('\t- A\n\t- B');
  const flat = R('- A\n- B');
  const strip = (h: string) => h.replace(/\sdata-mdh-id="[^"]*"|\sid="[^"]*"/g, '');
  assert.equal(strip(tab), strip(flat), 'Tab 缩进应与顶格结构一致');
});

test('TODO-1：相对缩进仍然产生子层', () => {
  const html = R('- A\n  - 子');
  const liCount = (html.match(/<li/g) ?? []).length;
  assert.equal(liCount, 2, `应是 2 个 li（外层 + 子层）：${html}`);
  // 子层必须是嵌套的 ul
  assert.ok(/<li[^>]*>[^<]*<ul/.test(html), `子层应嵌在外层 li 内：${html}`);
});

// ---------- 空行：标题 / 列表也要保留（2026-11-22）----------
//
// 原来只有段落保留 blefore，标题和列表的空行被丢掉了。
// 作者的期望是「源码空几行，渲染后也空几行」，不分块类型。

test('空行：标题之间的空行保留', () => {
  const ast = parse('## 标题A\n\n\n\n## 标题B').ast as any;
  const h2 = ast.children[1];
  assert.equal(h2.type, 'heading');
  assert.equal(h2.blankBefore, 3, `标题应带 blankBefore=3，实际 ${h2.blankBefore}`);
  const html = R('## 标题A\n\n\n\n## 标题B');
  assert.ok(html.includes('data-mdh-blank="3"'), `渲染应输出 data-mdh-blank：${html}`);
});

test('空行：列表前的空行保留', () => {
  const ast = parse('正文\n\n\n\n- 项').ast as any;
  const list = ast.children.find((c: any) => c.type === 'list');
  assert.ok(list, '应有列表节点');
  assert.equal(list.blankBefore, 3, `列表应带 blankBefore=3，实际 ${list.blankBefore}`);
  const html = R('正文\n\n\n\n- 项');
  assert.ok(/<ul[^>]*data-mdh-blank="3"/.test(html), `列表应输出 data-mdh-blank：${html}`);
});

test('空行：标题后接列表的空行保留', () => {
  const ast = parse('## 标题\n\n\n- 项').ast as any;
  const list = ast.children.find((c: any) => c.type === 'list');
  assert.equal(list.blankBefore, 2, `应为 2，实际 ${list.blankBefore}`);
});

test('空行：无空行时不输出 data-mdh-blank', () => {
  const html = R('## 标题A\n## 标题B');
  assert.ok(!html.includes('data-mdh-blank'), `不该有空行标记：${html}`);
});

test('空行：段落行为不变（回归）', () => {
  const html = R('标题\n\n\n正文');
  assert.ok(html.includes('data-mdh-blank="2"'), `段落空行应保持：${html}`);
});

test('空行：正文→标题的 enter 被识别（作者反馈场景）', () => {
  const withEnter = parse('正文C\n\n## 标题D').ast as any;
  const withoutEnter = parse('正文C\n## 标题D').ast as any;
  const h1 = withEnter.children.find((c: any) => c.type === 'heading');
  const h2 = withoutEnter.children.find((c: any) => c.type === 'heading');
  assert.equal(h1.blankBefore, 1, `应识别出 1 个空行，实际 ${h1.blankBefore}`);
  assert.equal(h2.blankBefore, undefined, '无空行时不该有 blankBefore');
});

test('空行：h1→h2 之间的 enter 被识别（作者反馈场景）', () => {
  const ast = parse('# 一级\n\n## 二级').ast as any;
  const h2 = ast.children[1];
  assert.equal(h2.type, 'heading');
  assert.equal(h2.blankBefore, 1, `h1→h2 的空行应被识别，实际 ${h2.blankBefore}`);
});
