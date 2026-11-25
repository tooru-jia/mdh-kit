/**
 * 反向序列化：AST → .mdh 源码
 *
 * 设计原则：
 * - 与 parser 严格对称：parser 读什么，这里写什么
 * - 只输出语法规定的写法，不擅自优化格式
 * - 输出必须能被 parse 重新解析成等价的对象（往返测试保证）
 */

import type {
  AnyNode,
  BlockNode,
  ChartNode,
  CodeNode,
  ColumnNode,
  GenericBlockNode,
  HeadingNode,
  ListNode,
  ListItemNode,
  MathNode,
  MermaidNode,
  QuoteNode,
  PageNode,
  ParagraphNode,
  RootNode,
  SlideNode,
  TableNode,
  TableRowNode,
} from './parser/ast.ts';

/** 序列化选项 */
export interface SerializeOptions {
  /** 缩进字符，默认 Tab */
  indent?: string;
  /** 元信息键值对，写在文件开头 */
  meta?: Record<string, string>;
}

/** 把 AST 序列化为 .mdh 源码 */
export function serialize(ast: RootNode, options: SerializeOptions = {}): string {
  const indent = options.indent ?? '\t';
  const lines: string[] = [];

  // 元信息
  if (options.meta && Object.keys(options.meta).length > 0) {
    lines.push('===');
    for (const [k, v] of Object.entries(options.meta)) lines.push(`${k} = ${v}`);
    lines.push('===');
    lines.push('');
  }

  // page 声明（PageNode 不在 BlockNode 联合里，需显式断言）
  const page = ast.children.find((c) => (c as unknown as { type: string }).type === 'page') as
    | unknown as
    | PageNode
    | undefined;
  if (page) {
    lines.push(`@page(${page.preset})`);
    // @page 后的空行按首块自身的 blankBefore 决定（2026-11-22），
    // 不再硬编码一个空行 —— 否则 `@page(slides)\n# A` 这种紧接写法
    // 序列化后多出空行，二次解析就冒出一个 blankBefore=1。
    const firstSlideKids = (page.slides[0]?.children ?? []) as any[];
    const firstBlanks = Math.min(10, Math.max(0, Number(firstSlideKids[0]?.blankBefore ?? 0)));
    for (let k = 0; k < firstBlanks; k++) lines.push('');
    page.slides.forEach((slide, idx) => {
      if (idx > 0) {
        lines.push('@next-slide');
        // @next-slide 后的空行按本页首块的 blankBefore 决定，
        // 不硬编码 —— 与 @page 同理，保证往返一致。
        const kids0 = (slide.children ?? []) as any[];
        const nb = Math.min(10, Math.max(0, Number(kids0[0]?.blankBefore ?? 0)));
        for (let k = 0; k < nb; k++) lines.push('');
      }
      // 页内块的块间空行同样按下一块的 blankBefore 还原（2026-11-22），
      // 否则 `@next-slide\n# B` 这种无空行写法会被序列化成有空行。
      const kids = (slide.children ?? []) as any[];
      kids.forEach((child, ci) => {
        const seg = serializeBlock(child, indent, 0);
        const isLast = ci === kids.length - 1;
        if (!isLast) {
          while (seg.length > 0 && seg[seg.length - 1] === '') seg.pop();
          const next = kids[ci + 1];
          const blanks =
            next.type === 'paragraph' || next.type === 'heading' || next.type === 'list'
              ? Math.min(10, Math.max(0, Number(next.blankBefore ?? 0)))
              : 1;
          for (let k = 0; k < blanks; k++) seg.push('');
        }
        lines.push(...seg);
      });
    });
    return trimTrailingBlank(lines).join('\n') + '\n';
  }

  // 顶层块
  //
  // 空行统一在这里收口（2026-11-22）：
  // 每个 serializeXxx 末尾固定补一个 '' 作为块间分隔，但源码里的空行数
  // 由下一块的 blankBefore 决定。做法是——序列化第 i 块后，先砍掉它
  // 末尾的空行，再按第 i+1 块的 blankBefore 补回对应数量。
  //
  // 为什么不在各 serializeXxx 里做：那要改 10 处，且每处规则不同；
  // 在顶层统一收口，语义只有一处，也方便以后加新块类型。
  for (let idx = 0; idx < ast.children.length; idx++) {
    const node = ast.children[idx];
    const seg = serializeBlock(node, indent, 0);

    // 最后一块：保留它自己的结尾空行（由 trimTrailingBlank 统一收拾）
    const isLast = idx === ast.children.length - 1;
    if (!isLast) {
      // 砍掉本块尾部的空行（块间分隔），改由下一块的 blankBefore 决定
      while (seg.length > 0 && seg[seg.length - 1] === '') seg.pop();
      const next = ast.children[idx + 1] as any;
      // blankBefore 缺省 = 0 个空行（源码里两行紧挨）。必须精确还原，
      // 否则「# 一级\n## 二级」这类无空行写法会被序列化成有空行，
      // 二次解析就多出 blankBefore=1，往返不等价。
      const blanks = next.type === 'paragraph' || next.type === 'heading' || next.type === 'list'
        ? Math.min(10, Math.max(0, Number(next.blankBefore ?? 0)))
        : 1;
      for (let k = 0; k < blanks; k++) seg.push('');
    }
    lines.push(...seg);
  }

  return trimTrailingBlank(lines).join('\n') + '\n';
}

/** 移除末尾多余空行，保留恰好一个结尾换行（由调用方补） */
function trimTrailingBlank(lines: string[]): string[] {
  const out = [...lines];
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out;
}

const pad = (indent: string, depth: number) => indent.repeat(depth);

/** 页：@next-slide 切分，不给最后一页写标记 */
function serializeSlide(slide: SlideNode, indent: string, depth: number): string[] {
  const out: string[] = [];
  for (const child of slide.children) out.push(...serializeBlock(child, indent, depth));
  return out;
}

/** 序列化任意块 */
function serializeBlock(node: BlockNode, indent: string, depth: number): string[] {
  const ind = pad(indent, depth);
  switch (node.type) {
    case 'heading':
      return serializeHeading(node, ind);
    case 'paragraph':
      return serializeParagraph(node, ind);
    case 'list':
      return serializeList(node, indent, depth);
    case 'table':
      return serializeTable(node, indent, depth);
    case 'column':
      return serializeColumn(node, indent, depth);
    case 'math':
      return serializeMath(node, ind);
    case 'chart':
      return serializeChart(node, indent, depth);
    case 'mermaid':
      return serializeMermaid(node, ind);
    case 'code':
      return serializeCode(node, ind);
    case 'quote':
      return serializeQuote(node as QuoteNode, indent, depth);
    case 'block':
      return serializeGeneric(node, ind);
    default:
      return [];
  }
}

function headingMarker(level: number): string {
  return '#'.repeat(Math.min(6, Math.max(1, level)));
}

function serializeHeading(n: HeadingNode, ind: string): string[] {
  return [`${ind}${headingMarker(n.level)} ${n.text}`, ''];
}

function serializeParagraph(n: ParagraphNode, ind: string): string[] {
  return [...n.lines.map((l) => (l === '' ? '' : `${ind}${l}`)), ''];
}

/** 块头部：***块名(params) ref="值" caption="值" */
function blockHeader(
  name: string,
  params?: string[],
  opts: { name?: string; caption?: string } = {},
): string {
  let head = `***${name}`;
  if (params && params.length > 0) {
    head += `(${name === 'column' ? params.join('/') : params.join(',')})`;
  }
  if (opts.name) head += ` ref="${opts.name}"`;
  if (opts.caption) head += ` caption="${opts.caption}"`;
  return head;
}

function blockFooter(name: string, tag?: string): string {
  return tag ? `***${name}-${tag}-end` : `***${name}-end`;
}

function serializeList(n: ListNode, indent: string, depth: number): string[] {
  const ind = pad(indent, depth);
  const out: string[] = [];

  // 显式列表块才输出 ***list
  if (n.explicit) out.push(`${ind}${blockHeader('list', n.params, { name: n.name })}`);

  const childDepth = n.explicit ? depth + 1 : depth;
  const blocks = n.blocks ?? [];
  const itemStart = n.itemStart;

  // 块内没有非列表内容 → 直接顺序输出
  if (blocks.length === 0) {
    for (const item of n.children) out.push(...serializeListItem(item, indent, childDepth));
  } else {
    /*
     * 项与块交错输出（2026-11-25 修）
     *
     * 早先按 itemStart 一刀切成「块在前 / 块在后」，所有列表项挤在中间——
     * 于是「项一、表格、项二」被序列化成「项一、项二、表格」，
     * 往返之后结构就变了。
     *
     * 现在按位置交错：每个块插在「它的 pos 落在哪两项之间」的那个缺口里。
     */
    const itemPos = n.itemPos ?? [];
    const sorted = [...blocks].sort((x, y) => x.pos - y.pos);
    let bi = 0;

    // itemStart 之前的块
    const firstItemPos = itemPos[0] ?? itemStart ?? Number.MAX_SAFE_INTEGER;
    while (bi < sorted.length && sorted[bi].pos < firstItemPos) {
      out.push(...serializeBlock(sorted[bi].node as BlockNode, indent, childDepth));
      bi++;
    }

    for (let k = 0; k < n.children.length; k++) {
      out.push(...serializeListItem(n.children[k], indent, childDepth));
      // 插在「第 k 项之后、第 k+1 项之前」的块
      const nextItemAt = itemPos[k + 1] ?? Number.MAX_SAFE_INTEGER;
      while (bi < sorted.length && sorted[bi].pos < nextItemAt) {
        out.push(...serializeBlock(sorted[bi].node as BlockNode, indent, childDepth));
        bi++;
      }
    }

    // 最后一项之后的块
    while (bi < sorted.length) {
      out.push(...serializeBlock(sorted[bi].node as BlockNode, indent, childDepth));
      bi++;
    }
  }

  if (n.explicit) out.push(`${ind}${blockFooter('list')}`);
  out.push('');
  return out;
}

function serializeListItem(n: ListItemNode, indent: string, depth: number): string[] {
  const ind = pad(indent, depth);
  const out: string[] = [];

  // 有空行隔断时，项前补出对应数量的空行（块内才有意义）
  if (n.blankBefore) for (let k = 0; k < n.blankBefore; k++) out.push('');

  const first = n.lines[0] ?? '';
  // 任务列表优先；否则有序项补 "."，无序项用 "-"
  let marker: string;
  if (n.task !== undefined) marker = n.task ? '- [x]' : '- [ ]';
  else if (n.ordered) marker = `${n.marker}.`;
  else marker = '-';
  out.push(`${ind}${marker} ${first}`);

  // 补充行：缩进一层；按 lineBlanks 还原各自之前的空行
  const blanksOf = n.lineBlanks ?? [];
  n.lines.slice(1).forEach((extra, idx) => {
    const blanks = blanksOf[idx + 1] ?? 0;
    for (let k = 0; k < blanks; k++) out.push('');
    out.push(`${pad(indent, depth + 1)}${extra}`);
  });

  /*
   * 项内嵌的块（2026-11-25）
   *
   * 缩进写在某一项下面的 `***table` / 代码块 / 引用…… 解析时挂在
   * ListItemNode.blocks 上。序列化必须把它们吐回来，
   * 否则「往返」就丢内容 —— 表现就是编辑框里看不到这些源码。
   *
   * 缩进一层（depth + 1），和补充段对齐：读回来时仍然归属这一项。
   */
  for (const b of n.blocks ?? []) {
    if (b.node) out.push(...serializeBlock(b.node as BlockNode, indent, depth + 1));
  }

  // 子项
  for (const kid of n.children) out.push(...serializeListItem(kid, indent, depth + 1));

  return out;
}

function serializeTable(n: TableNode, indent: string, depth: number): string[] {
  const ind = pad(indent, depth);
  const inner = pad(indent, depth + 1);
  const out: string[] = [ind + blockHeader('table', undefined, { name: n.name, caption: n.caption })];

  for (const header of n.headers) out.push(`${inner}head: ${header.join(', ')}`);
  for (const row of n.rows) out.push(`${inner}- ${row.cells.map(escapeCell).join(', ')}`);

  out.push(ind + blockFooter('table'));
  out.push('');
  return out;
}

/** 单元格含逗号时用反引号包住（见 SYNTAX §14） */
function escapeCell(cell: string): string {
  return cell.includes(',') && !cell.includes('`') ? `\`${cell}\`` : cell;
}

function serializeColumn(n: ColumnNode, indent: string, depth: number): string[] {
  const ind = pad(indent, depth);
  const params = n.ratios.map((r) => `${r}fr`);
  const out: string[] = [ind + blockHeader('column', params, { name: n.name })];

  // 用 @next-column 分隔各栏；每栏内容由结构化块重建
  n.columnBlocks.forEach((blocks, idx) => {
    if (idx > 0) out.push(`${pad(indent, depth + 1)}@next-column`);
    for (const b of blocks) out.push(...serializeBlock(b, indent, depth + 1));
  });

  out.push(ind + blockFooter('column'));
  out.push('');
  return out;
}

/**
 * 公式块：内容原样输出
 *
 * 不给内容加缩进——解析时 buildMath 用 `l.raw` 保留了原始缩进，
 * 序列化再加一层，往返就不一致了。块头块尾用 ind，内容用原样。
 */
function serializeMath(n: MathNode, ind: string): string[] {
  const out: string[] = [
    ind + blockHeader('math', undefined, { name: n.name, caption: n.caption }),
  ];
  for (const line of n.latex.split('\n')) out.push(line);
  out.push(ind + blockFooter('math'));
  out.push('');
  return out;
}

function serializeChart(n: ChartNode, indent: string, depth: number): string[] {
  const ind = pad(indent, depth);
  const inner = pad(indent, depth + 1);
  const out: string[] = [
    ind + blockHeader('chart', [n.chartType], { name: n.name, caption: n.caption }),
  ];
  if (n.headers.length > 0) out.push(`${inner}head: ${n.headers.join(', ')}`);
  for (const row of n.rows) out.push(`${inner}- ${row.map(escapeCell).join(', ')}`);
  out.push(ind + blockFooter('chart'));
  out.push('');
  return out;
}

/**
 * 引用块：内部块先序列化，再给每行加 `>` 前缀
 *
 * 块与块之间保留空行（`>` 单独一行）——否则相邻段落会被合并。
 * 连续两个空行要压成一个，避免 return 时多出一行。
 */
function serializeQuote(n: QuoteNode, indent: string, depth: number): string[] {
  const inner: string[] = [];
  for (const child of n.children ?? []) {
    const lines = serializeBlock(child, indent, 0);
    inner.push(...lines);
  }

  // 压掉连续空行（serializeBlock 每块结尾本来就带一个空行）
  const compact: string[] = [];
  for (const l of inner) {
    if (l === '' && compact[compact.length - 1] === '') continue;
    compact.push(l);
  }
  while (compact.length > 0 && compact[compact.length - 1] === '') compact.pop();

  const ind = pad(indent, depth);
  const out = compact.map((l) => (l === '' ? `${ind}>` : `${ind}> ${l}`));
  out.push('');
  return out;
}

function serializeMermaid(n: MermaidNode, ind: string): string[] {
  const out: string[] = [
    ind + blockHeader('mermaid', undefined, { name: n.name, caption: n.caption }),
  ];
  // 内容原样输出，不加缩进（见 serializeMath 的说明）
  for (const line of n.source.split('\n')) out.push(line);
  out.push(ind + blockFooter('mermaid'));
  out.push('');
  return out;
}

function serializeCode(n: CodeNode, ind: string): string[] {
  const info = [n.lang ?? '', n.title ? `title="${n.title}"` : ''].filter(Boolean).join(' ');
  /*
   * 代码内容**逐字输出**，不加 ind（2026-11-25）
   *
   * 解析层对代码内容是 verbatim 的（`body.push(l.raw)`，不剥缩进）——
   * 缩进在代码里是**语义的一部分**，不能被排版逻辑改写。
   *
   * 所以序列化也绝不能给它加/减缩进：一旦加了，二次解析会把那层 `\t`
   * 当成代码内容的一部分收进去，往返就多出缩进（曾经的真实 bug）。
   * ind 只作用于 fence 行，让代码块在源码里看起来对齐；内容保持原样。
   */
  const out: string[] = [`${ind}\`\`\`${info}`];
  for (const line of n.content.split('\n')) out.push(line);
  out.push(`${ind}\`\`\``, '');
  return out;
}

function serializeGeneric(n: GenericBlockNode, ind: string): string[] {
  // 分割线
  if (n.blockName === 'divider') return [`${ind}---`, ''];
  // 目录
  if (n.blockName === 'toc') return [`${ind}@toc`, ''];
  // 多行 HTML（V8）：原样输出，不加块头块尾
  if (n.blockName === 'html') {
    return [...n.lines.map((l) => ind + l), ''];
  }
  // 引用：用 `>` 行前缀，不用块
  if (n.blockName === 'quote') {
    return [...n.lines.map((l) => (l === '' ? `${ind}>` : `${ind}> ${l}`)), ''];
  }
  // 其它块：原样输出块头 + 内容 + 块尾
  const out: string[] = [ind + blockHeader(n.blockName, n.params, { name: n.name })];
  for (const line of n.lines) out.push(`${pad(ind, 1)}${line}`);
  out.push(ind + blockFooter(n.blockName, n.name));
  out.push('');
  return out;
}

/**
 * 单个节点 → mdh 源码
 *
 * 用于「编辑某一块」：把节点还原成源码交给用户改，改完再 parseNode 回来。
 *
 * 注意：块内细节（表格行、列表项）单独序列化时**不含父级上下文**，
 * 解析回来可能变义（例如表格行会被当成列表项）。因此可编辑单位建议为顶层块。
 */
export function serializeNode(node: AnyNode): string {
  // 内部节点（列表项、表格行）有各自的序列化方式
  if (node.type === 'listItem') {
    return serializeListItem(node as ListItemNode, '\t', 0)
      .filter((l) => l !== '')
      .join('\n')
      .replace(/^\n+/, '');
  }
  if (node.type === 'tableRow') {
    const cells = (node as TableRowNode).cells ?? [];
    return `- ${cells.map(escapeCell).join(', ')}`;
  }

  const lines = serializeBlock(node as BlockNode, '\t', 0);
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

export type { AnyNode };
