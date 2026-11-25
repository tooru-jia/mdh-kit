# mdh-render

mdh 的**第二层**：把 AST 画成页面，含编号计算与增删查改。

> 第一层（解析、序列化）在 `mdh-core`。第三层（主题样式）是纯 CSS。

---

## 职责边界

| 做什么 | 不做什么 |
|---|---|
| 把 AST 画成能显示的元素 | ❌ 不做视觉呈现（无行内 style） |
| 把数据挂到 `data-*` 属性上 | ❌ 不输出「表(1)」这类文字 |
| 计算编号（表 / 图 / 式） | ❌ 不决定编号怎么显示 |
| 提供增删查改 | ❌ 不做交互界面 |

**一句话**：这一层只管「数据齐不齐、结构对不对」，长什么样交给 CSS。

> **产出的是页面，不是文件。** 这一层的输出是给浏览器画的东西，
> 属于实现载体；mdh 仍然是唯一的数据形态，编辑保存后序列化回 `.mdh`。
> 把 `.mdh` 落成一份可分发文件是 mdh-press 的事。

---

## 用法

### 一次性渲染

```js
import { parse } from '@mdh-kit/core';
import { render } from '@mdh-kit/render';

const html = render(parse(src).ast);
```

### 持有状态（推荐）

```js
import { createRenderer } from '@mdh-kit/render';

const r = createRenderer(ast, { mode: 'incremental' });

r.toHtml();                    // 整篇
r.toHtmlOf('O3');              // 单块
r.getNumber('O3');             // "表(1)"
r.resolveReference('员工');     // "O3"
r.getReferrers('员工');         // 哪些节点引用了它

r.update('O3', newNode);       // 改
r.insert('O0', 2, newNode);    // 增
r.remove('O3');                // 删
r.move('O3', 'O0', 0);         // 移动

r.setAst(newAst);              // 换整棵树
r.lastAffected();              // 上次改动影响了哪些节点
```

---

## 两种模式

| 模式 | 行为 | 用途 |
|---|---|---|
| `full`（默认） | 每次渲染都重新生成整篇 | 简单、永远正确 |
| `incremental` | 只重渲染受影响的块 | 大文档性能 |

**增量更新的正确性**靠测试保证：同一批操作，`incremental` 与 `full` 的 HTML 必须**逐字节相同**。

受影响集合怎么算：

1. 被改动的节点
2. 编号变化的节点
3. 引用了上述节点的块
4. 上述所有节点的祖先（子元素 HTML 嵌在父元素里）

---

## HTML 结构约定

### 数据属性

| 属性 | 含义 | 示例 |
|---|---|---|
| `data-mdh-id` | 对象 ID | `O3`、`O3-D1` |
| `data-mdh-type` | 节点类型 | `table`、`heading` |
| `data-mdh-number` | 编号**数字** | `1` |
| `data-mdh-kind` | 编号类别 | `table` / `figure` / `equation` |
| `data-mdh-name` | 块的 `name=` | `员工` |
| `data-mdh-ref` | 引用的名字 | `员工` |
| `data-mdh-ref-number` | 引用指向的编号 | `1` |
| `data-mdh-latex` | 公式原文 | `E = mc^2` |
| `data-mdh-source` | Mermaid 原文 | `graph TD...` |
| `data-mdh-chart` | 图表数据 JSON | `{"chartType":"bar",...}` |
| `data-mdh-preset` | 页面预设 | `slides` |
| `data-mdh-slide-count` | slides 总页数 | `12` |
| `data-mdh-index` | 当前 section 是第几页 | `3` |
| `data-mdh-slide-total` | 每页都带的页总数 | `12` |

### 语义 class

每个元素都带 `mdh-*` class，第三层据此写样式：

| 节点 | class |
|---|---|
| 整篇 | `mdh-document` |
| 标题 | `mdh-heading mdh-heading-1`（带级别） |
| 段落 | `mdh-paragraph` |
| 列表 | `mdh-list mdh-list-unordered` / `-ordered` |
| 列表项 | `mdh-item`（任务项加 `mdh-item-task`） |
| 表格 | `mdh-table`，行 `mdh-row` |
| 引用 | `mdh-quote` |
| 分割线 | `mdh-divider` |
| 代码块 | `mdh-code` |
| 分栏 | `mdh-columns`，每栏 `mdh-col` |
| 公式 | `mdh-math` |
| 图表 / Mermaid | `mdh-figure` + `mdh-chart-figure` / `mdh-mermaid-figure` |
| 幻灯片 | `mdh-page`、`mdh-slide` |
| 目录 | `mdh-toc` |
| 正文引用 | `mdh-ref` |

参考样式见 [`examples/theme-reference.css`](examples/theme-reference.css)。

### 为什么编号只有数字

**「表(1)」还是「Table 1」是显示问题，由 CSS 决定：**

```css
[data-mdh-number][data-mdh-kind="table"]::before {
  content: "表(" attr(data-mdh-number) ")";
}
```

英文主题只需换一条 CSS 规则。**HTML 不含文字，主题才能自由换语言。**

### 正文引用

`见表 @员工薪资 可知` 渲染成：

```html
<p>见表 <span class="mdh-ref" data-mdh-ref="员工薪资"
      data-mdh-ref-number="1" data-mdh-ref-kind="table"></span> 可知。</p>
```

显示成什么（「表(1)」「Table 1」「(1)」）同样交给 CSS。

---

## slides

`@page(slides)` 时输出：

```html
<div class="mdh-page mdh-page-slides" data-mdh-preset="slides" data-mdh-slide-count="12">
  <section class="mdh-slide" data-mdh-index="1" data-mdh-slide-total="12">...</section>
  <section class="mdh-slide" data-mdh-index="2" data-mdh-slide-total="12">...</section>
</div>
```

**不输出「当前页」**——那是运行时状态，第三层翻页时自己管：

```js
slides.forEach((el, i) => el.classList.toggle('is-active', i === current));
```

```css
.mdh-slide { display: none; }
.mdh-slide.is-active { display: block; }
```

## 可选的第三方渲染器

内核**不内置** katex / mermaid / chart.js。这几类内容只输出占位：

```html
<div class="mdh-math" data-mdh-latex="E = mc^2"></div>
<figure><div class="mdh-chart" data-mdh-chart="{...}"></div></figure>
<pre class="mdh-mermaid" data-mdh-source="graph TD..."></pre>
```

想渲染公式，就自己接 KaTeX：

```js
document.querySelectorAll('[data-mdh-latex]').forEach((el) => {
  katex.render(JSON.parse(el.dataset.mdhLatex), el);
});
```

**好处**：不用公式的人不会下载 KaTeX；用的人自己控版本。

---

## 选项

```js
render(ast, {
  includeIds: true,      // 是否输出 data-mdh-id（默认 true）
  includeNumbers: true,  // 是否输出编号数据（默认 true）
});
```

`includeNumbers: false` 时，正文里的 `@名字` 会保留原文，不生成引用标记。
