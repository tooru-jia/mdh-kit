/**
 * HTML 直写：白名单与过滤（SYNTAX.md §21）
 *
 * 规则（作者拍定，方案 A）：
 *   - **认得的标签 → 渲染**
 *   - **认不得的标签 → 当纯文字**（转义后原样显示）
 *   - **认得的属性 → 保留**；认不得的 → 丢掉
 *   - **style 里的结构破坏型声明 → 剥离**（position:fixed / z-index 等）
 *
 * 为什么「认不得就当文字」而不是报错或删除：
 *   - 不报错：与全局「人写错不报错、不惊吓」一致
 *   - 不删除：内容静默消失是最坏的失败方式（参考 BUG-1）
 *   - 转义后输出：`<script>` 变成可见文本，既不会执行、也不会消失
 *
 * 安全说明：转义后的 `&lt;script&gt;` 是普通字符，浏览器不会执行。
 * 「当文字」本身没有安全风险。
 */

/** 允许的标签（SYNTAX.md §21 白名单） */
export const ALLOWED_TAGS = new Set([
  // 文本与语义
  'p', 'div', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'del', 'ins', 'mark',
  'small', 'sub', 'sup', 'br', 'hr',
  // 标题与结构
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'footer', 'section', 'article',
  'aside', 'nav', 'main', 'figure', 'figcaption', 'details', 'summary',
  'blockquote', 'pre', 'code',
  // 列表与定义列表
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  // 表格
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  // 媒体
  'img', 'video', 'audio', 'source', 'track', 'picture',
  // 其他
  'a', 'abbr', 'time', 'kbd', 'samp', 'var', 'q', 'cite', 'ruby', 'rt', 'rp',
  'bdi', 'bdo', 'wbr',
]);

/** 允许的属性（按标签限定；`*` 表示全部标签可用） */
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  '*': new Set(['style', 'class', 'id']),
  img: new Set(['src', 'alt', 'width', 'height']),
  video: new Set(['src', 'width', 'height', 'controls', 'loop', 'muted', 'autoplay']),
  audio: new Set(['src', 'controls', 'loop', 'muted', 'autoplay']),
  source: new Set(['src']),
  a: new Set(['href', 'target', 'rel']),
  th: new Set(['colspan', 'rowspan', 'scope']),
  td: new Set(['colspan', 'rowspan', 'scope']),
  details: new Set(['open']),
  ol: new Set(['start']),
};

/**
 * style 里要剥离的声明：会破坏文档结构或覆盖整页
 *
 * 这些不是「安全」问题（mdh 信任作者），而是「排版」问题 ——
 * 一个 position:fixed 能把整篇文档搞乱。
 */
const DANGEROUS_STYLE_PROPS = [
  'position',
  'z-index',
  'top',
  'right',
  'bottom',
  'left',
  'float',
];

/** 协议白名单：href / src 只允许这些 */
const SAFE_PROTOCOLS = ['http:', 'https:', 'mailto:', 'tel:', 'data:'];

const escText = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** 处理 style 属性：剥离危险声明，返回净化后的值（可能为空串） */
function sanitizeStyle(value: string): string {
  return value
    .split(';')
    .map((decl) => decl.trim())
    .filter(Boolean)
    .filter((decl) => {
      const prop = decl.split(':')[0]?.trim().toLowerCase() ?? '';
      return !DANGEROUS_STYLE_PROPS.includes(prop);
    })
    .join('; ');
}

/** 协议检查：不允许 javascript: 之类的地址 */
function isSafeUrl(value: string): boolean {
  const v = value.trim().toLowerCase();
  // 相对路径 / 锚点：没有协议，直接放行
  if (!/^[a-z][a-z0-9+.-]*:/.test(v)) return true;
  return SAFE_PROTOCOLS.some((p) => v.startsWith(p));
}

/** 属性名归一（`onClick` → `onclick`），并判断是否允许 */
function isAllowedAttr(tag: string, attr: string): boolean {
  const name = attr.toLowerCase();
  // 事件属性一律拒绝（可执行代码）
  if (name.startsWith('on')) return false;
  if (ALLOWED_ATTRS['*']?.has(name)) return true;
  return ALLOWED_ATTRS[tag]?.has(name) ?? false;
}

/**
 * 单个标签的解析结果
 *
 * - `raw`：原样保留的 HTML 片段（已过滤属性）
 * - `text`：认不得 → 转义成纯文字
 */
export interface TagResult {
  kind: 'tag' | 'text';
  value: string;
}

/**
 * 处理一个开始标签：`<div class="a" onclick="x">`
 *
 * 认得 → 过滤属性后保留；认不得 → 整个标签转义成文字。
 */
export function processOpenTag(raw: string): TagResult {
  const m = raw.match(/^<\s*([a-zA-Z][a-zA-Z0-9-]*)([\s\S]*?)(\/?)>$/);
  if (!m) return { kind: 'text', value: escText(raw) };

  const tag = m[1].toLowerCase();
  const attrText = m[2] ?? '';
  const selfClose = m[3] === '/' ? '/' : '';

  if (!ALLOWED_TAGS.has(tag)) return { kind: 'text', value: escText(raw) };

  // 逐个属性过滤
  const kept: string[] = [];
  const attrRe = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>`]+)))?/g;
  let am: RegExpExecArray | null;
  while ((am = attrRe.exec(attrText)) !== null) {
    const name = am[1];
    const value = am[3] ?? am[4] ?? am[5] ?? '';
    if (!isAllowedAttr(tag, name)) continue;

    const lname = name.toLowerCase();
    if (lname === 'style') {
      const clean = sanitizeStyle(value);
      if (clean) kept.push(`style="${escText(clean)}"`);
      continue;
    }
    if ((lname === 'href' || lname === 'src') && !isSafeUrl(value)) continue;
    kept.push(value === '' && am[2] === undefined ? name : `${name}="${escText(value)}"`);
  }

  const attrs = kept.length ? ' ' + kept.join(' ') : '';
  return { kind: 'tag', value: `<${tag}${attrs}${selfClose}>` };
}

/** 处理一个结束标签：`</div>` */
export function processCloseTag(raw: string): TagResult {
  const m = raw.match(/^<\s*\/\s*([a-zA-Z][a-zA-Z0-9-]*)\s*>$/);
  if (!m) return { kind: 'text', value: escText(raw) };
  const tag = m[1].toLowerCase();
  if (!ALLOWED_TAGS.has(tag)) return { kind: 'text', value: escText(raw) };
  return { kind: 'tag', value: `</${tag}>` };
}
