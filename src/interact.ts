/**
 * mdh-kit/interact —— 交互层（浏览器）
 *
 * 这个入口做两件事：
 *   ① 加载交互引擎，注册 `window.MDHInteractCore` / `window.MDHInteract`
 *   ② 导出 TypeScript API（createInteract / attachInteract）
 *
 * ⚠️ 只该在**浏览器**里引。Node 里没有 window，加载会崩。
 *
 * 用法：
 *   import { attachInteract } from 'mdh-kit/interact';
 *
 *   // 只读：选中 + 显示 ID + 复制
 *   attachInteract(container);
 *
 *   // 可编辑：传齐三样
 *   attachInteract(container, renderer, { serializeNode, parseNode });
 *
 *   // 发布器产出的只读文档
 *   attachInteract(container, renderer, { serializeNode, parseNode, locked: true });
 */

// ① 副作用导入：两个脚本各自把自己挂到 window 上
// 顺序有要求：core 提供能力，interact 在其上绑手势
import '../packages/mdh-theme/src/mdh-interact-core.js';
import '../packages/mdh-theme/src/mdh-interact.js';

// ② API
export { createInteract, attachInteract } from '../packages/mdh-theme/src/interact.ts';
export type {
  Interact,
  InteractOptions,
  InteractSelection,
  InteractApi,
} from '../packages/mdh-theme/src/interact.ts';
