/**
 * 默认主题 CSS 与样式注入
 *
 * 原属 `@mdh/css` 包（2026-11 合并回 `@mdh/theme`）。
 *
 * 验什么：
 *   1. CSS 能读到，内容非空、含关键变量
 *   2. injectCss 能插进 <head>、能前置到裸片段
 *   3. 幂等：同一段 HTML 注入两次不会重复
 *   4. 本包只含产物样式，不含源码着色
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { readDefaultCss, DEFAULT_CSS_PATH } from '../src/css-raw.ts';
import { injectCss, hasDefaultCss } from '../../mdh-compile/src/shared/css-inject.ts';

test('样式包：default.css 可读且含核心变量', async () => {
  const css = await readDefaultCss();
  assert.ok(css.length > 10000, `default.css 过小：${css.length}`);
  assert.ok(css.includes('--mdh-accent'), '缺 --mdh-accent');
  assert.ok(css.includes('--mdh-fs-body'), '缺 --mdh-fs-body');
  assert.ok(DEFAULT_CSS_PATH.endsWith('themes/default.css'));
});

test('样式包：本包只含产物样式，不含源码着色', async () => {
  const css = await readDefaultCss();
  assert.ok(!css.includes('cm-mdh-'), 'editor 的类名不该出现在产物样式里');
});

test('注入：完整文档插进 </head> 之前', () => {
  const html = '<!doctype html><html><head><meta charset="utf-8"></head><body><p>x</p></body></html>';
  const r = injectCss(html, 'body{color:red}');
  assert.equal(r.injected, true);
  assert.ok(r.html.indexOf('data-mdh-css="default"') < r.html.indexOf('</head>'));
  assert.ok(r.html.includes('body{color:red}'));
});

test('注入：裸片段前置', () => {
  const r = injectCss('<p>x</p>', 'p{color:blue}');
  assert.equal(r.injected, true);
  assert.ok(r.html.startsWith('<style'));
  assert.ok(r.html.endsWith('<p>x</p>'));
});

test('注入：幂等，第二次不重复', () => {
  const once = injectCss('<p>x</p>', 'p{}').html;
  const twice = injectCss(once, 'p{}');
  assert.equal(twice.injected, false);
  assert.equal(twice.html, once);
  assert.equal((once.match(/data-mdh-css="default"/g) ?? []).length, 1);
});

test('注入：空 CSS 不动 HTML', () => {
  const html = '<p>x</p>';
  const r = injectCss(html, '');
  assert.equal(r.injected, false);
  assert.equal(r.html, html);
});

test('hasDefaultCss 判定', () => {
  assert.equal(hasDefaultCss('<p>x</p>'), false);
  assert.equal(hasDefaultCss(injectCss('<p>x</p>', 'p{}').html), true);
});
