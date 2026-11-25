/**
 * 第三层·交互实现 A（mdh-kit 自带）
 *
 * ============================================================
 * 这是什么
 * ============================================================
 * 它坐在 mdh-interact-core.js（纯能力）之上，**只做一件事：绑定手势**。
 *
 *   单击块   → 选中
 *   双击块   → 进入编辑
 *   Esc      → 清除选中 / 关闭编辑
 *
 * 这是 mdh-kit 对「一个完整交互体验」的默认主张，给 demo 页面和
 * 第三方拿来即用的人。它不是唯一合法的交互方式。
 *
 * ============================================================
 * 手势由使用方决定
 * ============================================================
 * 换一个宿主，手势可能完全不同：
 *
 *   - 桌面软件（Lumen）：只绑单击选中，编辑入口放在源码区
 *   - 演示模式：单击翻页，不需要选中
 *   - 只读导出页：不绑任何手势
 *
 * 这些场景直接用 interact-core 自己绑，不要用这个文件。
 *
 * 用法：
 *   MDHInteract.attach(container, renderer, {
 *     serializeNode, parseNode, onChange,
 *   });
 */
(function (global) {
  'use strict';

  /**
   * 挂上「单击选中 + 双击编辑」这套默认手势
   *
   * @param {HTMLElement} container 渲染容器
   * @param {object} renderer       createRenderer 实例
   * @param {object} api            { serializeNode, parseNode, onChange }
   * @returns core 实例（可直接拿去做更细的控制或 destroy）
   */
  function attach(container, renderer, api) {
    api = api || {};

    var core = global.MDHInteractCore.create(container, {
      renderer: renderer,
      serializeNode: api.serializeNode,
      parseNode: api.parseNode,
      parseNodes: api.parseNodes,
      serializeAst: api.serializeAst,
      parseSource: api.parseSource,
      /*
       * 补渲染钩子：编辑保存后整篇重渲染，渲染层只给占位，
       * 公式 / 图表 / Mermaid 要靠插件填。漏传这个 = 编辑一次全篇公式消失。
       *
       * ⚠️ 这里是白名单转发，新增能力必须在此登记，
       *    否则 core 收到的是 undefined，且不会报错 —— 极难排查。
       */
      compileHtml: api.compileHtml,
      serializeAst: api.serializeAst,
      onChange: api.onChange,
      // 文档锁：发布器产出的只读文档，true 则不给编辑入口
      locked: api.locked,
      // 视觉选项
      showIdBadge: api.showIdBadge,
      copyLabel: api.copyLabel,
      badgeTitle: api.badgeTitle,
      text: api.text,
      debug: api.debug,
    });

    // ---- 手势：单击选中 ----
    //
    // 编辑不走双击 —— 选中后信息条上有「编辑」按钮，用户看得见、点得着。
    // 双击是隐藏操作，用户不会知道，也容易误触。
    container.addEventListener('click', function (e) {
      if (core.isEditing()) return;
      // 信息条里的按钮自己处理点击
      if (e.target.closest && e.target.closest('[data-mdh-badge]')) return;
      if (e.target.closest && e.target.closest('.mdh-code-copy')) return;
      var el = core.pick(e.target);
      if (!el) { core.clear(); return; }
      core.select(el);
    });

    // ---- 手势：双击文字 → 选中 + 复制整块 ----
    //
    // 双击 = 「指认这一块」的快捷方式：
    //   ① 把所在的块选中 → 出信息条
    //   ② 复制「块 ID + 整块文本」（和点信息条完全一致）
    //
    // 不复制浏览器选中的那个词 —— 双击的意图是「这一块有问题」，
    // 不是「这个词有问题」。部分选中交给拖选 + 点信息条那条路。
    container.addEventListener('dblclick', function (e) {
      if (core.isEditing()) return;
      if (e.target.closest && e.target.closest('[data-mdh-badge]')) return;
      var el = core.pick(e.target);
      if (!el) return;
      core.select(el);
      setTimeout(function () { core.copyCurrent(); }, 0);
    });

    // ---- 手势：Esc 清除 ----
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !core.isEditing()) core.clear();
    });

    return core;
  }

  global.MDHInteract = { attach: attach };
})(typeof window !== 'undefined' ? window : this);
