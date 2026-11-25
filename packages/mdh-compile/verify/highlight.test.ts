/**
 * highlight 插件验证
 *
 * 重点：第二层在有语言时会输出顶栏（<div class="mdh-code-head">），
 * 插件必须能跨过顶栏找到 <code>，否则整块代码都不高亮。
 * 这是 2026-11-20 被发现并修复的回归点，必须锁住。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../mdh-core/src/index.ts';
import { render } from '../../mdh-render/src/index.ts';
import { highlightPlugin } from '../src/node/highlight.ts';

const skeleton = (src: string) => render(parse(src).ast);
const run = (html: string, opts = {}) =>
  highlightPlugin(opts).transform(html, { mode: 'static' });

/** 有语言 → 第二层会输出顶栏 */
const WITH_LANG = '```ts\nconst y = 1;\n```\n';

/** 有语言 + 文件名 → 顶栏里多一个标题 */
const WITH_TITLE = '```ts title="src/parser.ts"\nexport const x = 1;\n```\n';

/** 无语言 */
const NO_LANG = '```\nplain text\n```\n';

// ---------- 前提：确认第二层的输出形态 ----------

test('第二层：有语言时会输出顶栏', () => {
  const html = skeleton(WITH_LANG);
  assert.ok(html.includes('mdh-code-head'), '应输出顶栏');
  assert.ok(html.includes('data-mdh-lang="ts"'), '应带 data-mdh-lang');
});

test('第二层：顶栏夹在 <pre> 与 <code> 之间', () => {
  const html = skeleton(WITH_LANG);
  const preIdx = html.indexOf('<pre');
  const headIdx = html.indexOf('mdh-code-head');
  const codeIdx = html.indexOf('<code');
  assert.ok(preIdx < headIdx, '顶栏应在 <pre> 之后');
  assert.ok(headIdx < codeIdx, '顶栏应在 <code> 之前');
});

// ---------- 回归：带顶栏时必须能高亮 ----------

/*
 * 断言用「code 标签是不是同时带 hljs 和 mdh-code-content」，
 * 不写死 class 属性顺序 —— 2026-11-25 起 class 变成
 * `mdh-code-content hljs`（语义类名 + 高亮类名，缺一不可）。
 */
const CODE_OPEN = /<code[^>]*class="[^"]*\bhljs\b[^"]*"[^>]*>/;
const CODE_BLOCK = /<code[^>]*class="[^"]*\bhljs\b[^"]*"[^>]*>([\s\S]*?)<\/code>/;

test('有语言（带顶栏）→ 代码被高亮', async () => {
  const out = await run(skeleton(WITH_LANG));
  assert.ok(CODE_OPEN.test(out), '应有 code.hljs');
});

test('有语言 + 文件名（带顶栏）→ 代码被高亮', async () => {
  const out = await run(skeleton(WITH_TITLE));
  assert.ok(CODE_OPEN.test(out), '应有 code.hljs');
});

test('高亮同时保留语义类名 mdh-code-content', async () => {
  // 内边距等布局规则挂在 mdh-code-content 上；
  // 高亮时若把它覆盖掉，代码就会紧贴左上角（历史 bug）。
  const out = await run(skeleton(WITH_TITLE));
  assert.ok(/<code[^>]*class="[^"]*\bmdh-code-content\b[^"]*"/.test(out), '应保留 mdh-code-content');
});

test('高亮产生 token span', async () => {
  const out = await run(skeleton(WITH_TITLE));
  const codePart = out.match(CODE_BLOCK);
  assert.ok(codePart, '应找到 code.hljs');
  assert.ok(
    (codePart[1].match(/<span/g) ?? []).length > 0,
    '代码内容里应有高亮 span',
  );
});

// ---------- 顶栏不能被破坏 ----------

test('顶栏原样保留（文件名）', async () => {
  const out = await run(skeleton(WITH_TITLE));
  assert.ok(out.includes('src/parser.ts'), '文件名应保留');
  assert.ok(
    /class="mdh-code-title">src\/parser\.ts</.test(out),
    '文件名应仍在顶栏结构里',
  );
});

test('顶栏原样保留（语言标签）', async () => {
  const out = await run(skeleton(WITH_LANG));
  assert.ok(
    /class="mdh-code-lang">ts</.test(out),
    '语言标签应仍在顶栏里',
  );
});

test('顶栏里不产生高亮 span', async () => {
  const out = await run(skeleton(WITH_TITLE));
  const head = out.match(/<div class="mdh-code-head">([\s\S]*?)<\/div>/);
  assert.ok(head, '应找到顶栏');
  assert.equal(
    (head[1].match(/<span class="hljs-/g) ?? []).length,
    0,
    '顶栏是元信息，不该有高亮 token',
  );
});

test('<pre> 的属性不丢失', async () => {
  const out = await run(skeleton(WITH_TITLE));
  const pre = out.match(/<pre([^>]*)>/);
  assert.ok(pre);
  assert.ok(pre[1].includes('mdh-code'), 'class 应保留');
  assert.ok(pre[1].includes('data-mdh-lang="ts"'), 'data-mdh-lang 应保留');
  assert.ok(pre[1].includes('data-mdh-title'), 'data-mdh-title 应保留');
});

test('data-mdh-id 不被吞掉', async () => {
  const out = await run(skeleton(WITH_LANG));
  assert.ok(/data-mdh-id="[MNO]\d+"/.test(out), '第二层加的 ID 应保留');
});

// ---------- 不应处理的几种 ----------

/*
 * 无语言 → 走自动识别（作者 2026-11-22 改）
 *
 * 原行为：正则强制要求 data-mdh-lang，无语言代码块原样输出、永不高亮。
 * 现在：所有代码块都进高亮流程，没写语言就交给 hljs.highlightAuto 猜。
 *      `plain text` 这种猜不出东西的内容，结果就是原样文字（不带 span），
 *      但会带上 class="hljs"，于是底色、字号这些样式也统一生效。
 */
test('无语言 → 走自动识别，加 hljs class', async () => {
  const out = await run(skeleton(NO_LANG));
  assert.ok(CODE_OPEN.test(out), '应加 hljs class');
  assert.ok(/plain\s*text/.test(out.replace(/<[^>]+>/g, '')), '内容应原样保留（允许被 span 包裹）');
  assert.ok(out.includes('mdh-code-head'), '顶栏应保留');
});

test('未知语言 + plain 模式 → 原样转义，不加高亮', async () => {
  const src = '```zzz\nconst a = 1;\n```\n';
  const out = await run(skeleton(src), { unknownLanguage: 'plain' });
  assert.ok(CODE_OPEN.test(out), '仍应加 hljs class');
  assert.equal((out.match(/<span class="hljs-/g) ?? []).length, 0, '不应有 token');
});

test('未知语言 + auto 模式 → 自动识别', async () => {
  const src = '```zzz\nconst a = 1;\n```\n';
  const out = await run(skeleton(src), { unknownLanguage: 'auto' });
  assert.ok(CODE_OPEN.test(out));
});

// ---------- 转义 ----------

test('代码里的 HTML 被转义后再高亮', async () => {
  const src = '```html\n<div class="x">a</div>\n```\n';
  const out = await run(skeleton(src));
  const codePart = out.match(CODE_BLOCK);
  assert.ok(codePart);
  // 原样出现未转义的 <div class="x"> 说明转义漏了
  assert.ok(!codePart[1].includes('<div class="x">'), '应转义尖括号');
});

test('多个代码块全部处理', async () => {
  const src = WITH_LANG + '\n' + WITH_TITLE + '\n' + WITH_LANG;
  const out = await run(skeleton(src));
  const count = (out.match(/<code[^>]*class="[^"]*\bhljs\b[^"]*"/g) ?? []).length;
  assert.equal(count, 3, '三个代码块都应被处理');
});

// ---------- 行号 ----------

test('代码体按行包成 mdh-code-line', async () => {
  // 行号靠 CSS 计数器在 .mdh-code-line 上递增，
  // 所以高亮之后行结构必须还在。
  const src = '```ts\nconst a = 1;\nconst b = 2;\nconst c = 3;\n```\n';
  const out = await run(skeleton(src));
  const lines = (out.match(/class="mdh-code-line"/g) ?? []).length;
  assert.equal(lines, 3, `应有 3 行：${out}`);
});

test('跨行的高亮标签在每行内闭合', async () => {
  // hljs 可能输出跨行的 <span>，拆行时必须补闭合，
  // 否则行号结构会被未闭合标签吃进去。
  const src = '```html\n<!-- 一段跨行注释 -->\n<!-- 第二行 -->\n```\n';
  const out = await run(skeleton(src));
  const lines = (out.match(/class="mdh-code-line"/g) ?? []).length;
  assert.ok(lines >= 2, `应至少 2 行：${out}`);
  // 每一行都必须是自洽的（开闭配平）
  for (const m of out.matchAll(/<span class="mdh-code-line">([\s\S]*?)<\/span>\n/g)) {
    const opens = (m[1].match(/<span/g) ?? []).length;
    const closes = (m[1].match(/<\/span>/g) ?? []).length;
    assert.equal(opens, closes, `行内标签应配平：${m[1]}`);
  }
});

// ---------- 幂等 ----------

test('重复执行不重复包 hljs', async () => {
  const once = await run(skeleton(WITH_LANG));
  const twice = await run(skeleton(once));

  // 只数 <code> 上的 hljs —— token 的 class（hljs-type 等）不算
  const codeHljs = (h: string) =>
    (h.match(/<code[^>]*class="[^"]*\bhljs\b[^"]*"/g) ?? []).length;

  assert.equal(codeHljs(once), 1, '第一次就该只有一个');
  assert.equal(codeHljs(twice), 1, '不应重复加 class');
  // 内容不能变：重复跑不允许把 span 转义成正文
  assert.ok(!twice.includes('&lt;span'), '不应把 span 转义成正文');
  /*
   * 只比较「纯文本内容」，不比较 token 的 class。
   *
   * highlight.js 对同一段代码两次识别可能给出不同的 token 细分
   * （实测 `const` 一次是 hljs-keyword、另一次是 hljs-type），
   * 这是库本身的不确定性，跟 mdh 的结构无关。
   * 幂等要保证的是「代码文字不被改坏、行结构不被吃掉」。
   */
  const textOf = (h: string) =>
    (h.match(/<code[^>]*>([\s\S]*?)<\/code>/)?.[1] ?? '').replace(/<[^>]+>/g, '');
  assert.equal(textOf(twice), textOf(once), '代码文字应保持一致');
  assert.equal(
    (twice.match(/class="mdh-code-line"/g) ?? []).length,
    1,
    '行结构不应重复包裹',
  );
});
