/**
 * Conformance 校验：ID 序列必须与规范完全一致
 *
 * ── 为什么要有这个脚本 ──
 * 「mdh」这个名称和 `.mdh` 后缀只允许遵守规范的实现使用。
 * 但「遵守了没有」不能靠嘴说 —— 得有个东西能跑一遍给出结论。
 * 这个脚本就是那个东西：给定一份实现的 parse()，它逐用例比对 ID 序列。
 *
 * ── 判据是「ID 序列」，不是「ID 长什么样」 ──
 * 规则里字母 M/N/O 是强制的（跨实现对话需要同一套坐标），
 * 所以这里比的是完整字符串，包括字母。
 *
 * ── 用法 ──
 *   node conformance/run.mjs                    校验本仓库实现
 *   node conformance/run.mjs --parse=./my.mjs   校验另一份实现（导出的 parse）
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectIds } from './collect.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES = join(HERE, 'cases');

/** 解析 --parse= 参数 */
const arg = process.argv.find((a) => a.startsWith('--parse='));
const parsePath = arg ? resolve(arg.slice('--parse='.length)) : null;

let parseImpl;
if (parsePath) {
  const mod = await import(parsePath);
  parseImpl = mod.parse ?? mod.default ?? mod;
  if (typeof parseImpl !== 'function') {
    console.error(`✖ ${parsePath} 没有导出 parse()`);
    process.exit(1);
  }
} else {
  ({ parse: parseImpl } = await import('../packages/mdh-core/src/index.ts'));
}

const files = readdirSync(CASES).filter((f) => f.endsWith('.json')).sort();
let pass = 0;
const failures = [];

for (const f of files) {
  const c = JSON.parse(readFileSync(join(CASES, f), 'utf8'));
  if (!Array.isArray(c.ids)) {
    failures.push({ f, why: '用例缺 ids（先跑 generate.mjs）' });
    continue;
  }
  let got;
  try {
    got = collectIds(parseImpl(c.source).ast);
  } catch (e) {
    failures.push({ f, why: '解析抛错：' + (e && e.message) });
    continue;
  }
  const ok = got.length === c.ids.length && got.every((id, i) => id === c.ids[i]);
  if (ok) {
    pass++;
  } else {
    failures.push({ f, why: `期望 ${c.ids.join(' ')}\n             实得 ${got.join(' ')}` });
  }
}

console.log(`\n${pass} / ${files.length} 通过`);
if (failures.length) {
  console.log('\n✖ 不一致：');
  for (const { f, why } of failures) console.log(`  ${f}\n     ${why}`);
  console.log('\n这份实现不符合 mdh ID 规范，不能自称 mdh、不能使用 .mdh 后缀。');
  process.exit(1);
}
console.log('✔ 全部通过：这份实现的 ID 序列符合 mdh 规范');
