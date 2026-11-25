/**
 * 校验默认主题 CSS 只有一份
 *
 * 历史上 `@mdh-kit/css` 与 `@mdh-kit/theme` 各存一份 default.css（迁移期复制），
 * 靠哈希比对保证不漂移。2026-11 已合并：`@mdh-kit/css` 删除，CSS 唯一来源是
 * `packages/mdh-theme/themes/default.css`。
 *
 * 这个脚本现在守的是「不要再次出现第二份」。
 *
 *   node tools/verify-css-sync.mjs
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'packages';
const TARGET = 'default.css';

/** 找出 packages/ 下所有 default.css */
function findAll(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) findAll(p, acc);
    else if (name === TARGET) acc.push(p);
  }
  return acc;
}

const found = findAll(ROOT);

if (found.length === 0) {
  console.error(`✖ 找不到 ${TARGET}，主题丢了`);
  process.exit(1);
}

if (found.length > 1) {
  console.error(`✖ ${TARGET} 出现 ${found.length} 份，应只有一份：`);
  found.forEach((p) => console.error('   ' + p));
  console.error('   → 主题样式只该在 packages/mdh-theme/themes/ 下');
  process.exit(1);
}

console.log(`✔ ${TARGET} 唯一：${found[0]}`);
console.log('\n✔ CSS 唯一性校验通过');
