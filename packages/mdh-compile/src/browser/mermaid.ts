/**
 * Mermaid 插件（浏览器宿主）
 *
 * 与 Node 宿主的区别：那边起 Playwright 的 Chromium，这边直接用当前窗口。
 * mermaid 需要真实 SVG 测量能力，浏览器里本来就有。
 *
 * ⚠️ mermaid.render() 会往 document.body 插临时节点做测量，
 *    所以不能放在被替换的片段内部调用 —— 必须先算完全部 SVG 再统一替换。
 *
 * 配色来自 shared/theme.ts，与 Node 宿主一致。
 */
import type { CompilePlugin } from '../types.ts';
import { decodeAttr } from '../shared/extract.ts';
import { MERMAID_THEME_VARIABLES } from '../shared/theme.ts';
import { missingDep } from '../shared/missing-dependency.ts';

const MERMAID_RE = /<pre class="mdh-mermaid-body" data-mdh-source="([^"]*)"><\/pre>/g;

export interface MermaidPluginOptions {
  theme?: string;
}

/** 页面可配置的 mermaid 来源（供 export 写入 HTML） */
export interface MdhConfig {
  /**
   * mermaid 脚本地址列表，按顺序尝试。
   *
   * 单条即可满足常规场景：
   *   在线版  → CDN 地址
   *   共用引擎版 → './assets/mermaid.min.js'
   * 多条时按顺序容错，第一个加载成功的胜出。
   */
  mermaidSources?: string[];
  /** 内嵌模式：页面里没有 script 标签，引擎直接从这里取 */
  mermaidInline?: () => Promise<any>;
}

let initialized = false;
let loader: Promise<any> | null = null;

/** 读取页面级配置 */
function config(): MdhConfig {
  return (globalThis as any).MDH_CONFIG ?? {};
}

/** 动态插入 <script> 并等待加载完成 */
function loadScript(url: string, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.async = true;
    const timer = setTimeout(() => {
      s.remove();
      reject(new Error(`加载超时: ${url}`));
    }, timeoutMs);
    s.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    s.onerror = () => {
      clearTimeout(timer);
      s.remove();
      reject(new Error(`加载失败: ${url}`));
    };
    document.head.appendChild(s);
  });
}

/**
 * 取得 mermaid 实例，按优先级尝试：
 *
 *   ① 页面已有 window.mermaid  → 直接用（零下载，站点自带时最佳）
 *   ② MDH_CONFIG.mermaidSources → 按顺序逐个加载，第一个成功即用
 *   ③ MDH_CONFIG.mermaidInline  → 内嵌模式，从闭包取（离线版）
 *   ④ 静态 import('mermaid')    → 打包器内嵌（standalone 产物）
 *
 * 全部失败返回 null，调用方降级为显示源码。
 */
async function getMermaid(): Promise<any> {
  const g = globalThis as any;

  // ① 页面已有全局 mermaid
  if (g.mermaid?.render) return initMermaid(g.mermaid);

  // ② 按来源列表加载
  const sources = config().mermaidSources ?? [];
  for (const url of sources) {
    try {
      await loadScript(url);
      if (g.mermaid?.render) return initMermaid(g.mermaid);
    } catch {
      /* 试下一个来源 */
    }
  }

  // ③ 内嵌注入
  if (config().mermaidInline) {
    const m = await config().mermaidInline!();
    return initMermaid(m?.default ?? m);
  }

  // ④ 打包器内嵌
  if (!loader) {
    loader = import('mermaid').then((m) => (m as any).default);
  }
  try {
    return initMermaid(await loader);
  } catch {
    return null;
  }
}

/** 初始化配置（全局只做一次） */
function initMermaid(mermaid: any): any {
  if (!initialized && mermaid?.initialize) {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      themeVariables: { ...MERMAID_THEME_VARIABLES },
    });
    initialized = true;
  }
  return mermaid;
}

/** 浏览器宿主无需释放资源，保留同名导出以便调用方代码一致 */
export async function disposeMermaid(): Promise<void> {
  /* no-op */
}

export function mermaidPlugin(options: MermaidPluginOptions = {}): CompilePlugin {
  return {
    name: 'mermaid',
    env: 'browser',
    async transform(html: string): Promise<string> {
      const sources: string[] = [];
      const scan = new RegExp(MERMAID_RE.source, 'g');
      let m: RegExpExecArray | null;
      while ((m = scan.exec(html)) !== null) sources.push(decodeAttr(m[1]));

      if (sources.length === 0) return html;

      const mermaid = await getMermaid();

      // ④ 全部来源失败：依赖缺失，报错（不降级 —— 图缺了就是显示源码，算渲染不出来）
      if (!mermaid) throw missingDep('mermaid', 'Mermaid 图（***mermaid）');

      const svgs: string[] = [];

      for (let i = 0; i < sources.length; i++) {
        try {
          const { svg } = await mermaid.render(
            `mdh-mermaid-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`,
            sources[i],
          );
          svgs.push(svg);
        } catch (e) {
          svgs.push(`__ERROR__${(e as Error).message ?? 'mermaid 渲染失败'}`);
        }
      }

      let idx = 0;
      return html.replace(
        new RegExp(MERMAID_RE.source, 'g'),
        (_m, enc: string) => {
          const svg = svgs[idx++];
          if (!svg || svg.startsWith('__ERROR__')) {
            return `<pre class="mdh-mermaid-body mdh-mermaid-failed" data-mdh-source="${enc}">${enc}</pre>`;
          }
          return `<div class="mdh-mermaid-body" data-mdh-source="${enc}">${svg}</div>`;
        },
      );
    },
  };
}
