/**
 * mdh 渲染器的全部可配置项
 *
 * ── 这是接入方唯一需要看的文件 ──
 * 想改行为，改这里就够了。每一项都有默认值，不传就用默认。
 *
 * ── 为什么单独一个文件 ──
 * 配置项散在各处时，接入方读代码要来回翻。集中在这里，
 * 一眼能看到「有哪些开关、默认是什么、改了会影响什么」。
 *
 * ── 数据 vs 回调 ──
 * 这个对象是**纯数据**，可以存成 JSON、从服务器下发、让用户改。
 * 回调（onChange / onSelect）不能写进 JSON，单独作为第三个参数传，
 * 见 `mount.ts` 的 `MdhCallbacks`。
 */

/** 渲染器的全部可选配置 */
export interface MdhSetting {
  /** mdh 源码（必填） */
  source: string;

  /**
   * 能否点击编辑
   *
   * - `false`（默认）：只能看、选中、复制 ID
   * - `true`：双击块弹出编辑窗，改完回写源码
   *
   * ⚠️ 这是「渲染出来的页面内容」能不能编辑，不是源码区。
   *    源码区的编辑由宿主自己的编辑器负责。
   */
  editable?: boolean;

  /**
   * 文档被锁（发布器产出的只读文档）
   *
   * `true` 时强制不可编辑，优先级高于 `editable`。
   * 锁的判定规则见 mdh-core 的 `detectLock`。
   */
  locked?: boolean;

  /**
   * 点击时是否显示 ID 角标
   *
   * 默认 `true`。关掉后仍然能选中、能拿 ID，只是不显示那个小标签。
   */
  showIdBadge?: boolean;

  /** 复制成功的提示文字，默认「已复制」 */
  copyLabel?: string;

  /**
   * 在容器里找哪个选择器作为渲染根
   *
   * 默认 `.mdh-document`。一般不用改，除非宿主自己包了一层。
   */
  selector?: string;

  /**
   * 界面文案（默认英文）
   *
   * mdh-kit 是给第三方接入的库，界面上写死中文会让非中文用户困惑。
   * 需要中文的宿主自己传：
   *   `text: { edit: '编辑', copied: '已复制', copy: '复制' }`
   */
  text?: {
    edit?: string;
    copied?: string;
    copy?: string;
    badgeTitle?: string;
    editTitle?: string;
    save?: string;
    cancel?: string;
    parseError?: string;
  };

  /** 打开调试输出（保存时把 textarea 原文逐字符打到 console） */
  debug?: boolean;

  /**
   * 是否带上默认主题样式
   *
   * - `true`（默认）：把 `<style>` 注入到容器里，开箱即用
   * - `false`：样式由宿主自己引 `mdh-kit/default.css`
   *
   * 多条内容共用一个页面时，建议 `false` —— 样式引一次就够。
   */
  injectStyle?: boolean;
}

/** 补全默认值后的配置 */
export interface ResolvedMdhSetting extends Required<Omit<MdhSetting, 'source' | 'text' | 'debug'>> {
  /** 界面文案（原样透传，不补默认值 —— 默认值在交互层） */
  text?: MdhSetting['text'];
  debug?: boolean;
  source: string;
}

/** 各项默认值 */
export const DEFAULT_SETTING = {
  editable: false,
  locked: false,
  showIdBadge: true,
  copyLabel: '已复制',
  selector: '.mdh-document',
  injectStyle: true,
} as const;

/**
 * 把用户传的稀疏配置补成完整配置
 *
 * 每项都过一遍默认值，接入方只写想改的那几项即可。
 */
export function resolveSetting(setting: MdhSetting): ResolvedMdhSetting {
  if (!setting || typeof setting.source !== 'string') {
    throw new Error('mdh: mount() 需要 source（mdh 源码字符串）');
  }

  return {
    source: setting.source,
    editable: setting.editable ?? DEFAULT_SETTING.editable,
    locked: setting.locked ?? DEFAULT_SETTING.locked,
    showIdBadge: setting.showIdBadge ?? DEFAULT_SETTING.showIdBadge,
    copyLabel: setting.copyLabel ?? DEFAULT_SETTING.copyLabel,
    selector: setting.selector ?? DEFAULT_SETTING.selector,
    injectStyle: setting.injectStyle ?? DEFAULT_SETTING.injectStyle,
    text: setting.text,
    debug: setting.debug ?? false,
  } as ResolvedMdhSetting;
}

/**
 * 用户可传的回调（不能写进 JSON，所以单独一个参数）
 *
 * 全部可选，不传就不通知。
 */
export interface MdhCallbacks {
  /** 编辑保存后：拿到新的完整源码 */
  onChange?: (newSource: string) => void;
  /** 选中某块：拿到它的 ID 与描述 */
  onSelect?: (info: { id: string; label: string }) => void;
  /** 取消选中 */
  onClear?: () => void;
}
