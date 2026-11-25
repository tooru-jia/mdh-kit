/**
 * 插件协议
 *
 * 第二层职责：把「占位」变成「真东西」（结构变化）。
 * 第三层职责：让这些东西好看（纯 CSS）。
 *
 * 插件只负责生成结构，不写任何样式。
 */

/** 插件运行所需的环境 */
export type PluginEnv = 'node' | 'browser';

export interface PluginContext {
  /** 当前编译所处的模式 */
  mode: CompileMode;
  /** 可选：浏览器实例（需要 env: 'browser' 的插件用） */
  browserPage?: unknown;
}

export interface CompilePlugin {
  /** 插件名，供调试 */
  name: string;
  /** 需要什么运行环境 */
  env: PluginEnv;
  /**
   * 找到所有需要处理的占位，返回 HTML 片段替换。
   *
   * 输入是整篇 HTML 骨架，输出是替换后的 HTML。
   * 这样插件之间可以自由组合、顺序无关（只要占位不重叠）。
   */
  transform(html: string, ctx: PluginContext): Promise<string>;
}

/** 编译模式 */
export type CompileMode = 'static' | 'hybrid' | 'runtime';

export interface CompileOptions {
  /** 默认 static：全部在编译期渲染完，产物是纯静态 HTML */
  mode?: CompileMode;
  /** 要启用的插件 */
  plugins?: CompilePlugin[];
  /**
   * 是否把默认主题 CSS 一并注入产物。
   *
   * - `'none'`（默认，向后兼容）：不注入，产物是无样式 HTML
   * - `'style'`：注入 `<style>` 标签（自包含，见 compileFromSourceCss）
   * - `{ css: string }`：注入调用方给的 CSS 文本
   *
   * ⚠️ 真值注入只在 `compileFromSource` / `compileAst` 里做，
   *    `compile()` 本身始终返回裸 HTML —— 它不知道 CSS 从哪来。
   */
  css?: 'none' | 'style' | { css: string };
}
