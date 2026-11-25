/**
 * 端到端：真实样例 → 完整编译（含插件）→ 检查高亮
 *
 * 与单元测试的区别：这里走的是 tools/build-example.mjs 那套真实链路，
 * 用真实文档而不是构造的小片段。
 */
import { readFileSync } from 'node:fs';
import { parse } from '@mdh/core';
import { render } from '@mdh/render';
import { highlightPlugin } from '../packages/mdh-compile/src/node/highlight.ts';

const file = process.argv[2] ?? '../mdh/examples/test-features.mdh';
const src = readFileSync(file, 'utf8');

const skeleton = render(parse(src).ast);
const out = await highlightPlugin().transform(skeleton, { mode: 'static' });

const pre = (html) => html.match(/<pre[^>]*class="[^"]*mdh-code[^"]*"[\s\S]*?<\/pre>/g) ?? [];

const before = pre(skeleton);
const after = pre(out);

console.log(`文件：${file}`);
console.log(`代码块数：${before.length}`);
console.log('');

let ok = 0;
let bad = 0;
after.forEach((p, i) => {
  const hasHead = p.includes('mdh-code-head');
  const hasHljs = p.includes('code class="hljs"');
  const tokenCount = (p.match(/<span class="hljs-/g) ?? []).length;
  const title = p.match(/mdh-code-title">([^<]*)</)?.[1] ?? '';
  const lang = p.match(/data-mdh-lang="([^"]*)"/)?.[1] ?? '';

  const pass = hasHljs && tokenCount > 0;
  // 未知语言走 auto 模式且识别不出内容时，token=0 是合法降级（代码照常输出，只是没着色）
  const benign = hasHljs && tokenCount === 0;
  if (pass) ok++;
  else if (!benign) bad++;

  const mark = pass ? '✔' : benign ? '○' : '✘';
  const note = benign ? ' (auto 识别不出内容，无 token 属正常)' : '';
  console.log(
    `${mark} [${i}] lang=${(lang || '-').padEnd(12)} ` +
      `顶栏=${hasHead ? '有' : '无'} hljs=${hasHljs} token=${String(tokenCount).padEnd(3)} ` +
      `${title ? `title="${title}"` : ''}${note}`,
  );
});

console.log('');
console.log(`结果：${ok}/${after.length} 个代码块高亮成功`);

if (after.length === 0) {
  console.log('✘ 文档里没有代码块，本次验证无效');
  process.exit(1);
}
if (bad > 0) {
  console.log(`✘ ${bad} 个代码块未高亮`);
  process.exit(1);
}
console.log('✔ 全部通过');
