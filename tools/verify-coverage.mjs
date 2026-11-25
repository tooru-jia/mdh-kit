/**
 * 校验 NAMING.md 里「规则 ↔ 用例」的映射是否成立
 *
 *   node --experimental-strip-types tools/verify-coverage.mjs
 *
 * 每个用例的 note 里写上它覆盖哪条规则（格式：覆盖规则 3），
 * 这里反查：ID-SPEC 的每条可测规则，是否至少有一个用例声称覆盖。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES = join(HERE, '../conformance/cases');

/** ID-SPEC 里能在 parse() 阶段判定的规则（9、10 是编辑期，排除） */
const TESTABLE_RULES = [
  '规则 1', '规则 2', '规则 3', '规则 4', '规则 4·补',
  '规则 5', '规则 5·补', '规则 6', '规则 7', '规则 8',
];

const cases = readdirSync(CASES)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ file: f, ...JSON.parse(readFileSync(join(CASES, f), 'utf8')) }));

console.log(`用例数：${cases.length}\n`);

let missing = 0;
for (const rule of TESTABLE_RULES) {
  const hit = cases.filter((c) => (c.note ?? '').includes(`覆盖${rule}`) || (c.note ?? '').includes(rule.replace('规则 ', '规则')));
  if (hit.length === 0) {
    console.log(`✖ ${rule}：没有用例声称覆盖`);
    missing++;
  } else {
    console.log(`✔ ${rule.padEnd(8)} ← ${hit.map((c) => c.name.split('-')[0]).join(', ')}`);
  }
}

console.log(`\n${TESTABLE_RULES.length - missing} / ${TESTABLE_RULES.length} 条可测规则已覆盖`);
process.exit(missing ? 1 : 0);
