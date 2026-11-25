/**
 * 编号与引用索引
 *
 * 编号是**呈现产物**，不在 AST 里（见 AST-SPEC v0.2）。
 * 这里按对象出现顺序计算，并建立引用索引。
 *
 * 三套独立序列（第二层只出数字，措辞归第三层 CSS）：
 *   table      —— 表
 *   figure     —— chart 与 mermaid 共用
 *   equation   —— math
 *
 * 规则：只有写了 ref 的对象才占号（与 SYNTAX.md 一致）。
 */

import type { AnyNode, BlockNode, RootNode } from '@mdh-kit/core';
import {
  buildFootnoteIndex,
  extractFootnoteDefs,
  type FootnoteIndex,
} from './footnotes.ts';

export interface NumberInfo {
  /** nodeId → 编号数字，如 "1"（措辞由第三层 CSS 拼） */
  byNode: Map<string, string>;
  /** nodeId → 纯数字，如 "1"（供 HTML data 属性使用） */
  valueByNode: Map<string, string>;
  /** nodeId → 类别，如 "table" / "figure" / "equation" */
  kindByNode: Map<string, string>;
  /** 名字 → nodeId（name= 声明的对象） */
  nameToNode: Map<string, string>;
  /** 名字 → 引用它的节点 ID 列表 */
  references: Map<string, string[]>;
  /** slides 总页数（无 slides 时为 0） */
  slideTotal: number;
  /**
   * 脚注索引（名字 → 编号 + 内容）
   *
   * 由 render() 在渲染前建立；单独调 renderInline 时可能为空。
   */
  footnotes?: FootnoteIndex;
}

/** 遍历所有节点（含嵌套） */
const walkAll = (node: AnyNode, visit: (n: AnyNode) => void) => {
  visit(node);
  const any = node as any;
  if (Array.isArray(any.children)) any.children.forEach((c: AnyNode) => walkAll(c, visit));
  if (node.type === 'table' && Array.isArray(any.rows)) {
    any.rows.forEach((r: AnyNode) => walkAll(r, visit));
  }
  if (Array.isArray(any.columnBlocks)) {
    any.columnBlocks.forEach((col: AnyNode[]) => col.forEach((c) => walkAll(c, visit)));
  }
  if (Array.isArray(any.slides)) any.slides.forEach((s: AnyNode) => walkAll(s, visit));
};

/** 从一行文字里找出所有的 @名字 引用 */
export const findReferences = (text: string): string[] => {
  const out: string[] = [];
  // @名字：@ 后跟非空白、非括号的字符；排除 @tag( / @foot( / @link( 这些带括号的
  const re = /@([^\s()\[\]，。、；：！？]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m[1]);
  }
  return out;
};

/** 取节点里所有可被引用的文本行 */
const textLinesOf = (node: AnyNode): string[] => {
  const any = node as any;
  const lines: string[] = [];
  for (const k of ['lines', 'text', 'source', 'latex', 'content']) {
    const v = any[k];
    if (typeof v === 'string') lines.push(v);
    else if (Array.isArray(v)) v.forEach((x) => typeof x === 'string' && lines.push(x));
  }
  return lines;
};

/**
 * 计算全文编号 + 引用索引
 *
 * 顺序很重要：编号按文档顺序，引用按名字解析。
 */
export function computeNumbers(
  ast: RootNode,
  source?: string,
  footnoteDefs?: Array<{ name: string; content: string }>,
): NumberInfo {
  const byNode = new Map<string, string>();
  const valueByNode = new Map<string, string>();
  const kindByNode = new Map<string, string>();
  const nameToNode = new Map<string, string>();

  let tableSeq = 0;
  let figureSeq = 0;
  let mathSeq = 0;

  // 第一遍：编号 + ref 索引
  //
  // DECISION-4：第二层只输出**编号数字**，不拼任何语言措辞。
  // 措辞（Table / 表 / Figure / 图 / Eq. / 式）归第三层主题，用 CSS ::before 拼。
  // 判据：词语没有语义，数字才有语义 —— 换措辞不改变文档含义。
  //
  // 编号依据（作者 2026-11-21 拍定）：**看 caption，不看 ref**。
  //   caption 是给人看的题注，编号跟它走才是「读者能看见的编号」；
  //   ref 只负责让 `@名字` 能跳过来，两件事互不绑定。
  //   组合关系：
  //     ref + caption → 能跳转 + 显示编号
  //     ref 无 caption → 能跳转，不显示编号
  //     无 ref 有 caption → 显示编号，不能跳转
  //     都没有        → 既不跳转也不编号
  walkAll(ast, (n) => {
    const any = n as any;
    const name: string | undefined = any.name;
    const numbered = !!any.caption;

    if (n.type === 'table') {
      if (numbered) {
        tableSeq++;
        byNode.set(n.id, String(tableSeq));
        valueByNode.set(n.id, String(tableSeq));
        kindByNode.set(n.id, 'table');
      }
    } else if (n.type === 'chart' || n.type === 'mermaid') {
      if (numbered) {
        figureSeq++;
        byNode.set(n.id, String(figureSeq));
        valueByNode.set(n.id, String(figureSeq));
        kindByNode.set(n.id, 'figure');
      }
    } else if (n.type === 'math') {
      if (numbered) {
        mathSeq++;
        byNode.set(n.id, String(mathSeq));
        valueByNode.set(n.id, String(mathSeq));
        kindByNode.set(n.id, 'equation');
      }
    }

    if (name && !nameToNode.has(name)) nameToNode.set(name, n.id);
  });

  // 第二遍：引用索引
  const references = new Map<string, string[]>();
  walkAll(ast, (n) => {
    for (const line of textLinesOf(n)) {
      for (const ref of findReferences(line)) {
        const list = references.get(ref) ?? [];
        if (!list.includes(n.id)) list.push(n.id);
        references.set(ref, list);
      }
    }
  });

  // slides 总页数（一篇文档只有一个 page 节点）
  const page = ast.children.find((c) => (c as unknown as { type: string }).type === 'page') as
    | { slides?: unknown[] }
    | undefined;
  const slideTotal = Array.isArray(page?.slides) ? page.slides.length : 0;

  // 脚注：需要整篇源码才能按「首次插入顺序」编号
  // 不传源码时退化为「按 AST 遍历顺序」，两种传法编号可能不同
  let footnotes: FootnoteIndex | undefined;
  if (source) {
    // 定义优先用调用方传入的（parse() 已摘出，含真实内容）；
    // 没有时才从源码里重新提取（BUG-10）
    const defs = footnoteDefs ?? extractFootnoteDefs(source).defs;
    footnotes = buildFootnoteIndex(source, defs);
  } else {
    const collected: string[] = [];
    walkAll(ast, (n) => {
      for (const line of textLinesOf(n)) collected.push(line);
    });
    footnotes = buildFootnoteIndex(collected.join('\n'), footnoteDefs ?? []);
  }

  return { byNode, valueByNode, kindByNode, nameToNode, references, slideTotal, footnotes };
}

/** 只算编号（不含引用索引），用于快速比对 */
export function computeNumberMap(ast: RootNode): Map<string, string> {
  return computeNumbers(ast).byNode;
}

export type { BlockNode };
