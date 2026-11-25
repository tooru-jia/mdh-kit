/**
 * 统计产物里各类插件的生效数量
 *
 *   node tools/count-artifacts.mjs stress/test-features.html
 */
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const html = readFileSync(file, 'utf8');

const count = (re) => (html.match(re) ?? []).length;

const stats = {
  'KaTeX 公式': count(/class="katex"/g),
  'Mermaid SVG': count(/<svg/g),
  'Chart 图片': count(/<img src="data:image\/png/g),
  'hljs 代码块': count(/<code class="hljs">/g),
  '高亮 token': count(/<span class="hljs-/g),
  // 失败标志必须带 class="... mdh-mermaid-failed"，否则会误匹配页面里的运行时脚本源码
  '渲染失败(mermaid)': count(/class="mdh-mermaid-body mdh-mermaid-failed"/g),
  '渲染失败(chart)': count(/class="mdh-chart-body mdh-chart-failed"/g),
};

console.log(`文件：${file}  (${(html.length / 1024).toFixed(0)}KB)\n`);
let bad = 0;
for (const [k, v] of Object.entries(stats)) {
  const isFail = k.startsWith('渲染失败');
  const mark = isFail ? (v === 0 ? '✔' : '✘') : v > 0 ? '✔' : '✘';
  if (mark === '✘') bad++;
  console.log(`${mark} ${k.padEnd(20)} ${v}`);
}

if (bad > 0) {
  console.log(`\n✘ ${bad} 项异常`);
  process.exit(1);
}
console.log('\n✔ 全部生效');
