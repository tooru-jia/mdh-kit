/**
 * 编辑能力判定（FIX-4）
 *
 * 目的：第三层（编辑器 / 预览）在**动手改之前**就要知道「这个块能不能改」，
 * 而不是调用 update() 拿到 false 才知道。
 *
 * 作者要求：
 *   「第三层能不能改，需要取决于第二层。第二层一定要能告知。」
 *   「查看源代码这个，是不需要第二层告知的，是直接提供这个接口就可以。」
 *
 * ⚠️ 判定规则还在设计阶段。当前实现按「第二层掌握的结构规则」给出一份
 * 保守的判断，规则集中在 `BLOCK_EDIT_RULES` 里 —— 以后调整规则只改这张表，
 * 接口和调用方都不用动。
 */

import type { AnyNode } from '@mdh-kit/core';

/** 一个块的编辑能力 */
export interface Editability {
  /** 能不能改 */
  editable: boolean;
  /**
   * 怎么改。
   *
   * - `inline`：内容是可读文本，可以所见即所得地改（段落、标题、列表项）
   * - `source`：只能改源码 / 结构化数据（公式的 LaTeX、图表的数据行、代码块的内容）
   * - `none`   ：不能改
   *
   * 第三层据此决定双击时弹哪种编辑器。
   */
  mode: 'inline' | 'source' | 'none';
  /** 不能改的原因（editable = false 时有值） */
  reason?: string;
}

/**
 * 各类块的编辑规则
 *
 * 规则表是唯一真相：以后要调整「什么情况不能改」，只改这里。
 */
const BLOCK_EDIT_RULES: Record<string, Editability> = {
  // ---------- 可以直接改文字的块 ----------
  paragraph: { editable: true, mode: 'inline' },
  heading: { editable: true, mode: 'inline' },
  listItem: { editable: true, mode: 'inline' },
  quote: { editable: true, mode: 'inline' },

  // ---------- 结构性容器：能改结构，文字要看具体内容 ----------
  list: { editable: true, mode: 'source' },
  table: { editable: true, mode: 'source' },
  tableRow: { editable: true, mode: 'source' },
  column: { editable: true, mode: 'source' },

  // ---------- 只能改源码的叶子块 ----------
  code: { editable: true, mode: 'source' },
  math: { editable: true, mode: 'source' },
  chart: { editable: true, mode: 'source' },
  mermaid: { editable: true, mode: 'source' },

  // ---------- 版式结构：不是内容，不给编辑 ----------
  page: {
    editable: false,
    mode: 'none',
    reason: '页面形态由 @page 指令决定，请在源码中修改',
  },
  slide: {
    editable: false,
    mode: 'none',
    reason: '分页由 @next-slide 决定，请在源码中插入或删除分页指令',
  },

  // ---------- 根节点 ----------
  root: {
    editable: false,
    mode: 'none',
    reason: '根节点不是可编辑的内容块',
  },
};

/**
 * 查询某个节点能不能改
 *
 * @param node 节点（调用方负责先按 ID 找到它）
 * @returns Editability；节点不存在时调用方应返回 null
 */
export function editabilityOf(node: AnyNode): Editability {
  const any = node as any;

  // 无 ID 的节点（如 slides 的页面容器）没有定位坐标，改不了
  if (!node.id) {
    return {
      editable: false,
      mode: 'none',
      reason: '该节点没有 ID，无法定位，不能单独编辑',
    };
  }

  // 通用块（divider / toc / next-slide 等）按块名细分
  if (node.type === 'block') {
    const name: string = any.blockName;
    if (name === 'divider') {
      return {
        editable: false,
        mode: 'none',
        reason: '分割线没有内容，请在源码中增删',
      };
    }
    if (name === 'toc') {
      return {
        editable: false,
        mode: 'none',
        reason: '目录由标题树自动生成，不能直接编辑',
      };
    }
    return { editable: true, mode: 'source' };
  }

  const rule = BLOCK_EDIT_RULES[node.type];
  if (rule) return { ...rule };

  // 未知类型：保守处理 —— 当源码块
  return { editable: true, mode: 'source' };
}
