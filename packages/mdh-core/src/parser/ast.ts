/**
 * mdh AST 类型定义
 *
 * 设计原则：
 * - 每个节点都是对象，带 id 与 description（对象化的基础）
 * - 块节点用 children 承载子节点
 * - 结构与语法规范一一对应（见 SYNTAX.md）
 */

/** 节点共通字段 */
export interface NodeBase {
  /** 对象 ID，两层结构，如 O1 / O1-D2。目前占位，P4 正式生成 */
  id: string;
  /** 内容概要，供人选中时查看、供 AI 定位 */
  description: string;
}

/** 文档根节点 */
export interface RootNode extends NodeBase {
  type: 'root';
  children: BlockNode[];
}

/** 标题 */
export interface HeadingNode extends NodeBase {
  type: 'heading';
  /** 1-6，对应 # ~ ###### */
  level: number;
  /** 标题文本（不含 # 与自动锚） */
  text: string;
  /**
   * 上一个块之后累计了几个空行（2026-11-22）
   *
   * 原来只有段落保留空行，标题和列表都丢掉了 —— 与「源码怎么写就怎么呈现」
   * 的理念不符：标题之间空几行，渲染后也该空几行。
   */
  blankBefore?: number;
}

/** 段落 */
export interface ParagraphNode extends NodeBase {
  type: 'paragraph';
  /** 段落内各行（1 回车即换行，行间保留） */
  lines: string[];
  /**
   * 段落之前有几个空行（0 = 紧接上一块）
   *
   * 作者 2026-11-21：源码怎么写就怎么呈现，空行数要如实保留。
   * 渲染层按「空行数 × 一行正文高度」换算成视觉间距，上限 10 行。
   */
  blankBefore?: number;
}

/** 列表 */
export interface ListNode extends NodeBase {
  type: 'list';
  /** 是否由显式 ***list 块声明（false = MD 式列表） */
  explicit: boolean;
  /** 块的参数，如 ***list(1fr/1fr) 中的值；无参数为 undefined */
  params: string[];
  /** 块的命名 ref="值" */
  name?: string;
  children: ListItemNode[];
  /**
   * 上一个块之后累计了几个空行（2026-11-22）
   *
   * 原来只有段落保留空行，列表丢掉了 —— 与「源码怎么写就怎么呈现」不符：
   * 正文或标题后空几行再接列表，渲染后也该空出对应的距离。
   */
  blankBefore?: number;
  /**
   * `***list` 块内的非列表内容（标题、正文等），按原位置渲染。
   *
   * `***list` 是「列表解析模式」的开关，不是内容限制——
   * 块内可以放标题、正文、列表项等任何内容（SYNTAX.md §11）。
   * 列表项在 children 里，其余内容在这里，渲染时按 pos 还原顺序。
   *
   * 只有显式块（explicit = true）才可能有值。
   */
  blocks?: Array<{
    /** 在块内的原始行号顺序，用于与 children 合并时保持位置 */
    pos: number;
    node: AnyNode;
  }>;
  /**
   * `children` 中第一个列表项在块内的原始行号。
   * 渲染时用它把 `blocks` 分成「列表前」和「列表后」两组。
   *
   * 只记一个数字（而不是每项的位置）：位置信息越多，
   * 序列化→再解析的往返越容易不一致，AST 就越不稳定。
   */
  itemStart?: number;
  /**
   * `children` 中每个列表项在块内的原始行号（2026-11-25）
   *
   * ── 为什么还是加了这个 ──
   * 上面说「只记一个数字」，是怕 AST 不稳定。但只记 itemStart
   * 有个硬伤：项与项之间夹着块时（table 作为某项的补充说明），
   * 渲染层无法知道这个块该插在哪两项之间，只能把它丢到整个列表之后。
   *
   * 往返稳定性靠的是「序列化后能还原同一份源码」，行号参与的是
   * 渲染时的拼接顺序，不会被序列化 —— 所以加它不影响往返契约。
   *
   * 与 children 一一对应；缺省表示未收集（MD 式列表）。
   */
  itemPos?: number[];
  /**
   * `***list` 块内空行的位置（V5）
   *
   * 作者在块内连续敲的空行是有意的排版，要原样渲染出来，
   * 而不是吃掉。数组元素是「这个空行在第几行」。
   */
  blankAt?: number[];
}

/** 列表项 */
export interface ListItemNode extends NodeBase {
  type: 'listItem';
  /** 该项的标记：'-' 或 '1.' 中的数字 */
  marker: '-' | string;
  /** 是否有序列号（true = 有序项） */
  ordered: boolean;
  /** 项内的文本行（含多段落） */
  lines: string[];
  /**
   * 每一行（补充段落）之前有几个空行，与 `lines` 一一对应
   *
   * 作者 2026-11-21：空行是 mdh 的设计理念，「源码怎么写就怎么呈现」。
   *
   * 唯一的例外：**项自己的第一段补充**（索引 0）之前的空行总是被忽略——
   * `- C` 下面空一行再写补充，是「把补充和项区分开」的书写习惯，
   * 不该在视觉上真的空出一行。只有补充**之间**的空行才保留。
   *
   * 缺省表示全部为 0。
   */
  lineBlanks?: number[];
  /** 子项 */
  children: ListItemNode[];
  /**
   * 项内嵌的块（2026-11-25）
   *
   * ── 什么是「嵌套」──
   * 缩进写在某一项下面、属于这一项的块：
   *
   *   ***list
   *   - 项一
   *     ***table          ← 这个 table 属于「项一」
   *     head: a
   *     ***table-end
   *   ***list-end
   *
   * 和「场域」的区别：`***list` 里顶格写的块只是列表的**兄弟内容**
   * （存在 ListNode.blocks），不属于任何一项。缩进写的才进这里，
   * 成为该项的**子节点**，渲染时放进 `<li>` 内部。
   *
   * ID 按嵌套关系走：项是 `M1-N1`，它下面的块是 `M1-N1-O1`。
   */
  blocks?: Array<{
    /** 在项内容里的原始行序，用于和 lines 一起还原顺序 */
    pos: number;
    node: AnyNode;
  }>;
  /** 任务列表状态：undefined = 非任务项 */
  task?: boolean;
  /** 该项之前有几个空行（0 = 没有。渲染时按行高换算视觉间距） */
  blankBefore?: number;
}

/** 通用块节点（未专门建模的块，如 math / chart，P6 后再细分） */
export interface GenericBlockNode extends NodeBase {
  type: 'block';
  /** 块名，如 math / chart */
  blockName: string;
  /** 位置参数，如 (bar) 中的值 */
  params: string[];
  /** 引用名，对应源码里的 ref="值" */
  name?: string;
  /** 块内原始行（尚未解析为子节点） */
  lines: string[];
}

/** 表格 */
export interface TableNode extends NodeBase {
  type: 'table';
  name?: string;
  /** 题注，显示给读者（表格题注显示在表格上方） */
  caption?: string;
  /** 表头行（head: 声明），无表头为空 */
  headers: string[][];
  rows: TableRowNode[];
}

/** 表格行 */
export interface TableRowNode extends NodeBase {
  type: 'tableRow';
  cells: string[];
  /** 单元格 ID，与 cells 一一对应（行ID带列号，如 O5-D2C3） */
  cellIds: string[];
}

/** 分栏：每栏有独立 ID（O1-D1、O1-D2…），可单独选中 */
export interface ColumnNode extends NodeBase {
  type: 'column';
  name?: string;
  /** 各栏的宽度比（fr 值），如 [1, 1] */
  ratios: number[];
  /** 每栏内的结构化块（支持 table/list/math/chart/引用/代码块） */
  columnBlocks: BlockNode[][];
  /** 每栏的原始行（调试用） */
  columns: string[][];
  /** 每栏的 ID，与 columns 一一对应 */
  columnIds: string[];
}

/** 数学公式 */
export interface MathNode extends NodeBase {
  type: 'math';
  name?: string;
  /** 题注，显示给读者；也是「是否编号」的依据（有 caption 才编号） */
  caption?: string;
  /** LaTeX 源码（多行保留） */
  latex: string;
}

/**
 * 图表（`***chart`）—— 🚧 **实验性，二期公开**
 *
 * 设计尚未完善：数据列语义（哪列是分类、哪列是系列）、
 * 单系列/多系列边界、空值处理都还没定稿。
 *
 * 实现保留在库内继续验证；对外文档暂不承诺。
 * 作者 2026-11-21：「chart 语法的设计还不完善，我考虑二期加上，不是这一期。」
 */
export interface ChartNode extends NodeBase {
  type: 'chart';
  name?: string;
  /** 题注，显示给读者 */
  caption?: string;
  /** bar / line / pie */
  chartType: string;
  headers: string[];
  rows: string[][];
}

/** slides 模式下的一页（由 -slide 切分） */
export interface SlideNode extends NodeBase {
  type: 'slide';
  name?: string;
  /** 页序号，从 1 开始 */
  index: number;
  /** 页内的结构化块（与页面内容同等对待，支持 table/list/column 等） */
  children: BlockNode[];
  /** 页内原始行（调试用，保留源文） */
  lines: string[];
}

/** 代码块 */
export interface CodeNode extends NodeBase {
  type: 'code';
  /** 语言标识，如 ts；可为空 */
  lang?: string;
  /** 文件名（title="值"）；可为空 */
  title?: string;
  /** 代码原文，逐字保留 */
  content: string;
}

/** Mermaid 图（归入「图」编号序列，与 chart 共用） */
export interface MermaidNode extends NodeBase {
  type: 'mermaid';
  name?: string;
  /** 题注，显示给读者 */
  caption?: string;
  /** Mermaid 源码，原样保留，不做缩进解析 */
  source: string;
}

/**
 * 引用块
 *
 * 引用内有完整的块结构（列表、代码块、表格等），不只是文字。
 * 与 column 类似，children 承载内部内容。
 */
export interface QuoteNode extends NodeBase {
  type: 'quote';
  /** 引用内的块 */
  children: BlockNode[];
}

/** 页面容器 */
export interface PageNode extends NodeBase {
  type: 'page';
  /** 预设：html / slides-16-9 */
  preset: string;
  slides: SlideNode[];
  /** 非 slides 模式下，页面内的普通块 */
  children: BlockNode[];
}

export type BlockNode =
  | HeadingNode
  | ParagraphNode
  | ListNode
  | TableNode
  | ColumnNode
  | MathNode
  | ChartNode
  | MermaidNode
  | CodeNode
  | QuoteNode
  | GenericBlockNode;

export type AnyNode =
  | RootNode
  | PageNode
  | BlockNode
  | ListItemNode
  | TableRowNode
  | SlideNode;

/** 解析诊断信息 */
export interface Diagnostic {
  level: 'error' | 'warning';
  message: string;
  /** 行号，从 1 开始 */
  line: number;
}

export interface ParseResult {
  ast: RootNode;
  diagnostics: Diagnostic[];
  /** 文档元信息（=== 区块内的键值对，如 title / author / date） */
  meta?: Record<string, string>;
  /**
   * 脚注定义（`@foot(名字): 内容`）。
   *
   * 定义行在解析时会被摘掉（不参与文档流），内容保存在这里交给渲染层。
   * 第二层据此编号、输出文末脚注区。
   */
  footnoteDefs?: Array<{ name: string; content: string }>;
}
