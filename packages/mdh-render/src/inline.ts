/**
 * 行内格式解析
 *
 * 第二层职责：把行内语法变成带语义的 HTML 结构。
 * 不做任何视觉处理——粗体多粗、代码什么底色，都由第三层 CSS 决定。
 *
 * 支持：
 *   **粗**        → <strong class="mdh-strong">
 *   /斜/          → <em class="mdh-em">
 *   __下划线__    → <u class="mdh-u">
 *   --删除--      → <del class="mdh-del">
 *   `代码`        → <code class="mdh-inline-code">
 *   $公式$        → <span class="mdh-inline-math" data-mdh-latex="...">
 *   @名字         → <span class="mdh-ref" ...>
 *
 * 实现方式（关键）：
 *   1. 先把「不解析的内容」（代码、公式）替换成占位符
 *   2. 把正文转义
 *   3. 扫描所有成对符号，记录区间（**不**直接生成标签）
 *   4. 按区间生成标签 —— 这一步只在最后做一次
 *   5. 还原占位符
 *
 * 第 3、4 步分开很重要：如果一边扫描一边生成标签，
 * 生成的标签会被后续规则当成正文再次匹配（这是上一版的 bug）。
 */

import type { NumberInfo } from './numbering.ts';
import { footAnchorId } from './footnotes.ts';
import { processOpenTag, processCloseTag } from './html-passthrough.ts';

const esc = (s: string): string =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** 属性值转义：除了 esc 还要处理单引号，避免属性提前结束 */
const escAttr = (s: string): string => esc(s).replace(/'/g, '&#39;');

export interface InlineOptions {
  numbers: NumberInfo;
  /** 是否解析 @名字 引用 */
  includeRefs?: boolean;
}

/** 占位符：用私用区字符，正文里不会出现 */
const PH_OPEN = '\uE000';
const PH_CLOSE = '\uE001';

/**
 * 「不可见字符」匹配集（DESIGN-3）
 *
 * 只抓 `Cf` 类格式字符 —— 它们零宽、肉眼不可见，是隐形提示注入的载体：
 *
 *   U+00AD        软连字符
 *   U+061C        阿拉伯文标记
 *   U+180E        蒙古文元音分隔符
 *   U+200B~200F   零宽空格 / 零宽非连接 / 零宽连接 / LTR / RTL 标记
 *   U+202A~202E   双向嵌入与覆盖（能把文字顺序整个颠倒）
 *   U+2060~2064   词连接符 / 不可见运算符
 *   U+2066~2069   双向隔离
 *   U+FEFF        BOM / 零宽无断空格
 *
 * **绝不包含 `So` 类**（😀 ★ ✅ 这些 emoji 与符号）——
 * 用户做图标用的正是它们，误伤就是事故。
 * `Zs` 类（全角空格等）也不处理：它们可见，不是注入载体。
 */
const INVISIBLE_RE =
  /[\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

/**
 * `@` 家族的关键字
 *
 * 这些是语法自身的名字，**不是**用户定义的引用目标。
 * 裸 `@名字` 解析时必须跳过它们，否则：
 *   - 不带引号的 `@link(官网, url)` 里 `@link` 会被标成「引用不存在」
 *   - `@tag(名字)` 关闭后同理
 */
const AT_FAMILY_KEYWORDS = new Set(['tag', 'foot', 'link', 'img']);

/** 一个配对区间 */
interface Span {
  start: number;
  end: number;
  open: string;
  close: string;
  /** 嵌套深度，用于排序 */
  depth: number;
}

/** 符号定义：按优先级排列（长的、更明确的在前） */
const MARKERS = [
  { token: '**', open: '<strong class="mdh-strong">', close: '</strong>', forbidBoundary: true },
  { token: '__', open: '<u class="mdh-u">', close: '</u>', forbidBoundary: true },
  { token: '--', open: '<del class="mdh-del">', close: '</del>', forbidBoundary: true },
  { token: '/', open: '<em class="mdh-em">', close: '</em>', forbidBoundary: true },
];

/**
 * 扫描一对符号的所有合法区间
 *
 * 规则（与 SYNTAX 一致）：
 * - 开始符后不能紧跟空白
 * - 结束符前不能是空白
 * - 规则统一：成对即格式，不区分前后文
 *
 * 斜杠的代价：`/usr/local/bin` 这种路径会被识别成斜体。
 * 这是「成对即语义」的必然结果——想显示路径、URL 原文，用反引号包住：
 *   `/usr/local/bin`、`https://a.com/b`
 */
function findSpans(text: string, marker: (typeof MARKERS)[number]): Span[] {
  const { token, open, close } = marker;
  const spans: Span[] = [];
  const len = token.length;

  let i = 0;
  while (i < text.length) {
    const start = text.indexOf(token, i);
    if (start === -1) break;

    // 避免把 **** 之类当成两个标记
    if (text[start + len] === token[0]) {
      i = start + 1;
      continue;
    }
    // 开始符后不能是空白或结束
    const after = text[start + len];
    if (after === undefined || /\s/.test(after)) {
      i = start + len;
      continue;
    }

    // 找配对的结束符
    let j = start + len;
    let end = -1;
    while (j < text.length) {
      const k = text.indexOf(token, j);
      if (k === -1) break;
      // 结束符前不能是空白
      if (!/\s/.test(text[k - 1] ?? '')) {
        end = k;
        break;
      }
      j = k + len;
    }

    if (end === -1) {
      i = start + len;
      continue;
    }

    spans.push({ start, end: end + len, open, close, depth: 0 });
    i = end + len;
  }

  return spans;
}

/** 计算嵌套深度（一个区间被几个别的区间包含） */
function assignDepth(spans: Span[]): void {
  for (const s of spans) {
    s.depth = spans.filter((o) => o !== s && o.start <= s.start && o.end >= s.end).length;
  }
}

/**
 * 把一组区间替换成标签
 *
 * 排序规则（关键）：
 *   1. 先按 start 从大到小（从后往前，前面的下标不失效）
 *   2. start 相同时，深度大的先处理（内层优先）
 *
 * 这样外层标签插入时，内层标签已生成完毕，位置仍然正确。
 */
function applySpans(text: string, spans: Span[]): string {
  const sorted = [...spans].sort((a, b) => b.start - a.start || b.depth - a.depth);
  let out = text;
  for (const s of sorted) {
    const tk = token(s);
    if (!tk) continue;
    out =
      out.slice(0, s.start) +
      s.open +
      out.slice(s.start + tk.length, s.end - tk.length) +
      s.close +
      out.slice(s.end);
  }
  return out;
}

/** 从区间反推它用的是哪个 token（按 open 标签查表） */
function token(span: Span): string {
  const m = MARKERS.find((x) => x.open === span.open);
  return m ? m.token : '';
}

/** 最大嵌套层数（与 SYNTAX 一致：最多两层） */
const MAX_DEPTH = 2;

/**
 * 递归生成标签
 *
 * 从后往前处理最外层区间，每处理一个就把内容交给下一层递归。
 * 这样嵌套（**粗里有 /斜/**）能正确生成两层标签。
 */
function applyNested(text: string, spans: Span[], depth: number): string {
  if (depth >= MAX_DEPTH || spans.length === 0) return text;

  let out = text;
  // 从后往前，前面的下标不失效
  const sorted = [...spans].sort((a, b) => b.start - a.start);
  for (const s of sorted) {
    const tk = token(s);
    if (!tk) continue;

    const innerText = out.slice(s.start + tk.length, s.end - tk.length);
    // 在内容里继续找可以嵌套的标记
    const innerSpans: Span[] = [];
    for (const marker of MARKERS) {
      for (const found of findSpans(innerText, marker)) {
        innerSpans.push(found);
      }
    }
    // 只保留最外层（避免同一 token 自嵌套）
    const innerOutermost: Span[] = [];
    for (const sp of innerSpans.sort((a, b) => a.start - b.start || b.end - a.end)) {
      const covered = innerOutermost.some((o) => sp.start >= o.start && sp.end <= o.end);
      if (!covered) innerOutermost.push(sp);
    }

    const rendered = applyNested(innerText, innerOutermost, depth + 1);
    out = out.slice(0, s.start) + s.open + rendered + s.close + out.slice(s.end);
  }
  return out;
}

export function renderInline(text: string, opts: InlineOptions): string {
  const { numbers } = opts;
  const includeRefs = opts.includeRefs !== false;

  // ---- 第 0 步：摘出「不可见字符」（DESIGN-3）----
  //
  // 零宽空格、双向控制符这类 Cf 类字符肉眼看不见，却是「隐形提示注入」的
  // 载体：把指令拆散藏在字符之间，人看不出异常，AI 剥掉控制符后却读得到。
  //
  // 处理方式：换成可见的行内代码标记 `[U+200B]`，让读者一眼发现。
  // **只处理 Cf 类**（格式字符），绝不碰 So 类（emoji、符号）——
  // 用户做图标用的是 😀 ★ ✅ 这些，删了就是事故。
  //
  // 必须放在所有格式规则之前：占位符里的码点不会参与后续正则匹配。
  const raw: string[] = [];
  let s = text;

  const invisibles: string[] = [];
  s = s.replace(INVISIBLE_RE, (ch) => {
    invisibles.push(ch);
    // 直接把标记塞进 raw，与后续行内代码、公式共用同一套占位符
    const cp = `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;
    raw.push(
      `<code class="mdh-inline-code mdh-invisible" data-cp="${cp}" title="不可见字符 ${cp}">[${cp}]</code>`,
    );
    return `${PH_OPEN}${raw.length - 1}${PH_CLOSE}`;
  });

  // ---- 第 1 步：摘出「不解析」的内容 ----

  // 行内代码
  s = s.replace(/``([\s\S]+?)``|`([^`]+)`/g, (_m, a, b) => {
    raw.push(`<code class="mdh-inline-code">${esc(a ?? b)}</code>`);
    return `${PH_OPEN}${raw.length - 1}${PH_CLOSE}`;
  });

  // 行内公式：$...$（SYNTAX §16 / DECISION-5）
  //
  // 此前是「两个 $ 之间即公式」，导致 `价格 $100 和 $200` 被整段当成公式、
  // 内容被撕开。现在改为四条确定性规则 —— 用户读一遍就能预判结果：
  //
  //   1. 必须有两个 $（成对），且不跨行         ← 正则本身保证
  //   2. 内容不以纯数字结尾                     ← 排除 `$100$`
  //   3. 内容不含中日韩字符                     ← 排除 `$100 和 $`
  //   4. 结尾 $ 后面不紧跟数字                  ← 排除 `$100 to $200`
  //
  // 不做「看起来像不像 LaTeX」的猜测 —— 那是主观判断，用户无法预判。
  // 但以上四条都是确定性规则，可机械判定。
  const isCJK = (t: string): boolean => /[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]/.test(t);
  s = s.replace(/\$([^$\n]+?)\$(?![0-9])/g, (whole, latex: string) => {
    if (/^\s*$/.test(latex)) return whole; // 空内容：不是公式
    if (/^\d+(\.\d+)?\s*$/.test(latex)) return whole; // 规则 2：纯数字 → 是金额
    if (isCJK(latex)) return whole; // 规则 3：含中文 → 是正文
    raw.push(`<span class="mdh-inline-math" data-mdh-latex="${esc(JSON.stringify(latex))}"></span>`);
    return `${PH_OPEN}${raw.length - 1}${PH_CLOSE}`;
  });

  // HTML 直写（SYNTAX §21，作者拍定方案 A）
  //
  //   - 认得的标签 → 过滤属性后原样放行
  //   - 认不得的标签 → **当纯文字**（转义后输出）
  //
  // 两条硬规则：
  //   ① **标签及其内容整体占位**，内部不再解析 mdh 行内语法（作者 2026-11-21 决定）。
  //      `<div>**不是加粗**</div>` 里的星号就是字面星号。
  //   ② 占位也挡住行内扫描：`</td>` 的 `/` 不会被斜体规则吃掉。
  //      规则简化成「成对即斜体」后，这个副作用必须在这里挡掉。
  //
  // 做法：先按同名开闭标签配对，整段处理；配不上对的单个标签按「只处理标签本身」。
  s = s.replace(
    /<([a-zA-Z][^\s<>/]*)[^<>]*>[\s\S]*?<\/\1\s*>|<\/?[a-zA-Z][^<>]*>/g,
    (whole) => {
      // 整段（开标签 + 内容 + 闭标签）
      const pair = whole.match(/^<([a-zA-Z][^\s<>/]*)[^<>]*>/);
      if (pair && whole.length > pair[0].length) {
        const tagName = pair[1];
        const openTag = pair[0];
        // 用同名闭标签定位，不能用 lastIndexOf('</')——
        // 嵌套场景（<details><summary>x</summary>y</details>）会切到内层
        const closeTag = `</${tagName}>`;
        const closeAt = whole.lastIndexOf(closeTag);
        const inner = closeAt > 0 ? whole.slice(openTag.length, closeAt) : '';

        const openR = processOpenTag(openTag);
        const closeR = processCloseTag(closeTag);

        if (openR.kind === 'text' || closeR.kind === 'text') {
          // 认不得：整段原样转义成文字
          raw.push(esc(whole));
        } else {
          // 认得：外层标签过滤属性；内部保留嵌套的合法标签，但不解析 mdh 行内语法
          raw.push(openR.value + escapeHtmlKeepTags(inner) + closeR.value);
        }
        return `${PH_OPEN}${raw.length - 1}${PH_CLOSE}`;
      }

      // 单个标签（自闭合、或没有配对）
      const isClose = /^<\s*\//.test(whole);
      const result = isClose ? processCloseTag(whole) : processOpenTag(whole);
      raw.push(result.kind === 'text' ? esc(whole) : result.value);
      return `${PH_OPEN}${raw.length - 1}${PH_CLOSE}`;
    },
  );

  // @link / @img 的地址必须加引号（FIX-1）
  //   @link(维基, "https://en.wikipedia.org/wiki/Washington,_D.C.")
  //   @link(带括号, "https://x.com/a(b)")
  //
  // ⚠️ 必须在这里（第 1 步）摘掉，不能留到第 5 步：
  //    地址里有 `/`，而 `/` 是斜体符号。留到第 5 步时，
  //    第 4 步的斜体扫描已经把 `./docs/a.html` 吃成 `.<em>docs</em>a.html`。
  const AT_URL = '([^,()]+?)\\s*,\\s*[“"]((?:[^”"])*)[”"]';
  const stash = (re: RegExp, build: (label: string, url: string) => string) => {
    s = s.replace(re, (_m, label: string, url: string) => {
      raw.push(build(label.trim(), url));
      return `${PH_OPEN}${raw.length - 1}${PH_CLOSE}`;
    });
  };
  stash(
    new RegExp(`@link\\(${AT_URL}\\)`, 'g'),
    (label, url) => `<a class="mdh-link" href="${escAttr(url)}">${esc(label)}</a>`,
  );
  stash(
    new RegExp(`@img\\(${AT_URL}\\)`, 'g'),
    (label, url) => `<img class="mdh-img" src="${escAttr(url)}" alt="${escAttr(label)}">`,
  );

  // V3：@tag / @foot 提前占位 —— 它们是「对象」不是「文字」，
  // 不该被行内格式包住。
  //   `/斜体里有 @tag(标签)/` → 斜体文字 + 独立的标签，
  //   而不是把整个标签塞进 <em> 里（那会让标签文字也变斜体）。
  //
  // DESIGN-4（2026-11-22）：`@tag()` 本期关闭，关键字已移除。
  // 现在 `@tag(名字)` 按普通文字**原样输出**，不渲染成标签。
  // 关闭时必须保留这条规则先于 `@名字` —— 否则 `@tag(abc)` 会被
  // `@名字` 规则先吃掉一个 "tag"，输出成 `@tag` + `(abc)` 两段。
  // 后续版本重开时，把这里的返回值换回
  //   `<span class="mdh-tag" data-mdh-tag="...">...</span>`
  // 并恢复 SYNTAX.md 的标签章节即可。
  //
  // ⚠️ 不能写成 `stash(..., () => esc(...))`：stash 会把返回值塞进 raw
  // 数组并返回占位符，而 raw 里的内容是「已渲染好的 HTML」，不能预先转义。
  // 这里直接把它们当作 `raw` 里的原样 HTML 存（内容经过 esc 保证安全）。
  //
  // ── 为什么包一层 span ──
  // 保留字当前不生效，但读者/作者要能一眼认出「这是个语法词」。
  // `.mdh-keyword-reserved` 只设 color（朱红），没有底色、圆角、内边距 ——
  // 它是一段红字，不是一个标签胶囊。与旧的 `.mdh-tag` 完全不同。
  const reservedSpan = (text: string) =>
    `<span class="mdh-keyword-reserved">${esc(text)}</span>`;

  s = s.replace(/@tag\(([^)]*)\)/g, (_m, label: string) => {
    raw.push(reservedSpan(`@tag(${label})`));
    return `${PH_OPEN}${raw.length - 1}${PH_CLOSE}`;
  });

  // 同样处理其余「保留关键字指令」：红字，不渲染、不当作引用。
  //
  // 不处理的话，`@theme(暗色)` 会掉进下面的裸 `@名字` 规则，
  // 被包成 `<span class="mdh-ref">` —— 看起来像「引用了一个不存在的对象」，
  // 但作者只是想写这个字。
  //
  // 名单对应 spec/syntax-def.ts 的 RESERVED_DIRECTIVES。
  s = s.replace(/@(theme|slide-theme|next-tab)\(([^)]*)\)/g, (_m, name: string, arg: string) => {
    raw.push(reservedSpan(`@${name}(${arg})`));
    return `${PH_OPEN}${raw.length - 1}${PH_CLOSE}`;
  });

  /*
   * `@title(...)` —— 预留关键字，和其它预留词一样标红（2026-11-25 改回）
   *
   * 第一期不做「页面大标题」，但**写法保留**，显示策略与 @tag / @theme 一致：
   * 红字原文，标出「这是个语法词，还没生效」。
   *
   * 早先曾按「纯原文」渲染（不加任何样式），与其它两个保留字不一致，
   * 作者反馈「三个都是保留字，都该是红字」—— 统一回红字。
   */
  s = s.replace(/@title\([^)]*\)/g, (whole) => {
    raw.push(reservedSpan(whole));
    return `${PH_OPEN}${raw.length - 1}${PH_CLOSE}`;
  });
  stash(/@foot\(([^)]+)\)(?!\s*[:：])/g, (name) => {
    const n = name.trim();
    const entry = numbers.footnotes?.byName.get(n);
    if (!entry) return `@foot(${n})`;
    if (!entry.defined) {
      return `<sup class="mdh-foot-ref mdh-foot-undefined" data-mdh-foot="${escAttr(n)}">${entry.number}</sup>`;
    }
    return (
      `<sup class="mdh-foot-ref"><a class="mdh-foot-link" href="#${footAnchorId(n)}" ` +
      `data-mdh-foot="${escAttr(n)}" data-mdh-foot-number="${entry.number}">${entry.number}</a></sup>`
    );
  });

  // ---- 第 2 步：转义正文 ----
  s = esc(s);

  // ---- 第 3 步：扫描所有成对符号，收集区间（不生成标签） ----
  const allSpans: Span[] = [];
  for (const marker of MARKERS) {
    allSpans.push(...findSpans(s, marker));
  }

  // 处理重叠：只保留最外层区间，内层由递归处理
  const outermost: Span[] = [];
  for (const span of allSpans.sort((a, b) => a.start - b.start || b.end - a.end)) {
    const covered = outermost.some((o) => span.start >= o.start && span.end <= o.end);
    if (!covered) outermost.push(span);
  }

  // ---- 第 4 步：由外向内生成标签（递归处理内容，天然支持嵌套） ----
  s = applyNested(s, outermost, 0);

  // ---- 第 5 步：@ 家族 ----
  //
  // 顺序重要：带括号的（tag/foot/link/img）必须先于裸 @名字 处理，
  // 否则 `@tag(abc)` 会被 @名字 规则先吃掉一个 "tag"。
  s = renderAtFamily(s, numbers);

  // ---- 第 6 步：还原占位符 ----
  s = s.replace(new RegExp(`${PH_OPEN}(\\d+)${PH_CLOSE}`, 'g'), (_m, i) => raw[Number(i)] ?? '');

  // ---- 第 7 步：把「对象型」内容移出行内格式（V3）----
  //
  // `@tag` / `@foot` / `@img` / `@link` 是对象，不是文字。
  // `/斜体里有 @tag(标签)/` 应该是「斜体文字 + 独立的标签」，
  // 而不是标签文字跟着变斜体。
  s = hoistObjectsOutOfInline(s);

  return s;
}

/**
 * 把「对象型」内容移出行内格式（V3）
 *
 * `@tag` / `@foot` / `@img` / `@link` 渲染出的是**对象**（标签、上标、图片、链接），
 * 不是文字。它们不该跟着行内格式变粗体 / 斜体 / 下划线 / 删除线。
 *
 *   `/斜体里有 @tag(标签)/`
 *     ❌ <em>斜体里有 <span class="mdh-tag">标签</span></em>
 *     ✅ <em>斜体里有 </em><span class="mdh-tag">标签</span><em></em>
 *
 * 做法：找出 `<em>` / `<strong>` / `<u>` / `<del>` 里的对象型标签，
 * 把它们从行内格式里「提」出来。
 *
 * 只处理**单层**行内格式（mdh 规定最多两层，这里保守只提最内层）。
 */
const INLINE_WRAPPERS: Array<{ open: string; close: string }> = [
  { open: '<em class="mdh-em">', close: '</em>' },
  { open: '<strong class="mdh-strong">', close: '</strong>' },
  { open: '<u class="mdh-u">', close: '</u>' },
  { open: '<del class="mdh-del">', close: '</del>' },
];

function hoistObjectsOutOfInline(html: string): string {
  let out = html;

  for (const { open, close } of INLINE_WRAPPERS) {
    const openEsc = open.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${openEsc}([\\s\\S]*?)${close}`, 'g');

    out = out.replace(re, (whole, inner: string) => {
      const openTag = whole.slice(0, whole.indexOf('>') + 1);

      // 收集内层里的「对象型」片段，并在原位置换成占位符
      const pieces: string[] = [];
      let rest = inner;

      // span.mjh-tag / sup / a.mjh-ref 这类成对标签
      const paired =
        /<(span|sup|a)\s[^>]*class="[^"]*\b(mdh-tag|mdh-foot-ref|mdh-link)\b[^"]*"[^>]*>[\s\S]*?<\/\1>/g;
      rest = rest.replace(paired, (hit) => {
        pieces.push(hit);
        return `\u0000${pieces.length - 1}\u0000`;
      });

      // <img> 是自闭合
      rest = rest.replace(/<img\s[^>]*class="[^"]*\bmdh-img\b[^"]*"[^>]*>/g, (hit) => {
        pieces.push(hit);
        return `\u0000${pieces.length - 1}\u0000`;
      });

      if (pieces.length === 0) return whole;

      // 在原位置把行内格式断开再续接：
      //   <em>前<占位>后</em>  →  <em>前</em>对象<em>后</em>
      let rebuilt = '';
      let segStart = 0;
      const phRe = /\u0000(\d+)\u0000/g;
      let m: RegExpExecArray | null;

      while ((m = phRe.exec(rest)) !== null) {
        const before = rest.slice(segStart, m.index);
        if (before.trim()) rebuilt += `${openTag}${before}${close}`;
        else if (before) rebuilt += before; // 只保留空白，不额外包一层
        rebuilt += pieces[Number(m[1])];
        segStart = m.index + m[0].length;
      }

      const tail = rest.slice(segStart);
      if (tail.trim()) rebuilt += `${openTag}${tail}${close}`;
      else if (tail) rebuilt += tail;

      return rebuilt;
    });
  }

  return out;
}

/**
 * HTML 片段里「只保留标签、不解析 mdh 语法」的处理
 *
 * 用于配对成功的标签内部：嵌套的合法标签保留（`<summary>` 这类），
 * 文字部分只转义特殊字符，**不做行内语法解析**。
 *
 * 为什么不能直接 esc(inner)：那样 `<details><summary>x</summary></details>`
 * 里的 summary 会被转义成文字，fold 打不开。
 */
const escapeHtmlKeepTags = (s: string): string =>
  s
    .split(/(<\/?[a-zA-Z][^<>]*>)/)
    .map((chunk) => {
      if (!chunk) return '';
      if (/^<\/?[a-zA-Z]/.test(chunk)) {
        const isClose = /^<\s*\//.test(chunk);
        const r = isClose ? processCloseTag(chunk) : processOpenTag(chunk);
        return r.kind === 'text' ? esc(chunk) : r.value;
      }
      return esc(chunk);
    })
    .join('');

/**
 * 属性值转义（二次安全版）
 *
 * 因此这里再做一次 `&` → `&amp;` 会造成双重转义：
 *   https://x.com/s?a=1&b=2  →  a=1&amp;b=2  →  a=1&amp;amp;b=2  （参数丢失）
 *
 * 所以这里只补 esc() 没覆盖的 `'`，并清掉可能破坏属性的双引号。
 */
const attrOfEscaped = (s: string): string =>
  String(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * 把 esc() 产生的实体还原回原字符（FIX-1）
 *
 * `@link(名, "地址")` 的地址在进入 renderAtFamily 前已被 esc() 处理过，
 * 例如 `?a=1&b=2` 变成 `?a=1&amp;b=2`。要塞进 href 属性前必须先还原，
 * 否则会二次转义成 `&amp;amp;`。
 */
const unescAttr = (s: string): string =>
  String(s)
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/**
 *
 * 全部由第二层输出结构，第三层只管配色：
 *
 *   @tag(abc)              → <span class="mdh-tag" data-mdh-tag="abc">abc</span>
 *   @foot(名字)            → <a class="mdh-foot-ref" href="#mdh-foot-名字" ...>n</a>
 *   @link(名字, 地址)      → <a class="mdh-link" href="地址">名字</a>
 *   @img(名字, 地址)       → <img class="mdh-img" src="地址" alt="名字">
 *
 * 说明：
 *   - @tag 是可见标签，不是跳转目标（SYNTAX §6）
 *   - @foot 的编号由 footnotes.ts 按首次插入顺序分配
 *   - @link / @img 的名字必填（它是链接文字 / alt）
 *
 * ⚠️ 地址未做协议白名单：`@link(x, javascript:...)` 会原样输出。
 *    这是待确认项（SYNTAX §8），当前信任文档作者。
 */
function renderAtFamily(s: string, numbers: NumberInfo): string {
  // @link(名字, "地址") —— 地址必须双引号包裹（FIX-1）
  //
  // 引号解决了括号内逗号/右括号与内容冲突：
  //   @link(维基, "https://en.wikipedia.org/wiki/Washington,_D.C.")
  //   @link(带括号, "https://x.com/a(b)")
  //
  // 不带引号的写法不再识别，原样输出（不报错，与「不惊吓」一致）。
  //
  // 注意：进入本函数前字符串已经过 esc()，双引号已变成 &quot;，
  // 所以两种形式都要认。
  const Q = '(?:&quot;|")';
  // 地址内容：不含双引号（已转义成 &quot;）
  const URL = '(?:(?!&quot;)[^])*?';
  s = s.replace(
    new RegExp(`@link\\(([^,()]+?)\\s*,\\s*${Q}(${URL})${Q}\\)`, 'g'),
    (_m, name: string, href: string) =>
      `<a class="mdh-link" href="${attrOfEscaped(unescAttr(href.trim()))}">${name.trim()}</a>`,
  );

  // @img(名字, "地址")
  s = s.replace(
    new RegExp(`@img\\(([^,()]+?)\\s*,\\s*${Q}(${URL})${Q}\\)`, 'g'),
    (_m, alt: string, src: string) =>
      `<img class="mdh-img" src="${attrOfEscaped(unescAttr(src.trim()))}" alt="${attrOfEscaped(alt.trim())}">`,
  );

  // @foot(名字) —— 插入脚注，编号查表
  s = s.replace(/@foot\(([^)]+)\)/g, (_m, rawName: string) => {
    const name = rawName.trim();
    const entry = numbers.footnotes?.byName.get(name);
    if (!entry) {
      // 索引里没有：说明是孤立写法，原样输出（不静默吞掉）
      return `@foot(${name})`;
    }
    if (!entry.defined) {
      // 引用了但没定义：给上标但不跳转，读者能看出这里有个脚注
      return `<sup class="mdh-foot-ref mdh-foot-undefined" data-mdh-foot="${attrOfEscaped(name)}">${entry.number}</sup>`;
    }
    return (
      `<sup class="mdh-foot-ref"><a class="mdh-foot-link" href="#${footAnchorId(name)}" ` +
      `data-mdh-foot="${attrOfEscaped(name)}" data-mdh-foot-number="${entry.number}">${entry.number}</a></sup>`
    );
  });

  // @tag(名字) —— 可见标签，不跳转
  s = s.replace(
    /@tag\(([^)]+)\)/g,
    (_m, rawName: string) => {
      const name = rawName.trim();
      return `<span class="mdh-tag" data-mdh-tag="${attrOfEscaped(name)}">${name}</span>`;
    },
  );

  // @名字 —— 引用（原有的逻辑，放在最后）
  //
  // 作者 2026-11-21：
  //   有 caption（=有编号）→ 显示「表 1」这类带编号的指代
  //   没有编号（只有 ref）→ 就是一个可点击的跳转标记，不显示编号
  // 判据：ref 让 `@名字` 能跳，caption 决定有没有编号，两件事独立。
  //
  // DESIGN-1（2026-11-22）：目标不存在时不再静默放过，而是输出
  // **可见的失效标记**。理由：`@员工` 打错成别的名字时，之前页面上
  // 看不出任何异常，错误会静默流进成品。现在用 <span>（无 href，
  // 从根上避免「点了没反应」的困惑）+ 浅色虚线，读者/作者都能看出
  // 「这里没连上」。文字仍按原样带 `@` 显示，内容不会丢。
  s = s.replace(/@([^\s()\[\]{}<>&，。、；：！？]+)/g, (whole, name: string) => {
    // @ 家族的关键字不能当引用目标：它们是语法自身的名字，不是用户定义的引用。
    // 例如不带引号的 `@link(官网, https://...)` 不再识别为链接，
    // 此时 `@link` 应原样留在文字里，而不是被标成「引用目标不存在」。
    if (AT_FAMILY_KEYWORDS.has(name)) return whole;

    const targetId = numbers.nameToNode.get(name);
    if (!targetId) {
      return `<span class="mdh-ref mdh-ref-broken" data-mdh-ref="${attrOfEscaped(
        name,
      )}">${whole}</span>`;
    }
    const num = numbers.valueByNode.get(targetId);
    const kind = numbers.kindByNode.get(targetId);
    const ref = attrOfEscaped(name);

    // 只有 ref 没有 caption：可点，但不带编号
    if (num === undefined) {
      return `<a class="mdh-ref mdh-ref-plain" href="#${escAttr(targetId)}" data-mdh-ref="${ref}">${whole}</a>`;
    }
    /*
     * 带编号的引用（作者 2026-11-25 修订）
     *
     * 早先这里输出空 <a>，正文由 CSS ::before 拼成「Table 1」。
     * 两个问题：
     *   ① 措辞写死在 CSS 里，而且**假设**目标一定是表 —— 图、公式也走同一条，
     *      只是被后面的选择器覆盖，很容易漏；
     *   ② 元素本身没有文字，一旦 CSS 没加载 / 主题覆盖了 ::before，
     *      正文上就是个空白，读者看到「见 」然后没了。
     *
     * 现在：元素内直接放原文 `@名字`，编号作为独立 span 挂在旁边。
     * 措辞交给主题，但**默认是原始名字**，永远不会错认类型。
     */
    return (
      `<a class="mdh-ref" href="#${escAttr(targetId)}" data-mdh-ref="${ref}" ` +
      `data-mdh-ref-number="${attrOfEscaped(String(num))}" ` +
      `data-mdh-ref-kind="${attrOfEscaped(kind ?? '')}">` +
      `<span class="mdh-ref-name">${whole}</span>` +
      `</a>`
    );
  });

  return s;
}
