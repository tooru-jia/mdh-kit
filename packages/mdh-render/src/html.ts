/**
 * HTML 生成
 *
 * 职责边界（见 ARCHITECTURE 第二层）：
 * - 输出**语义正确的 HTML** + **数据属性**
 * - 不做任何视觉呈现（颜色、字号、间距交给第三层的 CSS）
 * - 不含行内 style
 *
 * 数据属性约定：
 *   data-mdh-id       对象 ID
 *   data-mdh-type     节点类型
 *   data-mdh-number   编号数字（如 "1"），由 CSS 决定显示成什么
 *   data-mdh-kind     编号类别（table / figure / equation）
 *   data-mdh-ref      块的 ref="值"
 *   data-mdh-latex    公式原文（供外部渲染）
 *   data-mdh-source   Mermaid 原文
 *   data-mdh-lang     代码语言
 */

import type { AnyNode, RootNode } from '@mdh-kit/core';
import type { NumberInfo } from './numbering.ts';
import { renderInline } from './inline.ts';
import { footAnchorId } from './footnotes.ts';
import { buildTocHtml, collectTocEntries, fillTocPlaceholders, TOC_PLACEHOLDER } from './toc.ts';

export interface RenderOptions {
  /** 是否输出 data-mdh-id（默认 true） */
  includeIds?: boolean;
  /** 是否输出编号数据（默认 true） */
  includeNumbers?: boolean;
  /** 图表占位：把原始数据以 JSON 挂到属性上，供外部库渲染 */
  includeChartData?: boolean;
  /**
   * 原始源码
   *
   * 只有脚注需要它：脚注编号按「首次插入出现」排序，
   * 而 AST 里的段落已丢失行内顺序信息，必须回看源码。
   *
   * 不传时脚注退化为「按 AST 遍历顺序编号」——同一个文档两种传法
   * 编号可能不同，所以尽量传。
   */
  source?: string;
  /**
   * 脚注定义（`@foot(名字): 内容`）。
   *
   * 由 `parse()` 一并返回，避免第二层再从源码里重新提取一遍——
   * 重新提取会在「源码被摘过定义行」时拿到空定义（BUG-10）。
   */
  footnoteDefs?: Array<{ name: string; content: string }>;
}

const esc = (s: string): string =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** 每种节点对应的语义 class（供第三层写 CSS 用） */
const classOf = (node: AnyNode): string => {
  const any = node as any;
  switch (node.type) {
    case 'root':
      return 'mdh-document';
    case 'heading':
      return `mdh-heading mdh-heading-${Math.min(6, Math.max(1, any.level))}`;
    case 'paragraph':
      return 'mdh-paragraph';
    case 'list':
      return any.children?.[0]?.ordered ? 'mdh-list mdh-list-ordered' : 'mdh-list mdh-list-unordered';
    case 'listItem':
      return any.task !== undefined ? 'mdh-item mdh-item-task' : 'mdh-item';
    case 'table':
      return 'mdh-table';
    case 'tableRow':
      return 'mdh-row';
    case 'column':
      return 'mdh-columns';
    case 'math':
      // 有 caption 的公式要带题注和编号，走 figure 的结构
      return any.caption ? 'mdh-figure mdh-math' : 'mdh-math';
    case 'chart':
      return 'mdh-figure mdh-chart-figure';
    case 'mermaid':
      return 'mdh-figure mdh-mermaid-figure';
    case 'code':
      return 'mdh-code';
    case 'page':
      return any.slides?.length ? 'mdh-page mdh-page-slides' : 'mdh-page';
    case 'slide':
      return 'mdh-slide';
    case 'quote':
      return 'mdh-quote';
    case 'block': {
      const name = any.blockName;
      if (name === 'divider') return 'mdh-divider';
      if (name === 'toc') return 'mdh-toc';
      return `mdh-block mdh-block-${name}`;
    }
    default:
      return 'mdh-node';
  }
};

/** 组装通用属性 */
function attrs(node: AnyNode, numbers: NumberInfo, opts: RenderOptions): string {
  const a: string[] = [];
  const any = node as any;

  a.push(`class="${esc(classOf(node))}"`);

  // FIX-3：ID 为空串表示「这个节点不占 ID」（如 slides 的页面容器），不输出属性
  if (opts.includeIds !== false && node.id) {
    a.push(`data-mdh-id="${esc(node.id)}"`);
    // V7：同时输出原生 id，`@名字` 渲染出的 href="#M1" 才能跳过来。
    // data-mdh-id 只是数据属性，浏览器锚点不认。
    a.push(`id="${esc(node.id)}"`);
  }
  a.push(`data-mdh-type="${esc(node.type)}"`);

  if (opts.includeNumbers !== false) {
    const num = numbers.valueByNode.get(node.id);
    if (num !== undefined) {
      a.push(`data-mdh-number="${esc(num)}"`);
      a.push(`data-mdh-kind="${esc(numbers.kindByNode.get(node.id) ?? '')}"`);
    }
  }

  if (typeof any.name === 'string' && any.name) {
    a.push(`data-mdh-ref="${esc(any.name)}"`);
  }

  // 空行数如实透出（渲染层不换算尺寸，只给数值）。
  //
  // 2026-11-22：原来只有段落输出它，标题和列表的空行被丢掉了 ——
  // 与「源码怎么写就怎么呈现」不符。现在统一在这里输出，
  // 任何节点带 blankBefore 就自动带上 data-mdh-blank。
  // 主题层按值决定空几行（上限 10 行）。
  const blanks = Math.min(10, Math.max(0, Number(any.blankBefore ?? 0)));
  if (blanks > 0 && Number.isFinite(blanks)) {
    a.push(`data-mdh-blank="${blanks}"`);
  }

  return a.length ? ' ' + a.join(' ') : '';
}

/** 行内文本 → HTML：解析粗体、斜体、下划线、删除线、行内代码、行内公式、@引用 */
const inline = (text: string, numbers: NumberInfo, opts: RenderOptions): string =>
  renderInline(text, {
    numbers,
    includeRefs: opts.includeNumbers !== false,
  });

/**
 * 题注元素（caption / figcaption）
 *
 * ⚠️ `data-mdh-number` 必须**同时写到题注上**：
 * 主题层的编号是 `caption::before { content: "Table " attr(data-mdh-number) }`，
 * 而 `attr()` 取的是**伪元素宿主自己**的属性。只写在外层 table/figure 上时，
 * `attr()` 拿到空值，编号只剩「Table 」没有数字。
 */
const captionEl = (
  tag: 'caption' | 'figcaption',
  text: string,
  node: AnyNode,
  numbers: NumberInfo,
  opts: RenderOptions,
): string => {
  const n = numbers.byNode.get(node.id);
  const attr = n === undefined ? '' : ` data-mdh-number="${esc(n)}"`;
  // 语义类名（2026-11-22）：让主题能精确命中，不依赖后代选择器。
  // `.mdh-table caption` 在嵌套表格里会同时命中内外两层，加了类就没这个问题。
  const cls = tag === 'caption' ? 'mdh-table-caption' : 'mdh-figcaption';
  return `<${tag} class="${cls}"${attr}>${inline(text, numbers, opts)}</${tag}>`;
};

/** 渲染文末脚注区（没有脚注时返回空字符串） */
function renderFootnotes(numbers: NumberInfo, opts: RenderOptions): string {
  const index = numbers.footnotes;
  if (!index || index.ordered.length === 0) return '';

  const items = index.ordered
    .map((f) => {
      const anchor = footAnchorId(f.name);
      if (!f.defined) {
        // 引用了但没定义：也列出来，让读者知道这里缺内容
        return (
          `<li class="mdh-footnote mdh-footnote-undefined" id="${anchor}" ` +
          `data-mdh-foot="${esc(f.name)}"><span class="mdh-footnote-num">${f.number}.</span>` +
          `<span class="mdh-footnote-body">（未定义）</span></li>`
        );
      }
      // 脚注内容支持行内格式（加粗、代码、公式、链接），但不支持块级内容
      const body = inline(f.content ?? '', numbers, opts);
      return (
        `<li class="mdh-footnote" id="${anchor}" data-mdh-foot="${esc(f.name)}">` +
        `<span class="mdh-footnote-num">${f.number}.</span>` +
        `<span class="mdh-footnote-body">${body}</span></li>`
      );
    })
    .join('\n');

  return (
    `\n<section class="mdh-footnotes" role="doc-endnotes">\n` +
    `<ol class="mdh-footnotes-list">\n${items}\n</ol>\n</section>`
  );
}

/** 渲染整篇（根节点） */
export function renderRoot(ast: RootNode, numbers: NumberInfo, opts: RenderOptions): string {
  const body = ast.children.map((c) => renderNode(c, numbers, opts)).join('\n');
  const footnotes = renderFootnotes(numbers, opts);
  const a = attrs(ast, numbers, opts);

  // `@title` 已降级为预留关键字（2026-11-25）：不再输出页面大标题。
  // 写法由行内解析统一处理成红字（.mdh-keyword-reserved），见 inline.ts。

  const html = `<div${a}>\n${body}${footnotes}\n</div>`;

  // 目录回填：整篇渲染完之后才知道有哪些标题，
  // 所以必须在这里一次性替换掉所有占位（一份文档可以写多个 @toc）
  if (html.includes(TOC_PLACEHOLDER)) {
    return fillTocPlaceholders(html, buildTocHtml(collectTocEntries(ast)));
  }
  return html;
}

/** 渲染任意节点 */
export function renderNode(node: AnyNode, numbers: NumberInfo, opts: RenderOptions): string {
  const a = attrs(node, numbers, opts);
  const any = node as any;

  switch (node.type) {
    case 'heading': {
      const lv = Math.min(6, Math.max(1, any.level));
      // 空行由 attrs() 统一输出 data-mdh-blank（见该函数说明）
      return `<h${lv}${a}>${inline(any.text, numbers, opts)}</h${lv}>`;
    }

    case 'paragraph': {
      // 空行由 attrs() 统一输出 data-mdh-blank（见该函数说明）
      // V8：纯 HTML 标签行之间不插 <br>
      //
      // `<details>` / `<summary>` 这类多行 HTML 是结构化标签，
      // 不是「换行文本」。在它们之间插 <br> 会把块结构撑开一个空行，
      // 还会让标签被 <p> 截断。
      //
      // 判据：整行只有一个标签（可能带空白），没有其它文字。
      const isTagOnly = (line: string): boolean =>
        /^\s*<\/?[a-zA-Z][^<>]*>\s*$/.test(line);
      // DESIGN-2：逐行裁掉行尾空格。
      //
      // 配合主题层的 `white-space: pre-wrap`：行内空格要保留（源码对齐、留白），
      // 但**行尾**空格是看不见的字符，保留只会在换行前多出一个空位。
      // 想制造行尾留白的正确写法是加空行（mdh 支持按空行数留白）。
      //
      // 只裁行尾不裁行首：行首空白在解析层 `raw.slice(indent)` 已经处理过了。
      // 逐行裁而非整段裁：否则 `A  \nB` 的中间空格会残留。
      const rendered = (any.lines as string[]).map((l) => inline(l.trimEnd(), numbers, opts));
      const joined = rendered.reduce((acc, cur, idx) => {
        if (idx === 0) return cur;
        // 上一行或本行是纯标签 → 不加 <br>
        const prevRaw = (any.lines as string[])[idx - 1] ?? '';
        const curRaw = (any.lines as string[])[idx] ?? '';
        return isTagOnly(prevRaw) || isTagOnly(curRaw) ? acc + cur : acc + '<br>' + cur;
      }, '');
      return `<p${a}>${joined}</p>`;
    }

    case 'list': {
      const children = (any.children as AnyNode[]) ?? [];
      const blocks = (any.blocks as Array<{ pos: number; node: AnyNode }>) ?? [];
      const itemStart = any.itemStart as number | undefined;
      // V5：块内空行（作者有意敲的）要渲染出来
      const blankAt = (any.blankAt as number[] | undefined) ?? [];
      const tag = (children[0] as any)?.ordered ? 'ol' : 'ul';
      const items = children.map((c) => renderNode(c, numbers, opts)).join('');

      // 空行渲染成占位元素（高度由第三层 CSS 决定）
      const blankEl = '<div class="mdh-blank" aria-hidden="true"></div>';

      // 块内没有非列表内容 → 保持原来的纯净输出（但有空行时仍要包一层）
      if (blocks.length === 0 && blankAt.length === 0) {
        return `<${tag}${a}>${items}</${tag}>`;
      }

      // 块内混有标题 / 正文 / 代码块（BUG-1a：此前这些内容会被静默丢弃）
      //
      // 按块内原始位置排序，把空行插回它真正所在的地方：
      // 之前是全部堆在容器顶部，导致 `***list` 里的空行把整段往下推（观感上
      // 等于多嵌套了一层）。itemStart 之前的块在列表之上，其余在列表之下。
      const itemAt = itemStart ?? Number.POSITIVE_INFINITY;
      const above = blocks.filter((b) => b.pos < itemAt);
      const below = blocks.filter((b) => b.pos >= itemAt);

      // 按位置把 blocks 与空行交织成 HTML
      //
      // blankAt 与 blocks.pos 都来自同一个 inner 下标空间，但列表项本身不占
      // 位置（itemStart 只记第一个）。所以空行必须**按区间分配**，否则一个空行
      // 会在 head 和 tail 各出现一次（4 个空行渲染成 8 个）。
      const weave = (arr: Array<{ pos: number; node: AnyNode }>, blanks: number[]): string => {
        const out: string[] = [];
        let bi = 0;
        for (const pos of blanks) {
          while (bi < arr.length && arr[bi].pos <= pos) {
            out.push(renderNode(arr[bi].node, numbers, opts));
            bi++;
          }
          out.push(blankEl);
        }
        while (bi < arr.length) {
          out.push(renderNode(arr[bi].node, numbers, opts));
          bi++;
        }
        return out.join('');
      };

      const listTag = items ? `<${tag} class="mdh-list">${items}</${tag}>` : '';
      // 每个空行只归属一侧：落在首个列表项之前 → 列表之上，否则列表之下。
      const blanksAbove = blankAt.filter((p) => p < itemAt);
      const blanksBelow = blankAt.filter((p) => p >= itemAt);
      const head = weave(above, blanksAbove);
      const tail = weave(below, blanksBelow);

      /*
       * 项与项之间夹着块 → 把列表断开、块插在中间（2026-11-25）
       *
       * 典型用法：table 作为某一项的补充说明
       *   ***list
       *   - 项一
       *     ***table … ***table-end   ← 挂在项一下面
       *   - 项二
       *   ***list-end
       *
       * `<ul>` 里不能放 `<table>`，所以只能拆成多个 `<ul>`：
       *   <ul>项一</ul> <table> <ul>项二</ul>
       * 这样视觉上表格就落在项一和项二之间，符合「补充说明」的位置。
       *
       * 判定：list 块上记了 itemPos（每项在块内源码里的下标）。
       * 某个块的 pos 落在「项 i」和「项 i+1」之间，就在项 i 后面断开。
       */
      const itemBlocks = (any.itemPos as number[] | undefined) ?? [];
      const hasPos = itemBlocks.length === children.length && children.length > 0;

      if (hasPos && below.length > 0) {
        // 逐项输出，遇到「下一项之前有块」就在中间插入
        const segs: string[] = [];
        let buf: string[] = [];
        let bi = 0;
        const sorted = [...below].sort((x, y) => x.pos - y.pos);
        // 空行也按位置走：只保留「最后一项之后」的那些（其余已被项间结构覆盖）
        const lastItemPos = itemBlocks[itemBlocks.length - 1];
        const restBlanks =
          typeof lastItemPos === 'number' ? blanksBelow.filter((p) => p > lastItemPos) : blanksBelow;

        for (let k = 0; k < children.length; k++) {
          // 先插「在这一项之前」的所有块
          while (bi < sorted.length && typeof itemBlocks[k] === 'number' && sorted[bi].pos < itemBlocks[k]!) {
            if (buf.length) {
              segs.push(`<${tag} class="mdh-list">${buf.join('')}</${tag}>`);
              buf = [];
            }
            segs.push(renderNode(sorted[bi].node, numbers, opts));
            bi++;
          }
          buf.push(renderNode(children[k], numbers, opts));
        }
        // 剩下的块排在最后一项之后
        while (bi < sorted.length) {
          if (buf.length) {
            segs.push(`<${tag} class="mdh-list">${buf.join('')}</${tag}>`);
            buf = [];
          }
          segs.push(renderNode(sorted[bi].node, numbers, opts));
          bi++;
        }
        if (buf.length) segs.push(`<${tag} class="mdh-list">${buf.join('')}</${tag}>`);

        const wrapperAttrs2 = a
          .replace(/\sdata-mdh-type="list"/, ' data-mdh-type="listBlock"')
          .replace(/\sclass="[^"]*"/, ' class="mdh-list-block"');
        return `<div${wrapperAttrs2}>${head}${segs.join('')}${restBlanks.map(() => blankEl).join('')}</div>`;
      }

      // 外层容器：属性里的 data-mdh-type 已被上一步写成 list，
      // 这里换成 listBlock，避免重复属性。
      //
      // BUG-1：容器**不能带 `.mdh-list`**。那个类的 `padding-left: 1.5em`
      // 是给 `<ul>` 让出圆点位置的，套在外层 div 上会让整个 `***list` 块
      // 右移 22.4px，块内子项再叠加一层，观感上就像「多嵌套了一层」。
      const wrapperAttrs = a
        .replace(/\sdata-mdh-type="list"/, ' data-mdh-type="listBlock"')
        .replace(/\sclass="[^"]*"/, ' class="mdh-list-block"');
      return `<div${wrapperAttrs}>${head}${listTag}${tail}</div>`;
    }

    case 'listItem': {
      const kidsArr = Array.isArray(any.children) ? (any.children as AnyNode[]) : [];
      const hasNested = kidsArr.length > 0;
      // 任务项：用 data 属性区分勾选状态，由 CSS 画复选框
      const taskAttr =
        any.task === undefined ? '' : ` data-mdh-task="${any.task ? 'done' : 'todo'}"`;
      /*
       * 项与项之间的空行
       *
       * 由公共属性生成器（attrsOf）统一输出 data-mdh-blank，这里**不要**再加一遍 ——
       * 早先这里自己拼了一份，结果 `<li>` 上出现两个同名的 data-mdh-blank
       * （2026-11-25 发现并移除）。
       */
      const lines = (any.lines as string[]) ?? [];
      // lineBlanks[i] = 第 i 段补充之前的空行数（索引 0 恒为 0，见 ListItemNode）
      const blanksOf = (any.lineBlanks as number[] | undefined) ?? [];
      const first = lines[0] ? inline(lines[0].trimEnd(), numbers, opts) : '';
      const rest = lines
        .slice(1)
        .map((l, idx) => {
          const n = Math.min(10, Math.max(0, blanksOf[idx + 1] ?? 0));
          const attr = n > 0 ? ` data-mdh-blank="${n}"` : '';
          // DESIGN-2：补充段同样裁掉行尾空格（与 .mdh-paragraph 一致）
          return `<span class="mdh-item-para"${attr}>${inline(l.trimEnd(), numbers, opts)}</span>`;
        })
        .join('');

      // 子列表必须包成独立的 ul/ol，不能直接塞进 li
      let kids = '';
      if (hasNested) {
        const childTag = (kidsArr[0] as any)?.ordered ? "ol" : "ul";
        const childCls = (kidsArr[0] as any)?.ordered ? "mdh-list mdh-list-ordered" : "mdh-list mdh-list-unordered";
        kids = `<${childTag} class="${childCls}">${kidsArr
          .map((c) => renderNode(c, numbers, opts))
          .join('')}</${childTag}>`;
      }

      /*
       * 项内嵌的块（2026-11-25）
       *
       * 缩进写在某一项下面的 `***table` / `***math` / 代码块 / 引用……
       * 解析层已经把它们挂到 ListItemNode.blocks 上，这里渲染进 <li> 内部。
       *
       * `<li>` 里放 `<table>` / `<pre>` / `<blockquote>` 都是合法 HTML，
       * 视觉上会跟着列表缩进 —— 这正是「补充说明」该有的样子。
       *
       * 没写 blocks 的项不受影响（绝大多数项）。
       */
      const itemBlocks = (any.blocks as Array<{ pos: number; node: AnyNode }> | undefined) ?? [];
      const embedded = itemBlocks
        .map((b) => renderNode(b.node, numbers, opts))
        .join('');

      const content = `${first}${rest}${embedded}${kids}`;
      return `<li${a}${taskAttr}>${content}</li>`;
    }

    case 'table': {
      const head = (any.headers as string[][]) ?? [];
      const rows = (any.rows as AnyNode[]) ?? [];
      // V6：表头横向合并 —— 同一行内**相邻且文字完全相同**的格子合并成 colspan
      //
      //   head: 部门, 上半年, 上半年, 下半年, 下半年
      //   → <th>部门</th><th colspan="2">上半年</th><th colspan="2">下半年</th>
      //
      // 非相邻的相同文字不合并（中间隔了别的才算两列）。
      const mergeRow = (cells: string[]): string => {
        const out: string[] = [];
        let i = 0;
        while (i < cells.length) {
          const text = cells[i];
          let span = 1;
          // 往后数连续相同的
          while (i + span < cells.length && cells[i + span] === text) span++;
          const spanAttr = span > 1 ? ` colspan="${span}"` : '';
          out.push(`<th class="mdh-table-th"${spanAttr}>${inline(text, numbers, opts)}</th>`);
          i += span;
        }
        return out.join('');
      };
      // 表头行加类（2026-11-22）：数据行有 mdh-row，表头行原来没有，
      // 导致「给表头整行上底色」只能写 `.mdh-table thead tr` ——
      // 嵌套表格时会同时命中内外两层。
      const thead = head.length
        ? `<thead>${head
            .map((cells) => `<tr class="mdh-head-row">${mergeRow(cells)}</tr>`)
            .join('')}</thead>`
        : '';
      const tbody = `<tbody>${rows
        .map((r) => renderNode(r, numbers, opts))
        .join('')}</tbody>`;
      // 有 caption → 显示题注 + 编号
      // 只有 ref 没 caption → 也要输出一个只带编号的 caption（V10）
      //   规范 §14：「只写 name 时，表格上方显示 Table 1」
      const cap = any.caption
        ? captionEl('caption', any.caption, node, numbers, opts)
        : numbers.byNode.get(node.id) !== undefined
          ? captionEl('caption', '', node, numbers, opts)
          : '';
      return `<table${a}>${cap}${thead}${tbody}</table>`;
    }

    case 'tableRow': {
      const cells = (any.cells as string[]) ?? [];
      const ids = (any.cellIds as string[]) ?? [];
      return `<tr${a}>${cells
        .map((c, i) => {
          const cellId = ids[i];
          const cellAttr =
            opts.includeIds !== false && cellId ? ` data-mdh-id="${esc(cellId)}"` : '';
          return `<td class="mdh-table-td"${cellAttr}>${inline(c, numbers, opts)}</td>`;
        })
        .join('')}</tr>`;
    }

    case 'column': {
      const cols = (any.columnBlocks as AnyNode[][]) ?? [];
      const ids = (any.columnIds as string[]) ?? [];
      const ratios = (any.ratios as number[]) ?? [];

      // 宽度比作为数据输出，CSS 用它设置 grid-template-columns
      const ratioAttr = ratios.length > 0 ? ` data-mdh-ratios="${ratios.join(',')}"` : '';

      const inner = cols
        .map((blocks, i) => {
          const cid = ids[i];
          const cAttr = opts.includeIds !== false && cid ? ` data-mdh-id="${esc(cid)}"` : '';
          const content = blocks.map((b) => renderNode(b, numbers, opts)).join('\n');
          return `<div class="mdh-col"${cAttr} data-mdh-type="columnItem">${content}</div>`;
        })
        .join('');
      return `<div${a}${ratioAttr}>${inner}</div>`;
    }

    case 'math': {
      // 有 caption 或占了编号 → figure + figcaption（编号要落到 figcaption 上才显示）
      // 两者都没有 → 纯 div，最轻
      const numbered = numbers.byNode.get(node.id) !== undefined;
      if (any.caption || numbered) {
        return (
          `<figure${a}>` +
          `<div class="mdh-math-body" data-mdh-latex="${esc(JSON.stringify(any.latex))}"></div>` +
          captionEl('figcaption', String(any.caption ?? ''), node, numbers, opts) +
          `</figure>`
        );
      }
      return `<div${a} data-mdh-latex="${esc(JSON.stringify(any.latex))}"></div>`;
    }

    case 'chart': {
      const payload = JSON.stringify({ chartType: any.chartType, headers: any.headers, rows: any.rows });
      // V10：只有 ref 没 caption 时也要出 figcaption，否则编号没地方显示
      const cap =
        any.caption || numbers.byNode.get(node.id) !== undefined
          ? captionEl('figcaption', any.caption ?? '', node, numbers, opts)
          : '';
      return `<figure${a}><div class="mdh-chart-body" data-mdh-chart="${esc(payload)}"></div>${cap}</figure>`;
    }

    case 'mermaid': {
      const cap =
        any.caption || numbers.byNode.get(node.id) !== undefined
          ? captionEl('figcaption', any.caption ?? '', node, numbers, opts)
          : '';
      return `<figure${a}><pre class="mdh-mermaid-body" data-mdh-source="${esc(any.source)}"></pre>${cap}</figure>`;
    }

    case 'code': {
      const langAttr = any.lang ? ` data-mdh-lang="${esc(any.lang)}"` : '';
      const titleAttr = any.title ? ` data-mdh-title="${esc(any.title)}"` : '';
      /*
       * 所有代码块都输出顶栏（作者 2026-11-22）
       *
       * 原先只在「有文件名或语言」时才出顶栏，于是：
       *   ```        → 光秃秃一块灰底，和旁边的正文段落界限不清
       *   ```ts      → 有顶栏
       * 同一份文档里两种样子，读者会以为格式坏了。
       *
       * 现在一律输出：没文件名就空着，没语言也不显示语言，
       * 复制按钮由第三层 JS 注入到顶栏右侧——没有任何内容的顶栏
       * 仍然起到「这是一块代码」的视觉分界作用。
       */
      const head =
        `<div class="mdh-code-head">` +
        (any.title ? `<span class="mdh-code-title">${esc(any.title)}</span>` : '') +
        (any.lang ? `<span class="mdh-code-lang">${esc(any.lang)}</span>` : '') +
        `</div>`;
      /*
       * 行号（作者 2026-11-25）
       *
       * 用 CSS 计数器而不是把数字写进 DOM：
       *   · 数字是「显示」不是「数据」，第二层不该输出文字（同编号的约定）；
       *   · 复制代码时不会把行号一起复制走；
       *   · 主题可以一条 CSS 关掉行号。
       *
       * 结构：每行一个 <span class="mdh-code-line">，CSS 用 counter 递增出序号。
       *
       * ⚠️ 行之间不能留 `\n`：.mdh-code-line 是 display:block，本身就会换行，
       *    再留换行符会被当成空白文本，每两行之间多撑出一行。
       */
      const content = String(any.content ?? '');
      const lines = content.replace(/\n$/, '').split('\n');
      const body = lines
        .map((line) => `<span class="mdh-code-line">${esc(line)}</span>`)
        .join('');
      return `<pre${a}${langAttr}${titleAttr}>${head}<code class="mdh-code-content">${body}</code></pre>`;
    }

    case 'page': {
      // `@page` 只服务 slides：容器 + 每页一个 section
      const slides = (any.slides as AnyNode[]) ?? [];
      const inner = slides.map((s) => renderNode(s, numbers, opts)).join('\n');
      const preset = any.preset ? ` data-mdh-preset="${esc(any.preset)}"` : '';
      return `<div${a}${preset} data-mdh-slide-count="${slides.length}">${inner}</div>`;
    }

    case 'slide': {
      const kids = ((any.children as AnyNode[]) ?? [])
        .map((c) => renderNode(c, numbers, opts))
        .join('\n');
      const total = numbers.slideTotal > 0 ? ` data-mdh-slide-total="${numbers.slideTotal}"` : '';
      /*
       * 内层包裹 `.mdh-slide-inner`（2026-11-25）
       *
       * ── 为什么现在要加 ──
       * 一张图比页面高时，需要按「可用宽高的较小值」等比缩小。
       * 纯 CSS 能做到，但**要求图外面有一层容器**：
       *   section（固定 16:9，padding）
       *     └ div.mdh-slide-inner（flex，撑满可用区）
       *         └ figure > svg（max-height: 100%，等比缩）
       * 没有这一层时，`max-height: 100%` 的百分比无处可依，
       * 图只能按自身高度撑破页面。
       *
       * 主题层早就写了 `.mdh-slide-inner` 的样式，但渲染层一直没输出这个元素 ——
       * 现在补上，让样式真正生效，接入方不需要额外调任何 JS。
       */
      return `<section${a} data-mdh-index="${any.index}"${total}><div class="mdh-slide-inner">${kids}</div></section>`;
    }

    case 'quote': {
      const kids = ((any.children as AnyNode[]) ?? [])
        .map((c) => renderNode(c, numbers, opts))
        .join('\n');
      return `<blockquote${a}>${kids}</blockquote>`;
    }

    case 'block': {
      const name = any.blockName;
      // 所有 block 都带 data-mdh-block，供交互层识别具体类型
      const blockAttr = ` data-mdh-block="${esc(name)}"`;
      if (name === 'divider') return `<hr${a}${blockAttr}>`;
      if (name === 'toc') return `<nav${a}${blockAttr}>${TOC_PLACEHOLDER}</nav>`;
      // V8：多行 HTML 块原样输出（不转义、不包 <pre>）
      //   `<details>` … `</details>` 这类结构要交给浏览器解析，
      //   中间的每一行都过一遍行内处理（这样 `**加粗**` 仍然生效）。
      if (name === 'html') {
        const body = ((any.lines as string[]) ?? [])
          .map((l) => (l.trim() === '' ? '' : inline(l, numbers, opts)))
          .join('\n');
        return `<div${a}${blockAttr}>${body}</div>`;
      }
      return `<div${a}${blockAttr}><pre>${esc(
        ((any.lines as string[]) ?? []).join('\n'),
      )}</pre></div>`;
    }

    default:
      return `<div${a}></div>`;
  }
}
