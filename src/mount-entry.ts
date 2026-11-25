/**
 * mdh-kit/mount —— 浏览器端挂载入口
 *
 * ⚠️ 只在浏览器 / Electron 渲染进程里引。它依赖 DOM。
 *
 * ── 页面需要先引这些全局脚本（顺序不能乱） ──
 *   <script src="mdh.browser.js"></script>        编译器（含公式/图表/高亮）
 *   <script src="mdh-render.browser.js"></script> 单块渲染器（编辑时用）
 *   <script src="mdh-interact-core.js"></script>  交互能力
 *   <script src="mdh-interact.js"></script>       交互手势
 *
 * 然后：
 *   import { mount } from 'mdh-kit/mount';
 *   const view = await mount(el, { source: '……' });
 *
 * ── 为什么不在这里 import 那四个脚本 ──
 * 之前 import 过，结果打包时会内嵌一份副本，而页面又用 <script> 引了一份，
 * 两个实例先后注册 `window.MDHInteract`，后加载的覆盖先加载的 ——
 * 表现就是「改了源码但页面行为没变」，极难排查。
 *
 * 现在只做一件事：检查全局是否就绪，没就绪就报清楚的错。
 * 交互实现有且只有一份，来自页面的 <script>。
 */

export { mount, type MdhView } from './mount.ts';
export type { MdhSetting, MdhCallbacks } from './setting.ts';

/**
 * 检查页面上的 mdh 全局是否齐全
 *
 * 在 mount() 之前调用可以拿到更好的错误信息；
 * mount() 内部也会查，这里主要是给「快速失败」用。
 */
export function checkEnvironment(): { ok: boolean; missing: string[] } {
  const g = globalThis as unknown as Record<string, unknown>;
  const need: Array<[string, string]> = [
    ['Mdh', 'mdh.browser.js'],
    ['MDHRender', 'mdh-render.browser.js'],
    ['MDHInteractCore', 'mdh-interact-core.js'],
    ['MDHInteract', 'mdh-interact.js'],
  ];
  const missing: string[] = [];
  for (const [key, file] of need) {
    if (!g[key]) missing.push(`${key}（缺 ${file}）`);
  }
  return { ok: missing.length === 0, missing };
}
