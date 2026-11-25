# conformance —— ID 规范一致性测试集

> **用途**：判定一份实现是否符合 mdh 的 ID 规范。
> **谁需要**：想自称「mdh 实现」或用 `.mdh` 后缀的人。
> **判据**：同一份源码 → 同一串 ID，逐字符比对。

---

## 怎么跑

```bash
# 校验本仓库的实现
node conformance/run.mjs

# 校验别人的实现
node conformance/run.mjs --parse=./my-impl.mjs
```

`my-impl.mjs` 需要导出 `parse(source)`，返回 `{ ast }`：

```js
export function parse(source) {
  return { ast: /* 你的 AST */ };
}
```

---

## 通过意味着什么

```
21 / 21 通过
✔ 全部通过：这份实现的 ID 序列符合 mdh 规范
```

**你可以**：
- 自称「mdh 实现」
- 使用 `.mdh` 后缀
- 在 README 里写「符合 mdh ID 规范 v1」

## 不通过意味着什么

```
✖ 不一致：
  01-top-level-order.json
     期望 R M1 M2 M3
     实得 R A1 A2 A3

这份实现不符合 mdh ID 规范，不能自称 mdh、不能使用 .mdh 后缀。
```

**你不能**用 mdh 这个名字和 `.mdh` 后缀。请改名或换后缀（见 [`../NAMING.md`](../NAMING.md)）。

---

## 用例清单

| # | 文件 | 验什么 |
|---|---|---|
| 01 | `01-top-level-order` | 顶层块的顺序即序号，与块类型无关 |
| 02 | `02-nesting-depth` | 嵌套关系决定层级，不平铺 |
| 03 | `03-sibling-count` | 每层独立计数，兄弟按顺序 1,2,3 |
| 04 | `04-o-pool-flat` | 第 3 层之后仍在 O 段，序号累加 |
| 05 | `05-quote-child` | 引用内内容是 N 段 |
| 06 | `06-quote-nested-list` | 引用 → 列表 → 项 是三层 |
| 07 | `07-table-row` | 表格行是 N 段，单元格无 ID |
| 08 | `08-column-no-reset` | 分栏内容不重置层级 |
| 09 | `09-column-multi` | 多栏各自独立编号 |
| 10 | `10-slides` | 页是顶层块，页内内容是 N 段 |
| 11 | `11-explicit-list-block` | `***list` 块内列表项是 N 段 |
| 12 | `12-divider-is-block` | 分割线是独立块，占一个 M 号 |
| 13 | `13-mixed-document` | 混合文档按出现顺序依次编号 |
| 14 | `14-list-contains-block` | `***list` 里顶格放 table：table 是列表的子块，不另占顶层 M 号 |
| 15 | `15-list-nested-block` | `***list` 里再放 `***list`：内层列表仍在同一父节点下编号 |
| 16 | `16-item-nested-table` | 列表项下面**缩进**的 table 是项的子块：`M1-N1` → `M1-N1-O1` |
| 17 | `17-item-nested-multi` | 一个项下面嵌多个块：按出现顺序依次拿子序号 |
| 18 | `18-bare-list-no-slot` | 裸列表的分组节点不占号（id 为空串），项直接排到父级 |
| 19 | `19-slides-deep-nesting` | slides 里页占一段，页内嵌套到第 3 层时压回 O 池 |
| 20 | `20-table-cell-no-id` | 表格只有行有 ID，单元格不生成 ID |
| 21 | `21-mixed-sibling-and-child` | 顶格块（与项平级）与缩进块（项的子块）混在一张表里各归各位 |

> 14–17 这四条钉的是同一条规则：**缩进 = 归属**。
> 顶格的块与列表项平级（共用 N 段），缩进的块成为上一项的子项（落到 O 段），
> 这只在 `***list` 块内成立。

---

## 文件格式

每个用例是一个 JSON：

```json
{
  "name": "01-top-level-order",
  "note": "这个用例验什么",
  "source": "# 标题\n\n第一段。\n\n第二段。",
  "ids": ["R", "M1", "M2", "M3"]
}
```

| 字段 | 说明 |
|---|---|
| `source` | mdh 源码 |
| `ids` | **期望的 ID 序列**，按文档顺序，含根 `R` |
| `note` | 这个用例为什么重要 |

---

## 加用例的纪律

```bash
node conformance/seed.mjs      # 改这个文件里的用例表
node conformance/generate.mjs  # 跑实现，自动填 ids
```

⚠️ **`generate.mjs` 只是省手工，填出来的期望值必须人工核对。**

用实现自己生成期望值、再拿它验实现，等于自己给自己打分——改了 bug 也发现不了。

**核对时问一句**：「这个编号符合 `docs/ID-SPEC.md` 吗？」而不是「跑出来是什么」。

---

## 与单测的关系

| | 单元测试（`packages/*/verify/`） | conformance |
|---|---|---|
| 对象 | 本仓库的实现细节 | **外部实现** |
| 变化 | 跟着代码改 | **几乎不变**（是契约） |
| 数量 | 数百项 | 17 项，精挑细选 |
| 目的 | 别改坏 | 判定合不合规 |

**conformance 的用例要少而稳。** 加一条要犹豫：它会不会挡住别人的合理实现？

> **加用例前先问自己：**
> 「这条要是别人 ID 全对、只是架构和我不同，会不会被挡住？」
> 会 → 不该加。不会 → 可以加。
>
> **conformance 只锁「大家必须一样的那一小块」，其余全放开。**
> 这样规范才有说服力 —— 别人看完会说「要求很具体，而且我满足了」，
> 而不是「你的规矩比 MD 还多」。
