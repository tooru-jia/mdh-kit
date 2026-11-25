/**
 * 打包浏览器端运行时代码
 *
 *   node tools/build-browser.mjs
 *   → packages/mdh-theme/dist/mdh-render.browser.js
 */
import { build } from 'esbuild';

await build({
  entryPoints: ['packages/mdh-theme/src/browser-entry.ts'],
  bundle: true,
  format: 'iife',
  outfile: 'packages/mdh-theme/dist/mdh-render.browser.js',
  target: ['es2020'],
  minify: false,
});

console.log('已打包 packages/mdh-theme/dist/mdh-render.browser.js');
