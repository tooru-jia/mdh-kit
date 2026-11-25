/**
 * 代码高亮插件（浏览器宿主）
 *
 * 实现全在 shared/highlight-render.ts，与 Node 宿主逐字相同。
 */
import type { CompilePlugin } from '../types.ts';
import {
  CODE_RE,
  highlightCode,
  rebuildCodeBlock,
  type HighlightRenderOptions,
} from '../shared/highlight-render.ts';

export interface HighlightPluginOptions {
  /** 未知语言时的处理：原样输出或自动识别（默认 auto） */
  unknownLanguage?: 'auto' | 'plain';
}

export function highlightPlugin(options: HighlightPluginOptions = {}): CompilePlugin {
  const opts: HighlightRenderOptions = options;

  return {
    name: 'highlight',
    env: 'browser',
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
