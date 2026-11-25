/**
 * 保留关键字的渲染行为
 *
 * 保留关键字（`@tag` / `@theme` / `@slide-theme` / `@next-tab`）当前不生效。
 * 渲染时输出**红字**，但不是标签胶囊：
 *   · 包一层 `<span class="mdh-keyword-reserved">`（只上色）
 *   · **不**产出 `mdh-tag`（那是真标签的胶囊样式）
 *   · **不**被 `@名字` 规则当成「引用一个存在的对象」
 *
 * 保留关键字的完整名单与当前行为，见 SYNTAX.md 的「预留关键字」一节。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { parse } from '../../mdh-core/src/index.ts';
import { render } from '../src/index.ts';

test('保留关键字 @tag 输出红字 span', () => {
  const html = render(parse('文字 @tag(英语) 文字').ast);
  assert.ok(html.includes('@tag(英语)'), '@tag 文字应保留');
  assert.ok(html.includes('mdh-keyword-reserved'), '应包一层着色 span');
  assert.ok(!html.includes('mdh-tag"'), '不该产出标签胶囊');
});

test('保留指令 @theme / @slide-theme / @next-tab 同样是红字', () => {
  for (const s of ['@theme(暗色)', '@slide-theme(topic)', '@next-tab(配置)']) {
    const html = render(parse(`文字 ${s} 文字`).ast);
    assert.ok(html.includes(s), `${s} 应保留原文`);
    assert.ok(html.includes('mdh-keyword-reserved'), `${s} 应是保留字样式`);
    assert.ok(!html.includes('mdh-ref'), `${s} 不该被当成引用`);
  }
});

test('保留关键字不破坏行内格式', () => {
  const html = render(parse('/斜体 @tag(x) 结束/').ast);
  assert.ok(html.includes('<em'), '斜体应正常渲染');
  assert.ok(html.includes('mdh-keyword-reserved'), '保留字保留着色');
});

test('对照：真正生效的 @link 仍然渲染成链接', () => {
  const html = render(parse('正文 @link(官网, "https://a.com")').ast);
  assert.ok(html.includes('href="https://a.com"'), '@link 应渲染成链接');
  assert.ok(!html.includes('mdh-keyword-reserved'), '@link 不是保留字');
});
