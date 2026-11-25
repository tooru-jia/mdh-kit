/**
 * @mdh/compile/node —— Node 宿主
 *
 * 用于 CLI、CI、服务端、构建流程。
 * Mermaid 与 Chart 通过 Playwright 起 Chromium 渲染（需要 `playwright`）。
 *
 * @example
 * import { compileFromSource, fullPlugins } from '@mdh/compile/node';
 * const html = await compileFromSource(source);
 */

import type { RootNode } from '../../../mdh-core/src/index.ts';
import type { CompilePlugin } from '../types.ts';
import { compile, type CompileAllOptions } from '../core.ts';
import { injectCss } from '../shared/css-inject.ts';
import { readDefaultCss } from '../../../mdh-theme/src/css-raw.ts';
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

/** 编译 AST（Node 宿主，默认全装插件） */
export async function compileAst(
  ast: RootNode,
  options: CompileAllOptions = {},
  plugins: CompilePlugin[] = fullPlugins(),
): Promise<string> {
  return compile(ast, options, plugins);
}

/**
 * 编译源码（Node 宿主，默认全装插件）
 *
 * 会按需启动 Playwright 浏览器；结束后默认释放。
 *
 * `options.css` 为 `'style'` 时自动带上默认主题样式（读 `@mdh/theme/raw`）。
 * 不传则产物是无样式 HTML（与旧行为一致）。
 */
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
  let html = await compile(
    parsed.ast,
    { ...options, source, footnoteDefs: parsed.footnoteDefs },
    plugins,
  );
  if (options.dispose !== false) {
    await disposeMermaid();
    await disposeChart();
  }
  return options.css === 'style' ? injectCss(html, await readDefaultCss()).html : html;
}

/**
 * 编译源码并**一定带上**默认主题样式（A 档式自包含产物）
 *
 * 等价于 `compileFromSource(src, { ...opts, css: 'style' })`。
 * 这是「给别人看」的推荐入口 —— 产物单独打开就有完整排版。
 */
export async function compileWithCss(
  source: string,
  options: CompileAllOptions = {},
  plugins: CompilePlugin[] = fullPlugins(),
): Promise<string> {
  return compileFromSource(source, { ...options, css: 'style' }, plugins);
}
