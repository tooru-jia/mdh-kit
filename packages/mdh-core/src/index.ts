/**
 * @mdh-kit/core —— mdh 内核
 *
 * 第 1 层：编译与感知
 *   编译器内核 + 语法高亮
 *
 * 第 2 层：呈现与操作
 *   HTML 生成 + 操作接口
 *
 * 契约见 docs/AST-SPEC.md
 */

// ---- 第 1 层：解析 ----
export { parse } from './parser/index.ts';
export type {
  RootNode,
  BlockNode,
  AnyNode,
  HeadingNode,
  ParagraphNode,
  ListNode,
  ListItemNode,
  TableNode,
  TableRowNode,
  ColumnNode,
  MathNode,
  ChartNode,
  MermaidNode,
  CodeNode,
  PageNode,
  SlideNode,
  GenericBlockNode,
  NodeBase,
  Diagnostic,
  ParseResult,
} from './parser/ast.ts';

// ---- 第 2 层：渲染 ----
// 第 2 层渲染器待迁入（依赖 katex / mermaid / chart 等外部库）

// ---- 反向序列化：AST → .mdh 源码 ----
export { serialize } from './serializer.ts';
export { serializeNode } from './serializer.ts';
export type { SerializeOptions } from './serializer.ts';

// 生成器标识（版本 / 构建 / 层级）—— 排错与兼容用，不是安全依据
export {
  MDH_VERSION,
  MDH_BUILD_TIME,
  makeGeneratorStamp,
  generatorMetaTags,
  generatorStampJson,
} from './generator-stamp.ts';
export type { GeneratorStamp, LayerVersions } from './generator-stamp.ts';

// ---- 单块解析（编辑用） ----
export { parseNode, parseNodes } from './parse-node.ts';
export type { ParseNodeOptions } from './parse-node.ts';

// ---- 文档锁（发布器产出的只读文档） ----
export {
  detectLock,
  stripLock,
  hasSignatureBlock,
  SIGNATURE_BEGIN,
  SIGNATURE_END,
} from './lock.ts';
export type { LockState } from './lock.ts';
