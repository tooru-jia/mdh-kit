/**
 * 把 KaTeX 的 CSS 与字体打包成「可内联」的字符串
 *
 * KaTeX 的 CSS 用 `url(../fonts/X.woff2)` 引用字体，单文件产物里没有这些文件，
 * 直接内联 CSS 会导致 @font-face 全部 404，公式字符宽度算错、显示异常。
 *
 * 这里把 woff2 转成 base64 内联，产出自包含。
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

export function getKatexCss() {
  const cssPath = require.resolve('katex/dist/katex.min.css');
  const fontsDir = join(dirname(cssPath), 'fonts');
  let css = readFileSync(cssPath, 'utf8');

  // 把 url(fonts/X.woff2) 替换成 base64 data URI
  // 注意：KaTeX 的 CSS 里路径是 `fonts/...`，不是 `../fonts/...`
  css = css.replace(/url\((?:\.\.\/)?fonts\/([A-Za-z0-9_-]+)\.woff2\)/g, (_m, name) => {
    try {
      const buf = readFileSync(join(fontsDir, `${name}.woff2`));
      return `url(data:font/woff2;base64,${buf.toString('base64')}) format("woff2")`;
    } catch {
      return _m;
    }
  });

  // 剩下的 woff / ttf 引用去掉（woff2 已足够，去掉避免 404）
  css = css.replace(/,?url\((?:\.\.\/)?fonts\/[^)]+\.(?:woff|ttf)\) format\("(?:woff|truetype)"\)/g, '');

  return css;
}
