/**
 * 生成用于视觉验收的演示页
 *
 *   node tools/build-showcase.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from '../packages/mdh-core/src/index.ts';
import { compile, fullPlugins } from '../packages/mdh-compile/src/index.ts';
import { getKatexCss } from './lib/katex-css.mjs';
import { createRenderer } from '../packages/mdh-render/src/index.ts';

const DOC = `===
title = mdh 语法手册 · 时态篇
author = toru
===

# 英语时态：从入门到能用

三个月内把日常对话撑下来，**不追求口音完美**，只求敢开口、听得懂。这份笔记记录了三类最容易混淆的时态，以及每天 20 分钟就能做完的练习。

## 一、三种最常见的时态

***table name="时态" caption="日常对话中占比最高的三种时态"
head: 时态, 结构, 例句, 使用场景
- 一般现在时, 主语 + 动词原形, I work every day, 习惯、事实、规律
- 现在进行时, 主语 + be + 动词ing, I am working now, 此刻正在发生
- 一般过去时, 主语 + 动词过去式, I worked yesterday, 已经结束的事
***table-end

见表 @时态 可以看出，三种时态的差别主要在**时间点**，而不在动作本身。

### 记忆方法

***list
- **一般现在时** —— 想到「每天、经常、总是」
- **现在进行时** —— 想到「此时此刻」
- **一般过去时** —— 想到「已经过去了」
***list-end

## 二、最容易错的三个地方

***list
1. 第三人称单数忘记加 s
	- 错：She go to school
	- 对：She goes to school

2. be 动词和实义动词同时出现
	- 错：I am work here
	- 对：I work here

3. 过去式不规则变化记不住
	- go → went
	- eat → ate
	- take → took
***list-end

> 记住一句话：**一个句子里只能有一个谓语动词。** 这句话能解决上面百分之八十的错误。

## 三、每天二十分钟的练习

***column(1fr/1fr)
**听力**

1. 先听不看字幕
2. 再看字幕听一遍
3. 逐句跟读
@next-column
**口语**

1. 每天描述一件小事
2. 录音回听
3. 找出一个可以改进的点
***column-end

## 四、进度记录

***chart(bar) name="学习时长" caption="前三周每天的实际学习分钟数"
head: 日期, 分钟
- 第1天, 25
- 第2天, 18
- 第3天, 30
- 第4天, 22
- 第5天, 15
***chart-end

---

### 参考代码

\`\`\`ts title="复习计划.ts"
const plan = {
  goal: '日常对话',
  months: 3,
  dailyMinutes: 20,
};

function shouldReview(day: number): boolean {
  return day % 3 === 0;
}
\`\`\`

### 一个公式

记忆保持率与复习间隔的关系大致是：

***math name="retention"
R = e^{-t/S}
***math-end

其中 @retention 说明间隔越久，保持率越低——所以**分散复习**比集中突击有效。
`;

const css = readFileSync(new URL('../packages/mdh-theme/themes/default.css', import.meta.url), 'utf8');
// 字体 base64 内联，保证单文件产物里公式字体正常
const katexCss = getKatexCss();
// core 是纯能力层，interact 是默认手势层，必须先 core 后 interact
const interactCoreJs = readFileSync(
  new URL('../packages/mdh-theme/src/mdh-interact-core.js', import.meta.url),
  'utf8',
);
const interactJs = readFileSync(
  new URL('../packages/mdh-theme/src/mdh-interact.js', import.meta.url),
  'utf8',
);
const ast = parse(DOC).ast;
const body = await compile(ast, { plugins: fullPlugins() });
const runtime = readFileSync(
  new URL('../packages/mdh-theme/dist/mdh-render.browser.js', import.meta.url),
  'utf8',
);

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>mdh 默认主题</title>
<style>${katexCss}</style>
<style>${css}</style>
</head>
<body>
${body}
<script>${runtime}</script>
<script>${interactCoreJs}</script>
<script>${interactJs}</script>
<script>
  var ast = ${JSON.stringify(ast)};
  var renderer = window.MDHRender(ast);
  MDHInteract.attach(
    document.querySelector('.mdh-document'),
    renderer,
    { serializeNode: window.MDHCore.serializeNode, parseNode: window.MDHCore.parseNode }
  );
</script>
</body>
</html>`;

writeFileSync('showcase.html', html, 'utf8');
console.log('已生成 showcase.html');
