/**
 * 渲染器：持有 AST，支持整篇 / 单块渲染与增量更新
 *
 * 两种模式：
 *   mode: 'full'         每次渲染都重新生成整篇（默认，最可靠）
 *   mode: 'incremental'  只重渲染受影响的块
 *
 * 增量更新的正确性依赖「受影响集合算得全」，见 computeAffected()。
 * 测试时用 full 模式对拍 incremental，保证两者结果一致。
 */

import type { AnyNode, RootNode } from '@mdh/core';
import { computeNumbers, type NumberInfo } from './numbering.ts';
import { renderNode, renderRoot, type RenderOptions } from './html.ts';
import { findNode, insertNode, moveNode, removeNode, replaceNode, replaceNodeWithMany } from './tree.ts';
import { editabilityOf, type Editability } from './editability.ts';

export type { Editability };

export type RenderMode = 'full' | 'incremental';

/**
 * 编辑能力开关（FIX-4）
 *
 * - `full`：按块类型逐块判断能不能改（编辑中的宿主，如 Lumen）
 * - `readonly`：整篇一律不可改（发布物、只读预览）
 *
 * 默认 `full`，现有行为不变。
 */
export type EditingMode = 'full' | 'readonly';

export interface RendererOptions extends RenderOptions {
  mode?: RenderMode;
  /**
   * 编辑能力模式（默认 `full`）
  */
  editing?: EditingMode;
}

export interface Renderer {
  /** 整篇 HTML */
  toHtml(): string;
  /** 单块 HTML */
  toHtmlOf(nodeId: string): string | null;
  /** 某块的编号数字（如 "1"），无编号返回 undefined。措辞由第三层 CSS 拼 */
  getNumber(nodeId: string): string | undefined;
  /** 通过 ref 查节点 ID */
  resolveReference(name: string): string | undefined;
  /** 查某个名字被哪些节点引用 */
  getReferrers(name: string): string[];
  /**
   * 这个块能不能改（FIX-4）
   *
   * 第三层在「动手改之前」用它判断，而不是调用 update() 拿到 false 才知道。
   *
   * @returns 节点不存在时返回 null
   */
  getEditability(nodeId: string): Editability | null;
  /** 替换节点 */
  update(nodeId: string, newNode: AnyNode): boolean;
  /** 用多块替换一块（编辑框里写出多个块时用） */
  replaceWithMany(nodeId: string, newNodes: AnyNode[]): boolean;
  /** 插入节点 */
  insert(parentId: string, index: number, node: AnyNode): boolean;
  /** 删除节点 */
  remove(nodeId: string): boolean;
  /** 移动节点 */
  move(nodeId: string, newParentId: string, index: number): boolean;
  /** 换整棵 AST */
  setAst(ast: RootNode): void;
  /** 取当前 AST（持引用） */
  getAst(): RootNode;
  /** 最近一次增量更新涉及的节点 ID（调试用） */
  lastAffected(): string[];
}

/** 节点及其所有祖先的 ID（节点必须仍在树中） */
const ancestorsOf = (ast: RootNode, id: string): string[] => {
  const chain: string[] = [];
  const walk = (node: AnyNode, trail: string[]): boolean => {
    if (node.id === id) {
      chain.push(...trail);
      return true;
    }
    const any = node as any;
    const kids: AnyNode[] = [
      ...(Array.isArray(any.children) ? any.children : []),
      ...(node.type === 'table' && Array.isArray(any.rows) ? any.rows : []),
      ...(Array.isArray(any.columnBlocks) ? any.columnBlocks.flat() : []),
      ...(Array.isArray(any.slides) ? any.slides : []),
    ];
    return kids.some((k) => walk(k, [...trail, node.id]));
  };
  walk(ast, []);
  return chain;
};

/** 收集某 ID 的全部祖先（用改动前的快照，因为节点可能已被删除） */
const ancestorsInSnapshot = (snapshot: Map<string, string[]>, id: string): string[] =>
  snapshot.get(id) ?? [];

/** 为整棵树建立「ID → 祖先链」映射 */
function buildAncestorMap(ast: RootNode): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const walk = (node: AnyNode, trail: string[]) => {
    map.set(node.id, [...trail]);
    const any = node as any;
    const kids: AnyNode[] = [
      ...(Array.isArray(any.children) ? any.children : []),
      ...(node.type === 'table' && Array.isArray(any.rows) ? any.rows : []),
      ...(Array.isArray(any.columnBlocks) ? any.columnBlocks.flat() : []),
      ...(Array.isArray(any.slides) ? any.slides : []),
    ];
    kids.forEach((k) => walk(k, [...trail, node.id]));
  };
  walk(ast, []);
  return map;
}

/**
 * 计算增量更新的受影响集合
 *
 * 受影响的块：
 *   1. 被改动的节点本身
 *   2. 编号发生变化的节点
 *   3. 引用了上述节点的块
 *   4. 上述所有节点的祖先（因为子元素 HTML 嵌在父元素里）
 */
function computeAffected(
  ast: RootNode,
  prev: NumberInfo,
  next: NumberInfo,
  changedIds: string[],
  prevAncestors: Map<string, string[]>,
  nextAncestors: Map<string, string[]>,
): Set<string> {
  const affected = new Set<string>(changedIds);

  // 编号变了的块
  for (const [id, num] of next.byNode) {
    if (prev.byNode.get(id) !== num) affected.add(id);
  }
  // 编号消失的块
  for (const id of prev.byNode.keys()) {
    if (!next.byNode.has(id)) affected.add(id);
  }

  // 引用了受影响块的块
  for (const [name, referrers] of next.references) {
    const targetId = next.nameToNode.get(name);
    const targetChanged =
      (targetId && affected.has(targetId)) || prev.nameToNode.get(name) !== targetId;
    if (targetChanged) referrers.forEach((r) => affected.add(r));
  }
  for (const [name, referrers] of prev.references) {
    if (!next.references.has(name)) referrers.forEach((r) => affected.add(r));
  }

  // 加上所有祖先：用新旧两份快照，覆盖「已删除节点」的情况
  const withAncestors = new Set(affected);
  for (const id of affected) {
    for (const a of [...(prevAncestors.get(id) ?? []), ...(nextAncestors.get(id) ?? [])]) {
      withAncestors.add(a);
    }
    // 若该节点所在的父容器 ID 已知，也一并加入
    for (const a of ancestorsInSnapshot(prevAncestors, id)) withAncestors.add(a);
  }

  return withAncestors;
}

export function createRenderer(ast: RootNode, options: RendererOptions = {}): Renderer {
  let currentAst = ast;
  const mode: RenderMode = options.mode ?? 'full';
  const editing: EditingMode = options.editing ?? 'full';
  const opts: RenderOptions = {
    includeIds: options.includeIds,
    includeNumbers: options.includeNumbers,
    includeChartData: options.includeChartData,
  };

  let numbers = computeNumbers(currentAst);
  let ancestors = buildAncestorMap(currentAst);
  let lastAffectedIds: string[] = [];

  /** 应用一次结构改动，并更新编号与祖先快照 */
  const applyChange = (changedIds: string[]): void => {
    const prev = numbers;
    const prevAncestors = ancestors;
    numbers = computeNumbers(currentAst);
    ancestors = buildAncestorMap(currentAst);
    if (mode === 'incremental') {
      lastAffectedIds = [
        ...computeAffected(currentAst, prev, numbers, changedIds, prevAncestors, ancestors),
      ];
    } else {
      lastAffectedIds = changedIds;
    }
  };

  return {
    toHtml() {
      // full 模式：每次都重算，保证与最新 AST 一致
      if (mode === 'full') {
        numbers = computeNumbers(currentAst);
        ancestors = buildAncestorMap(currentAst);
      }
      return renderRoot(currentAst, numbers, opts);
    },

    toHtmlOf(nodeId) {
      const node = findNode(currentAst, nodeId);
      if (!node) return null;
      return renderNode(node, numbers, opts);
    },

    getNumber(id) {
      return numbers.byNode.get(id);
    },

    resolveReference(name) {
      return numbers.nameToNode.get(name);
    },

    getReferrers(name) {
      return [...(numbers.references.get(name) ?? [])];
    },

    getEditability(nodeId) {
      const node = findNode(currentAst, nodeId);
      if (!node) return null;
      // 只读模式：整篇一律不可改，不逐块判断
      if (editing === 'readonly') {
        return {
          editable: false,
          mode: 'none',
          reason: '当前为只读模式',
        };
      }
      return editabilityOf(node);
    },

    update(nodeId, newNode) {
      const ok = replaceNode(currentAst, nodeId, newNode);
      if (ok) applyChange([nodeId]);
      return ok;
    },

    /**
     * 用多块替换一块
     *
     * 编辑框里可能写出多个块（例如原文 + `---`），
     * 保存时原来那一块要被拆成几块。
     */
    replaceWithMany(nodeId: string, newNodes: AnyNode[]) {
      const ok = replaceNodeWithMany(currentAst, nodeId, newNodes);
      if (ok) applyChange([nodeId, ...newNodes.map((n) => n.id)]);
      return ok;
    },

    insert(parentId, index, node) {
      const ok = insertNode(currentAst, parentId, index, node);
      if (ok) applyChange([node.id, parentId]);
      return ok;
    },

    remove(nodeId) {
      const ok = removeNode(currentAst, nodeId);
      if (ok) applyChange([nodeId]);
      return ok;
    },

    move(nodeId, newParentId, index) {
      const ok = moveNode(currentAst, nodeId, newParentId, index);
      if (ok) applyChange([nodeId, newParentId]);
      return ok;
    },

    setAst(next) {
      currentAst = next;
      numbers = computeNumbers(currentAst);
      ancestors = buildAncestorMap(currentAst);
      lastAffectedIds = [];
    },

    getAst() {
      return currentAst;
    },

    lastAffected() {
      return [...lastAffectedIds];
    },
  };
}

/** 一次性渲染（封装） */
export type { RenderOptions };

export function render(ast: RootNode, options: RenderOptions = {}): string {
  // 脚注编号需要整篇源码；不传时退化为按 AST 顺序
  const numbers = computeNumbers(ast, options.source, options.footnoteDefs);
  return renderRoot(ast, numbers, options);
}
