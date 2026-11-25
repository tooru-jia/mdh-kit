/**
 * 第三方渲染库的配色（两个宿主共用）
 *
 * 为什么放在共用层：这是「语法级」的呈现参数，不是某个宿主的实现细节。
 * Mermaid 和 Chart 在浏览器里跑还是用 Playwright 跑，出来的图必须长一样。
 *
 * 设计方向 Swiss Modern：
 *   - 只有一种彩色（朱红 #c8402f），其余走灰阶
 *   - 不换色相，多系列时按明度递减
 *   - 线条浅、文字中灰
 */

/** 系列配色：朱红 → 深灰 → 中灰 → 浅灰 → 淡朱 */
export const SERIES_COLORS = [
  '#c8402f', // 朱红（主）
  '#55606b', // 深灰
  '#8a949e', // 中灰
  '#b8c0c8', // 浅灰
  '#e0c4bf', // 淡朱
] as const;

export const AXIS_COLOR = '#dcdcdc';
export const TEXT_COLOR = '#55606b';
export const BG_COLOR = '#ffffff';
export const BORDER_COLOR = '#dcdcdc';

/** Chart.js 用的字体配置 */
export const CHART_FONT = {
  family: '-apple-system, "PingFang SC", sans-serif',
  size: 12,
} as const;

/** Mermaid 主题变量 */
export const MERMAID_THEME_VARIABLES = {
  primaryColor: BG_COLOR,
  primaryTextColor: '#14161a',
  primaryBorderColor: BORDER_COLOR,
  lineColor: TEXT_COLOR,
  secondaryColor: '#f5f5f4',
  tertiaryColor: '#fafaf9',
  fontFamily: '-apple-system, "PingFang SC", sans-serif',
  fontSize: '14px',
} as const;

/** Svg 渲染的默认尺寸（Chart.js 用） */
export const CHART_SIZE = { width: 640, height: 320 } as const;
