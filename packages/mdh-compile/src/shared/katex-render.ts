/**
 * KaTeX 渲染（两个宿主共用）
 *
 * katex.renderToString 不依赖 DOM，浏览器和 Node 都能跑，
 * 所以两侧共用同一份实现，宿主持有只改 env 字段。
 *
 * ⚠️ 这里不 import katex：
 *    katex 是 CommonJS 包。iife 产物若把它设为 external，esbuild 会留下
 *    require('katex') 的 shim，浏览器没有 require → 整个 bundle 启动失败。
 *    所以 katex 由宿主注入：
 *      Node 宿主    → import katex from 'katex'，模块加载时 setKatex
 *      浏览器宿主    → 内嵌（默认）或从 window.katex 取
 */

import { missingDep } from './missing-dependency.ts';

let katexInstance: any = null;

/** 宿主注入 katex 实例 */
export function setKatex(instance: any): void {
  katexInstance = instance;
}

/** 取 katex：注入的优先，其次页面全局；都没有则返回 null */
function pickKatex(): any | null {
  if (katexInstance?.renderToString) return katexInstance;
  const g = globalThis as any;
  if (g.katex?.renderToString) return g.katex;
  return null;
}

/** 公式原文的兜底显示（katex 缺失时） */
function inlineFallback(encoded: string): string {
  return `<span class="mdh-inline-math mdh-math-nokatex" data-mdh-latex="${encoded}">${decodeLatex(encoded)}</span>`;
}

function blockFallback(pre: string, encoded: string, post: string): string {
  return `<div class="mdh-math mdh-math-nokatex"${pre}data-mdh-latex="${encoded}"${post}>${decodeLatex(encoded)}</div>`;
}

/** 从 data 属性里还原 LaTeX（值经过了 JSON.stringify + HTML 转义） */
export const decodeLatex = (encoded: string): string => {
  const unescaped = encoded
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
  try {
    return JSON.parse(unescaped);
  } catch {
    return unescaped.replace(/^"|"$/g, '');
  }
};

/** 行内公式占位
 *
 * 允许标签之间有空白：第二层输出的是
 *   <span class="mdh-inline-math" data-mdh-latex="...">
 *   </span>
 * 早期正则要求 `<span></span>` 严格相邻，导致所有行内公式都匹配不上。
 */
export const INLINE_MATH_RE =
  /<span class="mdh-inline-math" data-mdh-latex="([^"]*)">\s*<\/span>/g;

/**
 * 块级公式占位
 *
 * 渲染层输出的形态有两种历史写法，必须都认：
 *   <div class="mdh-math-body" data-mdh-latex="..."></div>   ← html.ts 当前写法
 *   <div class="mdh-math" data-mdh-latex="..."></div>        ← 早期写法
 *
 * 曾经正则写死 class="mdh-math"，而渲染层输出的是 mdh-math-body，
 * 名字对不上 → 所有块级公式都留一个空 div，页面上什么都不显示。
 * 现在改为「只要带 data-mdh-latex 的 div 都算」，不再依赖类名。
 */
export const BLOCK_MATH_RE =
  /<div class="(?:mdh-math|mdh-math-body)"([^>]*?)data-mdh-latex="([^"]*)"([^>]*)>\s*<\/div>/g;

export interface KatexRenderOptions {
  throwOnError?: boolean;
}

/** 渲染行内公式，返回替换用的整段 HTML */
export function renderInlineMath(encoded: string, opts: KatexRenderOptions): string {
  const katex = pickKatex();
  // 依赖缺失 → 报错（不是降级）。文档里用了公式却没装 KaTeX 是配置问题。
  if (!katex) throw missingDep('katex', '数学公式（行内 $…$）');

  const rendered = katex.renderToString(decodeLatex(encoded), {
    displayMode: false,
    throwOnError: opts.throwOnError ?? false,
    output: 'html',
  });
  return `<span class="mdh-inline-math" data-mdh-latex="${encoded}">${rendered}</span>`;
}

/** 渲染块级公式，返回替换用的整段 HTML */
export function renderBlockMath(
  pre: string,
  encoded: string,
  post: string,
  opts: KatexRenderOptions,
): string {
  const katex = pickKatex();
  // 依赖缺失 → 报错（不是降级）
  if (!katex) throw missingDep('katex', '数学公式（块级 ***math）');

  const rendered = katex.renderToString(decodeLatex(encoded), {
    displayMode: true,
    throwOnError: opts.throwOnError ?? false,
    output: 'html',
  });
  return `<div class="mdh-math"${pre}data-mdh-latex="${encoded}"${post}>${rendered}</div>`;
}
