import { defineConfig } from 'tsup';

/**
 * 打包配置：@mdh-kit/core、@mdh-kit/render、@mdh-kit/compile
 *
 * 输出三种格式：
 *   .js   ESM（浏览器 / 现代 Node）
 *   .cjs  CommonJS（老工具链）
 *   .d.ts 类型声明
 *
 * 依赖处理：
 *   @mdh-kit/core 零依赖（不打包任何外部库）
 *   @mdh-kit/render 只依赖 @mdh-kit/core（作为 external，不打进产物）
 *   @mdh-kit/compile 依赖 @mdh-kit/core / @mdh-kit/render 与第三方渲染库，全部 external
 *                —— 三个包都由使用方自己装，版本自己控
 *
 * @mdh-kit/compile 分成两个宿主入口：
 *   node/index      → CLI / CI / 服务端（mermaid、chart 走 Playwright）
 *   browser/index   → 网页 / Electron（mermaid、chart 在当前窗口渲染）
 * 两个入口互不引用，打包器按需裁剪，node 侧的 Playwright 不会进浏览器包。
 */
export default defineConfig([
  {
    entry: { index: 'packages/mdh-core/src/index.ts' },
    outDir: 'packages/mdh-core/dist',
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    sourcemap: true,
    target: 'es2020',
    splitting: false,
  },
  {
    entry: { index: 'packages/mdh-render/src/index.ts' },
    outDir: 'packages/mdh-render/dist',
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    sourcemap: true,
    target: 'es2020',
    splitting: false,
    // @mdh-kit/core 不打进产物：由使用方自己装
    external: ['@mdh-kit/core'],
  },
  {
    // mdh-theme：外观层（CSS）+ 交互能力层
    //
    // ⚠️ interact.ts 不 import 那两个 IIFE 文件（mdh-interact-core.js、
    //    mdh-interact.js），只从 window 读全局。所以这里只编译 .ts，
    //    两个 .js 当静态资源原样带到 dist/。
    entry: {
      index: 'packages/mdh-theme/src/index.ts',
      interact: 'packages/mdh-theme/src/interact.ts',
      'css-raw': 'packages/mdh-theme/src/css-raw.ts',
    },
    outDir: 'packages/mdh-theme/dist',
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    sourcemap: true,
    target: 'es2020',
    splitting: false,
    external: ['katex', 'highlight.js', 'mermaid', 'chart.js', 'playwright'],
  },
  {
    entry: {
      'node/index': 'packages/mdh-compile/src/node/index.ts',
      'browser/index': 'packages/mdh-compile/src/browser/index.ts',
      core: 'packages/mdh-compile/src/core.ts',
    },
    outDir: 'packages/mdh-compile/dist',
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    sourcemap: true,
    target: 'es2020',
    splitting: false,
    // 第三方渲染库与 mdh 自家包全部交给使用方，不进产物
    external: [
      '@mdh-kit/core',
      '@mdh-kit/render',
      'katex',
      'highlight.js',
      'mermaid',
      'chart.js',
      'chart.js/auto',
      'playwright',
    ],
  },
  {
    // mdh-kit 总入口：标准版（依赖由使用方提供）
    entry: {
      index: 'src/index.ts',
      interact: 'src/interact.ts',
      'mount-entry': 'src/mount-entry.ts',
      'css-raw': 'packages/mdh-theme/src/css-raw.ts',
    },
    outDir: 'dist',
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    sourcemap: true,
    target: 'es2020',
    splitting: false,
    external: [
      '@mdh-kit/core',
      '@mdh-kit/render',
      '@mdh-kit/compile',
      '@mdh-kit/theme',
      'katex',
      'highlight.js',
      'highlight.js/lib/common',
      'mermaid',
      'chart.js',
      'chart.js/auto',
      'playwright',
    ],
  },
  {
    // full 版：第三方库全打包进去（体积大，但不装也能跑）
    entry: { full: 'src/full.ts' },
    outDir: 'dist',
    format: ['esm'],
    dts: true,
    clean: false,
    sourcemap: true,
    target: 'es2020',
    splitting: false,
    // 只把 mdh 自家包和 playwright 留给外部
    external: [
      '@mdh-kit/core',
      '@mdh-kit/render',
      '@mdh-kit/compile',
      '@mdh-kit/theme',
      'playwright',
    ],
  },
]);
