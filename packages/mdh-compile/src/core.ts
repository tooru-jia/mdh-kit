/**
 * 编译编排核心（宿主无关）
 *
 * 职责：AST → 骨架 HTML → 依次交给插件 → 成品 HTML
 *
 * ⚠️ 这里**不 import 任何具体插件**，插件由各宿主入口传入。
 *    这样打包器才能按宿主裁剪，不会把 node 侧的 Playwright 带进浏览器包。
 *
 * 三种模式（架构上留好位置，当前只实现 static）：
 *   static  —— 全部在编译期渲染完，产物是纯静态 HTML（默认）
 *   hybrid  —— 公式/代码编译期，图表/Mermaid 转成运行时 JS
 *   runtime —— 全部转成运行时 JS，产物最轻
 */

import type { RootNode } from '../../mdh-core/src/index.ts';
import type { CompileMode, CompileOptions, CompilePlugin } from './types.ts';
import { render, type RenderOptions } from '../../mdh-render/src/index.ts';
import { MdhMissingDependency } from './shared/missing-dependency.ts';

export interface CompileAllOptions extends CompileOptions, RenderOptions {
  /** 编译结束后是否释放宿主资源（Node 宿主的浏览器，默认 true） */
  dispose?: boolean;
}

/**
 * 编译
 *
 * 插件顺序无关（各插件占位不重叠），但保持固定顺序便于复现。
 *
 * @example
 * // Node 宿主
 * import { compile, fullPlugins } from '@mdh-kit/compile/node';
 * await compile(ast);
 *
 * // 浏览器宿主
 * import { compile, fullPlugins } from '@mdh-kit/compile/browser';
 * await compile(ast);
 */
export async function compile(
  ast: RootNode,
  options: CompileAllOptions = {},
  plugins?: CompilePlugin[],
): Promise<string> {
  const mode: CompileMode = options.mode ?? 'static';

  // 兼容旧签名 compile(ast, { plugins })：未显式传第三个参数时从 options 取
  const active = plugins ?? options.plugins ?? [];

  if (mode !== 'static') {
    throw new Error(
      `[mdh-compile] 模式 "${mode}" 尚未实现。当前只支持 "static"（编译期全渲染）。`,
    );
  }

  let html = render(ast, options);

  const failures: string[] = [];
  for (const p of active) {
    try {
      html = await p.transform(html, { mode });
    } catch (e) {
      // 依赖缺失是配置问题，必须让调用方知道 —— 直接抛，不吞。
      // 内容类错误（用户写的 Mermaid/公式有语法错）才降级继续。
      if (e instanceof MdhMissingDependency) throw e;
      // 单个插件失败不拖垮整篇：记录后继续，其余插件照常跑
      failures.push(`${p.name}: ${(e as Error).message}`);
    }
  }

  if (failures.length > 0) {
    // 不抛，把失败挂到 html 之外由调用方决定 —— 但同时给出 console 输出便于排查
    console.warn(`[mdh-compile] ${failures.length} 个插件失败：\n${failures.join('\n')}`);
  }

  return html;
}
