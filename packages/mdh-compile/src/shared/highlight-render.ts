/**
 * highlight.js 渲染（两个宿主共用）
 *
 * 同样是纯字符串处理，两个宿主共用。
 *
 * ⚠️ 正则必须允许 <pre> 与 <code> 之间有顶栏：
 *    第二层在「有语言」时会输出 <div class="mdh-code-head">（文件名 + 语言标签）。
 *    早期正则要求 data-mdh-lang 后紧接 <code>，导致所有带语言的代码块高亮失败。
 *    见 mdh-kit/LOG.md #18。
 *
 * ⚠️ highlight.js 是「外链」依赖，不打进浏览器产物：
 *    mdh 本体只输出结构，颜色靠页面上的 hljs。
 *    页面需提供 window.hljs（CDN 或本地共用文件）；缺失时输出纯文本，内容不受影响。
 *    Node 宿主仍用 lib/common（36 种常用语言，约 160KB）。
 *
 *    为什么 highlight 可以外链而 katex/chart 不行：
 *    公式和图表缺了就是空白（画不出来），代码缺颜色只是难看。
 *
 * ⚠️ 这里不 import highlight.js：
 *    iife 产物里 import CJS 包会留下 require('highlight.js/lib/common')，
 *    浏览器没有 require → 整个 bundle 启动失败。
 *    highlight 一律由页面提供 window.hljs（CDN 或本地共用文件）。
 */

/**
 * 取 hljs 实例：
 *   ① 宿主显式注入的（Node 宿主在模块加载时 setHljs 注入 common 版）
 *   ② 页面上的 window.hljs（浏览器宿主：CDN 或本地共用文件）
 *   ③ 都没有 → null，调用方降级为纯文本
 */
let injected: any | null = null;

/** 宿主注入 hljs 实例（Node 宿主用；浏览器宿主不需要） */
export function setHljs(instance: any): void {
  injected = instance;
}

function pickHljs(): any | null {
  if (injected?.highlight && injected.getLanguage) return injected;
  const g = globalThis as any;
  if (g.hljs?.highlight && g.hljs.getLanguage) return g.hljs;
  return null;
}

const encode = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * <pre ... data-mdh-lang="xx" ...> [顶栏] <code>原文</code> </pre>
 *
 * 第 4 组 between 是顶栏，原样保留；只替换 <code> 内容。
 */
/**
 * 匹配渲染层输出的代码块
 *
 * 结构（2026-11-22 起所有代码块都带顶栏）：
 *   <pre data-mdh-lang="ts" ...><div class="mdh-code-head">…</div><code>…</code></pre>
 *
 * 三个要点：
 *   1. `data-mdh-lang` 可以有也可以没有 —— 无语言的代码块同样要处理
 *      （此前正则强制要求该属性，导致 ```` ``` ```` 裸代码块从不高亮）
 *   2. `pre` 和 `<code>` 之间可能夹顶栏 `<div>`，必须先吃掉再取代码内容
 *   3. 代码内容里可能有 `<div>`（被转义成 &lt;），所以顶栏用具体的
 *      `mdh-code-head` 类名锚定，不会误吞代码
 */
export const CODE_RE =
  /(<pre[^>]*>)(<div class="mdh-code-head">[\s\S]*?<\/div>)?\s*<code(?:[^>]*)>([\s\S]*?)<\/code>\s*<\/pre>/g;

export interface HighlightRenderOptions {
  unknownLanguage?: 'auto' | 'plain';
}

/**
 * highlight.js 缺失时只警告一次
 *
 * 为什么不是每次：一篇文档里几十个代码块，每块都警告会刷屏。
 */
let warnedHljs = false;

function warnMissingHljsOnce(): void {
  if (warnedHljs) return;
  warnedHljs = true;
  const msg =
    '[mdh-kit] 未检测到 highlight.js，代码块将不带语法高亮（内容完整可读）。\n' +
    '  · Node：npm install highlight.js\n' +
    '  · 浏览器：页面引入 window.hljs（CDN 或本地文件）\n' +
    '  · 或用内置版：mdh-kit/full';
  if (typeof console !== 'undefined') console.warn(msg);
}

/** 对一段代码做高亮，返回 code 内部 HTML */
export function highlightCode(code: string, lang: string, opts: HighlightRenderOptions = {}): string {
  const unknown = opts.unknownLanguage ?? 'auto';
  // 第二层给的是逐行结构，先还原成纯文本，否则 <span> 会被当代码内容转义
  const source = extractPlainCode(code);
  const hljs = pickHljs();

  // ③ 页面没提供 hljs → 降级为纯文本（内容照样可读）
  //
  // ⚠️ 这里**不报错**，与 katex/mermaid/chart 不同：
  //    那三个缺了内容就看不见（公式变源码、图空白），属于「渲染不出来」；
  //    hljs 缺了只是代码没颜色，内容完整 —— 为它阻断整篇不合理。
  //    所以只警告一次，提示怎么补。
  if (!hljs) {
    warnMissingHljsOnce();
    return encode(source);
  }

  try {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(source, { language: lang }).value;
    }
    if (unknown === 'auto') {
      return hljs.highlightAuto(source).value;
    }
    return encode(source);
  } catch {
    return encode(source);
  }
}

/**
 * 从第二层输出的代码体里取出纯文本
 *
 * ── 为什么需要这一步 ──
 * 第二层现在输出的是逐行结构：
 *   <span class="mdh-code-line">第一行</span>
 *   <span class="mdh-code-line">第二行</span>
 * 但 highlightCode() 要的是**纯文本**（它自己会转义、自己产出 span）。
 * 若把行结构直接喂进去，`<span>` 会被当成代码内容再转义一遍，
 * 页面上就会看到 `&lt;span class="mdh-code-line"&gt;` 这种东西。
 *
 * 所以：先剥掉行包装、还原 HTML 实体，得到干净源码，再交给 hljs。
 */
function extractPlainCode(codeHtml: string): string {
  /*
   * 按行结构取文本，而不是「剥光所有标签」。
   *
   * 第二层输出的是逐行结构：
   *   <span class="mdh-code-line">第一行</span><span class="mdh-code-line">第二行</span>
   * 行与行之间**没有换行符**（有的话 display:block 会多撑一行）。
   * 所以「剥光标签」会把多行拼成一长串 —— 行边界就丢了。
   *
   * 正确做法：先按行 span 切出来，每行内容里再剥标签，最后用 \n 重新接起来。
   * 这样拿到的是「原始源码」的准确形态，交给 highlight.js 才不会出错。
   */
  const LINE_RE = /<span class="mdh-code-line">([\s\S]*?)<\/span>(?=<span class="mdh-code-line">|$)/g;
  const lines: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = LINE_RE.exec(codeHtml)) !== null) {
    // 行内可能还有 hljs 的 token span（插件被重复执行时会遇到），一并剥掉
    lines.push(replaceEntities(m[1].replace(/<[^>]+>/g, '')));
  }

  // 没有行结构（旧版输出、或外部传入裸 HTML）→ 退化为「剥光标签」
  if (lines.length === 0) return replaceEntities(codeHtml.replace(/<[^>]+>/g, ''));

  return lines.join('\n');
}

/** 还原 HTML 实体（第二层已经做过一次 esc） */
function replaceEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * 把 highlight.js 的输出重新按行包成 `mdh-code-line`
 *
 * ── 为什么需要重新包 ──
 * 第二层（mdh-render）输出的代码体是逐行的：
 *   <span class="mdh-code-line">第一行</span>
 *   <span class="mdh-code-line">第二行</span>
 * 行号靠 CSS 计数器在这些 span 上递增。
 *
 * 但 highlight.js 只返回一段带 `<span class="hljs-*">` 的 HTML，
 * 换行符是裸的 `\n`，没有行结构。直接塞回去，行号就全丢了。
 *
 * ── 怎么做 ──
 * 按 `\n` 切，切的时候跟踪「哪些 hljs 标签还开着」，
 * 在行尾补上闭合、在下一行行首重新打开。
 * 这样每一行都是自洽的 HTML，颜色也接得上。
 *
 * ── 行之间不能留 `\n`（2026-11-25 修）──
 * `.mdh-code-line` 是 `display: block`，本身就会换行。
 * 若在 span 之间再留 `\n`，浏览器会把它当普通空白文本，
 * 在每两行之间额外撑出一行 —— 3 行代码看起来像 5 行。
 * 所以拼接时**不加换行符**。
 *
 * 例：`<span class="hljs-params">a\nb</span>`
 *   → <span class="mdh-code-line"><span class="hljs-params">a</span></span><span class="mdh-code-line"><span class="hljs-params">b</span></span>
 */
function splitHighlightedLines(highlighted: string): string {
  const lines = highlighted.split('\n');

  // openStack 记「上一行结束时还开着的标签」
  const openStack: string[] = [];
  const out: string[] = [];

  const TAG = /<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g;

  for (const line of lines) {
    // 行首：把上一行遗留的标签重新打开，颜色才接得上
    let body = openStack.join('');

    TAG.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TAG.exec(line)) !== null) {
      if (m[1] === '/') {
        openStack.pop();
      } else if (!m[0].endsWith('/>')) {
        openStack.push(`<${m[2]}${m[3]}>`);
      }
    }

    body += line;

    // 行尾：闭合这一行遗留的标签，让每行都是自洽的 HTML
    let tail = '';
    for (let k = openStack.length - 1; k >= 0; k--) {
      const name = openStack[k].slice(1).split(/[\s>]/)[0];
      tail += `</${name}>`;
    }

    out.push(`<span class="mdh-code-line">${body}${tail}</span>`);
  }

  // ⚠️ 不 join('\n')：见上面的说明，换行会撑出多余空行
  return out.join('');
}

/** 拼回整段 <pre>，顶栏原样保留 */
export function rebuildCodeBlock(
  preOpen: string,
  head: string,
  highlighted: string,
): string {
  // ⚠️ class 必须同时带 `mdh-code-content` 与 `hljs`：
  //   · mdh-code-content —— 第二层的语义类名，第三层靠它写内边距等布局；
  //   · hljs             —— highlight.js 的配色规则挂在它上面。
  // 早先这里只写 hljs，把 mdh-code-content 覆盖掉了，
  // 于是 `padding: 14px 16px` 从来没生效，代码紧贴左上角。
  const body = splitHighlightedLines(highlighted);
  return `${preOpen}${head ?? ''}<code class="mdh-code-content hljs">${body}</code></pre>`;
}
