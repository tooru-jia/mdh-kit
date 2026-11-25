/**
 * list 内空行与补充文本的渲染规则
 *
 * 核心原则（作者 2026-11-21）：**源码怎么写，就怎么呈现**，空行尤其如此。
 *
 * 规则：
 *   1. `- 项` 之后、下一个 `-` 之前的非列表行，归属该项，作为「补充」
 *   2. 补充**每行一段**（不是合并成一段）
 *   3. 源码里的空行 = 视觉分隔，渲染成「等于一行正文高度」的空白
 *   4. 看到 `-` 就是新项，补充不需要空行结束
 *   5. 补充里可以放行内格式与块
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../mdh-core/src/index.ts';
import { render } from '../src/index.ts';

const R = (src: string) => render(parse(src).ast, { source: src });

/** 取出列表部分的 HTML */
const listOf = (html: string): string => {
  const m = html.match(/<ul[\s\S]*?<\/ul>/);
  return m ? m[0] : '';
};

// ---------- 补充文本 ----------

test('list：项后的顶格文字归属该项，作为补充', () => {
  const html = R('***list\n- C\n\nC的说明\n- D\n***list-end');
  const li = html.match(/<li[^>]*>[\s\S]*?<\/li>/g) ?? [];

  assert.equal(li.length, 2, `应有两个列表项，实际 ${li.length}`);
  assert.ok(li[0].includes('C'), '第一项是 C');
  assert.ok(li[0].includes('C的说明'), `C的说明应归入 C：${li[0]}`);
  assert.ok(!li[1].includes('C的说明'), 'D 不该包含 C 的说明');
});

test('list：补充每行一段（不合并）', () => {
  const html = R('***list\n- C\n\n第一行\n第二行\n- D\n***list-end');
  const paras = html.match(/mdh-item-para/g) ?? [];

  assert.equal(paras.length, 2, `应是 2 段，实际 ${paras.length}`);
  assert.ok(html.includes('>第一行<') || html.includes('第一行'), '缺第一行');
  assert.ok(html.includes('>第二行<') || html.includes('第二行'), '缺第二行');
});

test('list：补充不需要空行结束，看到 - 就是新项', () => {
  const withBlank = R('***list\n- C\n\n补充\n\n- D\n***list-end');
  const withoutBlank = R('***list\n- C\n\n补充\n- D\n***list-end');

  const strip = (h: string) => h.replace(/\s+/g, '');
  /*
   * 结构（li 的数量、归属、文字）必须一致；
   * 但「- D 前面有没有空行」会被记成 data-mdh-blank —— 那是作者 2026-11-22
   * 要求保留的视觉信息，所以比对时把它剥掉。
   */
  const stripBlank = (h: string) => strip(h).replace(/data-mdh-blank="\d+"/g, '');
  assert.equal(stripBlank(withBlank), stripBlank(withoutBlank), '补充后有无空行，结构应一致');
  assert.ok(withBlank.includes('data-mdh-blank'), '有空的版本应带 data-mdh-blank');
  assert.ok(!withoutBlank.includes('data-mdh-blank'), '无空的版本不应带');
});

test('list：多段补充都归属同一项', () => {
  const html = R('***list\n- C\n\n第一段\n第二段\n第三段\n- D\n***list-end');
  const firstLi = html.slice(html.indexOf('<li'), html.indexOf('</li>') + 5);

  for (const t of ['第一段', '第二段', '第三段']) {
    assert.ok(firstLi.includes(t), `${t} 应归入 C`);
  }
});

// ---------- 空行的视觉呈现 ----------

test('list：补充之间的空行要保留为视觉分隔', () => {
  const html = R('***list\n- C\n\n第一段\n\n第二段\n- D\n***list-end');

  // 源码里两段之间有空行，渲染产物必须能区分出这两段
  assert.ok(html.includes('第一段'), '缺第一段');
  assert.ok(html.includes('第二段'), '缺第二段');

  // 结构上必须是两个独立段落（不是一个段落里换行）
  const paras = html.match(/mdh-item-para/g) ?? [];
  assert.equal(paras.length, 2, `应是 2 段，实际 ${paras.length}`);
});

test('list：空行高度等于一行正文高度', () => {
  const blankGap = R('***list\n- C\n\n第一段\n\n第二段\n- D\n***list-end');
  const noGap = R('***list\n- C\n\n第一段\n第二段\n- D\n***list-end');

  // 有空行的那份，必须带了「行高」这类尺寸信息，才能做到视觉上真的空出一行
  assert.ok(
    /mdh-blank|--mdh-blank|blank-before/.test(blankGap),
    `有空行的补充应带空白标记：${blankGap}`,
  );
  assert.ok(
    !/mdh-blank|blank-before/.test(noGap),
    `没空行的补充不该带空白标记：${noGap}`,
  );
});

// ---------- 补充里能放什么 ----------

test('list：补充里可以放行内格式', () => {
  const html = R('***list\n- C\n\n**加粗的补充** 与 $x^2$\n- D\n***list-end');
  assert.ok(html.includes('mdh-strong'), '补充里的加粗没生效');
  assert.ok(html.includes('mdh-inline-math'), '补充里的公式没生效');
});

test('list：补充里可以放块', () => {
  const html = R(
    '***list\n- C\n\n***table\nhead: a\n- 1\n***table-end\n- D\n***list-end',
  );
  assert.ok(html.includes('<table'), `补充里的表格没渲染：${html}`);
});

// ---------- 块内代码块（BUG：内容被吞） ----------

test('list：块内代码块的内容不能丢', () => {
  const html = R('***list\n- 第一项\n\n```ts\nconst a = 1;\n```\n***list-end');
  assert.ok(html.includes('<pre'), `代码块没渲染：${html}`);
  assert.ok(html.includes('const a = 1;'), `代码块内容被吞了：${html}`);
});

test('list：块内正文与代码块相邻时都不能丢', () => {
  const html = R('***list\n- 第一项\n\n正文行。\n\n```ts\nconst a = 1;\n```\n***list-end');
  assert.ok(html.includes('正文行。'), `正文被吞了：${html}`);
  assert.ok(html.includes('const a = 1;'), `代码块内容被吞了：${html}`);
});

// ---------- 块内空行不得把整体往下推 ----------

test('list：块内空行按原位插入，不堆到容器顶部', () => {
  // 空行在标题之后、列表之前 → 空行应夹在两者中间，列表不应被推到底部
  const html = R('***list\n### 计划\n\n\n1. 完成\n***list-end');
  const h3 = html.indexOf('</h3>');
  const blank = html.indexOf('mdh-blank');
  const ol = html.indexOf('<ol');
  assert.ok(h3 < blank && blank < ol, `空行应在标题与列表之间：${html}`);
});

test('list：空行只渲染一次，不重复', () => {
  const html = R('***list\n### 计划\n\n\n\n\n1. 完成\n***list-end');
  assert.equal((html.match(/mdh-blank/g) ?? []).length, 4, html);
});

// ---------- 无块模式（不受此规则影响） ----------

test('list：无块模式下空行仍表示列表结束', () => {
  const html = R('- A\n\n这是独立正文');
  const ul = listOf(html);

  assert.ok(!ul.includes('这是独立正文'), '无块模式下，空行后的文字不该进列表');
  assert.ok(html.includes('<p'), '应成为独立段落');
});
