/**
 * 单个源码片段 → AST 节点
 *
 * 用于「编辑某一块」：用户改完源码，把这段文本解析回节点，替换掉原节点。
 *
 * 为什么需要 `as` 参数：
 *   有些节点的语义依赖父级上下文。例如一行 `- 张三, 20k`，
 *   单独解析会得到「列表项」，但在 `***table` 里它是「表格行」。
 *   所以调用方要告诉它按什么类型解析。
 */

import type { AnyNode } from './parser/ast.ts';
import { parse } from './index.ts';

export interface ParseNodeOptions {
  /** 期望的节点类型。给了就按这个类型解释源码 */
  as?: string;
}

/** 把单块源码包成可解析的完整文档 */
const wrap = (text: string, as?: string): string => {
  const body = text.trimEnd();

  switch (as) {
    case 'tableRow':
      // 表格行需要包在 table 块里
      return `***table\n${body}\n***table-end`;

    case 'listItem':
      // 列表项包在 list 块里
      return `***list\n${body}\n***list-end`;

    default:
      // 其余类型本身就是完整块，直接解析
      return body;
  }
};

/**
 * 解析源码片段
 *
 * @returns 解析出的节点；失败返回 null
 *
 * @example
 * parseNode('***table\nhead: A\n- 1\n***table-end')      // → table 节点
 * parseNode('- 张三, 20k', { as: 'tableRow' })           // → tableRow 节点
 */
export function parseNode(text: string, options: ParseNodeOptions = {}): AnyNode | null {
  const { as } = options;
  const src = wrap(text, as);

  const result = parse(src);
  const errors = result.diagnostics.filter((d) => d.level === 'error');
  if (errors.length > 0) return null;

  const children = result.ast.children;
  if (children.length === 0) return null;

  // 按类型取值
  if (as === 'tableRow') {
    const table = children[0] as any;
    return table.rows?.[0] ?? null;
  }
  if (as === 'listItem') {
    const list = children[0] as any;
    return list.children?.[0] ?? null;
  }

  // 默认取第一个块；若有多个块，说明用户输入包含了多个块，只取第一个
  return children[0];
}

/** 解析并返回全部块（用于「一段源码替换成多块」的场景） */
export function parseNodes(text: string): AnyNode[] {
  return parse(text).ast.children;
}
