/**
 * @mdh-kit/theme —— 第三层：产物的外观与交互
 *
 * 只改「长什么样」和「怎么选中」，不改 HTML 结构。
 *
 * 交互分两层：
 *   createInteract  纯能力（选中 / 显示 ID / 复制 / 编辑），不绑手势
 *   attachInteract  mdh-kit 自带的完整手势（单击选中 + 双击编辑）
 *
 * ── 源码着色不在这里 ──
 *
 * 编辑器里的语法高亮（CodeMirror 的类名表、配色）属于**编辑器的职责**，
 * 不是渲染产物的外观 —— 所以本包不提供。
 *
 * 需要编辑器支持的话，照 `docs/SYNTAX-INTRODUCTION.md` 的符号总表自己写规则。
 */
export { createInteract, attachInteract } from './interact.ts';
export type {
  Interact,
  InteractOptions,
  InteractSelection,
  InteractApi,
} from './interact.ts';
