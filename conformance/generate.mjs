/**
 * 生成 conformance 用例的期望 ID
 *
 * ⚠️ 这个脚本只用来「把用例跑一遍、填出期望值」，**期望值必须人工核对**。
 *    靠实现生成期望值、再拿期望值验实现，等于自己给自己打分。
 *
 *   node conformance/generate.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectIds } from './collect.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES = join(HERE, 'cases');

const { parse } = await import('../packages/mdh-core/src/index.ts');

let n = 0;
for (const f of readdirSync(CASES).filter((x) => x.endsWith('.json'))) {
  const p = join(CASES, f);
  const c = JSON.parse(readFileSync(p, 'utf8'));
  if (!c.source || c.ids !== undefined) continue; // 已有期望值的跳过
  const ast = parse(c.source).ast;
  c.ids = collectIds(ast);
  writeFileSync(p, JSON.stringify(c, null, 2) + '\n');
  n++;
  console.log(`填好 ${f}：${c.ids.join(' ')}`);
}
console.log(`\n共补全 ${n} 个用例`);
