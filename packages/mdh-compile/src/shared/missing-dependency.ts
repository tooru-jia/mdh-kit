/**
 * 依赖缺失错误
 *
 * ── 为什么要有这个专门的类型 ──
 *
 * 编译流程里有两类失败，必须区别对待：
 *
 *   ① 依赖缺失（宿主没装 KaTeX / Mermaid / Chart.js）
 *      → 这是**配置问题**，必须立刻报错，否则用户看到「公式变成源码」
 *        还以为是自己写错了。
 *
 *   ② 内容出错（用户把 Mermaid 语法写错了）
 *      → 这是**文档问题**，降级显示（原样输出）是合理的，
 *        不该因为一段图写错就让整篇渲染失败。
 *
 * `compile()` 的插件 catch 靠 `instanceof MdhMissingDependency` 区分两者。
 */

/** 一个缺失的依赖 */
export interface MissingDependency {
  /** 包名，如 `katex` */
  name: string;
  /** 用在哪类语法上，如「数学公式」 */
  usedBy: string;
}

/**
 * mdh-kit 缺少必需依赖
 *
 * 消息里给出三条出路：装依赖 / 用内置版 / 手动注入实例。
 */
export class MdhMissingDependency extends Error {
  readonly missing: MissingDependency[];

  constructor(missing: MissingDependency[]) {
    const names = missing.map((m) => m.name);
    const detail = missing.map((m) => `  · ${m.name} —— 用于${m.usedBy}`).join('\n');

    super(
      `mdh-kit 缺少必需依赖：${names.join(', ')}\n` +
        `${detail}\n` +
        `\n任选一种解决：\n` +
        `  1. 安装依赖：npm install ${names.join(' ')}\n` +
        `  2. 改用内置版：import { … } from 'mdh-kit/full'（依赖已打包，体积较大）\n` +
        `  3. 手动注入：调用 setKatex() / setMermaid() / setChart() 传入实例`,
    );

    this.name = 'MdhMissingDependency';
    this.missing = missing;
  }
}

/** 便捷构造：单个依赖 */
export function missingDep(name: string, usedBy: string): MdhMissingDependency {
  return new MdhMissingDependency([{ name, usedBy }]);
}
