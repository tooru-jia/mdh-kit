/**
 * @mdh-kit/compile/browser —— 浏览器宿主
 *
 * 用于网页、Electron 渲染进程、任何已有 DOM 的环境。
 * Mermaid 与 Chart 直接在当前窗口渲染，**不需要 Playwright**。
 *
 * @example
 * import { compileFromSource } from '@mdh-kit/compile/browser';
 * document.querySelector('#app').innerHTML = await compileFromSource(source);
 */

import type { RootNode } from '../../../mdh-core/src/index.ts';
import type { CompilePlugin } from '../types.ts';
import { compile, type CompileAllOptions } from '../core.ts';
import { katexPlugin, type KatexPluginOptions } from './katex.ts';
import { highlightPlugin, type HighlightPluginOptions } from './highlight.ts';
import {
  mermaidPlugin,
  disposeMermaid,
  type MermaidPluginOptions,
} from './mermaid.ts';
import { chartPlugin, disposeChart, type ChartPluginOptions } from './chart.ts';

export { compile };
export type { CompileAllOptions };
export type { CompileMode, CompileOptions, CompilePlugin, PluginEnv, PluginContext } from '../types.ts';
export { injectCss, hasDefaultCss, type InjectResult } from '../shared/css-inject.ts';
export { MdhMissingDependency, missingDep, type MissingDependency } from '../shared/missing-dependency.ts';
// 公开 AST 类型：compileAst 的入参，下游需要有名字可用（否则 d.ts 报 TS2742）
export type { RootNode } from '../../../mdh-core/src/index.ts';

// 注入 hljs：默认从 window.hljs 取（CDN / 本地共用文件），
// 也可由宿主显式传入（桌面软件内部渲染时用内嵌版本）
export { setHljs } from '../shared/highlight-render.ts';

// 注入 katex：浏览器插件不自己 import（iife 下 CJS 会残留 require），
// 由宿主传入实例。打包器环境（Lumen、Vite）直接 import katex 后调这个。
export { setKatex } from '../shared/katex-render.ts';

export { katexPlugin, highlightPlugin, mermaidPlugin, chartPlugin };
export { disposeMermaid, disposeChart };
export type {
  KatexPluginOptions,
  HighlightPluginOptions,
  MermaidPluginOptions,
  ChartPluginOptions,
};

/** 全套插件（公式 + 代码高亮 + Mermaid + 图表） */
export function fullPlugins(): CompilePlugin[] {
  return [katexPlugin(), highlightPlugin(), mermaidPlugin(), chartPlugin()];
}

/** 编译 AST（浏览器宿主，默认全装插件） */
export async function compileAst(
  ast: RootNode,
  options: CompileAllOptions = {},
  plugins: CompilePlugin[] = fullPlugins(),
): Promise<string> {
  return compile(ast, options, plugins);
}

/** 编译源码（浏览器宿主，默认全装插件） */
export async function compileFromSource(
  source: string,
  options: CompileAllOptions = {},
  plugins: CompilePlugin[] = fullPlugins(),
): Promise<string> {
  const { parse } = await import('../../../mdh-core/src/index.ts');
  // 传 source + footnoteDefs：
  //   - source：脚注编号按「首次插入顺序」算，AST 里没有这个顺序信息
  //   - footnoteDefs：定义行已被 parse() 摘掉，必须一并交给渲染层（BUG-10）
  const parsed = parse(source);
  return compile(
    parsed.ast,
    { ...options, source, footnoteDefs: parsed.footnoteDefs },
    plugins,
  );
}
