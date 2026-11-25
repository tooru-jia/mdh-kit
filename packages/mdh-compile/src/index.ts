/**
 * @mdh/compile —— 兼容入口
 *
 * ⚠️ 新代码请按宿主直接引用：
 *     import { … } from '@mdh/compile/node'       // CLI / CI / 服务端
 *     import { … } from '@mdh/compile/browser'    // 网页 / Electron
 *
 * 这个入口等价于 node 宿主，保留是为了不破坏既有调用（tools/stress.mjs 等）。
 */

export * from './node/index.ts';
