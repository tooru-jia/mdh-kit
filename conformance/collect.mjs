/**
 * 从 AST 里按文档顺序收集所有 ID
 *
 * generate.mjs（填期望值）和 run.mjs（校验）必须用**同一份**逻辑，
 * 否则两边对「什么是 ID 序列」的理解会悄悄分叉，
 * 校验就变成拿着不同尺子量同一根木头。
 */

/** 递归收集所有 ID（按文档顺序，含 root） */
export function collectIds(node, out = []) {
  if (!node) return out;

  /*
   * 裸列表的分组节点不占位（2026-11-25）
   *
   * `***list` 是声明型：声明占一号，项是平级的下一段。
   * 裸列表（不写 `***list`）没有声明可言，**「组」这一层不该存在** ——
   * 它的 list 节点只是分组容器，id 沿用首项 ID，不该再算一个独立位置。
   *
   * 所以裸列表只收集 children，不记自己的 id。
   * 项和块的交错顺序仍按下面的 itemPos 合并规则处理。
   */
  const isBareList = node.type === 'list' && node.explicit === false;
  if (node.id && !isBareList) out.push(node.id);

  /*
   * `***list` 的 children（列表项）与 blocks（项间夹的块）在源码里交错，
   * ID 又共用同一个序号空间（项 M2、块 M3、项 M4）。
   * 所以两者要按出现顺序合并 —— 先 children 后 blocks 会走出 M2, M4, M3。
   */
  const kids = Array.isArray(node.children) ? node.children : null;
  const blocks = Array.isArray(node.blocks) ? node.blocks : null;
  const itemPos = Array.isArray(node.itemPos) ? node.itemPos : null;

  if (kids && blocks && blocks.length > 0 && itemPos) {
    const merged = [
      ...kids.map((c, i) => ({ at: itemPos[i] ?? Number.MAX_SAFE_INTEGER, c })),
      ...blocks.map((b) => ({ at: b.pos, c: b.node })),
    ].sort((a, b) => a.at - b.at);
    for (const m of merged) if (m.c && m.c.type) collectIds(m.c, out);
  } else {
    for (const c of kids ?? []) if (c && c.type) collectIds(c, out);
    for (const b of blocks ?? []) if (b && b.node && b.node.type) collectIds(b.node, out);
  }

  for (const list of [node.rows, node.slides]) {
    if (Array.isArray(list)) for (const c of list) if (c && c.type) collectIds(c, out);
  }
  if (Array.isArray(node.columnBlocks)) {
    for (const chunk of node.columnBlocks) {
      if (Array.isArray(chunk)) for (const c of chunk) if (c && c.type) collectIds(c, out);
    }
  }
  return out;
}
