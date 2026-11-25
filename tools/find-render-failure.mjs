/**
 * 定位渲染失败的块
 */
import { readFileSync } from 'node:fs';

const html = readFileSync(process.argv[2], 'utf8');

for (const cls of ['mdh-mermaid-failed', 'mdh-chart-failed']) {
  const re = new RegExp(`<[^>]*${cls}[^>]*>`, 'g');
  const hits = html.match(re) ?? [];
  console.log(`${cls}: ${hits.length}`);
  hits.forEach((h, i) => console.log(`  [${i}] ${h.slice(0, 300)}`));
}

// 列出所有 mermaid 块的形态
const blocks = html.match(/<div class="mdh-mermaid-body"[\s\S]{0,120}/g) ?? [];
console.log(`\n成功渲染的 mermaid 块: ${blocks.length}`);
const failedPre = html.match(/<pre class="mdh-mermaid-body[^"]*"[\s\S]*?<\/pre>/g) ?? [];
console.log(`失败降级为 <pre> 的块: ${failedPre.length}`);
failedPre.forEach((p, i) => {
  console.log(`  [${i}] ${p.replace(/\n/g, '\\n').slice(0, 400)}`);
});
