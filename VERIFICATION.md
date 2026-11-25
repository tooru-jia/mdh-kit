# 测试说明

> **范围**：这份文档只讲 `mdh-kit` 自己的测试怎么跑、验到什么程度、哪里测不到。
>
> **编辑器里的语法高亮不在本仓库范围**，也就不在这里验证。

---

## 怎么跑

```bash
cd mdh-kit
npm install

npm test             # 365 项单测
npm run typecheck    # 类型检查
npm run conformance  # ID 规范一致性（15 项）
npm run build        # 构建 dist
```

三项都要绿才算通过。`npm test` 报 `tests 0` 说明测试文件没被找到，是假通过。

---

## 各组测什么

| 组 | 位置 | 内容 |
|---|---|---|
| **解析** | `packages/mdh-core/verify/` | 各类语法识别、ID 生成、宽松回退 |
| **渲染** | `packages/mdh-render/verify/` | HTML 结构、数据属性、编号、增删查改 |
| **编译** | `packages/mdh-compile/verify/` | 插件编排、错误处理、依赖缺失 |
| **交互** | `packages/mdh-theme/verify/` | 选中、ID 角标、目录跳转 |
| **样式** | `packages/mdh-theme/verify/css.test.ts` | CSS 唯一性、注入幂等 |
| **ID 契约** | `conformance/` | 判定一份实现是否合规（对外） |

---

## 往返保真度

`serialize(parse(src))` 再 `parse` 一次，**语义必须一致**。

以下字段允许不同：

| 字段 | 原因 |
|---|---|
| `columns` | 每栏原始文本，仅供调试，重排后自然不同 |
| `blankBefore` | 渲染间距提示，往返后可能变化，不影响语义 |

其余字段（`id`、`type`、`name`、`caption`、`lines`、`children`）**必须严格一致**。

---

## 测不到的部分（必须人眼看）

| 项 | 为什么测不了 |
|---|---|
| Mermaid 出图效果 | 布局由 mermaid 自己算，只能看像不像 |
| 图表尺寸 / 饼图是否压扁 | 取决于容器宽高比，断言不了「好看」 |
| 分栏宽度是否合理 | 同上 |
| slides 缩放后的可读性 | `transform: scale` 的效果只能看 |
| 目录跳转的滚动是否顺滑 | 行为可测，观感不可测 |

**「测试全绿」不等于「画面正确」。** 改渲染或样式后，请拿真实文档在浏览器里看一遍。

---

## 当前已知限制

| 项 | 说明 |
|---|---|
| `tabs` 块 | 保留关键字，未实现。写了按未知块处理（内容会保留） |

---

## 未知语法的处理

认不得的东西**不报错、不崩、不吞内容**。10 项验证全过：

```bash
node --experimental-strip-types --no-warnings tools/check-unknown-syntax.mjs
```

| 输入 | 结果 |
|---|---|
| 未知块名 `***unknownblock ... ***unknownblock-end` | 内容渲染成段落，块标记行丢弃 |
| 未知指令 `@unknown(值)` | 正文照常，`@unknown` 标为失效引用 |
| 未知 `@` 函数 | 不崩 |
| 未闭合块 | 报 1 个错误，内容不丢 |
| 空文档 / 纯空白 / 只有 `***` | 不崩，产出空文档 |

> ⚠️ **曾经的 bug**：未知块名的内容是**直接丢弃**的（整段消失）。
> 这不叫「宽松解析」，叫「静默吞数据」。现已修：内容保留为段落。

---

## 长文档性能

```bash
node --experimental-strip-types --no-warnings tools/bench-longdoc.mjs
```

实测（混合块类型，含表格/代码/公式/列表）：

| 块数 | 源码大小 | 解析 | 渲染 | HTML |
|---|---|---|---|---|
| 1,000 | 8.8K | 2.5ms | 10ms | 213KB |
| 2,000 | 18K | 5ms | 18ms | 431KB |
| 5,000 | 49K | 5.2ms | 45ms | 1MB |

**线性增长，5000 块 50ms 量级，用户无感。**

2,000 块的文档产出 3,201 个 ID，**重复 0 个**。

> 未测的部分：Mermaid / Chart 的渲染耗时（取决于第三方库和图的复杂度，
> 不在 mdh 自身的性能范围内）。
