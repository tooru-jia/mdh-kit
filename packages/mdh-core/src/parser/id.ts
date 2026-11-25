/**
 * 对象 ID —— **整篇只在这里编号一次**
 *
 * ── 解耦 ──
 *
 * 嵌套由语法决定（缩进、`***list` 包裹、容器切割），解析器只负责建树。
 * 编号由这里统一遍历一次算出，解析阶段完全不碰 ID。
 *
 * 两件事分开之后：加新语法不用改编号代码；slides 切页只是树的变形，
 * 不需要「解析时编过一遍、合并时再重编一遍」。
 *
 * ── 规则 ──
 *
 * 从根往下走，看**父节点是什么类型**决定自己怎么排：
 *
 *   父是**声明型**（`***list`、`***column`、slides 的页）
 *     → 与父**同段号**，接着父的序号往下排
 *          list M1 → 项 M2、M3
 *
 *   父是**内容型**（`***table`、引用、`***math`…）
 *     → **加一段**，新段从 1 开始
 *          table M1 → 行 M1-N1
 *
 * 裸列表的分组节点不占号，它的项直接排到 list 的父级。
 *
 * ── 层数 ──
 *
 * 层数 = ID 的段数。只有「加一段」时才 +1，所以声明型块的内容
 * 不会让层数变深。嵌套上限（3 层）也按这个判。
 */

/** 层深 → 字母：1→M、2→N、3→O、4→P… */
const letterOf = (depth: number): string => {
  if (depth <= 1) return 'M';
  if (depth === 2) return 'N';
  if (depth === 3) return 'O';
  return String.fromCharCode('P'.charCodeAt(0) + depth - 4);
};

/** 从 ID 推断层深（= 段数） */
export function idDepth(id: string): number {
  if (!id) return 1;
  const segs = id.split('-').filter((s) => /^[A-Z]\d+$/.test(s));
  return segs.length === 0 ? 1 : segs.length;
}

/** 取父节点 ID（去掉最后一段） */
export function parentOf(id: string): string | undefined {
  const idx = id.lastIndexOf('-');
  return idx < 0 ? undefined : id.slice(0, idx);
}

/** 文档里参与编号的节点（结构化最小子集） */
export interface IdNode {
  type?: string;
  id?: string;
  explicit?: boolean;
  children?: IdNode[];
  blocks?: Array<{ node?: IdNode; pos?: number }>;
  /** 每个列表项的源行下标，与 `children` 一一对应（供编号时按源码顺序排序） */
  itemPos?: number[];
  columnBlocks?: IdNode[][];
  columnIds?: string[];
  rows?: Array<{ id?: string; cellIds?: string[] }>;
  slides?: IdNode[];
}

/**
 * 编号计数器：每个父级一套
 *
 * ── 超过 3 段怎么办 ──
 *
 * 只有 M / N / O 三段。第 4 层起不再加段，序号**回落到同一个 O 池**继续排：
 *
 *   M2-N1          ← 第 2 段父
 *     O1           ← 第 3 层
 *       O2         ← 第 4 层（不是 P1）
 *         O3       ← 第 5 层
 *
 * 池的归属是「最近的那个两段父」——`M2-N1` 下所有深层节点共用 `M2-N1-O` 前缀。
 * 这样 ID 最多 3 段，且全局唯一。
 */
class Allocator {
  private seq = new Map<string, number>();

  next(parentId: string | undefined): string {
    /*
     * 父已到 3 段 → 子节点回落到同一个 O 池。
     *
     * 池的 key 就是两段父本身（`M2-N1`）。因为「第 3 段」和「第 4 段以后」
     * 用的是同一个计数器，序号天然接着排，不会撞号。
     */
    const depth = parentId ? idDepth(parentId) : 0;
    const poolParent = depth >= 3 ? truncateTo2(parentId!) : parentId;

    const key = poolParent ?? '';
    const n = (this.seq.get(key) ?? 0) + 1;
    this.seq.set(key, n);

    const segDepth = poolParent ? idDepth(poolParent) + 1 : 1;
    const seg = `${letterOf(segDepth)}${n}`;
    return poolParent ? `${poolParent}-${seg}` : seg;
  }
}

/** 截到前两段：`M2-N1-O3` → `M2-N1` */
function truncateTo2(id: string): string {
  const segs = id.split('-');
  return segs.slice(0, 2).join('-');
}

/** 声明型：内容与它平级，不加深一层 */
const isDeclarative = (node: IdNode): boolean =>
  (node.type === 'list' && node.explicit === true) ||
  node.type === 'column' ||
  node.type === 'slide';

/**
 * 给整棵树分配 ID（**唯一入口**）
 *
 * 解析器建完树后调用一次，之后不再改动任何 ID。
 */
export function assignIds(root: IdNode): void {
  const alloc = new Allocator();
  root.id = 'R';

  for (const child of root.children ?? []) {
    // slides 的页容器：`@page` 只是声明，容器自己占一个号
    if (child.type === 'page' && child.slides?.length) {
      const pageId = alloc.next(undefined);
      child.id = pageId;
      for (const slide of child.slides) {
        slide.id = alloc.next(undefined);
        for (const c of slide.children ?? []) assignNode(alloc, c, slide.id);
      }
      continue;
    }
    assignNode(alloc, child, undefined);
  }
  for (const b of root.blocks ?? []) if (b?.node) assignNode(alloc, b.node, undefined);
}

/**
 * slides：页块占一个号，页内内容挂在页下
 *
 *   @page(slides)  M1（容器，不挂 ID）
 *     slide        M2
 *       标题        M2-N1
 */
function assignSlides(alloc: Allocator, page: IdNode, parentId: string | undefined): void {
  for (const slide of page.slides ?? []) {
    slide.id = alloc.next(parentId);
    for (const child of slide.children ?? []) assignNode(alloc, child, slide.id);
  }
}

/** 给单个节点编号，再递归它的子树 */
function assignNode(alloc: Allocator, node: IdNode, parentId: string | undefined): void {
  /*
   * 裸列表：分组节点**不占号**，项直接排到父级。
   *
   * 节点自身 id 留空（schema 允许空串表示「不占 ID」）——
   * 它只是个分组容器，渲染时和首项一体，不是独立位置。
   */
  if (node.type === 'list' && node.explicit !== true) {
    assignListContent(alloc, node, parentId);
    node.id = '';
    return;
  }

  const id = alloc.next(parentId);
  node.id = id;

  // 表格行：内容型，行进表格下一层（chart 的 rows 是纯数据，不加 ID）
  if (node.type === 'table') {
    for (const row of node.rows ?? []) {
      row.id = alloc.next(id);
      row.cellIds = [];
    }
  }

  // 分栏：栏与分栏**平级**，栏内内容挂在栏下
  if (Array.isArray(node.columnBlocks)) {
    const colIds: string[] = [];
    for (const col of node.columnBlocks) {
      if (!Array.isArray(col)) continue;
      const colId = alloc.next(parentId);
      colIds.push(colId);
      for (const child of col) assignNode(alloc, child, colId);
    }
    node.columnIds = colIds;
    return;
  }

  /*
   * 列表：项与 list **平级**。
   *
   *   显式 `***list`：声明已在上面占过号，项排到它的父级 → M1、M2 之后是 M2、M3
   *   裸列表：上面那个分支已处理，走不到这里
   */
  if (node.type === 'list') {
    assignListContent(alloc, node, parentId);
    return;
  }

  // 普通节点：子节点挂在它下面（加一段）
  for (const child of node.children ?? []) assignNode(alloc, child, id);
  for (const b of node.blocks ?? []) if (b?.node) assignNode(alloc, b.node, id);
}

/**
 * 列表内容的编号：**按源码顺序**交错排项和块
 *
 * 列表的 `children`（列表项）和 `blocks`（夹在项之间的块）在 AST 里是
 * 两个数组，但源码里是交错的：
 *
 *     ***list
 *     - 项一        ← children[0]
 *     ***table      ← blocks[0]（夹在中间）
 *     - 项二        ← children[1]
 *
 * 直接「先全部项、再全部块」会让 table 排到项二之后，
 * 编号顺序和页面呈现不一致。所以要按源行位置合并后再排。
 *
 * 位置来源：`itemPos[i]` 是第 i 项的源下标，`blocks[k].pos` 是块的源下标。
 */
function assignListContent(alloc: Allocator, node: IdNode, parentId: string | undefined): void {
  const kids = node.children ?? [];
  const blocks = (node.blocks ?? []).filter((b) => b?.node);
  const itemPos = node.itemPos ?? [];

  // 没有交错信息 → 保持原顺序（项在前、块在后）
  if (blocks.length === 0 || itemPos.length !== kids.length) {
    for (const item of kids) assignNode(alloc, item, parentId);
    for (const b of blocks) assignNode(alloc, b.node!, parentId);
    return;
  }

  const merged: Array<{ at: number; node: IdNode }> = [
    ...kids.map((c, i) => ({ at: itemPos[i] ?? Number.MAX_SAFE_INTEGER, node: c })),
    ...blocks.map((b) => ({ at: (b as { pos?: number }).pos ?? Number.MAX_SAFE_INTEGER, node: b.node! })),
  ].sort((a, b) => a.at - b.at);

  for (const m of merged) assignNode(alloc, m.node, parentId);
}
