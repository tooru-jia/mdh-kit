/**
 * AST 操作：查找、替换、插入、删除、移动
 *
 * 直接修改传入的 AST（持引用，见 ARCHITECTURE 第二层设计）。
 * 所有操作返回「是否成功」。
 */

import type { AnyNode, RootNode } from '@mdh-kit/core';

/** 子节点容器：返回节点当前所在的数组 */
interface Located {
  parent: AnyNode | null;
  list: AnyNode[];
  index: number;
}

/** 遍历所有 (node, list, index) 三元组 */
const eachChildList = (node: AnyNode, visit: (list: AnyNode[]) => void) => {
  const any = node as any;
  if (Array.isArray(any.children)) visit(any.children);
  if (node.type === 'table' && Array.isArray(any.rows)) visit(any.rows);
  if (Array.isArray(any.columnBlocks)) any.columnBlocks.forEach((c: AnyNode[]) => visit(c));
  if (Array.isArray(any.slides)) visit(any.slides);
};

/** 在整棵树里定位某个 ID */
export function locate(ast: RootNode, id: string): Located | null {
  let found: Located | null = null;

  const walk = (node: AnyNode, parent: AnyNode | null) => {
    if (found) return;
    if (node.id === id) {
      // 由调用方在遍历到父级时才知道 list/index，这里只标记存在
      found = { parent, list: [], index: -1 };
      return;
    }
    eachChildList(node, (list) => {
      list.forEach((child, i) => {
        if (found) return;
        if (child.id === id) {
          found = { parent: node, list, index: i };
          return;
        }
        walk(child, node);
      });
    });
  };

  walk(ast, null);
  return found;
}

/** 按 ID 查找节点 */
export function findNode(ast: RootNode, id: string): AnyNode | null {
  let hit: AnyNode | null = null;
  const walk = (node: AnyNode) => {
    if (hit) return;
    if (node.id === id) {
      hit = node;
      return;
    }
    eachChildList(node, (list) => list.forEach(walk));
  };
  walk(ast);
  return hit;
}

/** 替换节点：找到 id 对应节点，整体换成 newNode（保留 newNode 的 id 由调用方保证） */
export function replaceNode(ast: RootNode, id: string, newNode: AnyNode): boolean {
  let done = false;
  const walk = (node: AnyNode) => {
    if (done) return;
    eachChildList(node, (list) => {
      const i = list.findIndex((c) => c.id === id);
      if (i >= 0) {
        list[i] = newNode;
        done = true;
        return;
      }
      list.forEach(walk);
    });
  };
  walk(ast);
  return done;
}

/**
 * 把一块替换成多块
 *
 * 场景：用户在编辑框里写的不止一个块（比如原文后面补了 `---`），
 * 保存时需要把「原来那一块」换成「解析出来的所有块」。
 * `replaceNode` 只能一对一，这里是一对多。
 */
export function replaceNodeWithMany(
  ast: RootNode,
  id: string,
  newNodes: AnyNode[],
): boolean {
  if (newNodes.length === 0) return false;
  let done = false;
  const walk = (node: AnyNode) => {
    if (done) return;
    eachChildList(node, (list) => {
      const i = list.findIndex((c) => c.id === id);
      if (i >= 0) {
        list.splice(i, 1, ...newNodes);
        done = true;
        return;
      }
      list.forEach(walk);
    });
  };
  walk(ast);
  return done;
}

/** 在指定父节点下的第 index 位插入 */
export function insertNode(ast: RootNode,
  parentId: string,
  index: number,
  newNode: AnyNode,
): boolean {
  const parent = parentId === ast.id ? ast : findNode(ast, parentId);
  if (!parent) return false;

  const any = parent as any;
  const list: AnyNode[] | undefined = any.children;
  if (!Array.isArray(list)) return false;

  const i = Math.max(0, Math.min(index, list.length));
  list.splice(i, 0, newNode);
  return true;
}

/** 删除节点 */
export function removeNode(ast: RootNode, id: string): boolean {
  let done = false;
  const walk = (node: AnyNode) => {
    if (done) return;
    eachChildList(node, (list) => {
      const i = list.findIndex((c) => c.id === id);
      if (i >= 0) {
        list.splice(i, 1);
        done = true;
        return;
      }
      list.forEach(walk);
    });
  };
  walk(ast);
  return done;
}

/** 移动节点到新的父节点与位置 */
export function moveNode(
  ast: RootNode,
  id: string,
  newParentId: string,
  newIndex: number,
): boolean {
  const node = findNode(ast, id);
  if (!node) return false;
  if (!removeNode(ast, id)) return false;
  const insert = insertNode(ast, newParentId, newIndex, node);
  if (!insert) {
    // 插入失败则回滚：放回根节点末尾
    (ast.children as AnyNode[]).push(node);
    return false;
  }
  return true;
}
