/**
 * 生成一个可打开的 HTML 页面：渲染 + 参考主题
 *
 *   node tools/build-example.mjs [输出.html]
 */
import { writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { parse } from '../packages/mdh-core/src/index.ts';
import { render } from '../packages/mdh-render/src/index.ts';

const SRC = `===
title = mdh 渲染演示
===

# 我的第一篇 mdh

三个月内把日常对话撑下来，只求**敢开口**、听得懂。

## 一、时态对比

***table name="时态" caption="三种最常见的时态"
head: 时态, 结构, 例句
- 一般现在时, 主语+动词原形, I work every day
- 现在进行时, 主语+be+ing, I am working now
- 一般过去时, 主语+动词过去式, I worked yesterday
***table-end

见表 @时态 可知。

> 记住：**先抓住大意**，不要一开始就追求全听懂。

## 二、核心词汇

***column(1fr/1fr)
**日常生活**

- breakfast 早餐
- commute 通勤
- grocery 杂货
@next-column
**工作场景**

- deadline 截止日期
- colleague 同事
- agenda 议程
***column-end

## 三、公式与图表

***math name="emc"
E = mc^2
***math-end

质能方程 @emc 说明质量与能量等价。

***chart(bar) name="学习进度" caption="每周学习时长"
head: 周次, 小时
- 第一周, 5
- 第二周, 8
- 第三周, 6
***chart-end

---

## 四、代码

\`\`\`ts title="学习计划.ts"
const plan = {
  goal: '日常对话',
  months: 3,
};
\`\`\`

> 引用一段话作为结尾：**坚持比强度更重要**。
`;

const out = process.argv[2] ?? 'demo.html';
const css = readFileSync(
  new URL('../packages/mdh-render/examples/theme-reference.css', import.meta.url),
  'utf8',
);

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>mdh 渲染演示</title>
<style>${css}</style>
</head>
<body>
${render(parse(SRC).ast)}
</body>
</html>`;

writeFileSync(out, html, 'utf8');
console.log(`已生成 ${out}（${(html.length / 1024).toFixed(1)} KB）`);
