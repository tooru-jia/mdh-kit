/**
 * 验收问题回归测试（V1 - V8）
 *
 * 来自作者 2026-11-21 验收 Lumen 时提出的 8 条问题。
 * 每条都锁住「修好之后的行为」，避免以后回退。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, serialize } from '../../mdh-core/src/index.ts';
import { render } from '../src/index.ts';

const H = (src: string) => render(parse(src).ast);

// ---------- V2 · >>> 三级引用按原样显示 ----------

test('V2：>>> 三级引用 → 2 层，剩下的 > 原样显示', () => {
  const html = H('> 一级\n>> 二级\n>>> 三级');
  const quotes = (html.match(/<blockquote/g) ?? []).length;
  assert.equal(quotes, 2, '只应有 2 层引用');
  assert.ok(html.includes('&gt; 三级'), `应保留 > 符号：${html}`);
});

test('V2：>> 二级正常，不带多余 >', () => {
  const html = H('> 一级\n>> 二级');
  assert.equal((html.match(/<blockquote/g) ?? []).length, 2);
  assert.ok(!html.includes('&gt;'), '两级以内不该出现 &gt;');
});

// ---------- V3 · 行内样式不包住对象 ----------
//
// 注意（DESIGN-4，2026-11-22）：`@tag` 本期关闭，不再作为「对象」参与
// 提升逻辑。这里改用仍然开启的 `@foot` 验证同一套机制 ——
// 脚注上标是对象，不该被斜体/加粗包住。

const FOOT_SRC = (body: string) => `${body}\n\n@foot(注): 内容`;

test('V3：斜体里的 @foot 不被斜体包住', () => {
  const html = H(FOOT_SRC('/斜体里有 @foot(注)/'));
  const emEnd = html.indexOf('</em>');
  const footAt = html.indexOf('mdh-foot-ref');
  assert.ok(emEnd > 0 && footAt > emEnd, `<em> 应先闭合再出现脚注：${html}`);
});

test('V3：加粗里的 @foot 不被加粗包住', () => {
  const html = H(FOOT_SRC('**加粗 @foot(注)**'));
  const strongEnd = html.indexOf('</strong>');
  const footAt = html.indexOf('mdh-foot-ref');
  assert.ok(strongEnd > 0 && footAt > strongEnd, `</strong> 应先闭合：${html}`);
});

// ---------- V4 · 行内公式（编译层，这里只验骨架） ----------

test('V4：行内公式输出带空白的 span（插件正则要能匹配）', () => {
  const html = H('公式 $O(n \\log n)$ 结束');
  assert.ok(/<span class="mdh-inline-math"[^>]*>\s*<\/span>/.test(html), html);
});

test('V4：行内公式占位正则允许空白', async () => {
  const { INLINE_MATH_RE } = await import('../../mdh-compile/src/shared/katex-render.ts');
  const sample = '<span class="mdh-inline-math" data-mdh-latex="&quot;x&quot;">\n</span>';
  INLINE_MATH_RE.lastIndex = 0;
  assert.ok(INLINE_MATH_RE.test(sample), '带换行的占位应匹配');
});

// ---------- V5 · ***list 内空行保留 ----------

test('V5：块内 4 个空行渲染成 4 个空行元素', () => {
  const src = '***list\n### 计划\n\n\n\n\n1. 完成\n2. 实现\n***list-end';
  const ast = parse(src).ast;
  const list = ast.children[0] as any;
  assert.deepEqual(list.blankAt, [1, 2, 3, 4], `空行位置应记下：${JSON.stringify(list.blankAt)}`);

  const html = render(ast);
  assert.equal((html.match(/mdh-blank/g) ?? []).length, 4, html);
});

test('V5：空行不影响列表项解析', () => {
  const html = H('***list\n### 计划\n\n\n\n\n1. 完成语法定义\n    - 写清边界\n2. 完成实现\n***list-end');
  assert.ok(html.includes('<ol'), '应有有序列表');
  assert.ok(html.includes('写清边界'), '子项应在');
});

// ---------- V6 · 表头相邻同名合并 ----------

test('V6：相邻同名表头合并成 colspan', () => {
  const html = H('***table\nhead: 部门, 上半年, 上半年, 下半年, 下半年\n- 销售, 1, 2, 3\n***table-end');
  assert.ok(html.includes('<th class="mdh-table-th" colspan="2">上半年</th>'), html);
  assert.ok(html.includes('<th class="mdh-table-th" colspan="2">下半年</th>'), html);
});

test('V6：不相邻的相同文字不合并', () => {
  const html = H('***table\nhead: A, B, A\n- 1, 2, 3\n***table-end');
  assert.ok(!html.includes('colspan'), `不该合并：${html}`);
});

test('V6：三列连续同名合并成 colspan=3', () => {
  const html = H('***table\nhead: 全年, 全年, 全年\n- 1, 2, 3\n***table-end');
  assert.ok(html.includes('colspan="3"'), html);
});

// ---------- V7 · @ref 可跳转 ----------

test('V7：目标块带原生 id，引用带 href', () => {
  const html = H('***table ref="员工"\nhead: a\n- 1\n***table-end\n\n见表 @员工 可知');
  assert.ok(/<table[^>]*\bid="M1"/.test(html), `表格应有 id：${html}`);
  assert.ok(html.includes('href="#M1"'), `引用应有 href：${html}`);
});

// ---------- V8 · 多行 HTML 不拆段、不插 <br> ----------

test('V8：<details> 多行 HTML 不被 <p> 截断', () => {
  const html = H('<details>\n<summary>点我展开</summary>\n\n内容\n\n**加粗**\n</details>');
  assert.ok(!/<p[^>]*>\s*<details/.test(html), `不该被段落包住：${html}`);
  assert.ok(html.includes('<details>'), html);
  assert.ok(html.includes('</details>'), html);
  assert.ok(html.includes('<strong'), '块内行内格式应生效');
});

test('V8：HTML 标签之间不插 <br>', () => {
  const html = H('<div>\n文字\n</div>');
  assert.ok(!html.includes('<br>'), `不该有 <br>：${html}`);
});

test('V8：HTML 块能往返序列化', () => {
  const src = '<details>\n<summary>点我</summary>\n内容\n</details>';
  const out = serialize(parse(src).ast);
  assert.ok(out.includes('<details>'), out);
  assert.ok(out.includes('</details>'), out);
  assert.ok(!out.includes('***html'), '不该出现块标记');
});

test('V3：脚注保持在原位置，不跑到末尾', () => {
  const html = H(FOOT_SRC('**加粗 @foot(注) 结束**'));
  const footAt = html.indexOf('mdh-foot-ref');
  const afterAt = html.indexOf('结束');
  assert.ok(footAt > 0 && afterAt > footAt, `脚注应在「结束」之前：${html}`);
  // 两侧各自独立包一层
  const strongs = (html.match(/<strong/g) ?? []).length;
  assert.equal(strongs, 2, `应断成两段 strong：${html}`);
});

test('V3：斜体场景同样保持位置', () => {
  const html = H(FOOT_SRC('前 /斜体 @foot(注) 后/ 尾'));
  const footAt = html.indexOf('mdh-foot-ref');
  const afterAt = html.indexOf('后');
  assert.ok(footAt > 0 && afterAt > footAt, `脚注应在「后」之前：${html}`);
});

// ---------- V9 · @ref 必须可点击 ----------

test('V9：带编号的引用也输出 <a href>，能跳转', () => {
  const html = H('***table ref="员工" caption="说明"\nhead: a\n- 1\n***table-end\n\n见表 @员工 可知');
  const ref = html.match(/<a[^>]*mdh-ref[^>]*>/)?.[0] ?? '';
  assert.ok(ref.includes('href="#M1"'), `带编号的引用也要可点：${ref}`);
  // 引用本身必须可点；里面包着 <span class="mdh-ref-name"> 承载原文，
  // 所以要看「引用这个元素本身是不是 span」，而不是「页面里有没有 span」。
  assert.ok(!/<span[^>]*class="mdh-ref[\s"]/.test(html), '引用本身不该再用 span');
});

test('V9：引用元素内显示原文，不靠 CSS 拼措辞', () => {
  // 2026-11-25：早先元素是空的，正文由 CSS ::before 拼成「Table 1」。
  // 一旦 CSS 没加载或类型判断失误，页面就是空白或错认类型。
  // 现在元素内必须有原文，这是能独立成立的底线。
  const html = H('***table ref="员工薪资" caption="说明"\nhead: a\n- 1\n***table-end\n\n见表 @员工薪资 可知');
  const refEl = html.match(/<a[^>]*mdh-ref[\s\S]*?<\/a>/)?.[0] ?? '';
  assert.ok(refEl.includes('@员工薪资'), `引用里要有原文：${refEl}`);
  assert.ok(refEl.includes('mdh-ref-name'), '原文包在 .mdh-ref-name 里');
});

test('V9：四个对象（表 / 图 / 公式 / mermaid）引用全部可点', () => {
  const src = [
    '***table ref="T"\nhead: a\n- 1\n***table-end',
    '***chart(bar) ref="C"\nhead: x, y\n- 1, 2\n***chart-end',
    '***math ref="M"\nE=mc^2\n***math-end',
    '***mermaid ref="G"\ngraph TD\nA-->B\n***mermaid-end',
    '见 @T 、@C 、@M 、@G 。',
  ].join('\n\n');
  const html = H(src);
  const refs = [...html.matchAll(/<a[^>]*mdh-ref[^>]*>/g)].map((m) => m[0]);
  assert.equal(refs.length, 4, `应有 4 个可点引用：${html}`);
  for (const r of refs) {
    assert.ok(/href="#M\d+"/.test(r), `每个都要有 href：${r}`);
  }
});

// ---------- V10 · caption 与编号 ----------

test('V10：有 caption 时编号落到 caption 上', () => {
  const html = H('***table ref="员工" caption="表格说明"\nhead: a\n- 1\n***table-end');
  const cap = html.match(/<caption[^>]*>/)?.[0] ?? '';
  assert.ok(cap.includes('data-mdh-number="1"'), `caption 要带编号：${cap}`);
});

test('V10：只有 ref 没 caption 时不编号（作者 2026-11-21 拍定）', () => {
  const html = H('***table ref="员工"\nhead: a\n- 1\n***table-end');
  assert.ok(!/data-mdh-number=/.test(html), `只有 ref 不该编号：${html}`);
  assert.ok(!/<caption/.test(html), '也不该生成空 caption');
});

test('V10：chart / mermaid / math 的 caption 同样带编号', () => {
  const html = H(
    '***chart(bar) ref="C" caption="图注"\nhead: x, y\n- 1, 2\n***chart-end\n\n' +
      '***math ref="M" caption="式注"\nE=mc^2\n***math-end',
  );
  const figs = [...html.matchAll(/<figcaption[^>]*>/g)].map((m) => m[0]);
  assert.equal(figs.length, 2, `应有 2 个题注：${html}`);
  for (const f of figs) assert.ok(f.includes('data-mdh-number='), f);
});
