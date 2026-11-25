# 接入指南

> **给谁看**：要把 mdh 用在自己项目里的人——网站、桌面软件、CLI、内部工具。
> **看完能做什么**：把一段 `.mdh` 源码变成可显示的 HTML，并知道出了问题该看哪一层。

本文只讲「怎么用」。对象结构见 [`AST-SPEC.md`](AST-SPEC.md)，ID 规则见 [`ID-SPEC.md`](ID-SPEC.md)。

---

> **入门内容在 [README](../README.md)** —— 装哪个包、三十秒跑起来。
> 本文只讲「进阶用法 + 出问题怎么查」。

---

## 一、常见用法

### 只要 HTML，不要公式和图表

跳过 `@mdh/compile`，直接用两层：

```ts
import { parse } from '@mdh/core';
import { render } from '@mdh/render';

const { ast } = parse(source);
const html = render(ast, { source });
```

**为什么要传 `source`**：脚注编号按「首次出现顺序」算，AST 里没有这个顺序。不传的话脚注序号会按 AST 顺序排，和原文对不上。

### 只要 AST，不要 HTML

```ts
import { parse } from '@mdh/core';

const { ast, diagnostics } = parse(source);

// diagnostics 是解析警告（未闭合的块、未知块名等）
for (const d of diagnostics) {
  console.warn(`${d.line}:${d.column} ${d.message}`);
}
```

AST 结构见 [`AST-SPEC.md`](AST-SPEC.md)。

### 只装部分插件

默认是全套（公式 + 高亮 + Mermaid + 图表）。只想装公式：

```ts
import { compile, katexPlugin } from '@mdh/compile/browser';

const html = await compile(ast, {}, [katexPlugin()]);
```

插件是可选的，装了才有对应渲染能力。没装公式插件时，`$...$` 会原样输出。

### 光有 HTML 不够，还要交互

`@mdh/theme` 除了 CSS 还提供「能力层」：

```ts
import { createInteract } from '@mdh/theme/interact';

const it = createInteract(container);

// 能力：选中、清空、复制 ID、跳转目录…
container.addEventListener('click', (e) => {
  const hit = it.pick(e.target);
  if (hit) it.select(hit);
});
```

**这是能力，不是手势。** 单击选中、双击编辑这些「什么时候触发」的决定权在你手上——mdh 只提供「选中某个块」「跳到某个标题」这些动作。

如果你不介意用默认手势，用 `attachInteract` 一行搞定：

```ts
import { attachInteract } from '@mdh/theme/interact';

attachInteract(container, renderer, { onChange: (ast) => { /* ... */ } });
```

默认手势是：单击选中 + 双击编辑 + Esc 清除。

### 要做「导出单文件」按钮

**mdh-kit 不做导出**——它只管「在页面里渲染」。

| 你要什么 | 用哪个 |
|---|---|
| 在页面里渲染 mdh | `mdh-kit`（本仓库） |
| 生成可发的单文件 HTML | 不在本仓库范围内 |

把渲染结果打包成自包含的 `.html`（内联引擎、内嵌源码）属于出版环节，
需要宿主自己按你的分发方式实现。

---

## 二、编辑器里的源码着色

mdh-kit **不含编辑器插件**，也不发布着色资产。

如果你要做编辑器支持（语法高亮、代码片段），需要自己写规则。
`.mdh` 的符号表在 [`SYNTAX-INTRODUCTION.md`](./SYNTAX-INTRODUCTION.md) 的「符号总表」，
照着它写 TextMate / CodeMirror 的规则即可。

> 一个容易踩的点：`/` 在 mdh 里是斜体符号，而 HTML 闭合标签 `</td>`、
> 路径 `/usr/bin` 里都有 `/`。写高亮规则时要靠上下文区分，
> 不能只按字符判断。

---

## 三、出问题时查哪一层

这是最省时间的一张表。**先定位层级，再去改**。

| 现象 | 大概率是 | 去哪看 |
|---|---|---|
| 某个语法写了没反应（如 `@toc` 空白） | 渲染层没实现 | `@mdh/render` |
| 公式显示成源码 | 插件没装 / 没 hydrate | `@mdh/compile` 插件 |
| 有 HTML 但没样式 | 没引 CSS | `@mdh/theme/default.css` |
| 样式不对（间距、颜色、对齐） | 主题层 | `@mdh/theme` 的 CSS |
| 编辑器里没颜色 | 高亮的 Tag 没接上 | 见下 |
| 解析报错 / AST 结构不对 | 解析层 | `@mdh/core` |

### 编辑器没颜色的两个常见原因

**原因一：token 名不在 CodeMirror 的词表里**

CodeMirror 只认它自己的 Tag（`heading` / `keyword` / `string`）。返回自定义名字会静默失败——控制台报 `Unknown highlighting tag`，页面上就是纯黑。

解法：用 `StreamLanguage` 的 `tokenTable` 把语义名映射到真正的 Tag。

**原因二：CSS class 挂了但没定义样式**

给守卫：断言「映射里用到的每个 class 都在 CSS 里有定义」。

守卫写法：把「映射表里用到的每个 class」抽出来，逐个断言 CSS 里有对应定义。

---

## 四、几个容易踩的坑

### 改了 kit 源码，下游没变化

`@mdh/core` / `@mdh/render` / `@mdh/compile` 的 `exports` 指向 **`dist/`**，不是 `src/`。

改完源码必须重新构建：

```bash
cd mdh-kit && npm run build
```

**这条在开发期也生效。** 即使你在跑 `npm run dev`（Vite 热更新），
改的是 `mdh-kit/packages/*/src/`，桌面端看到的仍是旧的 `dist/` ——
表现是「代码明明改了，界面没反应」。

排查顺序：

1. 确认改的是 `src/` 还是 `dist/`
2. `cd mdh-kit && npm run build`
3. 刷新宿主（dev 环境下 Vite 会重载；打包产物要重新打包）

`@mdh/theme` 是源码直引（`src/`），**不用构建**，改完刷新即可。

### 脚注序号对不上

`render(ast)` 没传 `source`。脚注编号依赖「首次出现的顺序」，这个信息只在源码里。

```ts
const { ast, footnoteDefs } = parse(source);
render(ast, { source, footnoteDefs });
```

### Mermaid / 图表不显示

- 浏览器宿主：确认页面上有 JS 在跑，且没有 CSP 拦截
- Node 宿主：确认装了 Playwright 和浏览器
- 都没问题：看 `disposeMermaid()` / `disposeChart()` 有没有被误调

### 目录点了会跳，但不是平滑滚动

`@toc` 生成的是原生 `<a href="#M2">`。桌面端/应用里通常需要自己拦截，改成容器内滚动：

```ts
container.addEventListener('click', (e) => {
  const link = e.target instanceof Element ? e.target.closest('.mdh-toc-link') : null;
  if (link) {
    e.preventDefault();
    it.scrollToToc(link);   // @mdh/theme 提供的能力
  }
});
```

---

## 五、最小可运行示例

一个完整的 HTML 文件，复制即可跑：

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="./node_modules/@mdh/theme/themes/default.css">
</head>
<body>
  <div id="app"></div>
  <script type="module">
    import { compileFromSource } from './node_modules/@mdh/compile/dist/browser/index.js';

    const source = `
===
title = 示例
===

# 你好

这是一段**粗体**和 $E=mc^2$。

***table ref="demo" caption="示例表"
head: 项目, 数量
- 苹果, 3
***table-end
`;

    document.querySelector('#app').innerHTML = await compileFromSource(source);
  </script>
</body>
</html>
```

如果这段跑不起来，先检查 `node_modules/@mdh/compile/dist/` 是否存在——不存在说明没构建。
