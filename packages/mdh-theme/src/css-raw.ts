/**
 * 默认主题 CSS 的 Node 侧读取器
 *
 * 给编译期把 CSS 内联进产物用。浏览器不用这个文件 ——
 * 直接 `import 'mdh-kit/default.css'` 交给打包器。
 *
 * ── 为什么不能写死相对路径 ──
 *
 * 这个文件有两份拷贝，位置不同：
 *   · 源码：   packages/mdh-theme/src/css-raw.ts  → ../themes/default.css  ✅
 *   · 打包后： dist/css-raw.js                    → ../themes/default.css  ❌
 *
 * 打包后 `dist/` 的上一级是包根，`themes/` 并不在那儿。
 * 所以路径改成**从本文件往上逐级找**，找到为止 ——
 * 两种位置都能用（2026-11-25 修）。
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 在几个候选位置里找到默认主题 CSS */
function locateDefaultCss(): string {
  let dir = dirname(fileURLToPath(import.meta.url));

  // 从当前目录往上找，最多 5 层（覆盖 src/、dist/、包根等位置）
  for (let i = 0; i < 5; i++) {
    // 候选 1：同级的 themes/（打包后的 dist/ 布局）
    // 候选 2：../themes/（源码 packages/mdh-theme/src/ 布局）
    const candidates = [
      join(dir, 'themes', 'default.css'),
      join(dir, '..', 'themes', 'default.css'),
      join(dir, 'packages', 'mdh-theme', 'themes', 'default.css'),
    ];
    for (const c of candidates) {
      if (existsSync(c)) return resolve(c);
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }

  // 都没找到：返回最可能的路径，让 readFile 抛出带路径的错误（便于排查）
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', 'themes', 'default.css');
}

/** 默认主题 CSS 文件的绝对路径 */
export const DEFAULT_CSS_PATH = locateDefaultCss();

/** 读取默认主题 CSS */
export async function readDefaultCss(): Promise<string> {
  return readFile(DEFAULT_CSS_PATH, 'utf8');
}
