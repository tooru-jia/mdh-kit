/**
 * 目录（TOC）生成
 *
 * ── 为什么不能在渲染单个节点时生成 ──
 * 目录的内容来自「全文所有标题」，而渲染到 @toc 那一行时，
 * 后面的标题还没渲染。所以必须分三步：
 *
 *   ① 渲染时认整行 @toc → 输出一个空占位 <nav class="mdh-toc"></nav>
 *   ② 整篇渲染完成后，遍历全树收标题
 *   ③ 用占位符把真实目录塞回去
 *
 * ── 收录范围 ──
 * H1–H4。H5 / H6 不进目录（太细，目录会失控）。
 *
 * ── 必须遍历所有容器 ──
 * 只走 children 会漏掉 :::column / :::page(slides) 里的标题。
 * 四类口子：children / rows / columnBlocks / slides
 */

import type { AnyNode, HeadingNode, RootNode } from '@mdh-kit/core';

/** 目录里的一条 */
export interface TocEntry {
  /** 层级 1–4 */
  level: number;
  /** 标题文字（不含 # 与锚） */
  text: string;
  /** 标题节点的 ID，用于生成跳转锚 */
  id: string;
}

/** 收录的最大层级 */
export const TOC_MAX_LEVEL = 4;

/** 占位符：整篇渲染完后用它定位并替换 */
export const TOC_PLACEHOLDER = '<!--MDH_TOC_PLACEHOLDER-->';

/** 一个节点的所有子节点（覆盖四种容器口子） */
export function childNodesOf(node: AnyNode): AnyNode[] {
  const any = node as any;
  return [
    ...(Array.isArray(any.children) ? any.children : []),
    ...(Array.isArray(any.rows) ? any.rows : []),
    ...(Array.isArray(any.columnBlocks) ? any.columnBlocks.flat() : []),
    ...(Array.isArray(any.slides) ? any.slides : []),
  ];
}

/**
 * 按文档顺序收集所有 H1–H4
 *
 * 深度优先，保证「先出现的标题先入目录」。
 */
export function collectTocEntries(root: RootNode): TocEntry[] {
  const out: TocEntry[] = [];

  const walk = (node: AnyNode): void => {
    if (node.type === 'heading') {
      const h = node as HeadingNode;
      if (h.level >= 1 && h.level <= TOC_MAX_LEVEL) {
        out.push({ level: h.level, text: h.text, id: h.id });
      }
      // 标题没有子节点，直接返回
      return;
    }
    for (const kid of childNodesOf(node)) walk(kid);
  };

  for (const kid of root.children) walk(kid);
  return out;
}

/**
 * 生成目录 HTML
 *
 * 层级用嵌套 <ul> 表达。做法是**先建树再序列化**——
 * 直接用字符串拼闭合标签很容易多一个或少一个 </li>，
 * 建树能让结构天然正确。
 *
 * 只输出结构 + data 属性，不含任何行内样式：
 * 缩进几 em、什么颜色，全由主题层的 CSS 决定。
 */
export function buildTocHtml(entries: TocEntry[]): string {
  if (entries.length === 0) {
    return '<p class="mdh-toc-empty">（文档中还没有标题）</p>';
  }

  interface TocNode {
    entry: TocEntry;
    children: TocNode[];
  }

  // 建树：栈顶永远是「当前能当父节点的最后一个条目」
  const roots: TocNode[] = [];
  const stack: TocNode[] = [];

  for (const e of entries) {
    const node: TocNode = { entry: e, children: [] };
    // 弹出所有「层级 >= 当前」的节点，它们的父级才是当前的父
    while (stack.length && stack[stack.length - 1].entry.level >= e.level) {
      stack.pop();
    }
    if (stack.length === 0) roots.push(node);
    else stack[stack.length - 1].children.push(node);
    stack.push(node);
  }

  const render = (nodes: TocNode[]): string =>
    `<ul class="mdh-toc-list">${nodes
      .map((n) => {
        const e = n.entry;
        return (
          `<li class="mdh-toc-item" data-mdh-toc-level="${e.level}">` +
          `<a class="mdh-toc-link" href="#${escapeAttr(e.id)}" ` +
          `data-mdh-toc-text="${escapeAttr(e.text)}">${escapeText(e.text)}</a>` +
          (n.children.length ? render(n.children) : '') +
          `</li>`
        );
      })
      .join('')}</ul>`;

  return `<div class="mdh-toc-list-wrap">${render(roots)}</div>`;
}

/** 把整篇 HTML 里的所有 TOC 占位替换成真实目录 */
export function fillTocPlaceholders(html: string, tocHtml: string): string {
  return html.split(TOC_PLACEHOLDER).join(tocHtml);
}

const escapeText = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const escapeAttr = (s: string): string => escapeText(s);
