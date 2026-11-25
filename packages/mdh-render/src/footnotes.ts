/**
 * 脚注收集与编号（第二层）
 *
 * mdh 的脚注写法：
 *   @foot(名字)          插入（正文显示为上标）
 *   @foot(名字): 内容    定义（可写在任意位置，自动收集到文末）
 *
 * 编号规则（SYNTAX §7.1）：
 *   - 用户写名字，不写编号
 *   - 按「首次插入出现」的顺序编号 1、2、3
 *   - 同一脚注被多处插入，共用同一个编号
 *
 * ⚠️ 四个待确认项（见 SYNTAX.md 的 ⚠️ 标记，当前按括号里的默认处理）：
 *   1. 脚注内容多行 —— 暂不支持，按单行处理
 *   2. 脚注内富内容（列表/代码块）—— 暂不支持，仅解析行内格式
 *   3. 引用了但未定义 —— 输出上标但不跳转，并记一条警告
 *   4. 定义了但未引用 —— 仍然输出到文末
 */

/** 一行脚注定义：@foot(名字): 内容 */
const DEF_RE = /^@foot\(([^)]+)\)\s*[:：]\s*(.*)$/;

export interface FootnoteDef {
  name: string;
  content: string;
}

export interface FootnoteEntry {
  name: string;
  /** 编号（按首次插入顺序，从 1 开始） */
  number: number;
  content: string | null;
  /** 有定义吗（false = 引用了但没定义） */
  defined: boolean;
}

export interface FootnoteIndex {
  /** 名字 → 条目 */
  byName: Map<string, FootnoteEntry>;
  /** 按编号顺序的列表（文末输出用） */
  ordered: FootnoteEntry[];
  /** 问题（未定义就引用） */
  warnings: string[];
}

/**
 * 判断一行是不是脚注定义，是则返回定义，否则 null
 *
 * 定义必须独占一行（块级），不能混在段落里 —— 否则用户无法控制它的位置。
 */
export function parseFootnoteDef(line: string): FootnoteDef | null {
  const m = DEF_RE.exec(line.trim());
  if (!m) return null;
  return { name: m[1].trim(), content: m[2].trim() };
}

/**
 * 建立脚注索引
 *
 * @param source 整篇源码（用来按出现顺序扫插入点）
 * @param defs   已摘出的定义列表
 */
export function buildFootnoteIndex(source: string, defs: FootnoteDef[]): FootnoteIndex {
  const byName = new Map<string, FootnoteEntry>();
  const ordered: FootnoteEntry[] = [];
  const warnings: string[] = [];

  const defMap = new Map(defs.map((d) => [d.name, d.content]));

  // 按首次出现顺序扫描插入点（跳过定义行本身：定义行是 "@foot(x): "，带冒号）
  const insertRe = /@foot\(([^)]+)\)(?!\s*[:：])/g;
  let m: RegExpExecArray | null;
  while ((m = insertRe.exec(source)) !== null) {
    const name = m[1].trim();
    if (byName.has(name)) continue; // 已编号，共用一个号

    const content = defMap.get(name);
    if (content === undefined) {
      warnings.push(`脚注「${name}」被引用但没有定义`);
    }

    const entry: FootnoteEntry = {
      name,
      number: ordered.length + 1,
      content: content ?? null,
      defined: content !== undefined,
    };
    byName.set(name, entry);
    ordered.push(entry);
  }

  // 定义了但没被引用：追加到末尾，保留内容
  for (const d of defs) {
    if (byName.has(d.name)) continue;
    const entry: FootnoteEntry = {
      name: d.name,
      number: ordered.length + 1,
      content: d.content,
      defined: true,
    };
    byName.set(d.name, entry);
    ordered.push(entry);
  }

  return { byName, ordered, warnings };
}

/** 脚注编号的锚点 ID */
export const footAnchorId = (name: string): string =>
  `mdh-foot-${name.replace(/[^\w\u4e00-\u9fa5-]/g, '_')}`;

/**
 * 从源码里摘掉所有脚注定义行
 *
 * 返回「去掉定义行的源码」+ 定义列表。
 * 摘掉是为了不让定义行变成段落的一部分。
 */
export function extractFootnoteDefs(source: string): {
  source: string;
  defs: FootnoteDef[];
} {
  const defs: FootnoteDef[] = [];
  const kept: string[] = [];

  for (const line of source.split('\n')) {
    const def = parseFootnoteDef(line);
    if (def) {
      defs.push(def);
      kept.push(''); // 留空行，避免把上下两个段落粘在一起
    } else {
      kept.push(line);
    }
  }

  return { source: kept.join('\n'), defs };
}
