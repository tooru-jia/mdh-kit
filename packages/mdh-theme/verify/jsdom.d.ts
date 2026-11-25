/**
 * jsdom 的最小类型声明
 *
 * 只声明 verify/ 里实际用到的部分。
 * 不装 @types/jsdom：那会带进一份完整的 DOM 类型，
 * 与项目自己的 lib.dom 冲突，收益也只有一个测试文件。
 */
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string, options?: Record<string, unknown>);
    window: Window & typeof globalThis;
  }
}
