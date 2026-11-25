/**
 * 把默认主题 CSS 注入编译产物
 *
 * ── 为什么在 compile 这一层 ──
 * CSS 来自 `@mdh-kit/theme/default.css`，但**注入动作**属于产出 HTML 的人。
 * export 之前是自己去读文件、自己拼 `<style>`；现在统一在这里做，
 * 调用方只需要说「我要带样式」。
 *
 * ── 注入形态 ──
 * 产出一段 `<style data-mdh-css="default">…</style>`，由调用方决定放哪：
 *   - 已有 <head>：插进 </head> 之前
 *   - 裸片段：前置到最前面（浏览器里贴进容器也能生效）
 *
 * ⚠️ 标记属性 `data-mdh-css` 是幂等依据：同一段 HTML 注入两次不会重复加样式。
 */

/** 注入结果 */
export interface InjectResult {
  html: string;
  /** 是否真的注入了（已有标记时返回 false） */
  injected: boolean;
}

const MARKER = 'data-mdh-css="default"';

/**
 * 把 CSS 注入 HTML
 *
 * @param html 编译产物（可以是完整文档，也可以是一段片段）
 * @param css  主题 CSS 文本
 */
export function injectCss(html: string, css: string): InjectResult {
  if (!css || html.includes(MARKER)) {
    return { html, injected: false };
  }

  const block = `<style ${MARKER}>\n${css}\n</style>`;
  const headEnd = html.lastIndexOf('</head>');

  if (headEnd !== -1) {
    return {
      html: `${html.slice(0, headEnd)}${block}\n${html.slice(headEnd)}`,
      injected: true,
    };
  }

  // 裸片段：前置。浏览器里贴进容器，样式同样生效
  return { html: `${block}\n${html}`, injected: true };
}

/** 是否已带默认样式 */
export function hasDefaultCss(html: string): boolean {
  return html.includes(MARKER);
}
