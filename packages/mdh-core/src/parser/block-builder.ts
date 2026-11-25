/**
 * 结构构建：把分类后的行构建成 AST
 *
 * 依赖两条规则（见 SYNTAX.md）：
 * - 缩进：比上一行多 = 子层；相同 = 同层；少 = 回到父层
 * - 块：***块名 … ***块名-end 成对，内容靠块边界归属（不强制缩进）
 */

import type {
  BlockNode,
  ChartNode,
  ColumnNode,
  CodeNode,
  Diagnostic,
  GenericBlockNode,
  HeadingNode,
  ListItemNode,
  ListNode,
  MathNode,
  MermaidNode,
  PageNode,
  QuoteNode,
  ParagraphNode,
  ParseResult,
  RootNode,
  SlideNode,
  TableNode,
  TableRowNode,
} from './ast.ts';
import { classifyLine, classifyLines, type ParsedLine } from './line-parser.ts';
import { assignIds, idDepth, parentOf, type IdNode } from './id.ts';

/** 内容摘要：取前 30 字 */
const brief = (text: string, max = 30): string => {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
};

/**
 * 引用嵌套上限（层）
 *
 * SYNTAX.md：引用最多两层。第三层及更深的多余 `>` 当普通文字，
 * 不再生成新的 blockquote——避免无限嵌套把版面挤成一条缝。
 */
const MAX_QUOTE_DEPTH = 2;

/**
 * 块嵌套总深度上限（SYNTAX.md §四「嵌套规则」）
 *
 * 按 ID 段数计：`M1` 第 1 层、`M1-N1` 第 2 层、`M1-N1-O1` 第 3 层。
 * 第 4 层起整块降级为普通文本 —— 内容照常显示，但不再解析成块。
 */
const MAX_BLOCK_DEPTH = 3;

/** 逗号分列：反引号内的逗号不分列 */
function splitCells(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inCode = false;
  for (const ch of line) {
    if (ch === '`') inCode = !inCode;
    if (ch === ',' && !inCode) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** 解析 fr 参数：['1fr','2fr'] → [1, 2] */
const parseRatios = (params: string[]): number[] =>
  params.map((p) => Number.parseFloat(p.replace(/fr$/, '')) || 1);

class Builder {
  private diagnostics: Diagnostic[] = [];
  /**
   * 显式声明的 `***list` 的 ID 集合
   *
   * 显式 list 是**声明型**：它自己占一个号，列表项是平级的下一段。
   * 裸列表不是声明型，列表项直接是调用方的子集。
   */
  private explicitLists = new Set<string>();

  /**
   * 列表项的取号父节点
   *
   * 显式 `***list`（声明型）→ 用 list 的**父**，项与声明平级；
   * 裸列表 → 返回 undefined，由调用方给。
   */
  private listItemParent(listId: string): string | undefined {
    return this.explicitLists.has(listId) ? parentOf(listId) : undefined;
  }

  /**
   * 再加一层会不会超过嵌套上限
   *
   * 只看当前深度，与 ID 无关 —— 编号已和嵌套解耦（2026-11-25）。
   */
  private wouldExceedDepth(depth: number): boolean {
    return depth > MAX_BLOCK_DEPTH;
  }

  /** 把整块读成纯文本行（超限降级用）：丢掉 `***xxx` 标记，只留内容 */
  private blockAsPlainText(lines: ParsedLine[], start: number): string[] {
    const out: string[] = [];
    const name = lines[start]?.blockName ?? '';
    for (let i = start + 1; i < lines.length; i++) {
      const l = lines[i];
      if (l.kind === 'blockEnd' && l.blockName === name) break;
      if (l.kind === 'blockStart' || l.kind === 'blockEnd') continue;
      const c = l.content.trim();
      if (c) out.push(c);
    }
    return out;
  }

  /** 跳过从 `start` 开始的整个块（含同名嵌套），返回块之后的下标 */
  private skipBlock(lines: ParsedLine[], start: number): number {
    const name = lines[start]?.blockName ?? '';
    let depth = 1;
    for (let i = start + 1; i < lines.length; i++) {
      const l = lines[i];
      if (l.kind === 'blockStart' && l.blockName === name) depth++;
      else if (l.kind === 'blockEnd' && l.blockName === name && --depth === 0) return i + 1;
    }
    return lines.length;
  }

  /** 整篇呈现预设：由 @page(...) 声明，默认 html */
  private preset = 'html';
  /** 文档元信息（=== 区块内的键值对），只描述文档，不参与渲染 */
  private meta: Record<string, string> = {};

  build(lines: ParsedLine[]): ParseResult {
    // 元信息区块（=== … ===）不参与正文渲染，但键值对保留在 meta 上
    lines = this.stripFrontmatter(lines);

    // 预扫：@page(...) 是整篇声明，不是块，先收集（不参与块结构）
    for (const l of lines) {
      if (l.kind === 'directive' && l.directive === 'page') {
        this.preset = l.params?.[0] ?? 'slides';
        break;
      }
    }

    const root: RootNode = {
      type: 'root',
      // DECISION-3：根节点不属于任何内容层，用 R 标记（原来是 O0）
      id: 'R',
      description: '文档根节点',
      children: [],
    };

    let i = 0;
    /**
     * 上一个块之后累计了几个空行
     *
     * 作者 2026-11-21：空行是 mdh 的设计理念之一——**源码怎么写就怎么呈现**。
     * 用户多年的视觉直觉不该被「程序员算数」改写，所以空行数要如实保留到渲染层。
     * 段落是唯一消费它的节点（空行只在段与段之间有意义）。
     */
    let pendingBlanks = 0;
    while (i < lines.length) {
      const line = lines[i];
      // 本轮的起始空行数：无论走哪个分支，进入时都要取走并清零，
      // 避免空行「跨块」累加到后面的段落上
      const blanksHere = pendingBlanks;
      pendingBlanks = 0;

      // 跳过：空行、注释、未知块整段
      if (line.kind === 'blank') {
        pendingBlanks = blanksHere + 1;
        i++;
        continue;
      }
      if (line.kind === 'comment') {
        pendingBlanks = blanksHere;
        i++;
        continue;
      }
      if (line.kind === 'unknownBlock') {
        // 认不得的块名：**不报错，但内容必须保住**。
        //
        // 早先这里是个空循环 —— 整段直接跳过、什么都不产出，
        // 用户写了 `***unknownblock ... ***unknownblock-end` 就整段消失。
        // 这与「宽松解析」冲突：SYNTAX.md 说的是「认不得的块名不报错」，
        // 不是「可以吞掉内容」。
        //
        // 现在的处理：把块内的行当普通正文收集，渲染成段落。
        // 块标记行本身丢掉（它们是无法识别的语法），内容留着。
        const tag = line.blockName;
        i++;
        const orphanLines: string[] = [];
        while (i < lines.length) {
          const l = lines[i++];
          if (l.kind === 'unknownBlock' && l.blockName === tag) break;
          // 空行原样保留，让段落边界和原文一致
          orphanLines.push(l.kind === 'blank' ? '' : l.raw);
        }
        const text = orphanLines.join('\n').replace(/^\n+|\n+$/g, '');
        if (text.trim()) {
          root.children.push({
            type: 'paragraph',
            id: '',
            description: brief(text),
            lines: text.split('\n'),
            ...(blanksHere > 0 ? { blankBefore: blanksHere } : {}),
          } satisfies ParagraphNode);
        }
        continue;
      }

      // 块
      if (line.kind === 'blockStart') {
        /*
         * slides 模式下，顶层内容会被装进「页」里 —— 页本身占一层。
         *
         * 所以深度基准从 2 起算，和文档流保持一致的**内容嵌套层数**：
         * 同一个结构，写不写 `@page(slides)`，深度判断结果一样。
         */
        const baseDepth = this.preset.startsWith('slides') ? 2 : 1;
        const { node, next } = this.collectBlock(lines, i, undefined, baseDepth);
        if (node) root.children.push(node);
        i = next;
        continue;
      }

      // 文档级指令：@page 已在预扫处理；@toc 作为占位块；@next-* 由容器收集
      if (line.kind === 'directive') {
        if (line.directive === 'toc') {
          root.children.push({
            type: 'block',
            id: '',
            description: '目录',
            blockName: 'toc',
            params: [],
            lines: [],
          } satisfies GenericBlockNode);
        } else if (line.directive === 'next-slide') {
          // 用占位块记录切页位置，构建完成后由 splitIntoSlides 切成页
          root.children.push({
            type: 'block',
            id: '',
            description: '分页',
            blockName: 'next-slide',
            params: [],
            lines: [],
          } satisfies GenericBlockNode);
        } else if (line.directive === 'next-column') {
          this.diagnostics.push({
            level: 'warning',
            message: '@next-column 出现在 column 之外，已忽略',
            line: line.no,
          });
        }
        i++;
        continue;
      }

      // 孤立的块结束
      if (line.kind === 'blockEnd') {
        this.diagnostics.push({
          level: 'warning',
          message: `多余的块结束标记 ***${line.blockName}-end`,
          line: line.no,
        });
        i++;
        continue;
      }

      // 代码块
      if (line.kind === 'codeFenceStart') {
        const { node, next } = this.collectCode(lines, i);
        root.children.push(node);
        i = next;
        continue;
      }

      // 标题
      if (line.kind === 'heading') {
        const text = line.marker ?? '';
        root.children.push({
          type: 'heading',
          id: '',
          description: brief(text),
          level: line.level ?? 1,
          text,
          // 空行如实保留：标题之间空几行，渲染后也空几行（2026-11-22）
          ...(blanksHere > 0 ? { blankBefore: blanksHere } : {}),
        } satisfies HeadingNode);
        i++;
        continue;
      }

      // 列表
      if (line.kind === 'listItem') {
        /*
         * 裸列表**不占号**：没有声明，项直接挂在文档顶层（M1、M2…）。
         *
         * 分组节点只是容器，id 沿用首项 ID —— 它和首项在渲染时是一体的，
         * 不该单独占一个位置。
         */
        const { items, next } = this.collectItems(lines, i, undefined, false, undefined, 1);
        const node: ListNode = {
          type: 'list',
          id: items[0]?.id ?? '',
          description: '列表',
          explicit: false,
          params: [],
          children: items,
          // 空行如实保留：正文/标题后空几行再接列表，渲染后也空几行（2026-11-22）
          ...(blanksHere > 0 ? { blankBefore: blanksHere } : {}),
        };
        root.children.push(node);
        i = next;
        continue;
      }

      // 分割线
      // HTML 块（V8）：连续的标签行 + 中间的内容，原样输出成一个 html 节点
      //
      // 判据：遇到 `<details>` / `<div>` 这类**开始标签**，一直读到配对的结束标签。
      // 中间的空行和文字都保留，不按段落切分。
      if (line.kind === 'htmlTag' && !/^<\s*\//.test(line.content) && !/\/>$/.test(line.content)) {
        const tagName = line.content.match(/^<\s*([a-zA-Z][a-zA-Z0-9-]*)/)?.[1] ?? '';
        const body: string[] = [];
        let j = i;
        let depth = 1;
        while (j < lines.length && depth > 0) {
          const cur = lines[j];
          const text = cur.content ?? '';
          const openRe = new RegExp(`<${tagName}(?=[\\s>/])`, 'gi');
          const closeRe = new RegExp(`</${tagName}\\s*>`, 'gi');
          if (j > i) {
            depth += (text.match(openRe) ?? []).length;
            depth -= (text.match(closeRe) ?? []).length;
          }
          body.push(text);
          j++;
          if (depth <= 0) break;
        }
        root.children.push({
          type: 'block',
          id: '',
          description: brief(body[0] ?? 'HTML'),
          blockName: 'html',
          params: [],
          lines: body,
        } satisfies GenericBlockNode);
        i = j;
        continue;
      }

      if (line.kind === 'divider') {
        root.children.push({
          type: 'block',
          id: '',
          description: '分割线',
          blockName: 'divider',
          params: [],
          lines: [],
        } satisfies GenericBlockNode);
        i++;
        continue;
      }

      // 引用：内部继续走行分类与块构建（支持列表、代码块、表格等）
      if (line.kind === 'quote') {
        const quoteLines: string[] = [];
        const start = i;
        while (i < lines.length && lines[i].kind === 'quote') {
          quoteLines.push(lines[i].marker ?? '');
          i++;
        }
        // 把引用内的内容还原成普通行，重新分类
        const innerLines = this.reclassifyQuoteBody(lines.slice(start, i));
        const quoteId = '';
        root.children.push({
          type: 'quote',
          id: quoteId,
          description: brief(quoteLines.join(' ')),
          // 这里已经是第 1 层引用，把 quoteDepth 传 1，
          // 里面的 `>>` 才知道自己是第 2 层（超过 2 层就降级成正文）
          //
          // 引用是**内容型**：内容进引用的下一层（M1 → M1-N1）。
          // 深度基准同 blockStart：slides 模式多一层页。
          children: this.buildNestedBlocks(
            innerLines,
            quoteId,
            false,
            1,
            this.preset.startsWith('slides') ? 3 : 2,
          ),
        } satisfies QuoteNode);
        continue;
      }

      // 段落
      const paraLines: string[] = [];
      while (i < lines.length && lines[i].kind === 'text') {
        paraLines.push(lines[i].content);
        i++;
      }
      if (paraLines.length > 0) {
        root.children.push({
          type: 'paragraph',
          id: '',
          description: brief(paraLines.join(' ')),
          lines: paraLines,
          ...(blanksHere > 0 ? { blankBefore: blanksHere } : {}),
        } satisfies ParagraphNode);
        continue;
      }

      i++;
    }

    // @page(slides)：整篇是 slides，按 @next-slide 把 root.children 切成页
    if (this.preset.startsWith('slides')) {
      // FIX-3：页面容器不占 ID（@page 是文档级指令，不是块）。
      // 页是顶层块 M1、M2…，页内内容是页的下一层 M1-N1、M1-N2…
      const page: PageNode = {
        type: 'page',
        id: '',
        description: `页面（${this.preset}）`,
        preset: this.preset,
        slides: [],
        children: [],
      };
      page.slides = this.splitIntoSlides(root.children);
      root.children = [page as unknown as BlockNode];
    } else {
      // 非 slides 文档：@next-slide 无意义，占位块不能残留（BUG-7）
      //
      // 之前的实现只在 slides 模式下消费这些占位块，
      // 普通文档里它们会落到通用块渲染路径，产出一个空的 <pre>。
      const before = root.children.length;
      root.children = root.children.filter(
        (n) => !(n.type === 'block' && (n as GenericBlockNode).blockName === 'next-slide'),
      );
      if (root.children.length !== before) {
        this.diagnostics.push({
          level: 'warning',
          message: '@next-slide 出现在非 slides 文档，已忽略',
          line: 0,
        });
      }
    }

    /*
     * ── 统一编号 ──
     *
     * 到这里树已经建完（包括 slides 切页、分栏）、结构全部定形。
     * 编号只在这一处发生：遍历一次，按**节点类型 + 层深**统一分配。
     *
     * 之前是「解析时边算边编号」，于是 slides 切页时要再重编一遍，
     * 两套逻辑必须时时同步 —— 漏一处就出现 4、5 段的 ID（2026-11-25 重构）。
     */
    assignIds(root as unknown as IdNode);

    return { ast: root, diagnostics: this.diagnostics, meta: this.meta };
  }

  /**
   * 移除元信息区块（=== … ===）。
   * 元信息只描述文档，不参与渲染；未闭合时到文件末尾为止。
   */
  private stripFrontmatter(lines: ParsedLine[]): ParsedLine[] {
    const out: ParsedLine[] = [];
    let inside = false;
    for (const l of lines) {
      if (l.kind === 'frontmatterDelim') {
        inside = !inside;
        continue;
      }
      if (inside) {
        const m = l.content.match(/^\s*([A-Za-z_][\w-]*)\s*=\s*(.*)$/);
        if (m) this.meta[m[1]] = m[2].trim();
        continue;
      }
      out.push(l);
    }
    return out;
  }

  /**
   * 把已构建的顶层块按 @next-slide 标记切成多页（FIX-3）
   *
   * 页是顶层块，ID 是 M1、M2…；页内内容是页的下一层，ID 是 M1-N1、M1-N2…
   *
   * 注意：页内块在构建阶段已经拿到了全局 ID，这里要**按页重新编号**，
   * 否则会出现「第 2 页的标题叫 M3、第 1 页的标题叫 M1」这种看不出归属的情况。
   */
  private splitIntoSlides(children: BlockNode[]): SlideNode[] {
    const groups: BlockNode[][] = [[]];
    for (const node of children) {
      if (node.type === 'block' && (node as GenericBlockNode).blockName === 'next-slide') {
        groups.push([]);
        continue;
      }
      groups[groups.length - 1].push(node);
    }

    const kept = groups.filter((g) => g.length > 0);

    /*
     * 切页只是**结构操作** —— 编号统一交给 assignIds（2026-11-25）。
     *
     * 早先这里自己重编一遍号（renumber + counter），于是「解析时编过一次、
     * 切页时再编一次」，两套逻辑必须时时同步，漏一处就出现 4、5 段的 ID。
     *
     *   @page(slides)   M1（容器）
     *     slide          M2
     *       标题          M2-N1
     */
    return kept.map((g, idx) => ({
      type: 'slide' as const,
      id: '',
      description: `第 ${idx + 1} 页`,
      index: idx + 1,
      children: g,
      lines: g.flatMap((n) =>
        'lines' in n ? (((n as unknown as { lines?: string[] }).lines ?? []) as string[]) : [],
      ),
    }));
  }

  /** 收集代码块：从 codeFenceStart 到 codeFenceEnd，内容逐字保留 */
  private collectCode(
    lines: ParsedLine[],
    start: number,
    /**
     * 指定 ID（可选）
     *
     * 嵌在 `***list` / 引用 / 分栏里的代码块要挂在父节点下（`M1-N2`），
     * 不传就会掉回顶层计数，拿到 `M2` —— 和列表项不在同一层级。
     * 早先这里硬编码 `this.ids.block()`，就是这么错位的。
     */
    explicitId?: string,
  ): { node: CodeNode; next: number } {
    const head = lines[start];
    const body: string[] = [];
    let i = start + 1;
    let closed = false;

    for (; i < lines.length; i++) {
      const l = lines[i];
      if (l.kind === 'codeFenceEnd') {
        closed = true;
        i++;
        break;
      }
      // 代码内容逐字保留（含原始缩进）
      body.push(l.raw);
    }

    if (!closed) {
      this.diagnostics.push({
        level: 'warning',
        message: '代码块未闭合（缺少结尾的三反引号），已按剩余内容处理',
        line: head.no,
      });
    }

    const lang = head.codeLang;
    const title = head.codeTitle;
    const desc = [lang, title].filter(Boolean).join(' ') || '代码块';

    return {
      node: {
        type: 'code',
        id: explicitId ?? '',
        description: desc,
        lang,
        title,
        content: body.join('\n'),
      },
      next: i,
    };
  }

  /** 收集一个块：blockStart → 配对的 blockEnd */
  private collectBlock(
    lines: ParsedLine[],
    start: number,
    explicitId?: string,
    /** 当前嵌套层数（3 层上限判断用） */
    depth = 1,
  ): { node: BlockNode | null; next: number } {
    const head = lines[start];
    const blockName = head.blockName!;
    const name = head.blockNameTag;
    /** 位置标记（-甲），只用于闭合校验；ref 名不参与 */
    const tag = head.blockTag;
    const params = head.params ?? [];

    // ref 含非法字符（空格 / 逗号 / 括号 / 引号）：宽松接受，但明确告警（DECISION-2）
    if (head.invalidRef !== undefined) {
      this.diagnostics.push({
        level: 'warning',
        message:
          `ref="${head.invalidRef}" 含非法字符，无法被 @${head.invalidRef.split(/[\s,()"']/)[0]} 引用；` +
          `ref 只允许中文、字母、数字、_ 和 -`,
        line: head.no,
      });
    }

    /*
     * 配对：按块名做深度计数，**并校验命名标签**（2026-11-25 修）
     *
     * `***list-abc` … `***list-abc-end` 这种命名闭合是给人读的，
     * 但早先解析器只比块名，`-abc` 与 `-xyz` 对不上也照收 ——
     * 名字成了纯装饰，写错了不会有人发现。
     *
     * 现在的规则：
     *   · 闭合**不带**标签（`***list-end`）→ 接受任意开始标签（向后兼容）
     *   · 闭合**带**标签 → 必须与开始标签逐字相同，否则记为错误配对
     */
    let nestLevel = 1;
    let i = start + 1;
    let tagMismatch = false;
    for (; i < lines.length; i++) {
      const l = lines[i];
      if (l.kind === 'blockStart' && l.blockName === blockName) {
        nestLevel++;
      } else if (l.kind === 'blockEnd' && l.blockName === blockName) {
        // 带标签的闭合才校验；不带的保持宽松
        const endTag = l.blockNameTag;
        if (endTag !== undefined && tag !== undefined && endTag !== tag) {
          this.diagnostics.push({
            level: 'error',
            message:
              `块 ***${blockName}-${tag} 的结束标记写成了 ***${blockName}-${endTag}-end，` +
              `名字对不上（应写 ***${blockName}-${tag}-end）`,
            line: l.no,
          });
          tagMismatch = true;
          continue;   // 对不上就不算闭合，继续往下找
        }
        if (--nestLevel === 0) break;
      }
    }

    const closed = i < lines.length;
    // 已经报过「名字对不上」就别再叠一条「未闭合」——同一件事说两遍只会让人更糊涂
    if (!closed && !tagMismatch) {
      this.diagnostics.push({
        level: 'error',
        message: `块 ***${blockName} 未闭合，缺少 ***${blockName}-end`,
        line: head.no,
      });
    }

    const inner = lines.slice(start + 1, closed ? i : lines.length);
    const next = closed ? i + 1 : lines.length;
    // DECISION-3：column 是版式容器，ID 用 X 段；其余块走内容层 A/B/C
    // 所有块统一取号：column 也是普通块，不再特殊处理
    const blockId = explicitId ?? '';

    switch (blockName) {
      case 'list':
        return { node: this.buildList(inner, params, name, blockId, depth), next };
      case 'table':
        return { node: this.buildTable(inner, name, blockId, head.caption), next };
      case 'column':
        return { node: this.buildColumn(inner, params, name, blockId, depth), next };
      case 'math':
        return { node: this.buildMath(inner, name, blockId, head.caption), next };
      case 'chart':
        return { node: this.buildChart(inner, params, name, blockId, head.caption), next };
      case 'mermaid':
        return { node: this.buildMermaid(inner, head.caption, name, blockId), next };
      default:
        return { node: this.buildGeneric(blockName, params, name, inner, blockId), next };
    }
  }


  /**
   * 把引用内的行还原成普通行并重新分类
   *
   * 引用的每一行在 classifyLine 阶段被标记成 quote，marker 里存的是去掉 `>` 后的内容。
   * 这里把这些内容拼回纯文本，交给 classifyLines 重新分类——
   * classifyLines 能正确处理代码围栏等跨行结构，classifyLine 不能。
   *
   * @param canNest 本层之后还允许再嵌套吗？
   *   false 时（本层就是最后一层），剩下的 `>` 行不再分类成引用，
   *   而是当普通文本——这样 `>>>` 在第二层里会显示成 `> 三级`。
   */
  private reclassifyQuoteBody(quoteLines: ParsedLine[], canNest = true): ParsedLine[] {
    const bodies = quoteLines.map((ql) => ql.marker ?? '').join('\n');
    const classified = classifyLines(bodies);
    if (canNest) return classified;

    // 已经到最后一层：把「剩下的 `>` 行」降级成正文，保留 `>` 字符
    return classified.map((l) =>
      l.kind === 'quote'
        ? { ...l, kind: 'text' as const, content: l.content }
        : l,
    );
  }

  /**
   * 引用超过嵌套上限后，把余下内容当普通正文
   *
   * 参数 `lines` 是本层每行**剥掉自己那个 `>` 之后**的文本：
   *   `>>> 三级`
   *     → 第 1 层剥 1 个：`>> 三级`
   *     → 第 2 层剥 1 个：`> 三级`
   *     → 第 3 层超限，把 `> 三级` 原样显示
   *   保留的 `>` 让读者看出作者写了第 3 层。
   */
  private quoteLinesAsPlain(lines: string[], parentId: string): BlockNode[] {
    const out: BlockNode[] = [];
    let buf: string[] = [];
    const flush = () => {
      if (buf.length === 0) return;
      out.push({
        type: 'paragraph',
        id: `${parentId}-${out.length + 1}`,
        description: brief(buf.join(' ')),
        lines: [...buf],
      } as ParagraphNode);
      buf = [];
    };
    for (const line of lines) {
      if (line.trim() === '') {
        flush();
        continue;
      }
      buf.push(line);
    }
    flush();
    return out;
  }

  /**
   * 引用到达嵌套上限后，余下的 `>` 当普通正文
   *
   * 例：`>>> 三级`
   *   - 第 1 层剥掉 1 个 `>` → `>> 三级`
   *   - 第 2 层剥掉 1 个 `>` → `> 三级`
   *   - 到这里（第 3 层）已超过上限，剩下的 `> 三级` 原样当正文显示
   *
   * 所以用的是 **marker**（每层已剥掉自己那个 `>`），不是 content。
   */
  private quoteChildrenAsPlain(innerLines: ParsedLine[], parentId: string): BlockNode[] {
    const out: BlockNode[] = [];
    let buf: string[] = [];
    const flush = () => {
      if (buf.length === 0) return;
      out.push({
        type: 'paragraph',
        id: `${parentId}-${out.length + 1}`,
        description: brief(buf.join(' ')),
        lines: [...buf],
      } as ParagraphNode);
      buf = [];
    };
    for (const l of innerLines) {
      if (l.kind === 'blank') {
        flush();
        continue;
      }
      // 用 content（本层看到的原文）：
      //   `>>> 三级` 到这里时 content 就是 `> 三级`，正是要原样显示的内容
      buf.push(l.content ?? '');
    }
    flush();
    return out;
  }

  /**
   * 解析一段嵌套内容里的块。
   *
   * `forbidColumn` 用于 `***column` 内部：SYNTAX.md §15 / §23 规定
   * column 内不能嵌套 column（BUG-5）。命中的内层 column 按普通文本处理。
   */
  private buildNestedBlocks(
    inner: ParsedLine[],
    parentId: string | null = null,
    forbidColumn = false,
    /** 当前引用嵌套层数：0 = 不在引用里。SYNTAX.md 规定最多两层 */
    quoteDepth = 0,
    /**
     * 这一层内容的**嵌套层数**，用于 3 层上限判断。
     *
     * 和 ID 完全解耦：编号在 `assignIds` 里统一做，
     * 这里只需要知道「已经套了几层块」。
     */
    depth = 1,
  ): BlockNode[] {
    const out: BlockNode[] = [];
    let i = 0;
    while (i < inner.length) {
      const l = inner[i];
      if (l.kind === 'blank' || l.kind === 'comment') {
        i++;
        continue;
      }
      if (l.kind === 'blockStart') {
        // column 内禁止嵌套 column：整块按普通文本跳过（BUG-5）
        if (forbidColumn && l.blockName === 'column') {
          i++;
          while (i < inner.length) {
            const cur = inner[i];
            if (cur.kind === 'blockEnd' && cur.blockName === 'column') {
              i++;
              break;
            }
            i++;
            // 未闭合时一直吃到输入结束
          }
          continue;
        }
        /*
         * 嵌套深度上限：再加一层就是第 4 层 → 整块降级为普通文本。
         * 内容照常显示，只是不再解析成块、不占子层 ID。
         */
        if (this.wouldExceedDepth(depth)) {
          const text = this.blockAsPlainText(inner, i);
          if (text.length > 0) {
            out.push({
              type: 'paragraph',
              id: '',
              description: brief(text.join(' ')),
              lines: text,
            });
          }
          i = this.skipBlock(inner, i);
          continue;
        }
        const { node, next } = this.collectBlock(inner, i, undefined, depth);
        if (node) out.push(node);
        i = next;
        continue;
      }
      if (l.kind === 'blockEnd') {
        i++;
        continue;
      }
      if (l.kind === 'codeFenceStart') {
        // 传 nextId()：嵌套里的代码块要挂在父节点下，否则会掉回顶层计数
        const { node, next } = this.collectCode(inner, i, undefined);
        out.push(node);
        i = next;
        continue;
      }
      if (l.kind === 'heading') {
        out.push({
          type: 'heading',
          id: '',
          description: brief(l.marker ?? ''),
          level: l.level ?? 1,
          text: l.marker ?? '',
        });
        i++;
        continue;
      }
      if (l.kind === 'listItem') {
        /* 裸列表：不占号，项直接挂在当前父节点下 */
        const { items, next } = this.collectItems(inner, i, undefined, false, parentId ?? undefined, depth);
        out.push({
          type: 'list',
          id: items[0]?.id ?? '',
          description: '列表',
          explicit: false,
          params: [],
          children: items,
        });
        i = next;
        continue;
      }
      if (l.kind === 'divider') {
        out.push({
          type: 'block',
          id: '',
          description: '分割线',
          blockName: 'divider',
          params: [],
          lines: [],
        });
        i++;
        continue;
      }
      if (l.kind === 'quote') {
        const qs: string[] = [];
        const qStart = i;
        while (i < inner.length && inner[i].kind === 'quote') {
          qs.push(inner[i].marker ?? '');
          i++;
        }
        // 本层是第 quoteDepth+1 层；生成后还能不能再嵌套，看是否已达上限
        const canNestAfter = quoteDepth + 1 < MAX_QUOTE_DEPTH;
        const innerLines = this.reclassifyQuoteBody(
          inner.slice(qStart, qStart + qs.length),
          canNestAfter,
        );
        const qid = '';

        // 引用最多两层（§12）。quoteDepth = 已经处在几层引用里。
        //
        //   quoteDepth 0 → 本层是第 1 层，正常生成
        //   quoteDepth 1 → 本层是第 2 层，正常生成
        //   quoteDepth 2 → 本层是第 3 层，超限：本层内容原样显示，不再嵌套
        if (quoteDepth >= MAX_QUOTE_DEPTH) {
          // qs 是本层每行「剥掉自己那个 `>`」之后的内容，
          // 例如 `>>> 三级` 走到这里时 qs = ['> 三级']，原样显示
          out.push(...this.quoteLinesAsPlain(qs, qid));
          continue;
        }
        const quoteNode: QuoteNode = {
          type: 'quote',
          id: qid,
          description: brief(qs.join(' ')),
          children: this.buildNestedBlocks(innerLines, qid, false, quoteDepth + 1, depth + 1),
        };
        out.push(quoteNode);
        continue;
      }
      const para: string[] = [];
      while (i < inner.length && inner[i].kind === 'text') {
        para.push(inner[i].content);
        i++;
      }
      if (para.length > 0) {
        out.push({
          type: 'paragraph',
          id: '',
          description: brief(para.join(' ')),
          lines: para,
        });
      } else {
        i++;
      }
    }
    return out;
  }

  /** ***math —— 内容为 LaTeX，带 name 的公式全局连续编号 */
  private buildMath(
    inner: ParsedLine[],
    name: string | undefined,
    id: string,
    caption: string | undefined,
  ): MathNode {
    const latex = inner
      .filter((l) => l.kind !== 'blank' && l.kind !== 'comment')
      .map((l) => l.raw.trim())
      .join('\n');

    return {
      type: 'math',
      id,
      description: name ? `公式「${name}」` : '公式',
      name,
      caption,
      latex,
    };
  }

  /** ***mermaid —— 内容原样保留，不走缩进解析；与 chart 共用「图」编号序列 */
  private buildMermaid(
    inner: ParsedLine[],
    caption: string | undefined,
    name: string | undefined,
    id: string,
  ): MermaidNode {
    const source = inner.map((l) => l.raw).join('\n');

    return {
      type: 'mermaid',
      id,
      description: name ? `Mermaid「${name}」` : 'Mermaid 图',
      name,
      caption,
      source,
    };
  }

  /** ***chart —— 数据复用表格结构 */
  private buildChart(
    inner: ParsedLine[],
    params: string[],
    name: string | undefined,
    id: string,
    caption?: string,
  ): ChartNode {
    const chartType = (params[0] ?? 'bar').toLowerCase();
    const valid = ['bar', 'line', 'pie'];
    const type = valid.includes(chartType) ? chartType : 'bar';
    if (!valid.includes(chartType)) {
      this.diagnostics.push({
        level: 'warning',
        message: `不支持的图表类型「${chartType}」，已按 bar 处理`,
        line: inner[0]?.no ?? 0,
      });
    }

    let headers: string[] = [];
    const rows: string[][] = [];

    for (const l of inner) {
      if (l.kind === 'blank' || l.kind === 'comment') continue;
      const c = l.content.trim();
      const headMatch = c.match(/^head\s*:\s*(.*)$/i);
      if (headMatch) {
        headers = splitCells(headMatch[1]);
        continue;
      }
      const rowMatch = c.match(/^-\s*(.*)$/);
      if (rowMatch) rows.push(splitCells(rowMatch[1]));
    }

    return {
      type: 'chart',
      id,
      description: name ? `图表「${name}」（${type}）` : `图表（${type}）`,
      name,
      caption,
      chartType: type,
      headers,
      rows,
    };
  }

  /** ***list */
  private buildList(
    inner: ParsedLine[],
    params: string[],
    name: string | undefined,
    id: string,
    depth = 1,
  ): ListNode {
    // 登记：这是显式声明，列表项与它平级
    this.explicitLists.add(id);
    const node: ListNode = {
      type: 'list',
      id,
      description: name ? `列表「${name}」` : '列表',
      explicit: true,
      params,
      name,
      children: [],
      blocks: [],
    };

    let i = 0;
    while (i < inner.length) {
      const l = inner[i];
      if (l.kind === 'comment') {
        i++;
        continue;
      }
      if (l.kind === 'blank') {
        // V5：块内的空行是作者有意输入的，要保留并渲染出来。
        // 记到 blankAt 里，渲染时按位置插入空行。
        if (!node.blankAt) node.blankAt = [];
        node.blankAt.push(i);
        i++;
        continue;
      }
      if (l.kind === 'listItem') {
        // 第一个列表项的位置：渲染时用它把 blocks 分成「列表前 / 列表后」
        if (node.itemStart === undefined) node.itemStart = i;
        /*
         * 记下每项在块内源码里的下标 —— 供渲染层判断「某个块夹在哪两项之间」。
         *
         * ⚠️ 记在 list 块自己身上（itemPos），不塞进 listItem 节点：
         *    ListItemNode 是对外契约（AST-SPEC / schema），
         *    加内部字段会被 schema 判为不符。位置是渲染辅助信息，
         *    属于块级元数据，放在这里更合适。
         *
         * ⚠️ 一次 collectItems 会收走**连续的多个**项（`- a` `- b` 挤在一起时），
         *    所以 itemPos 要按返回的项数补齐，不能只记一个 ——
         *    早先只 push 一次，两个项共用一个位置，渲染时
         *    「项一 → 项二 → 表格」就被排成了「项一 → 表格 → 项二」。
         */
        if (!node.itemPos) node.itemPos = [];
        const collected = this.collectItems(inner, i, id, true, undefined, depth);
        /*
         * 每项的位置用 inner 下标（与 blocks.pos / blankAt 同一坐标系）。
         *
         * ⚠️ 一次 collectItems 会收走连续的多个项，它们共享同一个起始下标 ——
         *    所以这里按项数等比补齐「i, i+1, i+2…」，让同批项也能排序。
         */
        for (let n = 0; n < collected.items.length; n++) node.itemPos.push(i + n);
        node.children.push(...collected.items);
        i = collected.next;
        continue;
      }
      /*
       * 块内的非列表内容（标题、正文、代码块、子块……）不能丢。
       *
       * `***list` 是「列表解析模式」的开关，不是内容限制。按文档
       * `§十二 什么能套什么`，list 里应当能放 table / list / math / mermaid。
       *
       * ⚠️ 分段规则（2026-11-25 修）：
       *   早先只在 `blank / listItem / comment` 处断段，于是
       *     - 项一
       *     (空行)
       *     ***table … ***table-end
       *   会被空行切成两段，`***table` 的 start 和 end 落在不同段里，
       *   各自解析时都报「未闭合」。
       *
       *   现在：碰到 `blockStart` 就**整块吃到配对的 -end**，中间的空行、
       *   列表项都算进这一块，不再断段。其它情况仍按空行/列表项分段。
       */
      const start = i;
      let end = i;

      // ① 当前行本身就是块开始 → 整块收集
      if (inner[i].kind === 'blockStart') {
        const bn = inner[i].blockName!;
        let d = 1;
        let k = i + 1;
        for (; k < inner.length; k++) {
          const nl = inner[k];
          if (nl.kind === 'blockStart' && nl.blockName === bn) d++;
          else if (nl.kind === 'blockEnd' && nl.blockName === bn) {
            const endTag = nl.blockNameTag;
            const openTag = inner[i].blockTag;
            if (endTag !== undefined && openTag !== undefined && endTag !== openTag) {
              continue;   // 名字对不上，不算闭合
            }
            if (--d === 0) { k++; break; }
          }
        }
        end = k;
      } else {
        // ② 普通内容：成段收集，遇到块开始/列表项/空行/注释就停
        while (
          end < inner.length &&
          inner[end].kind !== 'listItem' &&
          inner[end].kind !== 'blank' &&
          inner[end].kind !== 'comment' &&
          inner[end].kind !== 'blockStart'
        ) {
          end++;
        }
        // 一段都没有（当前行就是 stop 条件）→ 至少吃掉一行，避免死循环
        if (end === start) end = start + 1;
      }

      /*
       * 顶格块与列表项**平级**，都挂在 list 的父节点下。
       *
       * `***list` 是声明型块：声明自己占一个号，内容是平级的下一段。
       *
       *     ***list      M1
       *       - 项一      M2
       *       ***table    M3   ← 顶格 → 与项平级
       *       - 项二      M4
       */
      const nested = this.buildNestedBlocks(
        inner.slice(start, end),
        this.listItemParent(id) ?? null,
        false,
        0,
        depth,
      );
      for (const parsed of nested) {
        // pos 用 inner 下标，和 blankAt / itemStart 同一坐标系
        node.blocks!.push({ pos: start, node: parsed });
      }
      i = end;
    }
    return node;
  }

  /** ***table */
  private buildTable(
    inner: ParsedLine[],
    name: string | undefined,
    blockId: string,
    caption?: string,
  ): TableNode {
    const headers: string[][] = [];
    const rows: TableRowNode[] = [];
    let rowSeq = 0;

    for (const l of inner) {
      if (l.kind === 'blank' || l.kind === 'comment') continue;
      const c = l.content.trim();

      // 表头：head: a, b, c
      const headMatch = c.match(/^head\s*:\s*(.*)$/i);
      if (headMatch) {
        headers.push(splitCells(headMatch[1]));
        continue;
      }

      // 数据行：- a, b, c
      const rowMatch = c.match(/^-\s*(.*)$/);
      if (rowMatch) {
        const cells = splitCells(rowMatch[1]);
        /*
         * 行 ID：走统一的 nextChildId
         *
         * 它内部会处理「表格已在 O 段」的情形（嵌套表格 M1-N1-O1）：
         * 行进同一个 O 池继续取号，不再追加新段。
         */
        const rowId = '';
        rowSeq++;
        rows.push({
          type: 'tableRow',
          id: rowId,
          description: brief(cells.join(' / ')),
          cells,
          cellIds: [],
        });
      }
    }

    const cols = headers[0]?.length ?? rows[0]?.cells.length ?? 0;
    return {
      type: 'table',
      id: blockId,
      description: name ? `表格「${name}」（${cols} 列 ${rows.length} 行）` : `表格（${cols} 列 ${rows.length} 行）`,
      name,
      caption,
      headers,
      rows,
    };
  }

  /** ***column —— 栏内容支持完整块语法 */
  private buildColumn(
    inner: ParsedLine[],
    params: string[],
    name: string | undefined,
    blockId: string,
    depth = 1,
  ): ColumnNode {
    const ratios = parseRatios(params);
    // 按 @next-column 切分成多栏（保留 ParsedLine 以便结构化解析）
    const chunks: ParsedLine[][] = [[]];

    for (const l of inner) {
      if (l.kind === 'blank' || l.kind === 'comment') {
        chunks[chunks.length - 1].push(l);
        continue;
      }
      if (l.kind === 'directive' && l.directive === 'next-column') {
        chunks.push([]);
        continue;
      }
      chunks[chunks.length - 1].push(l);
    }

    // 栏数与声明不符：取前面的，多余的忽略
    const want = ratios.length || chunks.length;
    const kept = chunks.slice(0, want);
    while (kept.length < want) kept.push([]);

    const cleaned = kept.map((chunk) =>
      chunk.filter((l) => l.kind !== 'blank' && l.kind !== 'comment'),
    );

    // DECISION-3：版式层用 X（容器）/ Y（栏），栏内内容重新从 A 开始
    //
    //   X1            分栏
    //   X1-Y1         左栏
    //   X1-Y1-A1      左栏里的第一个块
    //   X1-Y1-A1-B1   那个块里的子节点
    /*
     * 栏 ID 与「栏内内容」共用同一个号池（2026-11-25 修）
     *
     * 分栏在 O 段时（M49-N1-O1），它自己和所有栏、栏内块都挤在
     * 同一个扁平 O 池里。各记一本账就会撞号：
     *   分栏 O1 / 栏 O1（撞）/ 栏内第一块 O2（撞栏 O2）
     *
     * 所以这里统一用 this.ids 的 nextChildNo 取号，一处处递增。
     */
    /*
     * 栏号：分栏是**声明型**块 —— 它自己占一个号，栏与它平级。
     *
     *     ***column     M1
     *       左栏         M2
     *       右栏         M3
     *
     * 栏与分栏共用一个父节点计数器，所以从 parentOf(blockId) 取号，
     * 天然接着分栏自己的号往后排。
     */
    const columnParent = parentOf(blockId);
    const unitIds: string[] = kept.map(() => '');

    return {
      type: 'column',
      id: blockId,
      description: name ? `分栏「${name}」（${want} 栏）` : `分栏（${want} 栏）`,
      name,
      ratios: kept.map((_, idx) => ratios[idx] ?? 1),
      // 每栏内按完整块语法解析（table/list/math/chart/引用/代码块都可用）
      //
      // 每栏内按完整块语法解析（table/list/math/chart/引用/代码块都可用）
      //
      // 栏内内容是**栏的子集**，进栏的下一层：
      //   分栏      M1
      //   左栏      M2
      //   栏内段落  M2-N1
      columnBlocks: cleaned.map((chunk, idx) =>
        chunk.length > 0 ? this.buildNestedBlocks(chunk, unitIds[idx], true, 0, depth + 1) : [],
      ),
      columns: cleaned.map((chunk) => chunk.map((l) => l.raw.trim())),
      columnIds: unitIds,
    };
  }

  /** 其它块：保留原始内容 */
  private buildGeneric(
    blockName: string,
    params: string[],
    name: string | undefined,
    inner: ParsedLine[],
    id: string,
  ): GenericBlockNode {
    return {
      type: 'block',
      id,
      description: `${blockName}${name ? `「${name}」` : ''}`,
      blockName,
      params,
      name,
      lines: inner.filter((l) => l.kind !== 'blank').map((l) => l.raw),
    };
  }

  /**
   * 收集列表项（含嵌套）
   *
   * @param blockId 父块 ID，用于生成子节点 ID（`M3-N1`）
   * @param inBlock 是否处在 `***list` 块内 —— **只影响空行语义**，不影响 ID：
   *   块内空行是段落隔断；裸列表空行是列表结束。
   *   早先拿 `blockId` 兼职判断，裸列表一旦有了父 ID 就被误判成块内。
   * @param groupsUnder 裸列表的项挂到哪个父节点（显式 list 不用传，
   *   由 `listItemParent` 从 blockId 推出来）
   */
  private collectItems(
    lines: ParsedLine[],
    start: number,
    blockId?: string,
    inBlock = false,
    groupsUnder?: string,
    /** 当前嵌套层数（3 层上限判断用） */
    depth = 1,
  ): { items: ListItemNode[]; next: number; lines: number[] } {
    const items: ListItemNode[] = [];
    /** 每个项的源行号，与 items 一一对应（供 list 块排序用） */
    const itemLines: number[] = [];
    let i = start;

    /*
     * 列表项的取号父节点
     *
     * 两种写法都「往上挂一层」，挂到谁由调用方指定：
     *   显式 `***list` → 挂到 list 的**父**（项与声明平级）
     *   裸列表         → 挂到 collectItems 的**调用方**（项与调用方平级）
     */
    const rootParentId = groupsUnder ?? (blockId ? (this.listItemParent(blockId) ?? '') : '');

    const stack: Array<{
      indent: number;
      children: ListItemNode[];
      parentId: string;
    }> = [{ indent: -1, children: items, parentId: rootParentId }];

    /*
     * 列表项 ID 占位 —— 编号由 assignIds 统一做（2026-11-25）。
     * 解析阶段只决定「谁是谁的孩子」，不碰编号。
     */
    const makeId = (): string => '';

    /**
     * 记录最近处理的列表项及其缩进。
     *
     * 无标记行归属规则（BUG-1 / DECISION-8）：
     *   1. **空行之后不再归属** —— 空行结束列表（A1 + B1）
     *   2. 无空行时：归属于「前面最近的列表项」，且缩进不小于该项
     */
    let lastItem: ListItemNode | undefined;
    let lastItemIndent = -1;

    /** 按规则找宿主：从最近项往回退，直到找到缩进不大于当前行的项 */
    const findHost = (indent: number): ListItemNode | undefined => {
      if (!lastItem) return undefined;
      // 最近项缩进 <= 当前行 → 归属它
      if (indent >= lastItemIndent) return lastItem;
      // 否则回退到某一祖先层（用 lastItemByIndent 记录各级最近项）
      for (let s = stack.length - 1; s >= 0; s--) {
        const layer = stack[s];
        if (layer.indent < 0) break;
        if (indent >= layer.indent) {
          const last = layer.children[layer.children.length - 1];
          if (last) return last;
          break;
        }
      }
      return undefined;
    };

    /** 记录上一项之后累计了几个空行，供列表项标记 blankBefore */
    let sawBlank = false;
    let blankCount = 0;

    /**
     * 给列表项追加一段补充文本
     *
     * `blanks` 是这段之前的空行数。**第一段补充总是记 0**：
     * `- C` 下面空一行再写补充，是书写习惯（把补充和项分开），
     * 不该在视觉上真的空出一行。补充之间才如实记录。
     */
    const pushItemLine = (item: ListItemNode, text: string, blanks: number): void => {
      // 「第一段补充」= lines 里还没有任何补充（lines[0] 是项本身的文字）
      const isFirstSupplement = item.lines.length <= 1;
      item.lines.push(text);
      (item.lineBlanks ??= []).push(isFirstSupplement ? 0 : blanks);
    };

    while (i < lines.length) {
      const l = lines[i];

      // 空行
      if (l.kind === 'blank') {
        let j = i + 1;
        while (j < lines.length && lines[j].kind === 'blank') j++;
        const blanks = j - i;
        if (j >= lines.length) break;
        const nl = lines[j];
        const top = stack[stack.length - 1];

        // 后续仍是列表项，且不太浅 → 继续（空行只是段落隔断）
        if (nl.kind === 'listItem' && nl.indent >= top.indent) {
          sawBlank = true;
          blankCount = blanks;
          i = j;
          continue;
        }

        // 后续是正文
        //
        // 两种语境，规则不同：
        //
        // ① 无块模式（MD 式列表，blockId 为空）
        //    空行结束列表 → 正文成为顶层段落（BUG-1c）
        //
        // ② `***list` 块内（blockId 有值）
        //    空行只是段落隔断，正文仍归属「前面最近的列表项」，
        //    成为该项的第二段（SYNTAX.md §11「块式支持空行分段、多段落内容」）
        if (nl.kind === 'text' && inBlock) {
          const host = findHost(nl.indent);
          if (host) {
            pushItemLine(host, nl.content.trim(), blanks);
            i = j + 1;
            sawBlank = true;
            continue;
          }
        }

        /*
         * 缩进的「块级内容」跟在列表项后面 → 成为该**项的子块**（2026-11-25）
         *
         * 覆盖三类起始标记：
         *   · `***xxx`（blockStart）
         *   · ` ``` ` 代码块（codeFenceStart）
         *   · `>` 引用（quote）
         * 这三种都能嵌进 `<li>`，是「嵌套」，和顶格写的「场域」不同：
         *   顶格 → 列表的兄弟内容（ListNode.blocks）
         *   缩进 → 属于上面那一项（ListItemNode.blocks），渲染进 <li>
         *
         * ID 按嵌套关系走：项 M1-N1，它下面的块 M1-N1-O1。
         */
        const isNestedBlockStart =
          (nl.kind === 'blockStart' || nl.kind === 'codeFenceStart' || nl.kind === 'quote') &&
          nl.indent > 0;

        if (isNestedBlockStart) {
          const host = findHost(nl.indent);
          if (host) {
            // 进入块前的栈深度，块处理完要恢复到这儿（见下方注释）
            const stackDepthBefore = stack.length;
            // 找出这一块在源码里的范围
            let k: number;
            if (nl.kind === 'codeFenceStart') {
              k = j + 1;
              while (k < lines.length && lines[k].kind !== 'codeFenceEnd') k++;
              k = Math.min(k + 1, lines.length);
            } else if (nl.kind === 'quote') {
              k = j + 1;
              while (k < lines.length && lines[k].kind === 'quote') k++;
            } else {
              const bn = nl.blockName!;
              let d = 1;
              k = j + 1;
              for (; k < lines.length; k++) {
                const q = lines[k];
                if (q.kind === 'blockStart' && q.blockName === bn) d++;
                else if (q.kind === 'blockEnd' && q.blockName === bn) {
                  if (--d === 0) { k++; break; }
                }
              }
            }

            /*
             * 去掉缩进后再交给块解析器：
             * 解析器只认行首的标记（`***` / ` ``` ` / `>`），
             * 原样带着缩进会识别不出。每行砍掉 nl.indent 个字符。
             */
            const chunk = lines.slice(j, k).map((q) => {
              const raw = q.raw;
              const cut = raw.slice(Math.min(nl.indent, raw.length));
              const newIndent = Math.max(0, q.indent - nl.indent);
              return { ...q, raw: cut, indent: newIndent, content: cut.slice(newIndent) };
            });

            /*
             * 递归解析这一块，挂在项的 ID 之下。
             *
             * ⚠️ 这里用**全局** idgen（不传局部分配器）：
             *    同一个项下面可能有 table / code / quote 多个子块，
             *    而表格的行也要从同一层取号 —— 各记一本账会撞出
             *    多个 M1-N1-O1。全局计数器天然给每个节点唯一号。
             */
            /*
             * 嵌块挂在项下 —— 和该项目的子列表项共用项这一个计数器。
             *
             * 子项已经取过号，计数器已经推进；嵌块接着取，天然不撞号。
             */
            const nested = this.buildNestedBlocks(chunk, host.id, false, 0, depth + 1);
            if (nested.length > 0) {
              if (!host.blocks) host.blocks = [];
              for (const node of nested) host.blocks.push({ pos: j, node });
            }
            /*
             * 嵌块结束后把栈弹回「进入块之前」的深度（2026-11-25）
             *
             * 收集块内容会 push 若干层（块内部的列表项）。不恢复的话，
             * 后面顶格/浅缩进的列表项会误判成「项的子项」：
             *   - 项一
             *     ***table … ***table-end
             *   - 第 1 项          ← 本该回列表顶层，却挂到项一下面
             * 于是 AST 多一层嵌套，ID 也撞车（M1-N1-O1 既是项又是表格）。
             */
            while (stack.length > stackDepthBefore) stack.pop();
            lastItem = host;
            lastItemIndent = l.indent;
            i = k;
            sawBlank = true;
            continue;
          }
        }

        // 无块模式：空行结束列表（A1 + B1）
        // `i` 停在空行处，break 出去，由外层把空行之后的正文当普通段落解析。
        break;
      }

      // 非列表项（无标记的续行内容）
      if (l.kind !== 'listItem') {
        /*
         * 缩进的块级内容，**紧跟在项后面、中间没有空行** → 成为该项的子块
         *
         * 2026-11-25 修：早先这里无条件 `break`，于是
         *   - 项
         *     ***table … ***table-end      ← 没有空行
         * 会被当成「列表结束」，table 掉到列表外面变成兄弟块。
         * 而同样的写法中间空一行就正常 —— 同一个语义两种结果，是缺陷。
         *
         * 现在两种写法一致：缩进就属于那一项，渲染进 <li> 内部。
         */
        const isNestedBlockStart =
          (l.kind === 'blockStart' || l.kind === 'codeFenceStart' || l.kind === 'quote') &&
          l.indent > 0;

        if (isNestedBlockStart) {
          const host = findHost(l.indent);
          if (host) {
            const stackDepthBefore = stack.length;
            // 找出这一块在源码里的范围
            let k: number;
            if (l.kind === 'codeFenceStart') {
              k = i + 1;
              while (k < lines.length && lines[k].kind !== 'codeFenceEnd') k++;
              k = Math.min(k + 1, lines.length);
            } else if (l.kind === 'quote') {
              k = i + 1;
              while (k < lines.length && lines[k].kind === 'quote') k++;
            } else {
              const bn = l.blockName!;
              let d = 1;
              k = i + 1;
              for (; k < lines.length; k++) {
                const q = lines[k];
                if (q.kind === 'blockStart' && q.blockName === bn) d++;
                else if (q.kind === 'blockEnd' && q.blockName === bn) {
                  if (--d === 0) { k++; break; }
                }
              }
            }

            // 去掉缩进再交给块解析器（它只认行首标记）
            const chunk = lines.slice(i, k).map((q) => {
              const raw = q.raw;
              const cut = raw.slice(Math.min(l.indent, raw.length));
              const newIndent = Math.max(0, q.indent - l.indent);
              return { ...q, raw: cut, indent: newIndent, content: cut.slice(newIndent) };
            });

            const nested = this.buildNestedBlocks(chunk, host.id, false, 0, depth + 1);
            if (nested.length > 0) {
              if (!host.blocks) host.blocks = [];
              for (const node of nested) host.blocks.push({ pos: i, node });
            }

            // 栈回到进入块之前的深度，避免后续项误挂到该项下
            while (stack.length > stackDepthBefore) stack.pop();
            lastItem = host;
            lastItemIndent = l.indent;
            i = k;
            continue;
          }
        }

        // 块标记（***xxx-end 等）视为列表结束，交回调用方处理
        if (l.kind === 'blockEnd' || l.kind === 'blockStart') break;

        // 无空行时的续行：归属「前面最近的列表项」，且缩进不小于该项
        //
        // 注意：`break` 时 `i` 不动，外层会从这一行继续解析。
        // 这样即使 findHost 返回 undefined（例如顶格正文顶不进缩进的列表），
        // 内容也不会被丢弃 —— 这是 BUG-1a 的修复。
        const host = findHost(l.indent);
        if (host) {
          pushItemLine(host, l.content.trim(), 0);
          i++;
          continue;
        }
        break;
      }

      // 回退：弹掉缩进 >= 当前行的层
      while (stack.length > 1 && l.indent <= stack[stack.length - 1].indent) {
        stack.pop();
      }

      // 同层混用 `-` 与 `1.`：类型变了就断开，另起一个列表（BUG-2）
      //
      // SYNTAX.md §11 规定「同一层级内不得混用」，但没写混用了会怎样。
      // 此前的实现是「以首项为准」——所有项渲染成同一个 <ul>，
      // 有序项的编号被静默丢掉。现在改为断开，两段各自成像。
      {
        const layer = stack[stack.length - 1];
        const prev = layer.children[layer.children.length - 1];
        const isOrdered = l.ordered ?? false;
        if (prev && prev.ordered !== isOrdered) {
          // 顶层（回到最外层）才算断开；子层也按同样规则处理
          break;
        }
      }

      const text = this.itemText(l);
      const itemId = makeId();
      const item: ListItemNode = {
        type: 'listItem',
        id: itemId,
        description: brief(text) || '(空项)',
        marker: l.marker ?? '-',
        ordered: l.ordered ?? false,
        lines: text ? [text] : [],
        ...(text ? { lineBlanks: [0] } : {}),
        children: [],
        task: l.task,
        ...(sawBlank ? { blankBefore: blankCount } : {}),
      };

      const parentLayer = stack[stack.length - 1];
      parentLayer.children.push(item);
      /*
       * 记下这一项的源行号（不写进节点，避免污染 AST 契约）。
       *
       * 一次 collectItems 会收走连续的多个项，它们共享同一个起始下标，
       * 只有行号是唯一递增的 —— 排序「项与项间夹的块」必须靠它。
       */
      itemLines.push(l.no ?? i);
      // 子项挂在这个项的 ID 下 —— 父节点换了，计数器自然换一套
      stack.push({
        indent: l.indent,
        children: item.children,
        parentId: itemId,
      });
      lastItem = item;
      lastItemIndent = l.indent;
      sawBlank = false;
      i++;
    }

    return { items, next: i, lines: itemLines };
  }

  /** 列表项文本（去掉标记与任务框） */
  private itemText(l: ParsedLine): string {
    const c = l.content;
    if (l.ordered) {
      return c.match(/^\d+\.\s*(\[[ xX]\]\s*)?(.*)$/)?.[2] ?? c;
    }
    return c.match(/^-\s*(\[[ xX]\]\s*)?(.*)$/)?.[2] ?? c;
  }
}

/**
 * 脚注定义行：`@foot(名字): 内容`
 *
 * 它是「声明」不是「内容」——不参与文档流，不产出块节点。
 * 内容的收集与编号是第二层的事（mdh-render/footnotes.ts）。
 */
const FOOTNOTE_DEF_RE = /^@foot\([^)]+\)\s*[:：]/;

/**
 * 从一个 ID 推断它所在的内容层深（DECISION-3）
 *
 * 规则：数 M/N/O 段，最后一段就是它的层深。
 *   M1          → 1
 *   M2-N1       → 2
 *   M1-N1-O3    → 3（O 段之后都算第 3 层）
 */
function depthOfId(id: string): number {
  const segs = id.split('-');
  let depth = 0;
  for (const s of segs) {
    if (/^M\d+$/.test(s)) depth = 1;
    else if (/^N\d+$/.test(s)) depth = 2;
    else if (/^O\d+$/.test(s)) depth = 3;
  }
  return depth || 1;
}

export function parse(source: string): ParseResult {
  // 摘掉脚注定义行：换成空行，避免把上下两段粘在一起。
  // 不用 filter 直接删，因为行号会错位，diagnostics 定位就不准了。
  //
  // 定义内容必须留下来交给渲染层（BUG-10：此前摘掉即丢失，
  // 导致「@foot(x): 内容」既不当定义、也没渲染出内容）。
  const footnoteDefs: Array<{ name: string; content: string }> = [];
  const stripped = source
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!FOOTNOTE_DEF_RE.test(trimmed)) return line;
      const m = trimmed.match(/^@foot\(([^)]+)\)\s*[:：]\s*(.*)$/);
      if (m) footnoteDefs.push({ name: m[1].trim(), content: m[2].trim() });
      return '';
    })
    .join('\n');

  const result = new Builder().build(classifyLines(stripped));

  // DESIGN-3：扫描不可见字符，写进诊断。
  //
  // 渲染层会把 Cf 字符显式标记成 `[U+200B]`（读者能看见），
  // 但有些位置渲染层覆盖不到（`ref` 属性值、代码块内部），
  // 这里按行扫一遍原始源码兜底，让作者在编辑器侧栏也能看到。
  //
  // 只扫 `Cf` 类，不碰 `So`（emoji/符号）。
  const invisibles = scanInvisibleChars(stripped);
  const diagnostics = invisibles.length > 0
    ? [...result.diagnostics, ...invisibles]
    : result.diagnostics;

  const merged = { ...result, diagnostics };
  return footnoteDefs.length > 0 ? { ...merged, footnoteDefs } : merged;
}

/** 与渲染层保持一致的「不可见字符」匹配集（只含 Cf 类） */
const INVISIBLE_CHAR_RE =
  /[\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

/**
 * 逐行扫描不可见字符，生成 warning 诊断（DESIGN-3）
 *
 * 为什么要在这层做：渲染层只能标记它处理到的文本（正文、表格单元格等），
 * 而 `ref="名字"` 这类属性值、代码块原文都绕过了行内渲染。
 * 解析层拿到的是完整原始行，能兜住这些漏网位置，并且带行号。
 */
function scanInvisibleChars(source: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  source.split('\n').forEach((line, idx) => {
    const hits = line.match(INVISIBLE_CHAR_RE);
    if (!hits) return;
    const codes = [...new Set(hits.map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`))];
    out.push({
      level: 'warning',
      message: `第 ${idx + 1} 行含 ${hits.length} 个不可见字符（${codes.join(', ')}），可能隐藏了内容`,
      line: idx + 1,
    });
  });
  return out;
}
