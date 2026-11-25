/**
 * mdh-kit —— mdh 文档的解析器与阅读器内核
 *
 * ── 这是什么 ──
 * mdh 的解析器和阅读器内核。给它一段 mdh 源码，它把解析、渲染、主题样式
 * 全部准备好，挂到页面上——用户看到的是排好版的内容，不是标签。
 *
 * 它可以做成一个独立的阅读器软件，也可以拿到 mdh 文档后实时渲染。
 * 阅读器、编辑器侧边预览、桌面应用、聊天界面里的预览，都是这个内核的用法。
 *
 * ── 产物是什么 ──
 * **产物始终是 mdh。** 源码进来，源码出去：
 *
 *   .mdh 源码  →  parse  →  AST  →  render  →  页面（DOM）
 *        ↑                                        │
 *        └──────────  serialize  ←── 编辑 ─────────┘
 *
 * DOM / HTML 只是「让浏览器把内容画出来」的载体，和 CSS、字体一样，
 * 属于实现细节。它**不是** mdh-kit 的产物，也不对外承诺：
 * 换一个渲染目标（canvas、PDF、原生列表）而不改任何 `.mdh` 文件，
 * 这个库仍然是 mdh-kit。
 *
 * ── 运行环境 ──
 * 本入口不碰 DOM，浏览器、Node（含 Electron / Tauri 主进程）、构建期脚本里
 * 都能 import。
 * 交互层（mount / interact）要操作 document，所以只能在有 DOM 的地方引 ——
 * 浏览器页面、Electron 渲染进程、Tauri 的 WebView。
 * 判据是「有没有 document」，不是「是不是 Node」。
 *
 * ── 边界在哪里 ──
 * 「把 .mdh 落成一份可直接分发的 .html 文件」不在这里，那是 **mdh-press**。
 * 渲染归渲染，出版归出版 —— 这一层给的是「能显示的内容」，不是「成品文件」。
 *
 * ── 用它的人 ──
 *   · 阅读器（打开 .mdh 文件看）
 *   · 聊天界面（预览 AI 产出的 mdh）
 *   · 编辑器（侧边预览）
 *   · 任何二次开发
 *
 * ── 两个入口 ──
 *   mdh-kit         浏览器用（含渲染 + 样式；交互能力见下）
 *   mdh-kit/full    依赖已打包（体积大，但什么都不用装）
 *
 * ── 交互能力为什么不在这里 ──
 * 交互层（选中 / 显示 ID / 可选编辑）依赖浏览器 DOM，在 Node 里加载会崩。
 * 浏览器项目请另外引：
 *   import 'mdh-kit/interact';       // 注册 window.MDHInteract
 *   import { attachInteract } from 'mdh-kit/interact-api';
 *
 * ── 依赖缺失时会报错 ──
 * 不支持静默降级：文档里用了公式却没装 KaTeX，会抛 `MdhMissingDependency`
 * 并告诉你三条出路。唯一例外是 highlight.js —— 缺了只是代码没颜色，
 * 内容完整可读，所以只警告一次。
 */

// ── 核心能力 ──
export { parse, serialize, serializeNode, parseNode, parseNodes } from '@mdh-kit/core';
export type { RootNode } from '@mdh-kit/core';

// ── 渲染 ──
export { render, createRenderer } from '@mdh-kit/render';

// ── 编译（补公式 / 图 / 高亮）──
// 用 browser 版：不含 playwright，可在任何打包器环境跑
export {
  compile,
  compileAst,
  compileFromSource,
  fullPlugins,
  katexPlugin,
  highlightPlugin,
  mermaidPlugin,
  chartPlugin,
  setKatex,
  setHljs,
  disposeMermaid,
  disposeChart,
  injectCss,
  hasDefaultCss,
  MdhMissingDependency,
  missingDep,
} from '@mdh-kit/compile/browser';

export type {
  CompileAllOptions,
  CompileMode,
  CompileOptions,
  CompilePlugin,
  PluginEnv,
  PluginContext,
  KatexPluginOptions,
  HighlightPluginOptions,
  MermaidPluginOptions,
  ChartPluginOptions,
  InjectResult,
  MissingDependency,
} from '@mdh-kit/compile/browser';

// ── 渲染入口 ──
// ⚠️ mount 依赖浏览器 DOM，所以在独立入口 `mdh-kit/mount`，不在主入口。
//    主入口（这里）可以在 Node 里安全 import。
// 配置类型只是纯数据，可以放这里。
export {
  resolveSetting,
  DEFAULT_SETTING,
  type MdhSetting,
  type MdhCallbacks,
  type ResolvedMdhSetting,
} from './setting.ts';

// ── 主题样式 ──
// 浏览器：import 'mdh-kit/default.css'
// Node：import { readDefaultCss } from 'mdh-kit/raw'
