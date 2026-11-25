/**
 * Mermaid 插件（Node 宿主）
 *
 * 运行环境：Node（mermaid 需要真实 SVG 测量能力，jsdom 的 getBBox 不可用）
 * 实现：用 Playwright 起一次 Chromium，在其中跑 mermaid.min.js。
 * 只有文档里确实有 Mermaid 图时才启动浏览器。
 *
 * 浏览器宿主见 ../browser/mermaid.ts —— 同一份 shared 配色，只换渲染方式。
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { CompilePlugin } from '../types.ts';
import { decodeAttr } from '../shared/extract.ts';
import { MERMAID_THEME_VARIABLES } from '../shared/theme.ts';
import { missingDep } from '../shared/missing-dependency.ts';

/**
 * ESM 下用 import.meta.url，CJS 下退到 __filename
 *
 * 打包成 .cjs 后 import.meta 会被替换成空对象，直接取 .url 是 undefined，
 * createRequire(undefined) 会抛 "The argument 'filename' must be a file URL object…"。
 */
const baseUrl = (() => {
  try {
    // @ts-ignore 打包成 CJS 时 import.meta 为空对象
    if (typeof import.meta !== 'undefined' && import.meta.url) return import.meta.url;
  } catch {
    /* ignore */
  }
  return typeof __filename !== 'undefined' ? __filename : process.cwd() + '/';
})();

const require = createRequire(baseUrl);

/** Mermaid 占位（第二层输出） */
const MERMAID_RE = /<pre class="mdh-mermaid-body" data-mdh-source="([^"]*)"><\/pre>/g;

export interface MermaidPluginOptions {
  /** 主题，默认 default */
  theme?: string;
}

/** 缓存的浏览器上下文，一次编译复用 */
let cached: { browser: any; page: any } | null = null;

async function getPage(): Promise<any> {
  if (cached) return cached.page;

  const { chromium } = await import('playwright').catch(() => {
    throw missingDep('playwright', 'Mermaid / 图表渲染（需要真实浏览器测量）');
  });

  let mermaidPath: string;
  try {
    mermaidPath = require.resolve('mermaid/dist/mermaid.min.js');
  } catch {
    throw missingDep('mermaid', 'Mermaid 图（***mermaid）');
  }
  const mermaidJs = readFileSync(mermaidPath, 'utf8');

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<!DOCTYPE html><html><body></body></html>');
  await page.addScriptTag({ content: mermaidJs });
  await page.evaluate((vars) => {
    (globalThis as any).mermaid.initialize({ startOnLoad: false, themeVariables: vars });
  }, MERMAID_THEME_VARIABLES);

  cached = { browser, page };
  return page;
}

/** 关闭浏览器（编译结束后调用） */
export async function disposeMermaid(): Promise<void> {
  if (!cached) return;
  await cached.browser.close();
  cached = null;
}

export function mermaidPlugin(options: MermaidPluginOptions = {}): CompilePlugin {
  const theme = options.theme ?? 'default';

  return {
    name: 'mermaid',
    env: 'node',
    async transform(html: string): Promise<string> {
      const sources: string[] = [];
      const re = new RegExp(MERMAID_RE.source, 'g');
      let m: RegExpExecArray | null;
      while ((m = re.exec(html)) !== null) sources.push(decodeAttr(m[1]));

      if (sources.length === 0) return html; // 没有图，不启浏览器

      const page = await getPage();
      const svgs: string[] = [];

      for (let i = 0; i < sources.length; i++) {
        const svg = await page.evaluate(
          async ({ code, id, theme, vars }: { code: string; id: string; theme: string; vars: unknown }) => {
            const mm = (globalThis as any).mermaid;
            mm.initialize({ startOnLoad: false, theme, themeVariables: vars });
            try {
              const r = await mm.render(id, code);
              return r.svg as string;
            } catch (e) {
              return `__ERROR__${(e as Error).message}`;
            }
          },
          {
            code: sources[i],
            id: `mdh-mermaid-${Date.now()}-${i}`,
            theme,
            vars: MERMAID_THEME_VARIABLES,
          },
        );
        svgs.push(svg);
      }

      let idx = 0;
      return html.replace(
        new RegExp(MERMAID_RE.source, 'g'),
        (_m, enc: string) => {
          const svg = svgs[idx++];
          if (!svg || svg.startsWith('__ERROR__')) {
            // 渲染失败：降级显示原文
            return `<pre class="mdh-mermaid-body mdh-mermaid-failed" data-mdh-source="${enc}">${enc}</pre>`;
          }
          return `<div class="mdh-mermaid-body" data-mdh-source="${enc}">${svg}</div>`;
        },
      );
    },
  };
}
