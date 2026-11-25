/**
 * mdh-kit/full —— 依赖全打包版
 *
 * 与 `mdh-kit` 的 API 完全相同，唯一区别：**第三方库已经打进来**。
 *
 *   用 mdh-kit        → 宿主自己 npm install katex mermaid chart.js highlight.js
 *   用 mdh-kit/full   → 什么都不用装，体积大（约 500KB+）
 *
 * ── 什么时候用 full ──
 *   · 阅读器：装上就得能打开任何 .mdh，不想赌用户有没有装依赖
 *   · 离线产物：断网也要能看公式和图
 *
 * ── 什么时候用普通版 ──
 *   · 宿主已经引了 KaTeX（比如编辑器本身就用它）
 *   · 体积敏感，愿意按需 load
 *
 * ── mermaid 为什么仍然外链 ──
 * mermaid 及其依赖（elkjs 1.5MB + cytoscape 447KB）合计近 6MB，
 * 打进任何产物都不现实。所以 full 版仍然从 `window.mermaid`
 * 或宿主注入取；缺了会抛 `MdhMissingDependency`，不会静默降级。
 */

import katex from 'katex';
import hljs from 'highlight.js/lib/common';
import { Chart } from 'chart.js/auto';

import { setKatex, setHljs } from '@mdh/compile/browser';

// katex 的 CJS 默认导出可能是模块对象或函数，两种都兼容
const k = (katex as any).default ?? katex;
if (k?.renderToString) setKatex(k);

const h = (hljs as any).default ?? hljs;
if (h?.highlight) setHljs(h);

// Chart.js 挂到全局，浏览器宿主从 window.Chart 取
const g = globalThis as any;
if (!g.Chart) g.Chart = (Chart as any).default ?? Chart;

// 其余 API 与标准版完全一致
export * from './index.ts';
