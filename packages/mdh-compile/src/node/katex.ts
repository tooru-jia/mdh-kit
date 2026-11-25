/**
 * KaTeX 插件（Node 宿主）
 *
 * 实现全在 shared/katex-render.ts，这里只提供插件外壳。
 *
 * ⚠️ katex 由本宿主注入（shared 层不 import，避免浏览器 iife 产物残留 require）。
 */
import katex from 'katex';
import type { CompilePlugin } from '../types.ts';
import {
  BLOCK_MATH_RE,
  INLINE_MATH_RE,
  renderBlockMath,
  renderInlineMath,
  setKatex,
  type KatexRenderOptions,
} from '../shared/katex-render.ts';

// Node 宿主：注入内嵌的 katex
setKatex((katex as any).default ?? katex);

export interface KatexPluginOptions {
  /** 出错时是否抛出（默认 false，降级显示原文） */
  throwOnError?: boolean;
}

export function katexPlugin(options: KatexPluginOptions = {}): CompilePlugin {
  const opts: KatexRenderOptions = { throwOnError: options.throwOnError ?? false };

  return {
    name: 'katex',
    env: 'node',
    async transform(html: string): Promise<string> {
      let out = html.replace(
        INLINE_MATH_RE,
        (_m, enc: string) => renderInlineMath(enc, opts),
      );
      out = out.replace(
        BLOCK_MATH_RE,
        (_m, pre: string, enc: string, post: string) => renderBlockMath(pre, enc, post, opts),
      );
      return out;
    },
  };
}
