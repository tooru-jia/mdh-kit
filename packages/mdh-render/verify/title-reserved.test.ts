/**
 * `@title(...)` 的行为（2026-11-25 起降级为预留关键字）
 *
 * 第一期不做「页面大标题」。这个写法保留住，但：
 *   · 不产出任何结构（不进 AST、不占 ID、不进目录、不出 <header>）
 *   · 当预留关键字原样显示（红字），不报错
 *
 * 保留的理由：将来启用时，已经写成 `@title(...)` 的文档不会突然变样。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, serialize } from '../../mdh-core/src/index.ts';
import { render } from '../src/index.ts';

const H = (src: string) => render(parse(src).ast);

test('@title：不产出页面大标题', () => {
  const html = H('@title(我的文档)\n\n# 正文标题\n');
  assert.ok(!html.includes('mdh-doc-title'), '不该再输出页面大标题');
  assert.ok(!html.includes('<header'), '不该输出 <header>');
});

test('@title：不再有 docTitle 字段，退化为普通段落', () => {
  const { ast } = parse('@title(我的文档)\n\n# 正文标题\n');
  const root = ast as any;
  assert.equal(root.docTitle, undefined, 'root 上不该再有 docTitle 字段');

  // @title 那一行变成普通段落，原文完整保留；不是特殊节点
  assert.equal(ast.children.length, 2);
  const first = ast.children[0] as any;
  assert.equal(first.type, 'paragraph');
  assert.ok(
    JSON.stringify(first.lines ?? first.text ?? '').includes('@title(我的文档)'),
    '原文要完整保留在段落里',
  );
});

test('@title：不报错', () => {
  const { diagnostics } = parse('@title(我的文档)\n\n正文\n');
  assert.equal(diagnostics.length, 0);
});

test('@title：和其它预留关键字一样标红', () => {
  const html = H('正文前的 @title(我的文档) 这句\n');
  // 原文完整保留
  assert.ok(html.includes('@title(我的文档)'), '原文要完整保留');
  /*
   * 2026-11-25 改：早先按「纯原文」渲染（不加任何样式），
   * 与 @tag / @theme 不一致 —— 作者反馈「三个都是保留字，都该是红字」。
   * 现在统一走预留关键字样式（.mdh-keyword-reserved，朱红）。
   */
  assert.ok(html.includes('mdh-keyword-reserved'), '应标成预留关键字（红字）');
  // 不能被当成引用
  assert.ok(!html.includes('mdh-ref'), '不该被当成引用');
});

test('@title：不再当作引用解析', () => {
  const html = H('@title(我的文档)\n\n正文\n');
  assert.ok(!html.includes('mdh-ref-broken'), '不该被当成失效引用');
});

test('@title：往返一致（原文进、原文出）', () => {
  // 降级后它只是普通段落文字，序列化应当原样吐出，不多不少
  const { ast } = parse('@title(我的文档)\n\n# 标题\n');
  const out = serialize(ast);
  assert.equal(out.trim(), '@title(我的文档)\n\n# 标题');
});
