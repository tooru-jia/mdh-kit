/**
 * 占位提取与回填（两个宿主共用）
 *
 * 插件的工作模式统一是「找出所有占位 → 逐个产出 → 回填」。
 * 与宿主无关的部分全在这里，宿主持有只负责「怎么把一段源码变成产物」。
 */

/** 按正则找出所有匹配，返回完整结果数组（不用 matchAll，兼容性更好） */
export function findAll(html: string, re: RegExp): RegExpExecArray[] {
  const out: RegExpExecArray[] = [];
  const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let m: RegExpExecArray | null;
  while ((m = r.exec(html)) !== null) {
    out.push(m);
    // 零宽匹配保护，避免死循环
    if (m.index === r.lastIndex) r.lastIndex++;
  }
  return out;
}

/** 把 HTML 属性里的转义还原成原始文本 */
export const decodeAttr = (s: string): string =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/** 把原始文本转义成可放进 HTML 属性的值 */
export const encodeAttr = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** 把原始文本转义成可放进 HTML 正文的值 */
export const encodeText = encodeAttr;

/**
 * 逐个回填：按出现顺序，把 replacements 替换回每个占位处
 *
 * 数量对不上时抛错——宁可报错，也不要静默错位。
 */
export function fillIn(
  html: string,
  re: RegExp,
  replacements: string[],
  where: string,
): string {
  let idx = 0;
  return html.replace(
    new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'),
    (match: string) => {
      if (idx >= replacements.length) {
        throw new Error(
          `[mdh-compile/${where}] 占位比产物多：第 ${idx + 1} 个没有对应结果`,
        );
      }
      return replacements[idx++];
    },
  );
}
