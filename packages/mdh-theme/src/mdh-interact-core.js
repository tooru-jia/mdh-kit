/**
 * 第三层·交互能力（纯能力，不绑任何手势）
 *
 * ============================================================
 * 分层说明（重要）
 * ============================================================
 * 这个文件只提供「能做什么」，不决定「怎么触发」。
 *
 *   能力：选中块 / 清除选中 / 显示 ID 徽标 / 复制 ID / 进入编辑
 *   不提供：click、dblclick、keydown 等任何事件绑定
 *
 * 「单击选中、双击编辑」是**手势**，属于使用方的自由：
 *   - mdh-kit 自带的第三层实现（interact.js）：绑 click + dblclick
 *   - 桌面软件（Lumen）：只绑 click，编辑入口放在源码区
 *   - 任何其他宿主：想绑什么绑什么
 *
 * 为什么手势必须留给使用方：
 *   同一个软件里可能同时有多个读者（预览 + 演示 + 导出预览），
 *   它们的交互意图不同。能力可以共享，手势不能。
 *
 * ============================================================
 * 用法
 * ============================================================
 *   const it = MDHInteractCore.create(container, {
 *     renderer,        // 第二层 createRenderer（编辑时必需）
 *     serializeNode,   // AST → 源码（编辑时必需）
 *     parseNode,       // 源码 → 节点（编辑时必需）
 *     onChange,        // 编辑保存后回调
 *   });
 *
 *   it.select(elOrId);   // 选中
 *   it.clear();          // 清除
 *   it.current();        // 当前选中 → { el, id } | null
 *   it.copyId();         // 复制当前选中的 ID
 *   it.edit(elOrId);     // 进入编辑（需要能力齐全，否则静默忽略）
 *   it.pick(target);     // 从事件目标找出该选中的块（手势辅助，不做绑定）
 *   it.destroy();        // 解除，清掉自己创建的所有 DOM 与监听
 */
(function (global) {
  'use strict';

  var LABEL = {
    heading: '标题', paragraph: '段落', list: '列表', listItem: '列表项',
    table: '表格', tableRow: '表格行', column: '分栏', columnItem: '栏',
    math: '公式', chart: '图表', mermaid: '图', code: '代码块',
    page: '页面', slide: '幻灯片', block: '块',
  };

  /**
   * 界面文案（可配置，默认英文）
   *
   * 为什么默认英文：mdh-kit 是给第三方接入的库，
   * 中文写死会让非中文用户不明所以。谁需要中文，自己传一份。
   *
   *   create(container, { text: { edit: '编辑', copied: '已复制' } })
   */
  var DEFAULT_TEXT = {
    /** 信息条上的编辑按钮 */
    edit: 'Edit',
    /** 复制成功后的临时提示 */
    copied: 'Copied',
    /** 代码块的复制按钮 */
    copy: 'Copy',
    /** 信息条 tooltip */
    badgeTitle: 'Click to copy ID and content',
    /** 编辑按钮 tooltip */
    editTitle: 'Edit this block',
    /** 编辑框的保存按钮 */
    save: 'Save',
    /** 编辑框的取消按钮 */
    cancel: 'Cancel',
    /** 编辑保存时源码解析失败 */
    parseError: 'Parse failed — check the syntax',
  };

  // 编号措辞：默认英文，与默认主题 CSS 保持一致
  var NUM_KIND = { table: 'Table', figure: 'Figure', equation: 'Eq.' };

  /** 可选中、可编辑的类型 */
  var EDITABLE = {
    heading: 1, paragraph: 1, list: 1, table: 1, tableRow: 1,
    column: 1, math: 1, chart: 1, mermaid: 1, code: 1, block: 1,
    /**
     * 单个列表项（2026-11-25 新增）
     *
     * 列表项现在能**单独选中**：点它就选中这一项，拿到它自己的 ID（M1-N1），
     * 编辑也只改这一行，不牵动整个列表。
     *
     * 早先它在 SKIP_UP 里 → 点项会一路向上找到整个 listBlock，
     * 于是「点第 3 项却选中整个列表」，改什么都得重写全部项。
     */
    listItem: 1,
    /**
     * `***list` 块的外层容器
     *
     * 显式块渲染成 `<div class="mdh-list-block" data-mdh-type="listBlock">`，
     * 而 `<ul>` 那层反而不带 ID。点列表**空白处**（非某一项）时选它。
     */
    listBlock: 1,
    /** 引用块整体可编辑 —— 否则会选中里面的段落，丢掉 `>` 前缀 */
    quote: 1,
  };

  /**
   * 命中这些类型时向上找可编辑的祖先
   *
   * columnItem：栏是布局容器，点栏内文字选中的应是整栏。
   *
   * ⚠️ `listItem` **不在这里**（2026-11-25 移出）：
   *    列表项本身是可编辑单元，点它就该选中它自己。
   */
  var SKIP_UP = { columnItem: 1 };

  /**
   * 这些类型的元素，实际该编辑的是它的**父块**
   *
   * 引用块渲染成 `<blockquote><p>文字</p></blockquote>`，
   * 内层的 p 也是 paragraph（本来可编辑），但它单独编辑会丢掉 `>` 前缀，
   * 保存回去引用块就降级成普通段落。所以段落只要落在这些父块里，
   * 就把编辑目标让给父块。
   */
  var PARENT_OWNS = {
    /** 引用块内的段落 → 编辑整个引用块 */
    'quote:paragraph': 1,
  };

  /** 从命中的元素向上找第一个可编辑的 */
  function pickEditable(el, container) {
    var cur = el;
    var guard = 0;
    while (cur && cur !== container && guard++ < 20) {
      var t = cur.getAttribute && cur.getAttribute('data-mdh-type');
      if (t) {
        // 这一层该由父块接管吗？
        var parentType = nearestBlockType(cur.parentElement, container);
        if (parentType && PARENT_OWNS[parentType + ':' + t]) {
          cur = cur.parentElement;
          continue;
        }
        if (EDITABLE[t]) return cur;
        if (!SKIP_UP[t]) return null;
      }
      cur = cur.parentElement;
    }
    return null;
  }

  /** 向上找最近的块级 data-mdh-type（跳过容器） */
  function nearestBlockType(start, container) {
    var cur = start;
    var guard = 0;
    while (cur && cur !== container && guard++ < 20) {
      var t = cur.getAttribute && cur.getAttribute('data-mdh-type');
      if (t) return t;
      cur = cur.parentElement;
    }
    return null;
  }

  /** 块的显示名（ID 徽标里的文字） */
  function labelOf(el) {
    var t = el.getAttribute('data-mdh-type') || '';
    var name = el.getAttribute('data-mdh-ref') || '';
    var num = el.getAttribute('data-mdh-number') || '';
    var kind = el.getAttribute('data-mdh-kind') || '';
    var blockName = el.getAttribute('data-mdh-block') || '';

    if (t === 'block' && blockName) {
      var BLOCK_LABEL = { divider: '分割线', quote: '引用', toc: '目录' };
      var label = BLOCK_LABEL[blockName] || blockName;
      return name ? label + '「' + name + '」' : label;
    }

    var parts = [LABEL[t] || t];
    if (name) parts.push('「' + name + '」');
    if (num) parts.push((NUM_KIND[kind] || '') + num);
    return parts.join(' ');
  }

  /** 在 AST 里按 ID 找节点 */
  function findNode(root, id) {
    var hit = null;
    (function walk(node) {
      if (hit || !node) return;
      if (node.id === id) { hit = node; return; }
      var kids = node.children || [];
      for (var i = 0; i < kids.length; i++) walk(kids[i]);
      var rows = node.rows || [];
      for (var j = 0; j < rows.length; j++) walk(rows[j]);
      var cols = node.columnBlocks || [];
      for (var k = 0; k < cols.length; k++) {
        for (var m = 0; m < cols[k].length; m++) walk(cols[k][m]);
      }
      var slides = node.slides || [];
      for (var n = 0; n < slides.length; n++) walk(slides[n]);
      /*
       * 列表项 / list 块里嵌的块（2026-11-25）
       *
       * 这些节点存在 `blocks`（形如 [{ pos, node }]）里，不走 children。
       * 不遍历的话，点嵌套块（如 M44-N3-O1 那张表）编辑时找不到节点 ——
       * 表现是「点 Edit 没反应」。
       */
      var blocks = node.blocks || [];
      for (var b = 0; b < blocks.length; b++) {
        walk(blocks[b] && blocks[b].node ? blocks[b].node : blocks[b]);
      }
    })(root);
    return hit;
  }

  /** 找父节点（替换 listItem / tableRow 时用） */
  function findParent(root, id) {
    var hit = null;
    (function walk(node) {
      if (hit || !node) return;
      var kids = node.children || [];
      for (var i = 0; i < kids.length; i++) {
        if (kids[i].id === id) { hit = node; return; }
        walk(kids[i]);
        if (hit) return;
      }
      var rows = node.rows || [];
      for (var j = 0; j < rows.length; j++) {
        if (rows[j].id === id) { hit = node; return; }
      }
      var cols = node.columnBlocks || [];
      for (var k = 0; k < cols.length; k++) {
        for (var m = 0; m < cols[k].length; m++) {
          if (cols[k][m].id === id) { hit = node; return; }
          walk(cols[k][m]);
          if (hit) return;
        }
      }
      var slides = node.slides || [];
      for (var n = 0; n < slides.length; n++) {
        if (slides[n].id === id) { hit = node; return; }
        walk(slides[n]);
        if (hit) return;
      }
      // 嵌在 list / 列表项里的块（blocks），同 findNode
      var blocks = node.blocks || [];
      for (var b = 0; b < blocks.length; b++) {
        var bn = blocks[b] && blocks[b].node ? blocks[b].node : blocks[b];
        if (bn && bn.id === id) { hit = node; return; }
        if (bn) { walk(bn); if (hit) return; }
      }
    })(root);
    return hit;
  }

  /** 复制文本（带降级） */
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () { fallbackCopy(text); });
      return;
    }
    fallbackCopy(text);
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    ta.remove();
  }

  /**
   * 创建交互能力实例
   *
   * @param {HTMLElement} container 渲染容器（内部有 [data-mdh-id] 的元素）
   * @param {object} opts
   *   renderer      createRenderer 实例（编辑时需要）
   *   serializeNode (node) => string（编辑时需要）
   *   parseNode     (text, opts?) => node（编辑时需要）
   *   onChange      () => void，编辑保存后回调
   *   copyLabel     复制成功时的提示文字，默认「已复制」
   *   badgeTitle    徽标 tooltip
   */
  function create(container, opts) {
    opts = opts || {};
    var renderer = opts.renderer || null;
    var serializeNode = opts.serializeNode || null;
    var parseNode = opts.parseNode || null;
    /** 整段 → 多个节点（编辑框可能写出多个块） */
    var parseNodes = opts.parseNodes || null;
    /** AST → 整篇源码（保存后重排 ID 用） */
    var serializeAst = opts.serializeAst || null;
    /** 源码 → { ast }（保存后重排 ID 用） */
    var parseSource = opts.parseSource || null;
    /**
     * 重渲染后的「补渲染」钩子
     *
     * ── 解决什么 ──
     * repaint() 只调 renderer.toHtml()，那是第二层，只产出占位：
     *   <div class="mdh-math-body" data-mdh-latex="..."></div>
     *   <div class="mdh-chart-body" data-mdh-chart="..."></div>
     *   <pre class="mdh-mermaid-body" data-mdh-source="..."></pre>
     * 公式、图表、Mermaid 的真正内容要靠 mdh-compile 的插件去填。
     *
     * 首次上屏走的是 compileFromSource，插件跑过，所以一切正常；
     * 但用户编辑任意一块之后走的是 repaint，插件没跑 ——
     * 结果就是「改一个字，全篇公式全部消失」。
     *
     * 这个钩子把「补渲染」交回宿主：传进来的 html 再过一遍插件。
     * 不传就保持旧行为（纯文字文档不受影响，也不需要这个）。
     */
    var compileHtml = opts.compileHtml || null;
    var onChange = opts.onChange || function () {};
    var copyLabel = opts.copyLabel || DEFAULT_TEXT.copied;

    /** 界面文案：用户传的覆盖默认 */
    var T = {};
    (function () {
      var user = opts.text || {};
      for (var k in DEFAULT_TEXT) {
        if (Object.prototype.hasOwnProperty.call(DEFAULT_TEXT, k)) {
          T[k] = user[k] || DEFAULT_TEXT[k];
        }
      }
    })();
    // 文档锁：发布器产出的只读文档。true = 不给编辑入口。
    // 锁由宿主张量（mdh-core 的 detectLock），交互层只负责执行。
    var locked = opts.locked === true;

    var selected = null;
    var badge = null;
    var editor = null;        // { box, destroy }
    var disposed = false;

    /**
     * 能力是否完整（能编辑）
     *
     * 三个条件全满足才行：
     *   ① 有 renderer / serializeNode / parseNode（编辑的材料）
     *   ② 文档没被锁（发布器产出）
     */
    function canEdit() {
      if (locked) return false;
      return !!(renderer && serializeNode && parseNode && parseNodes);
    }

    /** 设置锁状态（内容被替换后宿主可重设） */
    function setLocked(next) {
      locked = next === true;
      return locked;
    }

    function clearBadge() {
      if (badge && badge.parentNode) badge.parentNode.removeChild(badge);
      badge = null;
    }

    /**
     * 把信息条贴到块的上方
     *
     * 用 fixed 定位，挂在 document.body 上：
     *   · 挂在块内对 <hr> / <img> 这类自闭合元素无效（子节点被丢弃）
     *   · 挂在容器内会被容器的 overflow 裁掉
     * fixed + body 是唯一对任何块都成立的做法。
     *
     * 跟随滚动/缩放：用一个轻量的重定位，而不是给整个文档加监听 ——
     * 信息条的存在时间很短（下次点击就换/消失），跟着更新足够。
     */
    function placeBadge(el, node) {
      if (typeof document === 'undefined' || !document.body) return;

      document.body.appendChild(node);
      node.style.position = 'fixed';

      var reposition = function () {
        if (!badge || !el.isConnected) return;
        var r = el.getBoundingClientRect();
        var bh = node.offsetHeight || 30;
        var gap = 6;
        var top = r.top - bh - gap;
        // 顶部空间不够 → 挪到块下方
        if (top < 4) top = r.bottom + gap;
        var left = r.left;
        if (left < 4) left = 4;
        node.style.top = Math.round(top) + 'px';
        node.style.left = Math.round(left) + 'px';
      };

      reposition();
      // 一帧后再量一次（字体/内容落定后高度可能变）
      requestAnimationFrame(reposition);

      // 滚动 / 缩放时跟着走；信息条消失后自动解绑
      var onMove = function () {
        if (!badge || !el.isConnected) {
          window.removeEventListener('scroll', onMove, true);
          window.removeEventListener('resize', onMove);
          return;
        }
        reposition();
      };
      window.addEventListener('scroll', onMove, true);
      window.addEventListener('resize', onMove);
    }

    /**
     * 信息条上的 ID 短暂变成「已复制」
     *
     * 复制动作是静默的（没有弹窗、没有 toast），用户唯一能感知到的反馈
     * 就是这个字符串变一下。双击复制时信息条刚生成，也要有这一步，
     * 否则用户不知道自己到底复没复制上。
     */
    function flashCopied() {
      if (!badge) return;
      var codeEl = badge.querySelector('.mdh-id-badge-id');
      if (!codeEl) return;
      var old = codeEl.textContent;
      codeEl.textContent = copyLabel;
      setTimeout(function () {
        // 信息条可能已经被清掉或换成新块了
        if (badge && badge.querySelector('.mdh-id-badge-id') === codeEl) {
          codeEl.textContent = old;
        }
      }, 1200);
    }

    /**
     * 选中的视觉表现：高亮 + 信息条
     *
     * 信息条形态：`M2 · 段落 · [复制] [编辑]`
     *
     *   复制  点一下把 ID 放进剪贴板（人机对话的关键动作）
     *   编辑  仅在可编辑时出现，点开就进入编辑态
     *
     * 为什么不做成「双击编辑」：双击是隐藏操作，用户不会知道。
     * 显式按钮能看见、能点，也不容易被误触。
     */
    function paintSelection(el) {
      if (selected && selected !== el) {
        selected.classList.remove('mdh-selected');
      }
      el.classList.add('mdh-selected');

      clearBadge();
      // showIdBadge=false：只高亮、不挂信息条（宿主想自己画时用）
      if (opts.showIdBadge === false) return;

      var id = el.getAttribute('data-mdh-id');

      badge = document.createElement('div');
      badge.className = 'mdh-id-badge';
      badge.setAttribute('data-mdh-badge', '1');

      // 信息条只显示 ID —— 不显示「段落」「标题」这类类型名
      //
      // 类型是内部概念，用户不需要知道。他点一块的意思就是「改这里」，
      // 谁管它在系统里叫什么。ID 是给 AI 的坐标，够用。
      var code = document.createElement('span');
      code.className = 'mdh-id-badge-id';
      code.textContent = id;
      badge.appendChild(code);

      // 整条点击 → 复制
      badge.setAttribute('data-act', 'copy');
      badge.title = opts.badgeTitle || T.badgeTitle;
      badge.style.cursor = 'pointer';
      badge.addEventListener('click', function (e) {
        // 按钮（编辑）自己处理，别抢它的点击
        if (e.target.closest && e.target.closest('button[data-act="edit"]')) return;
        e.stopPropagation();
        e.preventDefault();
        copySelection(id, el);
        flashCopied();
      });

      // 编辑：唯一的按钮（仅在可编辑时出现）
      if (canEdit()) {
        var editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'mdh-id-badge-btn mdh-id-badge-btn-edit';
        editBtn.setAttribute('data-act', 'edit');
        editBtn.textContent = T.edit;
        editBtn.title = T.editTitle;
        editBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          e.preventDefault();
          edit(el);
        });
        badge.appendChild(editBtn);
      }

      // ── 信息条挂在容器里，不挂在块内 ──
      //
      // 早先写成 `el.appendChild(badge)`，对 <p>、<h2> 没问题，
      // 但分割线渲染成 `<hr>`（自闭合元素），子节点会被浏览器直接丢弃 ——
      // 表现就是「分割线能选中，但没有信息条、没有 Edit 按钮」。
      //
      // 现在挂到容器上，用 fixed 定位贴在块上方。
      // 这样对任何元素都成立，包括 hr / img / 图表这类不能有子内容的块。
      placeBadge(el, badge);
    }

    /**
     * 给新解析出的节点分配「文档里没被占用」的 ID
     *
     * parseNodes 产出的节点自带 M1/M2… 这类编号，那是按「这一小段源码」
     * 从头数的，放进真实文档就会和现有块撞车 —— 两个 M2 意味着
     * 「按 ID 找节点」永远找错人（点分割线打开的是前面的段落）。
     *
     * 做法：
     *   · 首块沿用原来的 ID（用户点的那一块，身份不变）
     *   · 其余块取「当前文档最大 M 编号 + 递增」，保证唯一
     *   · 子节点（列表项、表格行等）跟着父块重新编号
     *
     * 已知取舍：这里只保证「不重复」，不保证「编号紧凑」。
     * 编号紧凑需要整篇重排，那会打乱其他块的 ID，代价更大。
     */
    function assignFreshIds(nodes, keepId) {
      // 收集文档里已被占用的顶层 M 编号
      var taken = {};
      var maxM = 0;
      var walk = function (node) {
        var n = node && node.id;
        if (n && n.charAt(0) === 'M') {
          taken[n] = 1;
          var num = parseInt(n.slice(1), 10);
          if (!isNaN(num) && num > maxM) maxM = num;
        }
        var lists = [node.children, node.rows, node.slides];
        if (node.columnBlocks) lists = lists.concat(node.columnBlocks);
        lists.forEach(function (list) {
          if (Array.isArray(list)) list.forEach(function (c) { if (c && c.type) walk(c); });
        });
      };
      if (renderer && renderer.getAst) walk(renderer.getAst());

      var next = maxM + 1;
      nodes.forEach(function (node, i) {
        if (i === 0 && keepId) {
          node.id = keepId;
        } else {
          while (taken['M' + next]) next++;
          node.id = 'M' + next;
          taken[node.id] = 1;
          next++;
        }
        // 子节点按父块重新编号（避免沿用 parseNodes 给的临时子 ID）
        renumberChildren(node);
      });
    }

    /** 按父 ID 给子节点重新编号：M5 → M5-M1 / M5-N1 …（只处理一层，够用即可） */
    function renumberChildren(node) {
      var seq = 0;
      var fix = function (parent, children) {
        if (!Array.isArray(children)) return;
        children.forEach(function (c) {
          if (!c || !c.type) return;
          seq++;
          c.id = parent.id + '-N' + seq;
          renumberChildren(c);
        });
      };
      fix(node, node.children);
      fix(node, node.rows);
      fix(node, node.slides);
    }

    // ---------- 能力 ----------

    /** 从事件目标找出该选中的块；返回 HTMLElement | null */
    function pick(target) {
      var hit = target && target.closest ? target.closest('[data-mdh-id]') : null;
      if (!hit || hit === container) return null;
      return pickEditable(hit, container);
    }

    /** 某块在顶层 children 里的下标；不在顶层返回 -1 */
    function indexOfTopLevel(id) {
      var kids = renderer.getAst().children || [];
      for (var i = 0; i < kids.length; i++) {
        if (kids[i].id === id) return i;
      }
      return -1;
    }

    /** 选中某个块：接受 HTMLElement 或 ID 字符串 */
    function select(target) {
      if (disposed) return null;
      var el = typeof target === 'string'
        ? container.querySelector('[data-mdh-id="' + target + '"]')
        : target;
      if (!el || el === container) { clear(); return null; }

      if (selected && selected !== el) selected.classList.remove('mdh-selected');
      selected = el;
      paintSelection(el);
      return el;
    }

    /** 清除选中 */
    function clear() {
      if (selected) selected.classList.remove('mdh-selected');
      clearBadge();
      selected = null;
    }

    /** 当前选中：{ el, id } | null */
    function current() {
      if (!selected) return null;
      return { el: selected, id: selected.getAttribute('data-mdh-id') };
    }

    /** 复制指定块的 ID（不传则复制当前选中） */
    function copyId(idOrNothing) {
      var id = idOrNothing;
      if (!id) {
        var cur = current();
        if (!cur) return false;
        id = cur.id;
      }
      copyText(id);
      return true;
    }

    /**
     * 复制「ID + 块文本」
     *
     * 格式：
     *   M2
     *   第一段正文。
     *
     * 为什么带文本：用户把这段粘给 AI 时，光给个 M2 是个坐标，
     * AI 还得回头翻源码才知道指的是哪一段。带上文字，它一眼就懂。
     *
     * ── 不做「部分复制」 ──
     * 曾经想过：如果用户拖选了块里的几个字，就只复制那几个字。
     * 结论是不做 —— 同一个块有两种复制结果，用户没法预期，
     * 而且 AI 拿到半句话也定位不准。要指认「这一块」，就给整块。
     */
    function copySelection(id, el) {
      return copyWholeBlock(id, el);
    }

    /** 复制「ID + 整块文本」，忽略任何文字选区 */
    function copyWholeBlock(id, el) {
      var text = '';
      if (el) {
        // 去掉信息条自己的文字，只留块本身的内容
        var clone = el.cloneNode(true);
        var badgeInClone = clone.querySelector('[data-mdh-badge]');
        if (badgeInClone && badgeInClone.parentNode) {
          badgeInClone.parentNode.removeChild(badgeInClone);
        }
        text = (clone.textContent || '').replace(/\s+/g, ' ').trim();
      }
      copyText(text ? id + '\n' + text : id);
      return true;
    }

    /**
     * 进入编辑
     *
     * 能力不完整时返回 false（不报错），使用方可以据此降级。
     */
    function edit(target) {
      if (disposed || !canEdit() || editor) return false;
      var el = typeof target === 'string'
        ? container.querySelector('[data-mdh-id="' + target + '"]')
        : target;
      if (!el || el === container) return false;

      var picked = pickEditable(el, container);
      if (!picked) return false;

      // 进入编辑前先清掉选中态：
      // 选中高亮 + 信息条会被编辑框盖住，留着会透出边缘、显得脏。
      clear();

      openEditor(picked);
      return true;
    }

    /** 是否正在编辑 */
    function isEditing() {
      return !!editor;
    }

    /**
     * 目录跳转（能力，不绑手势）
     *
     * 第三层决定「什么时候跳」——单击、键盘、自动预览都可以。
     * 这里只负责「跳到哪里、怎么跳」。
     *
     * 为什么按标题文字匹配而不是 ID：
     *   目录项的 href 是 #M12 这种块 ID，但第三方渲染库（KaTeX/Mermaid）
     *   可能重建 DOM 导致 ID 漂移；标题文字是稳定的。
     *   所以优先用 data-mdh-toc-text 按文字找，找不到再退回 ID。
     *
     * @param {HTMLElement|string} target 目录链接元素，或其 data-mdh-toc-text 值
     * @param {{ behavior?: ScrollBehavior, offset?: number }} [opts]
     * @returns {HTMLElement|null} 滚动到的标题元素，找不到返回 null
     */
    function scrollToToc(target, opts) {
      opts = opts || {};
      var behavior = opts.behavior || 'smooth';
      // 留出一点顶部空间，避免标题贴着容器边缘
      var offset = opts.offset == null ? 16 : opts.offset;

      var text = null;
      var id = null;

      if (target && typeof target === 'object') {
        text = target.getAttribute('data-mdh-toc-text');
        var href = target.getAttribute('href') || '';
        if (href.charAt(0) === '#') id = decodeURIComponent(href.slice(1));
      } else if (typeof target === 'string') {
        text = target;
      }
      if (!text && !id) return null;

      // 优先按标题文字找；标题文字相同时取第一个未跳过的
      var heading = null;
      if (text) {
        var hs = container.querySelectorAll('h1, h2, h3, h4, h5, h6');
        for (var i = 0; i < hs.length; i++) {
          if (hs[i].textContent.trim() === text) { heading = hs[i]; break; }
        }
      }
      // 退回按 ID 找
      if (!heading && id) {
        heading = container.querySelector('[data-mdh-id="' + CSS.escape(id) + '"]');
      }
      if (!heading) return null;

      // 容器内部滚动：算相对容器的位置，而不是 window
      // （桌面端预览区是独立滚动容器，用 scrollIntoView 会滚错层）
      var cRect = container.getBoundingClientRect();
      var hRect = heading.getBoundingClientRect();
      var cStyle = window.getComputedStyle(container);
      var scrollable = container.scrollHeight > container.clientHeight + 1
        && /(auto|scroll)/.test(cStyle.overflowY);

      if (scrollable) {
        var top = container.scrollTop + (hRect.top - cRect.top) - offset;
        container.scrollTo({ top: Math.max(0, top), behavior: behavior });
      } else {
        heading.scrollIntoView({ behavior: behavior, block: 'start' });
      }

      return heading;
    }

    /** 重渲染后重新装饰（代码块复制按钮等） */
    function decorateCodeBlocks() {
      var pres = container.querySelectorAll('pre.mdh-code:not([data-mdh-decorated])');
      for (var i = 0; i < pres.length; i++) {
        var pre = pres[i];
        var head = pre.querySelector('.mdh-code-head');
        if (!head) continue;
        var btn = document.createElement('button');
        btn.className = 'mdh-code-copy';
        btn.type = 'button';
        btn.textContent = T.copy;
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var self = e.currentTarget;
          var p = self.closest('pre.mdh-code');
          var code = p && p.querySelector('code');
          if (!code) return;
          copyText(code.textContent || '');
          self.textContent = copyLabel;
          setTimeout(function () { self.textContent = T.copy; }, 1400);
        });
        head.appendChild(btn);
        pre.setAttribute('data-mdh-decorated', '1');
      }
    }

    /**
     * 内容被替换后调用
     *
     * @param {string|null} [keepId] 重渲染前选中的块 ID；传入则在新 DOM 里恢复选中
     *
     * 为什么需要这个参数：整篇重渲染（innerHTML 替换）会销毁所有元素，
     * 原来的 selected 指向死节点。但块的 ID 是稳定的，
     * 所以可以用 ID 在渲染后的 DOM 里重新找到它。
     */
    function refresh(keepId) {
      clear();
      decorateCodeBlocks();
      if (keepId) select(keepId);
    }

    function destroy() {
      disposed = true;
      if (editor) { editor.destroy(); editor = null; }
      clear();
      selected = null;
    }

    // ---------- 编辑（内部实现）----------

    function openEditor(el) {
      var id = el.getAttribute('data-mdh-id');
      var type = el.getAttribute('data-mdh-type');

      var node = findNode(renderer.getAst(), id);
      if (!node) return;

      var source = serializeNode(node);
      el.classList.add('mdh-editing');

      var box = document.createElement('div');
      box.className = 'mdh-editor';
      box.innerHTML =
        '<div class="mdh-editor-bar">' +
        '<span class="mdh-editor-id">' + id + '</span>' +
        '<button data-act="save">' + T.save + '</button>' +
        '<button data-act="cancel">' + T.cancel + '</button>' +
        '</div>';

      var ta = document.createElement('textarea');
      ta.className = 'mdh-editor-input';
      ta.value = source;
      ta.spellcheck = false;
      box.appendChild(ta);

      document.body.appendChild(box);
      ta.focus();
      ta.setSelectionRange(0, 0);

      /*
       * 跟随内容增高（2026-11-25 改）
       *
       * 原来把它硬顶在 `window.innerHeight * 0.6`：
       * 内容再多也不再长，于是编辑一大块时下面的源码既看不见也滚不到。
       *
       * 现在只按内容撑开，**上限交给父层 .mdh-editor 的 max-height: 80vh**，
       * 超出部分由 textarea 自己 overflow-y: auto 滚动。
       * 这样「短内容自适应、长内容可滚」两件事各归各管。
       */
      var autoGrow = function () {
        ta.style.height = 'auto';
        ta.style.height = ta.scrollHeight + 4 + 'px';
      };
      ta.addEventListener('input', autoGrow);

      var place = function () {
        autoGrow();
        var r = el.getBoundingClientRect();
        var vw = window.innerWidth;
        var vh = window.innerHeight;
        var gap = 8;

        // 块不在视口里 → 先滚进来再量
        if (r.bottom < 0 || r.top > vh) {
          el.scrollIntoView({ block: 'center', behavior: 'instant' });
          r = el.getBoundingClientRect();
        }

        // ── 宽度取容器的，不取块的 ──
        //
        // 块可能是分栏里的半栏、表格里的一格，宽度只有几百甚至几十像素。
        // 编辑框跟它等宽的话，textarea 窄到没法写字。
        // 任何时候只可能有一个编辑框，所以统一用「整篇内容」的宽度就对。
        var containerRect = container.getBoundingClientRect();
        var usableW = Math.min(
          containerRect.width > 0 ? containerRect.width : r.width,
          vw - gap * 2,
        );
        var boxH = box.offsetHeight;

        // 左边界对齐容器（不是块）—— 否则分栏里的块会把编辑框挤偏
        var left = containerRect.width > 0 ? containerRect.left : r.left;
        if (left + usableW > vw - gap) left = vw - gap - usableW;
        if (left < gap) left = gap;

        // 纵向仍然贴着块：用户点的就是那儿，编辑框出现在原地最自然
        var top = r.top;
        if (top + boxH > vh - gap) top = Math.max(gap, vh - gap - boxH);
        if (top < gap) top = gap;

        box.style.position = 'fixed';
        box.style.top = top + 'px';
        box.style.left = left + 'px';
        box.style.right = 'auto';
        box.style.width = usableW + 'px';
        box.style.minHeight = Math.min(r.height, 200) + 'px';
      };

      requestAnimationFrame(place);
      window.addEventListener('resize', place);
      window.addEventListener('scroll', place, true);

      var bar = box.querySelector('.mdh-editor-bar');

      var destroyEditor = function () {
        window.removeEventListener('resize', place);
        window.removeEventListener('scroll', place, true);
        if (box.parentNode) box.parentNode.removeChild(box);
        el.classList.remove('mdh-editing');
        editor = null;
      };

      /**
       * 重渲染整篇
       *
       * 分两步：
       *   ① 同步：先把第二层的 HTML 上屏 —— 文字、表格、列表立刻可见，
       *      用户不会觉得「点了保存没反应」。
       *   ② 异步：如果宿主给了 compileHtml，再跑一遍插件，
       *      把公式 / 图表 / Mermaid 补回来，然后替换。
       *
       * ── 为什么要异步而不是直接 await ──
       * 插件里 mermaid.render 是真正的异步（要布局测量），
       * 一个文档里几张图就要几百毫秒。同步等它会让编辑框关得很慢。
       *
       * ── 竞态 ──
       * 连着存两次时，先发的那次可能后回来，把新的覆盖成旧的。
       * 用一个自增 token 判断「回来时我还算不算最新」。
       */
      var repaintToken = 0;

      /*
       * 把整篇 HTML 写回容器。
       *
       * ⚠️ `renderer.toHtml()` 输出的是**完整的** `<div class="mdh-document">…</div>`，
       *    而 container 本身就是那个 `.mdh-document`。直接 `container.innerHTML = html`
       *    会套娃成 document > document，DOM 里出现两个 `data-mdh-id="R"` ——
       *    每存一次多一层，ID 重复、样式也被叠了一层（2026-11-25 修复）。
       *
       * 所以：如果容器自己就是 mdh-document，只写它的内层内容。
       */
      function writeInto(html) {
        var isDocRoot = container.getAttribute && container.getAttribute('data-mdh-id') === 'R';
        if (!isDocRoot) {
          container.innerHTML = html;
          return;
        }
        // 剥掉最外层的 <div …> 和 </div>
        var tmp = document.createElement('div');
        tmp.innerHTML = html;
        var inner = tmp.firstElementChild;
        container.innerHTML = inner ? inner.innerHTML : html;
      }

      function repaint() {
        var html = renderer.toHtml();
        writeInto(html);
        clear();
        decorateCodeBlocks();
        onChange(renderer.getAst());

        if (!compileHtml) return;

        var token = ++repaintToken;
        Promise.resolve()
          .then(function () { return compileHtml(html, renderer.getAst()); })
          .then(function (filled) {
            // 已经有一次更新的重绘发出去了 → 这次结果作废
            if (token !== repaintToken) return;
            if (typeof filled !== 'string' || !filled) return;
            writeInto(filled);
            clear();
            decorateCodeBlocks();
          })
          .catch(function (e) {
            // 补渲染失败不该把编辑结果弄丢 —— 文字已经上屏了，
            // 失败的只是公式/图，按缺依赖的提示处理即可。
            if (typeof console !== 'undefined') {
              console.warn('[mdh] 重渲染后补渲染失败（公式 / 图表 / Mermaid 可能缺失）：', e && e.message ? e.message : e);
            }
          });
      }

      function save() {
        var as = type === 'listItem' ? 'listItem' : type === 'tableRow' ? 'tableRow' : undefined;
        var text = ta.value;

        /*
         * @title 的保存路径（2026-11-25）
         *
         * 它不是块，不能走 parseNodes + replaceWithMany。
         * 编辑框里写的是 `@title(文档名)`：
         *   · 写成 @title(xxx)  → 更新 root.docTitle
         *   · 写成空 / 别的     → 从这个 AST 里拿不到标题，按「清空」处理
         * 然后整篇重绘，标题才会出现在或消失于页面顶部。
         */
        if (type === 'docTitle') {
          var m = /^\s*@title\s*\(([\s\S]*)\)\s*$/.exec(text);
          if (!m && text.trim() !== '') {
            bar.querySelector('.mdh-editor-id').textContent = T.parseError;
            return;
          }
          var nextTitle = m ? m[1].trim() : '';
          var curAst = renderer.getAst();
          if (nextTitle) curAst.docTitle = nextTitle;
          else delete curAst.docTitle;

          destroyEditor();
          repaint();
          return;
        }

        if (!as) {
          // ── 自由编辑：整段按 mdh 语法重新解析 ──
          //
          // 编辑框不是「块内容编辑器」，它就是一小片 mdh 源码。
          // 用户写什么就该得什么：
          //   `---`              → 一个分割线
          //   `原文 + 空行 + ---` → 段落 + 分割线（两块）
          //   `## 标题`          → 一个二级标题
          //
          // ⚠️ parseNodes 给的 ID 是从 M1 起算的临时编号，直接塞进文档会
          //    和已存在的块撞车（两个 M2），后续按 ID 找节点就会找错人。
          //    所以先把它们整体改成「文档里没被占用的 ID」。
          var nodes = parseNodes ? parseNodes(text) : [];
          /*
           * ⚠️ 空数组不一定是解析失败（2026-11-25 修）
           *
           * `@toc`、`@page(slides)` 这类**文档级指令**不产出块节点。
           * 早先这里见到空数组就报「解析失败」，用户没法在编辑器里写这类指令。
           *
           * 判据改成：内容非空、却解析不出任何节点 → 才算解析失败。
           */
          var looksEmpty = text.trim() === '';
          if (nodes.length === 0 && !looksEmpty) {
            // 可能整段都是文档级指令：用整篇源码试一次，能解析就放行
            var probe = parseSource ? parseSource(text) : null;
            var isDirectiveOnly =
              !!probe && Array.isArray(probe.ast?.children) && probe.ast.children.length === 0;
            if (!isDirectiveOnly) {
              bar.querySelector('.mdh-editor-id').textContent = T.parseError;
              return;
            }
            /*
             * 原块按「被指令替代」处理：删掉它，让整篇重绘体现出指令效果。
             * （指令不产出节点，replaceWithMany 收空数组会直接返回 false，
             *   所以这里必须显式 remove。）
             */
            var topIdx = indexOfTopLevel(id);
            if (topIdx >= 0) {
              renderer.remove(id);
            }
            destroyEditor();
            repaint();
            return;
          }
          // 记住这一块在顶层的位置 —— 重排 ID 后靠它找回新 ID
          var anchorIndex = indexOfTopLevel(id);

          // ── 继承原来那块的「前面空几行」 ──
          //
          // parseNodes 只看这一小段源码，不知道它在整篇文档里的位置，
          // 所以产出的节点 blankBefore 一律是 0。
          // 如果在第 2 段的位置插入内容，新块的空行信息就丢了 ——
          // 序列化时「第一段」和「新第二段」粘在一起，两段合并成一段。
          //
          // 这里把原块的 blankBefore 转给第一个新块，后面的块照它自己
          // 解析出来的值（块内部空行 parseNodes 是知道的）。
          var oldNodes = renderer.getAst().children || [];
          var oldNode = null;
          for (var oi = 0; oi < oldNodes.length; oi++) {
            if (oldNodes[oi].id === id) { oldNode = oldNodes[oi]; break; }
          }
          var oldBlank = (oldNode && oldNode.blankBefore) || 0;
          if (nodes[0] && oldBlank > 0) nodes[0].blankBefore = oldBlank;

          assignFreshIds(nodes, id);
          renderer.replaceWithMany(id, nodes);
          // ⚠️ 这里**不做**整篇重排。
          //
          // ID 只在「打开文档」时由解析器一次性排好（M1/M2/M3…连续）。
          // 编辑期间必须保持稳定 —— 一旦重排，AI 刚才说的「改 M4」就失效了，
          // 因为它可能已经变成别的块。
          //
          // 代价是插入新块后编号会跳（M5 后面接 M8）。这是有意接受的取舍：
          // 编号难看 << 坐标漂移。
          destroyEditor();
          repaint();
          // 按原 ID 选回去；重排取消后 ID 没变，直接可用
          select(id);
          return;
        }

        // 列表项 / 表格行：本身不是一个独立块，只能一对一替换
        var newNode = parseNode(text, { as: as });
        if (!newNode) {
          bar.querySelector('.mdh-editor-id').textContent = T.parseError;
          return;
        }
        newNode.id = id;

        if (as === 'listItem') {
          var parent = findParent(renderer.getAst(), id);
          if (parent && parent.children) {
            var i = parent.children.findIndex(function (c) { return c.id === id; });
            if (i >= 0) parent.children[i] = newNode;
          }
        } else {
          var t = findParent(renderer.getAst(), id);
          if (t && t.rows) {
            var j = t.rows.findIndex(function (c) { return c.id === id; });
            if (j >= 0) t.rows[j] = newNode;
          }
        }
        destroyEditor();
        repaint();
      }

      box.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-act]');
        if (!btn) return;
        e.stopPropagation();
        if (btn.getAttribute('data-act') === 'save') save();
        else {
          destroyEditor();
          clear();
        }
      });

      ta.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.stopPropagation(); destroyEditor(); clear(); }
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
      });

      editor = { box: box, destroy: destroyEditor };
    }

    decorateCodeBlocks();

    return {
      // 能力
      select: select,
      clear: clear,
      current: current,
      copyId: copyId,
      /**
       * 复制当前选中的块（ID + 整块文本）
       *
       * @returns {boolean} 没选中任何块时返回 false
       */
      copyCurrent: function () {
        var cur = current();
        if (!cur) return false;
        copyWholeBlock(cur.id, cur.el);
        // 双击复制也要有反馈 —— 信息条刚生成，用户得看到「已复制」
        flashCopied();
        return true;
      },
      edit: edit,
      isEditing: isEditing,
      canEdit: canEdit,
      pick: pick,
      refresh: refresh,
      scrollToToc: scrollToToc,
      // 锁（发布器产出的只读文档）
      isLocked: function () { return locked; },
      setLocked: setLocked,
      // 生命周期
      destroy: destroy,
      // 元素
      container: container,
    };
  }

  global.MDHInteractCore = { create: create };
})(typeof window !== 'undefined' ? window : this);
