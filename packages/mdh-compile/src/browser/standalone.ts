/**
 * 浏览器产物入口（all-in-one：内嵌 katex + mermaid + highlight.js）
 *
 * 与 browser/index.ts 相同，区别是先注入内嵌的第三方库实例。
 * 单独一个文件是因为：
 *   - katex 是 CJS 包，放在 browser/index.ts 会让 B 档（全外链）也带上它
 *   - iife + external 的 CJS 包会残留 require()，浏览器直接崩
 */
import katex from 'katex';
import mermaid from 'mermaid';
import hljs from 'highlight.js/lib/common';
import { setKatex } from '../shared/katex-render.ts';
import { setHljs } from '../shared/highlight-render.ts';

// 注入内嵌 katex（katex 的 CJS 默认导出可能是模块对象或函数，两种都兼容）
const k = (katex as any).default ?? katex;
if (k?.renderToString) setKatex(k);

// 注入内嵌 highlight.js
const h = (hljs as any).default ?? hljs;
if (h?.highlight) setHljs(h);

/*
 * 把 mermaid 挂到全局
 *
 * `mermaid.ts` 的 `getMermaid()` 优先找 `window.mermaid`，
 * 而依赖自检（src/dependencies.ts）也只看 `window.mermaid`。
 * 打包进来的实例不会自动挂上去 —— 于是出现「包里明明带了 mermaid，
 * 却一直报缺少依赖 / 图渲染不出来」（2026-11-25 修）。
 *
 * 挂上去既满足插件，也让宿主能拿到同一个实例做自定义配置。
 */
const mm = (mermaid as any).default ?? mermaid;
const g = globalThis as Record<string, unknown>;
if (mm?.render && !g.mermaid) g.mermaid = mm;

/*
 * 告诉自检层「这些库是内嵌的」
 *
 * 启动自检（src/dependencies.ts）会看 window.Mdh 上的这几个标记：
 * 打包进本文件的库不会挂到 window 上，不打标记就会被误判成「缺依赖」——
 * 用户明明只引了这一个 script，却被告知「请 npm install mermaid」。
 */
export const hasKatex = !!(k?.renderToString);
export const hasMermaid = !!(mm?.render);
export const hasHljs = !!(h?.highlight);

export * from './index.ts';
