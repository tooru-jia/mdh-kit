/**
 * 交互能力层（TS 包装）
 *
 * 两个 IIFE 文件，顺序有要求：core（纯能力）→ interact（默认手势）。
 *
 *   mdh-interact-core.js   纯能力：select / clear / current / copyId / edit
 *                          **不绑任何事件** —— 手势由使用方决定
 *   mdh-interact.js        mdh-kit 自带的第三层实现：单击选中 + 双击复制
 *
 * ── ⚠️ 这里不 import 那两个文件 ──
 * 曾经 import 过，结果是：打包产物里内嵌了一份交互实现，
 * 页面又用 <script> 引了另一份 —— 两个实例先后注册 `window.MDHInteract`，
 * 后加载的覆盖先加载的，于是「改了源码但页面行为没变」，很难排查。
 *
 * 现在只从全局读。页面的 <script> 负责提供实现，有且只有一份。
 * 缺了就在调用时报清楚的错。
 */

// ---------- 纯能力 ----------

export interface InteractOptions {
  /** 第二层 createRenderer 实例（编辑时需要） */
  renderer?: unknown;
  /** 节点 → 源码（编辑时需要） */
  serializeNode?: (node: unknown) => string;
  /** 源码 → 节点（编辑时需要） */
  parseNode?: (text: string, opts?: { as?: string }) => unknown;
  /** 整段源码 → 多个节点（编辑时需要） */
  parseNodes?: (text: string) => unknown[];
  /** AST → 整篇源码（保存后重排 ID 用） */
  serializeAst?: (ast: unknown) => string;
  /** 源码 → { ast }（保存后重排 ID 用） */
  parseSource?: (source: string) => { ast: unknown };
  /**
   * 重渲染后的「补渲染」钩子
   *
   * 编辑保存后会整篇重渲染，而渲染层只产出占位：
   *   <div class="mdh-math-body" data-mdh-latex="…"></div>
   *   <pre class="mdh-mermaid-body" data-mdh-source="…"></pre>
   * 公式、图表、Mermaid 的真正内容由 compile 插件填充。
   *
   * 不传 = 编辑一次，全篇公式和图就退回空占位。
   *
   * @param html 第二层刚渲染出的 HTML
   * @param ast  渲染这份 HTML 用的 AST
   */
  compileHtml?: (html: string, ast: unknown) => string | Promise<string>;
  /** 编辑保存后回调 */
  onChange?: (ast: unknown) => void;
  /** 复制成功提示文字，默认「已复制」 */
  copyLabel?: string;
  /** ID 徽标 tooltip */
  badgeTitle?: string;
  /**
   * 文档是否被锁（发布器产出的只读文档）
   *
   * true → 不给编辑入口，只保留选中 / 显示 ID / 复制。
   * 由宿主用 `detectLock(source, meta)` 判定后传入。
   */
  locked?: boolean;
  /** 界面文案覆盖（默认英文） */
  text?: MdhUiText;
  /** 打开调试输出 */
  debug?: boolean;
}

export interface InteractSelection {
  el: HTMLElement;
  id: string;
}

export interface Interact {
  /** 选中某个块：HTMLElement 或 ID 字符串 */
  select(target: HTMLElement | string): HTMLElement | null;
  /** 清除选中 */
  clear(): void;
  /** 当前选中 */
  current(): InteractSelection | null;
  /** 复制 ID（不传则复制当前选中的） */
  copyId(id?: string): boolean;
  /** 复制当前选中的块（ID + 整块文本），没选中时返回 false */
  copyCurrent(): boolean;
  /** 进入编辑；能力不完整时返回 false */
  edit(target: HTMLElement | string): boolean;
  /** 是否正在编辑 */
  isEditing(): boolean;
  /** 能力是否完整（能编辑） */
  canEdit(): boolean;
  /** 当前是否被锁（发布器产出的只读文档） */
  isLocked(): boolean;
  /** 设置锁状态（内容被替换后重设） */
  setLocked(locked: boolean): boolean;
  /**
   * 从事件目标找出该选中的块 —— **手势辅助，不做绑定**
   *
   * 用法：container.addEventListener('click', e => it.select(it.pick(e.target)))
   */
  pick(target: EventTarget | null): HTMLElement | null;
  /**
   * 内容被替换后调用：重新装饰 + 可选恢复选中
   *
   * @param keepId 重渲染前选中的块 ID。整篇 innerHTML 替换会销毁所有元素，
   *               但块 ID 是稳定的，传入即可在新 DOM 里重新选中。
   */
  refresh(keepId?: string | null): void;
  /**
   * 目录跳转 —— **能力，不做绑定**
   *
   * 桌面端自己决定什么时候调（单击、键盘、自动预览都行）。
   * 优先按 `data-mdh-toc-text` 匹配标题文字，找不到再退回 `href="#ID"`。
   *
   * @param target 目录链接元素，或标题文字字符串
   * @returns 滚动到的标题元素；找不到返回 null
   */
  scrollToToc(
    target: HTMLElement | string,
    opts?: { behavior?: ScrollBehavior; offset?: number },
  ): HTMLElement | null;
  /** 解除，清掉自己创建的所有 DOM 与监听 */
  destroy(): void;
  container: HTMLElement;
}

interface MDHInteractCoreGlobal {
  create(container: HTMLElement, opts?: InteractOptions): Interact;
}

const coreMod = (globalThis as unknown as { MDHInteractCore?: MDHInteractCoreGlobal })
  .MDHInteractCore;

/**
 * 创建交互能力实例（不绑任何手势）
 *
 * @example
 * const it = createInteract(container, { renderer, serializeNode, parseNode });
 * // 手势自己决定
 * container.addEventListener('click', (e) => it.select(it.pick(e.target)));
 */
export function createInteract(container: HTMLElement, opts: InteractOptions = {}): Interact {
  if (!coreMod) {
    throw new Error(
      '[mdh/theme] 交互能力层未加载。请确认 mdh-interact-core.js 已随包引入。',
    );
  }
  return coreMod.create(container, opts);
}

// ---------- mdh-kit 自带的第三层实现 ----------

export interface InteractApi {
  /** 节点 → 源码 */
  serializeNode?: (node: unknown) => string;
  /** 源码 → 节点 */
  parseNode?: (text: string, opts?: { as?: string }) => unknown;
  /** 整段源码 → 多个节点（编辑框可能写出多个块） */
  parseNodes?: (text: string) => unknown[];
  /** AST → 整篇源码（保存后重排 ID 用） */
  serializeAst?: (ast: unknown) => string;
  /** 源码 → { ast }（保存后重排 ID 用） */
  parseSource?: (source: string) => { ast: unknown };
  /**
   * 重渲染后的「补渲染」钩子
   *
   * ── 为什么需要 ──
   * 编辑保存后会整篇重渲染，而渲染层只产出占位：
   *   <div class="mdh-math-body" data-mdh-latex="…"></div>
   *   <div class="mdh-chart-body" data-mdh-chart="…"></div>
   *   <pre class="mdh-mermaid-body" data-mdh-source="…"></pre>
   * 公式、图表、Mermaid 的真正内容由 mdh-compile 的插件填充。
   *
   * 不传这个钩子 = 编辑一次，全篇公式和图就退回空占位。
   * 用 mdh-kit/mount 时它会自动接好，无需自己写。
   *
   * @param html 第二层刚渲染出的 HTML
   * @param ast  渲染这份 HTML 用的 AST
   * @returns 补好公式 / 图 / 图表的 HTML；可以是异步的
   */
  compileHtml?: (html: string, ast: unknown) => string | Promise<string>;
  /** 编辑保存后回调 */
  onChange?: (ast: unknown) => void;
  /** 文档是否被锁（发布器产出的只读文档） */
  locked?: boolean;
  /** 选中时是否显示 ID 角标，默认 true */
  showIdBadge?: boolean;
  /** 复制成功的提示文字，默认「已复制」 */
  copyLabel?: string;
  /** 角标 tooltip，默认「Click to copy ID and content」 */
  badgeTitle?: string;
  /** 界面文案覆盖（默认英文） */
  text?: MdhUiText;
  /** 打开调试输出 */
  debug?: boolean;
}

/** 交互层界面文案 */
export interface MdhUiText {
  /** 编辑按钮，默认 "Edit" */
  edit?: string;
  /** 复制成功提示，默认 "Copied" */
  copied?: string;
  /** 代码块复制按钮，默认 "Copy" */
  copy?: string;
  /** 信息条 tooltip */
  badgeTitle?: string;
  /** 编辑按钮 tooltip */
  editTitle?: string;
  /** 编辑框保存按钮，默认 "Save" */
  save?: string;
  /** 编辑框取消按钮，默认 "Cancel" */
  cancel?: string;
  /** 源码解析失败的提示，默认 "Parse failed — check the syntax" */
  parseError?: string;
}

interface MDHInteractGlobal {
  attach(
    container: HTMLElement,
    renderer: unknown,
    api: InteractApi,
  ): Interact;
}

const gestureMod = (globalThis as unknown as { MDHInteract?: MDHInteractGlobal }).MDHInteract;

/**
 * 挂上 mdh-kit 的默认手势：单击选中 + 双击编辑 + Esc 清除
 *
 * 这是「拿来即用」的完整交互，适合 demo 和不需要自定义手势的宿主。
 * 手势需要自定义时（如桌面软件的预览区），改用 createInteract。
 */
export function attachInteract(
  container: HTMLElement,
  renderer: unknown,
  api: InteractApi = {},
): Interact {
  if (!gestureMod) {
    throw new Error(
      '[mdh/theme] 交互手势层未加载。请确认 mdh-interact.js 已随包引入。',
    );
  }
  return gestureMod.attach(container, renderer, api);
}
