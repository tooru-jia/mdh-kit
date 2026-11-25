# mdh-theme

mdh 文档的**外观层**与**交互能力层**。

> 两件事，别混：
> **外观**（CSS）决定「长什么样」，**能力**（createInteract）决定「能做什么动作」。
> 至于「什么时候触发动作」，那是宿主自己的事。

---

## 装什么

```ts
// 文档外观：一份 CSS
import '@mdh/theme/default.css';

// 能力：按需
import { createInteract, attachInteract } from '@mdh/theme/interact';
```

包很小，没有运行时依赖。CSS 约 40KB，交互层约 17KB。

> **只管渲染产物的外观。** 编辑器里的语法高亮（CodeMirror 的类名表、
> 源码区配色）不属于这个包 —— 那是编辑器的职责，不是文档长什么样。
> 需要的话照 `docs/SYNTAX-INTRODUCTION.md` 的符号总表自己写规则。

---

## 外观：CSS 变量

主题用**29 个 CSS 变量**描述设计语言。改配色不用碰任何选择器，覆盖变量即可。

### 文字与背景

| 变量 | 用途 |
|---|---|
| `--mdh-fg` | 正文颜色 |
| `--mdh-fg-muted` | 次要文字（题注、辅助说明） |
| `--mdh-fg-subtle` | 更弱的文字（占位、禁用） |
| `--mdh-bg` | 页面背景 |
| `--mdh-bg-subtle` | 浅背景（代码块外框、标签底） |
| `--mdh-bg-code` | 代码块背景 |

### 边框与强调

| 变量 | 用途 |
|---|---|
| `--mdh-border` | 普通边框 |
| `--mdh-border-strong` | 强调边框（引用左边线、表头下边线） |
| `--mdh-accent` | 主色（朱红）——链接、编号、选中态 |
| `--mdh-accent-soft` | 主色的浅底 |
| `--mdh-accent-ink` | 主色的深色文字版 |

### 字号与行高

| 变量 | 默认 |
|---|---|
| `--mdh-fs-body` | 16px |
| `--mdh-fs-h1` / `-h2` / `-h3` | 34 / 25 / 19px |
| `--mdh-fs-small` | 14px |
| `--mdh-fs-code` | 13.5px |
| `--mdh-lh-body` | 1.75 |
| `--mdh-lh-heading` | 1.25 |

### 间距与其它

| 变量 | 用途 |
|---|---|
| `--mdh-space-1` … `--mdh-space-5` | 8 / 16 / 24 / 32 / 48px 五档间距 |
| `--mdh-radius` / `--mdh-radius-sm` | 圆角 |
| `--mdh-font-body` / `--mdh-font-mono` | 字体族 |
| `--mdh-measure` | 正文最大宽度（42em） |

### 换一套配色

```css
/* 你自己的样式表，在 default.css 之后引入 */
:root {
  --mdh-accent: #1a6fb5;
  --mdh-accent-soft: #e8f1fa;
  --mdh-accent-ink: #14568c;
  --mdh-bg: #fdfdfc;
}
```

深色主题同理——覆盖变量，不用改任何选择器。

---

## 能力：createInteract

创建交互能力实例。**它不绑任何手势**。

```ts
import { createInteract } from '@mdh/theme/interact';

const it = createInteract(container, {
  renderer,          // 可选：用于编辑保存
  serializeNode,     // 可选：节点 → 源码
  parseNode,         // 可选：源码 → 节点
});
```

### 能力清单

| 方法 | 作用 |
|---|---|
| `pick(target)` | 从事件目标找出该选中的块（手势辅助，不绑定） |
| `select(target)` | 选中某个块（HTMLElement 或 ID） |
| `clear()` | 清除选中 |
| `current()` | 当前选中（`{ el, id }`） |
| `copyId(id?)` | 复制块 ID |
| `edit(target)` | 进入编辑态；能力不完整时返回 false |
| `isEditing()` | 是否正在编辑 |
| `canEdit()` | 能力是否完整 |
| `scrollToToc(target)` | 跳转到目录项对应的标题 |
| `refresh(keepId?)` | 内容被替换后重新装饰 + 恢复选中 |
| `destroy()` | 解除，清掉所有 DOM 与监听 |

### 自己绑手势

```ts
const it = createInteract(container);

// 单击选中
container.addEventListener('click', (e) => {
  // 目录链接：改成容器内平滑滚动
  const link = e.target instanceof Element ? e.target.closest('.mdh-toc-link') : null;
  if (link) {
    e.preventDefault();
    it.scrollToToc(link);
    return;
  }
  const hit = it.pick(e.target);
  if (hit) it.select(hit);
  else it.clear();
});

// Esc 清除
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') it.clear();
});
```

**这是给桌面软件、自定义编辑器的推荐用法**——你的产品有自己的手势表，不该被库绑死。

### 用默认手势

不想自己写就用现成的：

```ts
import { attachInteract } from '@mdh/theme/interact';

attachInteract(container, renderer, {
  serializeNode: (node) => serialize(node),
  parseNode: (text) => parseNode(text),
  onChange: (ast) => { /* 保存 */ },
});
```

默认手势：**单击选中 + 双击编辑 + Esc 清除**。适合 demo、内部工具、不需要自定义交互的场景。

---

## `refresh()` 的正确用法

预览区通常用 `innerHTML = html` 整体替换。这会销毁所有旧元素，交互实例里的 `selected` 变成死节点。

块 ID 是稳定的（同一个块重渲染还是 `O2`），所以：

```ts
// 1. 替换前记住选中
const keepId = it.current()?.id ?? null;

// 2. 替换内容
container.innerHTML = newHtml;

// 3. 按 ID 选回来
it.refresh(keepId);
```

`refresh()` 还负责重新装饰（代码块的复制按钮等）——**每次内容变化后都要调**。

---

## CSS 类名一览

给需要针对性覆盖样式的人：

| 类 | 元素 |
|---|---|
| `.mdh-document` | 整篇容器 |
| `.mdh-heading` / `-1` … `-6` | 标题 |
| `.mdh-paragraph` | 段落 |
| `.mdh-list` / `-unordered` / `-ordered` | 列表 |
| `.mdh-table` | 表格 |
| `.mdh-code` / `.mdh-code-head` | 代码块 |
| `.mdh-quote` | 引用 |
| `.mdh-toc` / `.mdh-toc-list` / `.mdh-toc-link` | 目录 |
| `.mdh-figure` / `.mdh-chart-body` / `.mdh-mermaid-body` | 图表 |
| `.mdh-footnotes` / `.mdh-footnote` | 脚注 |
| `.mdh-selected` | 选中态 |
| `.mdh-id-badge` | ID 徽标 |

数据属性（供脚本识别）：

| 属性 | 值 |
|---|---|
| `data-mdh-id` | 块 ID，如 `O2` / `M5-H1C2` |
| `data-mdh-type` | 节点类型 |
| `data-mdh-number` | 编号数字 |
| `data-mdh-kind` | 编号类别（table / figure / equation） |
| `data-mdh-block` | 块名（toc / divider / …） |
| `data-mdh-toc-level` | 目录层级 |
| `data-mdh-toc-text` | 目录项的标题文字 |

---

## 不做什么

- **不做语法解析** —— 那是 `@mdh/core`
- **不生成 HTML** —— 那是 `@mdh/render`
- **不绑手势** —— `createInteract` 只给能力；`attachInteract` 给的是「参考实现」，不是唯一答案
