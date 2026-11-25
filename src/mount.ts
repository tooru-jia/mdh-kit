/**
 * mdh-kit 的唯一渲染入口
 *
 * ── 做什么 ──
 * 给一段 mdh 源码，渲染成能直接看、能点击选中、可选编辑的内容，挂进你给的容器。
 *
 * ── 怎么用 ──
 *   页面先引引擎（含公式/图表/高亮）：
 *     <script src="mdh-kit/mdh.browser.js"></script>
 *     <script src="mdh-kit/mdh-render.browser.js"></script>
 *     <script src="mdh-kit/interact-core.js"></script>
 *     <script src="mdh-kit/interact.js"></script>
 *
 *   然后：
 *     import { mount } from 'mdh-kit/mount';
 *     const view = await mount(el, { source: '……' });
 *
 * ── 为什么用页面的 window.Mdh，而不是自己 compile ──
 * 编译需要 KaTeX / Chart.js / Mermaid，它们打成一份就好（mdh.browser.js，524KB）。
 * 如果 mount 自己再打包一份，页面就有两份编译器，体积翻倍且依赖容易对不上。
 * 所以 mount 只做「编排」：调页面的 Mdh 拿 HTML，自己负责上屏与挂交互。
 */

import { parse, serialize, serializeNode, parseNode, parseNodes, detectLock } from '../packages/mdh-core/src/index.ts';
import { createRenderer } from '../packages/mdh-render/src/index.ts';
import { attachInteract, type Interact } from '../packages/mdh-theme/src/interact.ts';
import { resolveSetting, type MdhSetting, type MdhCallbacks } from './setting.ts';
import {
  reportDependencies,
  type DependencyReport,
  type DependencyStatus,
} from './dependencies.ts';

/** 页面上的 mdh 引擎（由 mdh.browser.js 提供） */
interface MdhGlobal {
  compileFromSource(source: string, options?: unknown): Promise<string>;
  compileAst(ast: unknown, options?: unknown): Promise<string>;
}

/** mount() 返回的视图对象 */
export interface MdhView {
  /** 渲染出来的根元素 */
  readonly root: HTMLElement;
  /** 底层交互实例：select / clear / copyId / isLocked … */
  readonly interact: Interact;
  /** 当前是否可编辑（锁定时恒为 false） */
  canEdit(): boolean;
  /**
   * 依赖探测结果
   *
   * `missing` 非空 = 缺必需依赖（公式 / 图）。**不阻止渲染**，
   * 文字、表格、列表照常；只有真正用到那个能力时才会报错。
   * 宿主可以据此在界面上提示「装一下 mermaid」。
   */
  readonly missingDeps: DependencyStatus[];
  /** 缺了但不影响阅读的（如 highlight.js，只是代码没颜色） */
  readonly degradedDeps: DependencyStatus[];
  /** 源码变了以后重新渲染 */
  rerender(source: string): Promise<void>;
  /** 解除挂载，清掉所有 DOM 与监听 */
  destroy(): void;
}

/**
 * 把一个配置对象落到容器里
 *
 * @param container 挂到哪
 * @param setting   配置（纯数据，可来自 JSON 文件）
 * @param callbacks 回调（可选，不能写进 JSON）
 */
export async function mount(
  container: HTMLElement,
  setting: MdhSetting,
  callbacks: MdhCallbacks = {},
): Promise<MdhView> {
  if (!container || typeof container.appendChild !== 'function') {
    throw new Error('mdh: mount() 第一个参数必须是 DOM 容器');
  }

  const engine = (globalThis as unknown as { Mdh?: MdhGlobal }).Mdh;
  if (!engine?.compileFromSource) {
    throw new Error(
      'mdh: 页面上找不到引擎。请先引入 mdh.browser.js（它提供 window.Mdh.compileFromSource）。',
    );
  }

  // 依赖探测：缺什么就告诉用户，**但不拦着渲染**
  //
  // 用户的心智模型是「装完包跑起来，缺什么它告诉我」。
  // 所以这里只 warn + 把清单放进返回值，不抛错 ——
  // 纯文字文档不该因为没装 Mermaid 就渲染不了。
  // 真正用到那个能力时（渲染到公式 / 图），由编译插件报错。
  const depReport: DependencyReport = reportDependencies();

  const opts = resolveSetting(setting);
  // 锁优先：setting 显式 locked，或源码里自带锁标记
  const autoLocked = detectLock(opts.source).locked;
  const editable = opts.editable && !opts.locked && !autoLocked;

  let interact: Interact | null = null;
  let root: HTMLElement | null = null;

  /** 渲染正文并挂上交互 */
  async function renderInto(source: string): Promise<void> {
    // ① 编译：源码 → 成品 HTML（公式 / 图表 / 代码高亮都补好）
    container.innerHTML = await engine!.compileFromSource(source);

    // ② 找根元素
    const el = container.querySelector<HTMLElement>(opts.selector);
    if (!el) throw new Error(`mdh: 渲染结果里找不到 ${opts.selector}`);
    root = el;

    // ③ 交互（带默认手势：单击选中、双击编辑、Esc 清除）
    //
    // 可编辑需要三样：renderer（渲染单块）+ serializeNode + parseNode。
    // 只读时三样都不传，canEdit() 自然是 false。
    interact?.destroy();
    interact = attachInteract(el, editable ? createRenderer(parse(source).ast) : null, {
      serializeNode: editable ? (node) => serializeNode(node as never) : undefined,
      parseNode: editable ? (text, o) => parseNode(text, o as never) : undefined,
      parseNodes: editable ? (text) => parseNodes(text) : undefined,
      serializeAst: editable ? (ast) => serialize(ast as never) : undefined,
      parseSource: editable ? (src) => parse(src) : undefined,
      /*
       * 补渲染：编辑保存后整篇重渲染，渲染层只给占位，
       * 公式 / 图表 / Mermaid 要靠引擎的插件填。
       *
       * 钩子拿到的是**刚渲染用的那份 AST**，不是 HTML。
       * 这样能直接交给引擎的 compileAst，不用反序列化回源码再解析一遍。
       */
      compileHtml: editable
        ? (html: string, ast: unknown) =>
            engine!.compileAst(ast, {}).catch((e: unknown) => {
              // 补渲染失败不吞掉：文字已经上屏，失败的只是公式/图，
              // 但必须让人知道为什么看不见，否则就是「悄悄坏掉」。
              console.warn('[mdh-kit] 编辑后补渲染失败，公式 / 图表 / Mermaid 可能缺失：', e);
              return html;
            })
        : undefined,
      onChange: (ast) => callbacks.onChange?.(serialize(ast as never)),
      locked: opts.locked || autoLocked,
      showIdBadge: opts.showIdBadge,
      copyLabel: opts.copyLabel,
      text: opts.text,
      debug: opts.debug,
    });

    // ④ 选中 / 取消选中通知
    if (callbacks.onSelect || callbacks.onClear) {
      let last: string | null = null;
      el.addEventListener('click', () => {
        const cur = interact?.current();
        if (!cur) {
          if (last) {
            last = null;
            callbacks.onClear?.();
          }
          return;
        }
        if (cur.id !== last) {
          last = cur.id;
          callbacks.onSelect?.({
            id: cur.id,
            label: cur.el.textContent?.trim().slice(0, 20) ?? '',
          });
        }
      });
    }
  }

  await renderInto(opts.source);

  return {
    get root() {
      return root!;
    },
    get interact() {
      return interact!;
    },
    canEdit: () => interact?.canEdit() ?? false,
    missingDeps: depReport.missing,
    degradedDeps: depReport.degraded,
    async rerender(source: string) {
      await renderInto(source);
    },
    destroy() {
      interact?.destroy();
      interact = null;
      root = null;
      container.innerHTML = '';
    },
  };
}
