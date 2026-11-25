# 可覆盖的类名

> **给第三方看的**：想改样式，不用改我们的 CSS —— 覆盖下面这些类名即可。
>
> 这些类名**是公开契约**，改版时会尽量保持稳定。新增元素会出现在这里，
> 不会悄悄改名。

---

## 一、覆盖方式

```css
/* 在 default.css 之后引入 */
.mdh-heading-1 { font-size: 40px; }        /* 只改这一个元素 */
.mdh-code { border-left: 3px solid #c8402f; }  /* 只改这一块 */
```

三档粒度，按需选：

| 档 | 改什么 | 写法 | 影响范围 |
|---|---|---|---|
| ① | 设计变量（配色、字号、间距） | `:root { --mdh-accent: #1a6fb5 }` | 全局 |
| ② | 某一类元素 | `.mdh-heading-1 { … }` | 该类全部 |
| ③ | 单个元素 | 用 `data-mdh-id` 定位 | 那一个块 |

**优先用 ① 变量**——改得少、不出错。变量清单见 `mdh-theme/README.md`。

---

## 二、文档骨架

| 类名 | 元素 | 说明 |
|---|---|---|
| `.mdh-document` | 整篇容器 | 一切内容的根 |
| `.mdh-page-slides` | slides 容器 | 只在 `@page(slides)` 下出现 |
| `.mdh-slide` | 一页幻灯片 | |
| `.mdh-slide-count` / `.mdh-slide-total` | 页码 | 「第 3 / 8 页」，**只作钩子、暂无样式** |

> `@page` 当前只支持 `slides` 一个取值，A4 等纸型已砍掉，
> 所以没有「A4 页面容器」这一类。

## 三、文字

| 类名 | 元素 | 说明 |
|---|---|---|
| `.mdh-heading` | 标题（通用） | 同时带 `.mdh-heading-1` … `-6` |
| `.mdh-heading-1` … `-6` | 各级标题 | 按层级分别命中 |
| `.mdh-paragraph` | 段落 | 源码里连续的行合成一个，用 `<br>` 分隔 |
| `.mdh-strong` / `.mdh-em` / `.mdh-u` / `.mdh-del` | 加粗 / 斜体 / 下划线 / 删除线 | |
| `.mdh-inline-code` | 行内代码 | |
| `.mdh-inline-math` | 行内公式 | KaTeX 渲染 |
| `.mdh-link` | 链接 | 一定是 `<a href>`，能点 |
| `.mdh-img` | 图片 | |
| `.mdh-keyword-reserved` | **保留关键字** | `@tag()` / `@theme()` 等，红字，不是标签 |
| `.mdh-ref` | 引用对象 | `@名字` 指向存在的对象 |
| `.mdh-ref-broken` | **失效引用** | 目标不存在：淡色 + 虚下划线 |

> ⚠️ `.mdh-ref-broken` 只在样式层做标记，**不会在正文里插任何字符**
> （曾经加过问号，作者裁决去掉）。

## 四、列表

| 类名 | 元素 | 说明 |
|---|---|---|
| `.mdh-list` | 列表容器 | |
| `.mdh-list-unordered` / `.mdh-list-ordered` | 无序 / 有序列表 | 对应 `<ul>` / `<ol>` |
| `.mdh-item` | 列表项 | 对应 `<li>` |
| `.mdh-item-task` | 任务项 | 带勾选框 |
| `.mdh-item-para` | 列表项的补充段 | 在 `<li>` 内，用 `<span>` 而非 `<p>` |

## 五、块

| 类名 | 元素 | 说明 |
|---|---|---|
| `.mdh-quote` | 引用块 | `<blockquote>` |
| `.mdh-divider` | 分割线 | `<hr>`，25px 高，中间 1px 线 |
| `.mdh-code` | 代码块 | |
| `.mdh-code-head` | 代码块顶栏 | 文件名 + 语言标签 + 复制按钮 |
| `.mdh-code-title` | 代码块文件名 | |
| `.mdh-code-lang` | 代码块语言 | |
| `.mdh-code-content` | 代码正文 | 对应 `<code>` |
| `.mdh-columns` | 分栏容器 | |
| `.mdh-columns > *` | 单栏 | 每栏一个子元素 |
| `.mdh-table` | 表格 | |
| `.mdh-table-caption` | 表格题注 | |
| `.mdh-table-th` / `.mdh-table-td` | 表头格 / 数据格 | |
| `.mdh-head-row` / `.mdh-row` | 表头行 / 数据行 | |

> **`.mdh-table-th` 而不是 `.mdh-table th`**：嵌套表格时后代选择器会
> 同时命中内外两层，用类名只命中自己那层。

## 六、图表与公式

| 类名 | 元素 | 说明 |
|---|---|---|
| `.mdh-figure` | 图容器（通用） | 图表和 Mermaid 都用 |
| `.mdh-figcaption` | 图题注 | |
| `.mdh-chart-figure` | 图表容器 | |
| `.mdh-chart-body` | 图表画布 | Chart.js canvas |
| `.mdh-mermaid-body` | Mermaid 图 | |
| `.mdh-math` | 块级公式 | |
| `.mdh-math-body` | 公式内容 | KaTeX 接管 |

## 七、目录与脚注

| 类名 | 元素 | 说明 |
|---|---|---|
| `.mdh-toc` | 目录容器 | |
| `.mdh-toc-list-wrap` | 目录列表外包装 | |
| `.mdh-toc-list` | 目录列表 | |
| `.mdh-toc-item` | 目录项 | |
| `.mdh-toc-link` | 目录链接 | 点击在容器内平滑滚动 |
| `.mdh-footnotes` | 文末脚注区 | |
| `.mdh-footnotes-list` | 脚注列表 | |
| `.mdh-footnote` | 单个脚注 | |
| `.mdh-footnote-num` | 脚注序号 | |
| `.mdh-footnote-body` | 脚注正文 | |
| `.mdh-foot-ref` | 正文里的脚注上标 | |
| `.mdh-foot-undefined` | **未定义的脚注** | 引用了不存在的脚注 |
| `.mdh-footnote-undefined` | 未定义脚注的占位 | |

## 八、交互态（点击后出现）

| 类名 | 元素 | 说明 |
|---|---|---|
| `.mdh-selected` | 被选中的块 | 加了 outline + 底色 |
| `.mdh-id-badge` | 选中信息条 | `M2 [Edit]`，挂在 `document.body`（fixed 定位） |
| `.mdh-id-badge-id` | 信息条里的 ID | 点这条复制 |
| `.mdh-id-badge-btn` | 信息条按钮 | |
| `.mdh-id-badge-btn-edit` | 编辑按钮 | 只在可编辑时出现 |
| `.mdh-editing` | 正在编辑的块 | |
| `.mdh-editor` | 编辑浮层 | |
| `.mdh-editor-bar` | 编辑浮层顶栏 | |
| `.mdh-editor-id` | 编辑浮层里的块 ID | |
| `.mdh-editor-input` | 编辑框 `<textarea>` | |
| `.mdh-code-copy` | 代码块的复制按钮 | |

> ⚠️ `.mdh-id-badge` 挂在 `document.body` 上，不在容器内。
> 因为它要贴在 `<hr>`、`<img>` 这类自闭合元素旁边，挂进块里会被丢弃。

## 九、数据属性（给脚本用）

| 属性 | 值 | 说明 |
|---|---|---|
| `data-mdh-id` | `M2` / `M12-N3` | 块 ID，全局唯一 |
| `data-mdh-type` | `paragraph` / `table` / … | 节点类型 |
| `data-mdh-block` | `divider` / `toc` / … | 块名 |
| `data-mdh-number` | `1` / `2` | 编号数字 |
| `data-mdh-kind` | `table` / `figure` / `equation` | 编号类别 |
| `data-mdh-ref` | `名字` | 引用名 |
| `data-mdh-task` | `done` | 任务项完成态 |
| `data-mdh-blank` | `1` | 前面有空行 |
| `data-mdh-toc-level` / `-text` | 数字 / 字符串 | 目录层级与标题文字 |

---

## 十、不承诺稳定的部分

| 不承诺 | 原因 |
|---|---|
| 元素标签（`<p>` 会不会变成 `<div>`） | 只保证类名，不保证标签 |
| 类名的组合方式 | 可能新增辅助类，但不会删已有的 |
| 内联样式 | 全部走 CSS，不写内联 |
| `.mdh-editor-*` 内部的 DOM 结构 | 编辑浮层属于参考实现 |

> **承诺的是**：上表列出的类名不会无故消失；真要改会先标废弃一版。
