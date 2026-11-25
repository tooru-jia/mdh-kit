/**
 * KaTeX 插件（浏览器宿主）
 *
 * 实现全在 shared/katex-render.ts，与 Node 宿主逐字相同，
 * 只有 env 字段不同。
 */
import type { CompilePlugin } from '../types.ts';
import {
  BLOCK_MATH_RE,
  INLINE_MATH_RE,
  renderBlockMath,
  renderInlineMath,
  setKatex,
  type KatexRenderOptions,
} from '../shared/katex-render.ts';

// 浏览器宿主：A/C 档由构建器内嵌 katex（见 tools/build-iife.mjs 的注入做法）。
// 浏览器插件本身不 import katex —— iife 下 CJS 的 katex 会残留 require()；
// B 档则依赖页面通过 CDN 加载的 window.katex。
// 两者都进入 shared/katex-render.ts 的 pickKatex()。

export interface KatexPluginOptions {
  /** 出错时是否抛出（默认 false，降级显示原文） */
  throwOnError?: boolean;
}

export function katexPlugin(options: KatexPluginOptions = {}): CompilePlugin {
  const opts: KatexRenderOptions = { throwOnError: options.throwOnError ?? false };

  return {
    name: 'katex',
    env: 'browser',
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
