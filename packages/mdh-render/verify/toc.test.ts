/**
 * 目录（TOC）验证
 *
 * @toc 曾经只输出一个空的 <nav>，目录内容从未生成。
 * 本文件锁住它的行为，避免再次回归到「写了 @toc 但什么也不显示」。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../mdh-core/src/index.ts';
import { render } from '../src/index.ts';
import { buildTocHtml, collectTocEntries, TOC_MAX_LEVEL } from '../src/toc.ts';
const R = (src: string) => render(parse(src).ast);

/** 取出第一个目录区（不含外层 nav） */
const tocOf = (html: string): string => {
  const m = html.match(/<nav[^>]*mdh-toc[^>]*>([\s\S]*?)<\/nav>/);
  return m ? m[1] : '';
};

// ---------- 基本行为 ----------

test('@toc：生成目录，不再是空 nav', () => {
  const inner = tocOf(R('@toc\n\n# 一级\n## 二级\n'));
  assert.notEqual(inner.trim(), '', '目录内容为空');
  assert.ok(inner.includes('一级'), inner);
  assert.ok(inner.includes('二级'), inner);
});

test('@toc：不残留占位符', () => {
  const html = R('@toc\n\n# 一\n');
  assert.ok(!html.includes('MDH_TOC_PLACEHOLDER'), '占位符没被替换');
  assert.ok(!html.includes('<!--MDH_TOC'), '占位符没被替换');
});

test('@toc：条目带跳转锚与标题文字属性', () => {
  const html = R('@toc\n\n# 一级\n');
  // 锚指向标题节点的 ID
  assert.ok(/class="mdh-toc-link" href="#M\d+"/.test(html), html);
  assert.ok(html.includes('data-mdh-toc-text="一级"'), html);
});

// ---------- 收录范围 ----------

test('@toc：收录 H1–H4，排除 H5 / H6', () => {
  const html = R('@toc\n\n# 一\n## 二\n### 三\n#### 四\n##### 五\n###### 六\n');
  const nav = tocOf(html);
  for (const t of ['一', '二', '三', '四']) assert.ok(nav.includes(`>${t}<`), `缺 H${t}`);
  // 用 nav 区域断言，不能查全文——H5 标题本身还在正文里
  assert.ok(!nav.includes('五'), 'H5 不该进目录');
  assert.ok(!nav.includes('六'), 'H6 不该进目录');
});

test('@toc：层级嵌套正确（标签平衡）', () => {
  const html = R('@toc\n\n# A\n## A1\n### A1a\n# B\n');
  const nav = tocOf(html);
  const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
  assert.equal(count(nav, /<ul[ >]/g), count(nav, /<\/ul>/g), '<ul> 不平衡');
  assert.equal(count(nav, /<li[ >]/g), count(nav, /<\/li>/g), '<li> 不平衡');
});

test('@toc：不输出行内样式（缩进归主题层）', () => {
  const html = R('@toc\n\n# A\n## B\n### C\n');
  const nav = tocOf(html);
  assert.ok(!nav.includes('style="'), '渲染层不该写行内样式');
  assert.ok(!/\d\.\d{5,}em/.test(html), '不该有计算出来的缩进值');
});

// ---------- 边界 ----------

test('@toc：文档没有标题时给出提示而非空白', () => {
  const inner = tocOf(R('@toc\n\n只有正文。\n'));
  assert.ok(inner.includes('mdh-toc-empty'), inner);
});

test('@toc：多个 @toc 都被填充，内容一致', () => {
  const html = R('@toc\n\n# 一\n\n@toc\n\n## 二\n');
  const navs = html.match(/<nav[^>]*mdh-toc[\s\S]*?<\/nav>/g) ?? [];
  assert.equal(navs.length, 2, `应有 2 个目录，实际 ${navs.length}`);
  const strip = (s: string) => s.replace(/(data-)?mdh-id="[^"]*"/g, '').replace(/\sid="[^"]*"/g, '');
  assert.equal(strip(navs[0]), strip(navs[1]), '两份目录内容不一致');
});

test('@toc：容器（分栏）里的标题也收录', () => {
  const inner = tocOf(R('@toc\n\n# 外层\n\n***column(1fr/1fr)\n## 栏内标题\n***column-end\n'));
  assert.ok(inner.includes('外层'), inner);
  assert.ok(inner.includes('栏内标题'), '分栏里的标题没进目录');
});

// ---------- 纯函数 ----------

test('collectTocEntries：按文档顺序返回，带层级与 ID', () => {
  const entries = collectTocEntries(parse('# A\n### C\n## B\n').ast);
  assert.deepEqual(
    entries.map((e) => [e.level, e.text]),
    [
      [1, 'A'],
      [3, 'C'],
      [2, 'B'],
    ],
  );
  for (const e of entries) assert.ok(e.id, '条目缺节点 ID');
});

test('buildTocHtml：空列表给出提示而非空串', () => {
  assert.ok(buildTocHtml([]).includes('mdh-toc-empty'));
});

test('collectTocEntries：最大层级常量为 4', () => {
  assert.equal(TOC_MAX_LEVEL, 4);
});
