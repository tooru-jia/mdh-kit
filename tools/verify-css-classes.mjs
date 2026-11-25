/**
 * 校验 docs/CSS-CLASSES.md 里列的类名都有样式
 *
 * 目的：文档说「这些类名是公开契约」，那就必须有东西保证它没写错。
 *
 * 三类豁免：
 *   ① 交互层动态加的类（不在 default.css，由 mdh-interact*.js 加）
 *   ② 只作钩子、暂无样式的类（渲染器输出但 CSS 故意不写，如实标注）
 *   ③ 靠组合选择器命中的类（如 `.mdh-page-slides .mdh-slide`）
 */
import { readFileSync } from 'node:fs';

const DOC = 'docs/CSS-CLASSES.md';
const CSS = 'packages/mdh-theme/themes/default.css';

const doc = readFileSync(DOC, 'utf8');
const css = readFileSync(CSS, 'utf8');

// 不限行首 —— `.mdh-page-slides .mdh-slide` 这类组合选择器也要算命中
const cssClasses = new Set(
  [...css.matchAll(/\.(mdh-[a-z0-9-]+)/g)].map((m) => m[1]),
);

const docClasses = new Set(
  [...doc.matchAll(/`\.?(mdh-[a-z0-9-]+)`/g)].map((m) => m[1]),
);

/** ① 交互层动态添加，不在 default.css */
const DYNAMIC = new Set([
  'mdh-selected',
  'mdh-editing',
  'mdh-id-badge',
  'mdh-id-badge-btn',
  'mdh-id-badge-btn-edit',
  'mdh-id-badge-id',
  'mdh-editor',
  'mdh-editor-bar',
  'mdh-editor-id',
  'mdh-editor-input',
  'mdh-code-copy',
]);

/** ② 只作钩子，暂无样式（文档里已标注，方便第三方接管） */
const HOOK_ONLY = new Set([
  'mdh-head-row',
  'mdh-slide-count',
  'mdh-slide-total',
]);

const missing = [];
for (const c of docClasses) {
  if (DYNAMIC.has(c) || HOOK_ONLY.has(c)) continue;
  if (!cssClasses.has(c)) missing.push(c);
}

if (missing.length) {
  console.error('✖ 文档写了、但 CSS 里既没样式也没标注豁免的类：');
  missing.forEach((c) => console.error('   ' + c));
  process.exit(1);
}

console.log(
  `✔ ${docClasses.size} 个类名全部有据可查` +
    `（动态 ${DYNAMIC.size} / 钩子 ${HOOK_ONLY.size} / 有样式 ${docClasses.size - DYNAMIC.size - HOOK_ONLY.size}）`,
);
