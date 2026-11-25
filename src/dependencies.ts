/**
 * 依赖探测：缺什么，告诉用户，但不拦着渲染
 *
 * ── 设计原则 ──
 * 用户的心智模型是「npm i mdh-kit，跑起来，缺什么它告诉我」。
 * 所以这里**不抛错、不阻止启动**，只做两件事：
 *   ① console.warn 一次，开发者能看见
 *   ② 把缺失清单放进 mount() 的返回值，宿主可以自己决定怎么展示
 *
 * ── 什么时候才真报错 ──
 * 真正用到那个能力时（渲染到公式 / 渲染到 Mermaid 图），
 * 由编译插件抛 `MdhMissingDependency`。那时才拦。
 *
 * ── 检查清单 ──
 *   katex        公式
 *   mermaid      图
 *   highlight.js 代码高亮 —— 缺了只是没颜色，也算一条「可选」
 *   chart.js     1.0.0 的 `***chart` 标为「二期公开」，**不参与**
 */

/** 一个依赖的状态 */
export interface DependencyStatus {
  /** 包名 */
  name: string;
  /** 用来做什么 */
  usedBy: string;
  /** 是否必需（false = 缺了只影响观感） */
  required: boolean;
  /** 当前环境里有没有 */
  present: boolean;
}

/** 探测结果 */
export interface DependencyReport {
  /** 全部依赖的状态 */
  all: DependencyStatus[];
  /** 缺失且必需的 */
  missing: DependencyStatus[];
  /** 缺失但可选的 */
  degraded: DependencyStatus[];
}

/** 探测各依赖在不在当前环境里 */
export function probeDependencies(): DependencyReport {
  const g = globalThis as Record<string, unknown>;

  // 引擎对象（mdh.browser.js / mdh.all.js 提供的 window.Mdh）
  // 会把内嵌的库标在自身上 —— 那些库没有挂到 window，只能通过这里判断
  const engine = g.Mdh as
    | { hasKatex?: boolean; hasMermaid?: boolean; hasHljs?: boolean }
    | undefined;

  const all: DependencyStatus[] = [
    {
      name: 'katex',
      usedBy: '数学公式',
      required: true,
      present: !!(g.katex || engine?.hasKatex),
    },
    {
      name: 'mermaid',
      usedBy: 'Mermaid 图',
      required: true,
      // mermaid 打包进 mdh.all.js 后不会挂到 window 上，
      // 所以要看引擎的自标记（2026-11-25 修：之前只看 window.mermaid，
      // 导致 all-in-one 包里明明带了 mermaid，还一直报「缺少依赖」）
      present: !!(g.mermaid || engine?.hasMermaid),
    },
    {
      name: 'highlight.js',
      usedBy: '代码高亮',
      required: false,
      present: !!(g.hljs || engine?.hasHljs),
    },
  ];

  return {
    all,
    missing: all.filter((d) => d.required && !d.present),
    degraded: all.filter((d) => !d.required && !d.present),
  };
}

/** 提示过的标记：同一份页面只提示一次 */
let warned = false;

/**
 * 把缺失情况告诉用户
 *
 * @returns 探测报告（调用方可以放进返回值给宿主用）
 */
export function reportDependencies(): DependencyReport {
  const report = probeDependencies();
  if (warned) return report;
  if (report.missing.length === 0 && report.degraded.length === 0) return report;
  warned = true;

  if (typeof console === 'undefined') return report;

  if (report.missing.length > 0) {
    const names = report.missing.map((d) => d.name);
    console.warn(
      `[mdh-kit] 缺少依赖：${names.join(', ')}\n` +
        report.missing.map((d) => `  · ${d.name} —— 用于${d.usedBy}`).join('\n') +
        `\n\n` +
        `现在能正常渲染文字、表格、列表等内容；` +
        `但文档里**一旦出现** ${report.missing.map((d) => d.usedBy).join(' / ')}，那一步会报错。\n\n` +
        `装上就好了：\n` +
        `  npm install ${names.join(' ')}\n` +
        `  （浏览器里也可改用 mdh-kit/dist/mdh.all.js，KaTeX 已内嵌）`,
    );
  }

  if (report.degraded.length > 0) {
    console.warn(
      `[mdh-kit] 缺少 ${report.degraded.map((d) => d.name).join(', ')}：` +
        `代码块将不带语法高亮，内容完整可读。`,
    );
  }

  return report;
}
