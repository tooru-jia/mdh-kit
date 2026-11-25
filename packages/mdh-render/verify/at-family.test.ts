/**
 * @ 家族验证：@tag / @foot / @link / @img
 *
 * 这四种语法在规范里写了很久，但渲染层一直没有实现。
 * 本文件锁住它们的行为，避免再次回归到「原样输出」。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../mdh-core/src/index.ts';
import { render } from '../src/index.ts';
import { buildFootnoteIndex, extractFootnoteDefs, parseFootnoteDef } from '../src/footnotes.ts';

/** 渲染，并把源码一起传进去（脚注编号需要） */
const R = (src: string) => render(parse(src).ast, { source: src });

// ---------- @tag（DESIGN-4：本期关闭）----------
//
// 2026-11-22 作者决定：`@tag()` 是关键字但本期不开放，放到后期。
// 现在 `@tag(名字)` 按普通文字原样输出，不再渲染成 <span class="mdh-tag">。
// 后续重开时把这几条恢复即可（见 inline.ts 的 DESIGN-4 注释）。

test('@tag：本期关闭，原样输出（不渲染 span.mdh-tag）', () => {
  const html = R('标签 @tag(abc) 结束');
  assert.ok(!html.includes('mdh-tag'), `不该渲染标签：${html}`);
  assert.ok(html.includes('@tag(abc)'), `应原样输出：${html}`);
});

test('@tag：中文标签也原样输出', () => {
  const html = R('@tag(英语)');
  assert.ok(!html.includes('mdh-tag'), html);
  assert.ok(html.includes('@tag(英语)'), html);
});

test('@tag：一行多个都原样输出', () => {
  const html = R('@tag(英语) @tag(学习)');
  assert.equal((html.match(/class="mdh-tag"/g) ?? []).length, 0, html);
  assert.ok(html.includes('@tag(英语)'), html);
  assert.ok(html.includes('@tag(学习)'), html);
});

test('@tag：不会退化成 @tag + (abc) 两段', () => {
  const html = R('@tag(abc)');
  // 关键：必须完整保留括号内容，不能被 @名字 规则吃掉 "tag"
  assert.ok(html.includes('@tag(abc)'), `括号内容丢了：${html}`);
});

// ---------- @link ----------

test('@link：渲染为 a.mdh-link', () => {
  const html = R('看 @link(官网, "https://example.com") 这里');
  assert.ok(
    html.includes('<a class="mdh-link" href="https://example.com">官网</a>'),
    html,
  );
});

test('@link：相对路径', () => {
  const html = R('@link(文档, "./docs/a.html")');
  assert.ok(html.includes('href="./docs/a.html"'), html);
});

test('@link：锚点', () => {
  const html = R('@link(跳转, "#章节")');
  assert.ok(html.includes('href="#章节"'), html);
});

test('@link：不带引号的地址不再识别，原样输出', () => {
  const html = R('@link(官网, https://example.com)');
  assert.ok(!html.includes('<a '), '不生成链接');
  assert.ok(html.includes('@link(官网, https://example.com)'), '原样输出');
});

test('@link：地址含逗号不截断', () => {
  const html = R('@link(维基, "https://en.wikipedia.org/wiki/Washington,_D.C.")');
  assert.ok(html.includes('href="https://en.wikipedia.org/wiki/Washington,_D.C."'), html);
});

test('@link：地址含右括号不截断', () => {
  const html = R('@link(带括号, "https://x.com/a(b)")');
  assert.ok(html.includes('href="https://x.com/a(b)"'), html);
});

// ---------- @img ----------

test('@img：渲染为 img.mdh-img，名字进 alt', () => {
  const html = R('@img(产品图, "./a.png")');
  assert.ok(
    html.includes('<img class="mdh-img" src="./a.png" alt="产品图">'),
    html,
  );
});

test('@img：不加尺寸属性（交给 CSS）', () => {
  const html = R('@img(a, "./a.png")');
  const img = html.match(/<img[^>]*>/)?.[0] ?? '';
  assert.ok(!/width=|height=/.test(img), img);
});

// ---------- @foot 插入 ----------

test('@foot：首次插入编号为 1', () => {
  const src = '正文 @foot(a)\n\n@foot(a): 内容 A';
  const html = R(src);
  assert.ok(html.includes('data-mdh-foot-number="1"'), html);
});

test('@foot：按首次出现顺序编号', () => {
  const src = ['先 @foot(b) 后 @foot(a)', '', '@foot(a): A', '@foot(b): B'].join('\n');
  const html = R(src);
  const b = html.match(/data-mdh-foot="b" data-mdh-foot-number="(\d+)"/)?.[1];
  const a = html.match(/data-mdh-foot="a" data-mdh-foot-number="(\d+)"/)?.[1];
  assert.equal(b, '1', 'b 先出现应为 1');
  assert.equal(a, '2', 'a 后出现应为 2');
});

test('@foot：多处引用共用同一编号', () => {
  const src = ['@foot(x) 又一次 @foot(x)', '', '@foot(x): X'].join('\n');
  const html = R(src);
  const nums = [...html.matchAll(/data-mdh-foot-number="(\d+)"/g)].map((m) => m[1]);
  assert.deepEqual(nums, ['1', '1'], '两处引用应都是 1');
});

test('@foot：定义行不参与文档流', () => {
  const src = '@foot(x): 内容\n\n正文';
  const html = R(src);
  assert.ok(!html.includes('@foot(x)'), '定义行不该以原文出现在正文');
  assert.ok(html.includes('<p'), '正文段落应正常');
});

test('@foot：引用了但未定义 → 输出上标 + undefined class', () => {
  const html = R('正文 @foot(没有定义)');
  assert.ok(html.includes('mdh-foot-undefined'), html);
  assert.ok(html.includes('data-mdh-foot="没有定义"'), html);
});

test('@foot：定义了但未引用 → 仍输出到文末', () => {
  const src = '正文\n\n@foot(孤儿): 没人引用';
  const html = R(src);
  assert.ok(html.includes('mdh-footnotes'), html);
  assert.ok(html.includes('没人引用'), html);
});

test('@foot：内容支持行内格式', () => {
  const src = ['正文 @foot(x)', '', '@foot(x): 有 **粗体** 和 `代码`'].join('\n');
  const html = R(src);
  assert.ok(html.includes('mdh-strong'), '脚注内容应解析加粗');
  assert.ok(html.includes('mdh-inline-code'), '脚注内容应解析行内代码');
});

test('@foot：同名中文也能跳转（锚点）', () => {
  const src = ['正文 @foot(研究来源)', '', '@foot(研究来源): X'].join('\n');
  const html = R(src);
  assert.ok(html.includes('href="#mdh-foot-研究来源"'), html);
  assert.ok(html.includes('id="mdh-foot-研究来源"'), html);
});

// ---------- 脚注工具函数 ----------

test('parseFootnoteDef：识别定义', () => {
  assert.deepEqual(parseFootnoteDef('@foot(a): 内容'), { name: 'a', content: '内容' });
});

test('parseFootnoteDef：中文冒号也认', () => {
  assert.deepEqual(parseFootnoteDef('@foot(a)：内容'), { name: 'a', content: '内容' });
});

test('parseFootnoteDef：插入不是定义', () => {
  assert.equal(parseFootnoteDef('正文 @foot(a) 后面'), null);
});

test('extractFootnoteDefs：定义行被摘掉', () => {
  const { source, defs } = extractFootnoteDefs('A\n@foot(x): X\nB');
  assert.equal(defs.length, 1);
  assert.ok(!source.includes('@foot(x)'), source);
  assert.ok(source.includes('A') && source.includes('B'));
});

test('buildFootnoteIndex：未定义的给出警告', () => {
  const idx = buildFootnoteIndex('@foot(缺失)', []);
  assert.equal(idx.warnings.length, 1);
  assert.ok(idx.warnings[0].includes('缺失'));
});

// ---------- 与其他语法共存 ----------

test('@ 家族与行内格式共存', () => {
  const html = R('**粗** 和 @tag(a) 和 /斜/');
  assert.ok(html.includes('mdh-strong'), html);
  // @tag 本期关闭，原样输出（DESIGN-4）
  assert.ok(html.includes('@tag(a)'), html);
  assert.ok(html.includes('mdh-em'), html);
});

test('@ 家族在代码里不解析', () => {
  const html = R('`@tag(abc)`');
  assert.ok(!html.includes('mdh-tag'), '反引号内不该解析 @tag');
  assert.ok(html.includes('@tag(abc)'), html);
});

test('@名字 引用仍正常（不受 @ 家族影响）', () => {
  const src = ['***table ref="员工"', 'head: 姓名', '- 张三', '***table-end', '', '见表 @员工'].join(
    '\n',
  );
  const html = R(src);
  assert.ok(html.includes('data-mdh-ref="员工"'), html);
});
