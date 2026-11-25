/**
 * 代码高亮插件（Node 宿主）
 *
 * 实现全在 shared/highlight-render.ts，这里只提供插件外壳。
 *
 * ⚠️ hljs 由本宿主在模块加载时注入（lib/common，36 种常用语言）。
 *    shared 层不再 import highlight.js —— 否则浏览器 iife 产物里会残留
 *    require()，导致整个 bundle 启动失败。
 */
import hljsCommon from 'highlight.js/lib/common';
import type { CompilePlugin } from '../types.ts';
import {
  CODE_RE,
  highlightCode,
  rebuildCodeBlock,
  setHljs,
  type HighlightRenderOptions,
} from '../shared/highlight-render.ts';

// Node 宿主：注入内嵌的 common 版
setHljs(hljsCommon);

export interface HighlightPluginOptions {
  /** 未知语言时的处理：原样输出或自动识别（默认 auto） */
  unknownLanguage?: 'auto' | 'plain';
}

export function highlightPlugin(options: HighlightPluginOptions = {}): CompilePlugin {
  const opts: HighlightRenderOptions = options;

  return {
    name: 'highlight',
    env: 'node',
    async transform(html: string): Promise<string> {
      return html.replace(
        CODE_RE,
        (_m, preOpen: string, head: string, code: string) => {
          // 语言从 pre 的属性里取（渲染层写的是 data-mdh-lang）
          const lang = /data-mdh-lang="([^"]*)"/.exec(preOpen)?.[1] ?? '';
          const highlighted = highlightCode(code, lang, opts);
          return rebuildCodeBlock(preOpen, head, highlighted);
        },
      );
    },
  };
}
