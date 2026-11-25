/**
 * 行分类：把每一行源码分类为语法类型
 *
 * 依据 SYNTAX.md：
 * 行首 `//` 开头的 → 注释（独占一行）
 * - 行首 `***` + 已知块名 → 块开始
 * - 行首 `***` + 已知块名-end → 块结束
 * - 行首 `***` 单独成行 → 分割线
 * - 行首 `@page(...)` / `@next-slide` / `@next-column` / `@toc` → 文档级指令
 * - 行首 `#` → 标题
 * - 行首 `-` / `1.` → 列表项
 * - 行首 `>` → 引用
 * - 行首 `-----` → 分割线
 * - 空行 → 空行
 * - 其它 → 正文
 */

/** 已知块名清单（见 SYNTAX.md「已规划的块」） */
export const KNOWN_BLOCKS = new Set([
  'list',
  'column',
  'table',
  'chart',
  'math',
  'mermaid',
]);

export type LineKind =
  | 'blank'
  | 'comment'
  | 'frontmatterDelim'
  | 'unknownBlock'
  | 'blockStart'
  | 'blockEnd'
  | 'heading'
  | 'listItem'
  | 'quote'
  | 'divider'
  | 'directive'
  | 'codeFenceStart'
  | 'codeFenceEnd'
  | 'codeContent'
  | 'htmlTag'
  | 'text';

export interface ParsedLine {
  /** 行号，从 1 开始 */
  no: number;
  /** 原始行内容（不含换行符） */
  raw: string;
  /** 缩进宽度（Tab 按 1 计，空格按 1 计，只用于比较大小） */
  indent: number;
  kind: LineKind;
  /** 去掉缩进后的内容 */
  content: string;
  /** heading: 级别 */
  level?: number;
  /** blockStart / blockEnd: 块名 */
  blockName?: string;
  /** blockStart: 块的引用名，对应 ref="值"；blockEnd: 闭合标记里的名字 */
  blockNameTag?: string;
  /**
   * blockStart: `-标签` 里的标签（`***list-abc` 的 `abc`）
   *
   * 与 ref 名分开：ref 是内容层的引用名，这个是语法层的位置标记，
   * 只有闭合校验用它。早先混用 blockNameTag，导致
   *   · 有 ref 名时 `-标签` 被顶掉
   *   · 拿 ref 名去校验收合的荒唐行为
   */
  blockTag?: string;
  /** blockStart: 位置参数 */
  params?: string[];
  /** blockStart: 题注 caption="值" */
  caption?: string;
  /** blockStart: ref 值含非法字符时的原始值（用于报诊断） */
  invalidRef?: string;
  /** codeFenceStart: 语言标识，如 ts */
  codeLang?: string;
  /** codeFenceStart: 文件名 title="值" */
  codeTitle?: string;
  /** listItem: 标记（'-' 或有序数字） */
  marker?: string;
  /** listItem: 是否有序 */
  ordered?: boolean;
  /** listItem: 任务列表状态 */
  task?: boolean;
  /** directive: 指令名，如 page / toc / next-slide / next-column */
  directive?: string;
}

/**
 * 已知文档级指令（独占一行、无闭合）
 *
 * ⚠️ `title` 已移除（2026-11-25）——它降级为**预留关键字**：
 *    写法保留、将来会实现，现在原样显示，不产出任何结构。
 *    见 SYNTAX-INTRODUCTION §十四「保留关键字」。
 */
export const KNOWN_DIRECTIVES = new Set(['page', 'toc', 'next-slide', 'next-column']);

/** 解析 @ 指令：@page(slides) / @toc / @next-slide / @next-column
 *
 * 只认「整行就是一个已知指令」，行内出现的 @ 一律不在这里处理（交给行内解析）。
 */
function parseDirective(content: string): { directive: string; params?: string[] } | null {
  const m = content.match(/^@([a-z][a-z-]*)(?:\(([^)]*)\))?\s*$/);
  if (!m) return null;
  const directive = m[1];
  if (!KNOWN_DIRECTIVES.has(directive)) return null;
  const raw = (m[2] ?? '').trim();
  const params = raw ? raw.split('/').map((s) => s.trim()).filter(Boolean) : undefined;
  return { directive, params };
}

/** 计算缩进：Tab 与空格都按 1 计，只用于比较大小 */
function countIndent(line: string): number {
  let n = 0;
  for (const ch of line) {
    if (ch === ' ' || ch === '\t') n++;
    else break;
  }
  return n;
}

/** ref 的合法字符集（DECISION-2）
 *
 * 中文、字母、数字、下划线、短横线。
 * 不允许空格、逗号、括号、引号 —— 因为 `@引用` 扫描到这些字符就停，
 * 允许写入一个永远引用不到的名字是最坏的静默失效。
 */
export const REF_CHARSET_RE = /^[\w\u4e00-\u9fa5-]+$/;

/** 解析块标记行的参数与名字：***column(1fr/1fr) ref="对比" caption="说明"
 *
 * 注意：`/` 仅在 column 的 fr 列表里作分隔符。
 * page 的比值（如 slides-16/9）属于单个参数，不能拆。
 */
function parseBlockHeader(
  rest: string,
  blockName?: string,
): {
  params: string[];
  name?: string;
  caption?: string;
  /** 命名标签（`***list-abc` 里的 `abc`），用于校验闭合 */
  blockTag?: string;
  /** ref 值里出现了非法字符（空格 / 逗号等），供上层报诊断 */
  invalidRef?: string;
} {
  const params: string[] = [];
  let name: string | undefined;
  let caption: string | undefined;
  let blockTag: string | undefined;
  let invalidRef: string | undefined;
  let i = 0;

  /*
   * 命名标签：`***list-abc` / `***table-甲` 里的 `-abc` / `-甲`（2026-11-25）
   *
   * 早先这里完全没解析，`-abc` 被当空气丢掉，于是
   *   · 开始标签的 blockNameTag 永远是 undefined
   *   · 闭合校验没法判断「名字对不对」
   * 现在把它取出来，交给 collectBlock 做配对校验。
   */
  const tagMatch = /^-([^\s(]+)/.exec(rest);
  if (tagMatch) {
    blockTag = tagMatch[1];
    i = tagMatch[0].length;
  }

  // 位置参数 (a/b/c)
  if (rest[i] === '(') {
    const end = rest.indexOf(')', i);
    if (end !== -1) {
      const inner = rest.slice(i + 1, end).trim();
      // 只有 column 用 `/` 分隔多个 fr 值；其它块的 `/` 属于值本身
      if (inner) {
        const parts = blockName === 'column' ? inner.split('/') : [inner];
        params.push(...parts.map((s) => s.trim()));
      }
      i = end + 1;
    }
  }

  // 命名参数 ref="值" / caption="值"
  //
  // `ref` 是引用名：唯一用途是被 `@ref` 引用（DECISION-2），
  // 所以字符集必须和 `@引用` 的扫描规则一致。
  // `caption` 是给人读的题注，允许空格与逗号，不校验。
  const remain = rest.slice(i).trim();
  const refMatch = remain.match(/\bref\s*=\s*"([^"]*)"/);
  if (refMatch) {
    const value = refMatch[1];
    // 允许写 `.` 的旧习惯，但规范化时按字符集判定
    if (REF_CHARSET_RE.test(value)) {
      name = value;
    } else {
      invalidRef = value;
      // 仍然存下来（宽松解析），只是同时报诊断
      name = value;
    }
  }
  const capMatch = remain.match(/\bcaption\s*=\s*"([^"]*)"/);
  if (capMatch) caption = capMatch[1];

  return { params, name, caption, blockTag, invalidRef };
}

/** 分类单行 */
export function classifyLine(raw: string, no: number): ParsedLine {
  const indent = countIndent(raw);
  const content = raw.slice(indent);

  // 空行
  if (content.trim() === '') {
    return { no, raw, indent, kind: 'blank', content: '' };
  }

  // 分割线：3 个及以上短横线，独占一行（与列表 -项、删除线 --文字-- 不冲突）
  if (/^-{3,}$/.test(content)) {
    return { no, raw, indent, kind: 'divider', content };
  }

  // 元信息边界：=== 独占一行（内容由 assembleLines 成对收集，见下）
  if (content.trim() === '===') {
    return { no, raw, indent, kind: 'frontmatterDelim', content };
  }

  // 注释：行首 // 开头（不分块名，一律注释）
  if (content.startsWith('//')) {
    return { no, raw, indent, kind: 'comment', content };
  }

  // 文档级指令：@page(...) / @next-slide / @next-column / @toc（独占一行，无闭合）
  if (content.startsWith('@')) {
    const instr = parseDirective(content);
    if (instr) return { no, raw, indent, kind: 'directive', content, ...instr };
  }

  // 块标记：***块名 / ***块名-end / ***块名-名字-end
  //
  // 单独一行的 `***` 曾经等价于分割线，现已废弃（作者 2026-11-21）：
  // 一个符号背两种职责会让判定变复杂，分割线只保留 `---`。
  if (content.startsWith('***')) {
    const after = content.slice(3);
    const nameMatch = after.match(/^([a-zA-Z]+)(.*)$/);
    if (nameMatch) {
      const blockName = nameMatch[1];
      let rest = nameMatch[2];

      if (KNOWN_BLOCKS.has(blockName)) {
        // 结尾标记：-end 或 -名字-end
        const endMatch = rest.match(/^-([^\s(]*?)-end\b(.*)$/) ?? rest.match(/^-end\b(.*)$/);
        if (endMatch) {
          const tag = endMatch[1] || undefined;
          return {
            no,
            raw,
            indent,
            kind: 'blockEnd',
            content,
            blockName,
            blockNameTag: tag,
          };
        }
        // 开始标记
        const { params, name, caption, blockTag, invalidRef } = parseBlockHeader(rest, blockName);
        return {
          no,
          raw,
          indent,
          kind: 'blockStart',
          content,
          blockName,
          params,
          caption,
          /*
           * 两个名字分开存，各管各的：
           *   blockNameTag ← ref="员工" 的引用名（内容层，给 @员工 用）
           *   blockTag     ← -甲 的位置标记（语法层，只给闭合校验用）
           */
          blockNameTag: name,
          ...(blockTag !== undefined ? { blockTag } : {}),
          ...(invalidRef !== undefined ? { invalidRef } : {}),
        };
      }
      // 未知块名 → 整块忽略（含内容行，直到对应的 -end）
      return {
        no,
        raw,
        indent,
        kind: 'unknownBlock',
        content,
        blockName,
      };
    }
    return { no, raw, indent, kind: 'comment', content };
  }

  // 标题：# ~ ###### （# 后不要求空格）
  const h = content.match(/^(#{1,6})(.*)$/);
  if (h) {
    const text = h[2].replace(/^ /, '').trim();
    return {
      no,
      raw,
      indent,
      kind: 'heading',
      content,
      level: h[1].length,
      // 标题文本暂存于 marker
      marker: text,
    };
  }

  // 引用：>
  if (content.startsWith('>')) {
    return {
      no,
      raw,
      indent,
      kind: 'quote',
      content,
      marker: content.slice(1).replace(/^ /, ''),
    };
  }

  // 列表项：- 或 1.
  const orderedMatch = content.match(/^(\d+)\.(.*)$/);
  if (orderedMatch) {
    const rest = orderedMatch[2];
    const taskMatch = rest.match(/^\s*\[([ xX])\]\s?(.*)$/);
    return {
      no,
      raw,
      indent,
      kind: 'listItem',
      content,
      marker: orderedMatch[1],
      ordered: true,
      task: taskMatch ? taskMatch[1].toLowerCase() === 'x' : undefined,
    };
  }

  // 无序列表项：行首 `-`，但后面不能紧跟 `-`
  // `--文字--` 是删除线，不是列表（见 DECISION-1 / SYNTAX.md §6）
  const unorderedMatch = content.match(/^-(?!-)(.*)$/);
  if (unorderedMatch) {
    const rest = unorderedMatch[1];
    const taskMatch = rest.match(/^\s*\[([ xX])\]\s?(.*)$/);
    return {
      no,
      raw,
      indent,
      kind: 'listItem',
      content,
      marker: '-',
      ordered: false,
      task: taskMatch ? taskMatch[1].toLowerCase() === 'x' : undefined,
    };
  }

  // HTML 标签行：独占一行、整行只有一个标签时，单独成块（V8）
  //
  // 多行 HTML（`<details>` … `</details>`）如果按普通文本拼进段落，
  // 会被 `<p>` 截断、被 `<br>` 撑开。这里单独标记，交给渲染层原样输出。
  if (/^\s*<\/?[a-zA-Z][^<>]*>\s*$/.test(content)) {
    return { no, raw, indent, kind: 'htmlTag', content };
  }

  // 其它：正文
  return { no, raw, indent, kind: 'text', content };
}

/** 批量分类
 *
 * 三反引号代码块需要「跨行状态」：进入 fence 后，后续所有行都算代码内容，
 * 直到遇到同长度的 fence 结束标记。因此在批量处理时维护状态。
 */
export function classifyLines(source: string): ParsedLine[] {
  const raw = source.split('\n').map((l) => l.replace(/\r$/, ''));
  const out: ParsedLine[] = [];

  let fenceLen = 0; // 0 = 不在代码块内
  let fenceIndent = 0;

  for (let i = 0; i < raw.length; i++) {
    const line = raw[i];
    const no = i + 1;
    const indent = countIndent(line);
    const content = line.slice(indent);

    // ---------- 在代码块内 ----------
    if (fenceLen > 0) {
      const close = content.match(/^`{3,}\s*$/);
      if (close && close[0].trim().length >= fenceLen) {
        out.push({ no, raw: line, indent, kind: 'codeFenceEnd', content });
        fenceLen = 0;
        fenceIndent = 0;
        continue;
      }
      out.push({ no, raw: line, indent, kind: 'codeContent', content: line });
      continue;
    }

    // ---------- 不在代码块内：检查是否是 fence 开始 ----------
    const open = content.match(/^(`{3,})\s*(.*)$/);
    if (open) {
      fenceLen = open[1].length;
      fenceIndent = indent;
      const info = open[2].trim();

      // info string：第一段是语言，形如 key="value" 的是属性
      const tokens = info.length > 0 ? info.split(/\s+/) : [];
      let lang: string | undefined;
      let title: string | undefined;
      if (tokens.length > 0 && !tokens[0].includes('=')) {
        lang = tokens.shift();
      }
      for (const t of tokens) {
        const m = t.match(/^(\w+)\s*=\s*"([^"]*)"$/);
        if (m && m[1] === 'title') title = m[2];
      }

      out.push({
        no,
        raw: line,
        indent,
        kind: 'codeFenceStart',
        content,
        codeLang: lang,
        codeTitle: title,
      });
      continue;
    }

    // ---------- 普通行 ----------
    out.push(classifyLine(line, no));
  }

  // 未闭合的 fence：把已标记为 codeContent 的行保留（宽松处理，不报错）
  return out;
}
