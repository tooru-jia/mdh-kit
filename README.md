# mdh-kit

**mdh-kit 是 mdh 文档的解析器和阅读器内核。**

它能解析 `.mdh`，把它渲染成一张排好版的页面。可以做成一个独立的阅读器软件，
也可以拿到 mdh 文档后实时渲染——阅读器、预览面板、桌面应用、聊天界面里的预览，
都是这个内核的用法。

写的是纯文本，看到的是成品——不需要懂任何渲染技术。

**渲染后的每个内容都有专属块，并带一个 ID，比如 `M1`、`M2`。**
用户点一下就能拿到 ID 和文本，用来精确定位、直接跟 AI 对话，实现局部重写。

---

## mdh 能做什么

**用纯文本写出两种产物：文档流和 slides。** 
**每个产物的每一个段落，图片，公式，表格都有编号。** ，可以基于稳定的 ID（`M1`、`M2`），人和 AI 指着同一个东西说话。

**表格、插图、公式自动编号，正文可以用 `@名字` 互相引用。** 调整块的顺序，
编号跟着重排，引用不用手改；点一下引用就跳到目标位置。目录只收 H1–H4，
文档写深了也不会变成一屏清单。

**于是可以把生成和修改都交给 AI。** 把语法给 AI，它就能快速产出整份文档；
要改哪一处，直接说「改 M4」，不用担心AI改错位置。

---

## 产物始终是 mdh

这一条决定了 mdh-kit 是什么，不是实现细节：

```
.mdh 源码  →  parse  →  AST  →  render  →  页面
     ↑                                       │
     └──────────  serialize  ←──  编辑  ──────┘
```

- **进来的是 mdh，出去的是 mdh。** 编辑完保存，得到的还是 `.mdh`。
- 页面上的 DOM 只是「让浏览器把内容画出来」的载体，跟 CSS、字体同级，
  是**实现细节**，不是产物。换一个渲染目标（canvas / PDF / 原生控件）
  而一个 `.mdh` 文件都不用改，这个库仍然是 mdh-kit。
- **mdh-kit 不生成文件。** 它给的是「能显示的内容」，不是「一个成品文件」。
  渲染归渲染，出版归出版。

> 这条不影响运行环境：主入口在浏览器、Node、桌面软件（Electron / Tauri）
> 里都能用。见下文「可以在 Node 里跑」。

---

## 快速开始

mdh-kit 在浏览器里跑。Mermaid 和图表需要真实的 SVG 测量与 canvas，
浏览器里本来就有，所以**直接用**，不需要额外准备什么。

---

### 浏览器

**纯 HTML —— 一个 script 搞定**

```bash
npm install mdh-kit
```

```html
<script src="node_modules/mdh-kit/dist/mdh.all.js"></script>
<div id="app"></div>
<script>
  MdhKit.mount(document.getElementById('app'), {
    source: '# 标题\n\n正文。',
  });
</script>
```

`mdh.all.js`（709KB）把解析、渲染、样式、公式、图表、交互全打进去了。
**什么都不用另装。**

内容渲染出来后，点任意一块显示 `M2`，点它复制 `M2 + 块内容`。

**有打包器（Vite / webpack / Electron）**

```ts
import { mount } from 'mdh-kit/mount';
```

```html
<!-- 引擎和渲染器仍走全局脚本 -->
<script src="node_modules/mdh-kit/dist/mdh.browser.js"></script>
<script src="node_modules/mdh-kit/packages/mdh-theme/dist/mdh-render.browser.js"></script>
```

```ts
const view = await mount(document.getElementById('app'), { source });
```

> **为什么打包器还要引 script**：引擎（KaTeX / Chart.js，500KB）挂在 `window`
> 上才能跨宿主复用。打包器只打 `mount`，引擎仍走全局——这样同页多次
> `mount()` 只加载一份引擎。

---

### 可以在 Node 里跑

**mdh-kit 不绑定运行环境。** 主入口不碰 DOM，在 Node 里能正常 import ——
它只准备数据与结构：

```ts
import { parse, render, compileAst } from 'mdh-kit';

const html = await compileAst(parse(source).ast);  // 拿到可显示的片段
```

典型用途是用 Electron / Tauri 做**桌面软件**：主进程或构建期做解析与预渲染，
渲染进程用 `mdh-kit/mount` 挂上去。

---

### 什么时候需要 DOM

判据不是「Node 还是浏览器」，而是**这个环境里有没有 `document`**：

| 环境 | 有 DOM | 主入口<br>`parse` / `render` | 交互层<br>`mount` / `interact` |
|---|:---:|:---:|:---:|
| 浏览器页面 | ✅ | 能用 | 能用 |
| Electron **渲染进程** | ✅ | 能用 | 能用 |
| Tauri 的 WebView | ✅ | 能用 | 能用 |
| Electron **主进程** | ❌ | 能用 | ❌ |
| Node 脚本 / CI | ❌ | 能用 | ❌ |

交互层要操作 `document` 才能挂手势、定位角标，所以在没有 DOM 的地方引用会崩。
**这不是「Node 不能用 mdh-kit」**——主入口照样能用，只是拿不到交互能力。

---

### 不做什么：生成文件

**mdh-kit 不负责把 `.mdh` 转成一份可直接分发的文件。**

它给你的是「能显示的内容」，不是「一个成品文件」。
要出版成自包含的 `.html`，那是另一个环节的事——渲染归渲染，出版归出版。

---

### 依赖缺失时怎么办

**启动时会告诉你，不会拦着渲染。**

`mount()` 一开始就探测依赖，缺什么会在控制台警告一次，同时把清单放进返回值：

```
[mdh-kit] 缺少依赖：mermaid
  · mermaid —— 用于Mermaid 图

现在能正常渲染文字、表格、列表等内容；
但文档里一旦出现 Mermaid 图，那一步会报错。

装上就好了：
  npm install mermaid
```

宿主也可以自己接管这个提示：

```ts
const view = await mount(el, { source });

if (view.missingDeps.length) {
  showBanner(`请安装：${view.missingDeps.map((d) => d.name).join(', ')}`);
}
```

### 两个时机，两种反应

| 时机 | 行为 |
|---|---|
| **`mount()` 启动** | ⚠️ warn + 写进 `view.missingDeps`，**继续渲染** |
| **渲染到公式 / 图** | ❌ 抛 `MdhMissingDependency`，说清缺什么、怎么装 |

**所以纯文字文档不受影响**：没装 KaTeX 也能正常渲染段落、表格、列表。

### 各依赖的影响范围

| 依赖 | 缺了会怎样 | 算必需吗 |
|---|---|---|
| **katex** | 公式渲染不出来 | ✅ 必需 |
| **mermaid** | 图渲染不出来 | ✅ 必需 |
| highlight.js | 代码只是没颜色，内容完整 | ❌ 只警告 |
| chart.js | `***chart` 是**实验品**，不承诺稳定，不参与自检 | — |

> **不会静默降级**：真用到某个能力而它缺失，一定抛错，不会悄悄出一份坏结果。

---

### 要可编辑模式

```ts
const view = await mount(el, {
  source,
  editable: true,
}, {
  onChange: (newSource) => save(newSource),
});
```

点块上的「Edit」就地改。

---

## 包结构

**对外只有一个包：`mdh-kit`。** 装它就够了。

内部的四个模块是它的组成部分，**不单独发布**——它们在这个仓库里通过
workspace 组织，分开只是为了代码边界清楚，不是让你一个个装：

| 内部模块 | 职责 |
|---|---|
| `mdh-core` | 解析、AST、反向序列化、ID 生成 |
| `mdh-render` | 把 AST 画成页面、编号、增删查改 |
| `mdh-compile` | 编排 + 插件（公式 / 高亮 / Mermaid / 图表） |
| `mdh-theme` | 默认主题 CSS + 交互能力 |

```bash
npm install mdh-kit   # 只装这一个
```

> **编辑器插件与着色规则不在本仓库。** 需要编辑器支持的话，
> 照 [`SYNTAX-INTRODUCTION.md`](docs/SYNTAX-INTRODUCTION.md) 的符号表自己写。

---

## 文档

### 按角色阅读顺序

| 你要做的事 | 按这个顺序读 |
|---|---|
| **写 mdh 文档** | [语法介绍](docs/SYNTAX-INTRODUCTION.md) → 就这一步，然后开始写 |
| **接进自己的产品** | [语法介绍](docs/SYNTAX-INTRODUCTION.md) → [接入指南](docs/INTEGRATION.md) → [可覆盖的类名](docs/CSS-CLASSES.md) → [测试说明](VERIFICATION.md) |
| **自己实现一份**<br>（写解析器 / 做编辑器 / 语言绑定） | [语法介绍](docs/SYNTAX-INTRODUCTION.md) → [**ID 规范**](docs/ID-SPEC.md) → [AST 契约](docs/AST-SPEC.md) → [一致性测试集](conformance/README.md) → [名称条款](NAMING.md) |
| **只是看一眼** | 本 README 的「快速开始」就够 |

---

### 每份文档是干什么的

| 文档 | 目的 | 谁看 |
|---|---|---|
| [**SYNTAX-INTRODUCTION**](docs/SYNTAX-INTRODUCTION.md) | **教怎么写 mdh**。符号总表、块结构、各模块、嵌套规则、完整例子 | 写文档的人 |
| [**INTEGRATION**](docs/INTEGRATION.md) | **教怎么接入**。分场景的调用方式、出错时按层排查、真实踩过的坑 | 集成方 |
| [**CSS-CLASSES**](docs/CSS-CLASSES.md) | **改样式的入口**。渲染产出哪些类名、哪些是公开契约、哪些只是钩子 | 前端 / 设计师 |
| [**ID-SPEC**](docs/ID-SPEC.md) | **定义 ID 怎么生成**。M/N/O 分段、层级规则、编辑期规则。**这是 mdh 之所以是 mdh 的东西** | 实现者 |
| [**AST-SPEC**](docs/AST-SPEC.md) | **定义对象结构**。节点类型、字段、往返保真度约定 | 实现者 |
| [**conformance/**](conformance/README.md) | **判定合规**。给定一份实现，跑一遍就知道它配不配叫 mdh | 实现者 |
| [**VERIFICATION**](VERIFICATION.md) | **说清测到什么程度**。怎么跑、各组测什么、哪里测不到必须人眼看 | 想验证的人 |
| [**NAMING**](NAMING.md) | **名称条款**。代码随便改，但叫 mdh 要通过 conformance | 想 fork 的人 |
| [**LICENSE**](LICENSE) | MIT + 名称条款的附加说明 | 所有人 |

> **`docs/ID-SPEC.md` 是核心契约。**
> 改了里面的规则，产物就不能再叫 mdh、不能用 `.mdh` 后缀——
> 判定方法是跑 `conformance/`，全绿就行。详见 [`NAMING.md`](NAMING.md)。

---

## 开发

```bash
npm install
npm run build        # 构建 dist
npm test             # 单测
npm run typecheck
npm run conformance  # ID 规范一致性
```

常用工具：

```bash
node tools/dump-ast.mjs <file.mdh>       # 看 AST 结构
node tools/check-syntax.mjs <file.mdh>   # 看编辑器着色结果
node tools/build-showcase.mjs            # 生成展示页
```

---

## 为什么值得用

### 一、同一份源码，两种呈现

mdh 文档**不是只能排成文章**。同一份 `.mdh`，由文档开头的 `@page` 决定呈现方式：

| 模式 | 写法 | 呈现成 |
|---|---|---|
| **文档流**（默认） | 不写 `@page` | 一篇可以往下滚的文章 |
| **Slides 流** | 开头写 `@page(slides)` | 一页一页的演示稿，`@next-slide` 翻页 |

```mdh
@page(slides)

# 封面标题

## 副标题

@next-slide

## 第二页

- 要点一
- 要点二
```

**内容不用重写。** 想从文档变成演讲稿，加一行 `@page(slides)`，
再在要分页的地方插 `@next-slide` 就行；反过来也一样。
这在「先写完整文档，再拿去做汇报」的场景里省掉一整次重排。

### 二、语法是给 AI 的说明书

mdh 的语法规则是**成文的、无歧义的**（见 [`docs/SYNTAX-INTRODUCTION.md`](docs/SYNTAX-INTRODUCTION.md)）。
把这份语法交给 AI，它就能稳定写出结构正确的 mdh —— 不用一边生成一边猜渲染器怎么理解。

配合固定的块 ID，流程可以形成闭环：

```
用户：把语法给 AI  →  AI 生成 .mdh  →  mdh-kit 渲染
                ↑                          │
                └────  「改 M4」 ──────────┘
```

### 三、用户能指定编号，让 AI 精确修改

每个块在渲染后都有一个**稳定的 ID**（`M1`、`M2`…，表格行是 `M4-N1`）。
用户在页面上点一下就能拿到 ID，然后直接说「把 M4 改成……」，AI 不需要猜是哪一段。

**这个 ID 不是运行时随便编的。** 它由 [`docs/ID-SPEC.md`](docs/ID-SPEC.md) 规定，
只要源码相同，任何实现产出的 ID 都必须相同 —— 人和 AI 因此站在同一个坐标系里。

### 四、理解统一，而不是理解各异

**Markdown 的问题是「理解各异」**：同一份 `.md`，各家渲染都不一样。

mdh 补的是**「理解统一」**。这需要两样东西，都在这个仓库里：

- 一份**对外契约**：[`docs/AST-SPEC.md`](docs/AST-SPEC.md) + [`docs/ID-SPEC.md`](docs/ID-SPEC.md)
- 一份**可依赖的实现**：`mdh-core`

---

## 许可

MIT，见 [`LICENSE`](LICENSE)。

「mdh」名称和 `.mdh` 后缀有额外条件：需通过 `conformance/` 全部用例。
代码随便改，改完换个名字就行。见 [`NAMING.md`](NAMING.md)。
