/**
 * 验证 highlight 插件对「带顶栏的代码块」是否生效
 *
 * 用 mdh-kit 自己的插件跑，不经过 Lumen。
 * 语法取自 mdh/examples/test-features.mdh：```ts title="文件名"
 */
import { parse } from '@mdh-kit/core';
import { render } from '@mdh-kit/render';
import { highlightPlugin } from '../packages/mdh-compile/src/node/highlight.ts';

const src = [
  '```ts title="src/parser.ts"',
  'export function parse(source: string) {',
  '  return source;',
  '}',
  '```',
  '',
  '```ts',
  'const y = 1;',
  '```',
  '',
].join('\n');

const skeleton = render(parse(src).ast);
console.log('=== 骨架（第二层输出）===');
const skeletons = skeleton.match(/<pre[\s\S]*?<\/pre>/g) ?? [];
if (skeletons.length === 0) {
  console.log('✘ 没解析出代码块，语法写错了');
  process.exit(1);
}
skeletons.forEach((p, i) => console.log(`[${i}]`, p.replace(/\n/g, '\\n').slice(0, 240)));

const out = await highlightPlugin().transform(skeleton, { mode: 'static' });

console.log('\n=== 插件处理后 ===');
const pres = out.match(/<pre[\s\S]*?<\/pre>/g) ?? [];
let broken = 0;
pres.forEach((p, i) => {
  const spans = (p.match(/<span/g) ?? []).length;
  const hasHljs = p.includes('code class="hljs"');
  const hasHead = p.includes('mdh-code-head');
  if (!hasHljs) broken++;
  console.log(
    `[${i}] 顶栏=${hasHead ? '有' : '无'}  高亮span=${spans}  hljs=${hasHljs}`,
  );
});

console.log(
  `\n结论：${broken === 0 ? '全部生效' : `${broken}/${pres.length} 个代码块没被处理`}`,
);

// ── 对照：不带语言的代码块（应该没有顶栏）──
console.log('\n=== 对照：无语言代码块 ===');
for (const l of ['', 'text']) {
  const s2 = ['```' + l, 'plain code here', '```', ''].join('\n');
  const sk = render(parse(s2).ast);
  const before = (sk.match(/<pre[\s\S]*?<\/pre>/g) ?? [])[0] ?? '(无)';
  const o = await highlightPlugin().transform(sk, { mode: 'static' });
  const after = (o.match(/<pre[\s\S]*?<\/pre>/g) ?? [])[0] ?? '(无)';
  console.log(`lang="${l}"`);
  console.log('  骨架:', before.slice(0, 130));
  console.log('  有无顶栏:', before.includes('mdh-code-head'));
  console.log('  处理后有 hljs:', after.includes('code class="hljs"'));
}
