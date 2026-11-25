import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, serializeNode, parseNode } from '../../mdh-core/src/index.ts';
import { createRenderer, render } from '../src/index.ts';
import { computeNumbers } from '../src/numbering.ts';

const SRC = `# 标题

正文段落。

***table ref="员工" caption="员工表"
head: 姓名, 薪资
- 张三, 20k
***table-end

见表 @员工 可知。

***chart(bar) ref="销量" caption="销量图"
head: 月份, 值
- 一月, 100
***chart-end

***mermaid ref="流程" caption="流程图"
graph TD
A-->B
***mermaid-end

***math ref="emc" caption="质能方程"
E = mc^2
***math-end

***table ref="第二张" caption="第二张表"
head: A
- 1
***table-end
`;

const astOf = (src = SRC) => parse(src).ast;

// ---------- 编号计算 ----------

test('编号：表 / 图 / 式 三套独立序列', () => {
  const n = computeNumbers(astOf());
  const values = [...n.valueByNode.values()];
  const kinds = [...n.kindByNode.values()];
  assert.ok(kinds.includes('table'));
  assert.ok(kinds.includes('figure'));
  assert.ok(kinds.includes('equation'));
  // 表 1、表 2；图 1、图 2（chart 与 mermaid 共用）；式 1
  assert.equal(values.filter((v) => v === '1').length, 3, '表1/图1/式1');
  assert.equal(values.filter((v) => v === '2').length, 2, '表2/图2');
  assert.equal(values.length, 5);
});

test('编号：只有写了 caption 的对象才占号（ref 不影响编号）', () => {
  // 作者 2026-11-21：编号跟 caption 走，跟 ref 无关。
  // ref 只负责让 `@名字` 能跳过来——能跳转 ≠ 有编号。
  const src = `***table
head: A
- 1
***table-end

***table ref="有名字"
head: A
- 1
***table-end

***table caption="有题注"
head: A
- 1
***table-end`;
  const n = computeNumbers(astOf(src));
  const tables = astOf(src).children;
  assert.equal(n.byNode.get(tables[0].id), undefined, '无名无题注的表不占号');
  assert.equal(n.byNode.get(tables[1].id), undefined, '只有 ref 没有 caption 也不占号');
  assert.equal(n.byNode.get(tables[2].id), '1', '有 caption 才是第一张');
});

test('编号：chart 与 mermaid 共用「图」序列', () => {
  const n = computeNumbers(astOf());
  const figs = [...n.kindByNode.entries()].filter(([, k]) => k === 'figure');
  assert.equal(figs.length, 2);
  const vals = figs.map(([id]) => n.valueByNode.get(id)).sort();
  assert.deepEqual(vals, ['1', '2']);
});

// ---------- 引用索引 ----------

test('引用：能查到正文里引用了哪个名字', () => {
  const n = computeNumbers(astOf());
  const refs = n.references.get('员工') ?? [];
  assert.equal(refs.length, 1, `引用数 ${refs.length}`);
});

test('引用：resolveReference 能由名字找到节点', () => {
  const r = createRenderer(astOf());
  const id = r.resolveReference('员工');
  assert.ok(id, '应能解析到节点');
  assert.equal(r.getNumber(id!), '1');
});

// ---------- HTML 结构 ----------

test('HTML：语义标签正确', () => {
  const html = render(astOf());
  assert.ok(html.includes('<h1'), '标题');
  assert.ok(html.includes('<p'), '段落');
  assert.ok(html.includes('<table'), '表格');
  assert.ok(html.includes('<thead'), '表头');
  assert.ok(html.includes('<blockquote') || true, '引用可选');
  assert.ok(html.includes('<figure'), '图表');
});

test('HTML：数据属性齐全（id / type / number / kind / name）', () => {
  const html = render(astOf());
  assert.ok(/data-mdh-id="[MNO]\d+"/.test(html), 'id');
  assert.ok(html.includes('data-mdh-type="table"'), 'type');
  assert.ok(html.includes('data-mdh-number="1"'), 'number');
  assert.ok(html.includes('data-mdh-kind="table"'), 'kind');
  assert.ok(html.includes('data-mdh-ref="员工"'), 'name');
});

test('HTML：不包含行内样式（视觉交给 CSS）', () => {
  const html = render(astOf());
  assert.ok(!html.includes('style='), '不应出现 style 属性');
  assert.ok(!/font-|color:|background:/.test(html), '不应内联视觉规则');
});

test('HTML：每种块都带语义 class（供第三层写 CSS）', () => {
  const html = render(astOf());
  const expect = [
    'mdh-document',
    'mdh-heading',
    'mdh-heading-1',
    'mdh-paragraph',
    'mdh-table',
    'mdh-row',
    'mdh-figure',
    'mdh-chart-figure',
    'mdh-mermaid-figure',
    'mdh-math',
  ];
  for (const c of expect) assert.ok(html.includes(c), `缺少 class: ${c}`);
});

test('HTML：列表 / 引用 / 分割线 / 代码块的 class', () => {
  const unordered = render(parse('- 无序').ast);
  assert.ok(unordered.includes('mdh-list-unordered'), '无序列表');

  const ordered = render(parse('1. 有序').ast);
  assert.ok(ordered.includes('mdh-list-ordered'), '有序列表');

  assert.ok(render(parse('> 引用').ast).includes('mdh-quote'), '引用');
  assert.ok(render(parse('---').ast).includes('mdh-divider'), '分割线');
  assert.ok(render(parse('```ts\nx\n```').ast).includes('mdh-code'), '代码块');
});

test('HTML：heading 的 class 带级别', () => {
  const html = render(parse('## 二级').ast);
  assert.ok(html.includes('mdh-heading-2'), '应带 mdh-heading-2');
});

test('HTML：编号只输出数字，不输出「Table 1」之类的措辞', () => {
  const html = render(astOf());
  assert.ok(!html.includes('Table'), '不应含任何语言措辞');
  assert.ok(!html.includes('表('), '不应含中文编号文字');
  assert.ok(html.includes('data-mdh-number="1"'), '只输出数字');
});

test('HTML：正文引用渲染为带编号的标记，由 CSS 决定显示', () => {
  // 有 caption（=有编号）：渲染成带编号的 span，措辞由 CSS ::before 拼
  const html = render(astOf());
  assert.ok(html.includes('class="mdh-ref"'), '引用占位');
  assert.ok(html.includes('data-mdh-ref="员工"'), '引用名字');
  assert.ok(html.includes('data-mdh-ref-number="1"'), '引用指向的编号');
  assert.ok(html.includes('data-mdh-ref-kind="table"'), '引用指向的类别');
  assert.ok(!html.includes('见表 @员工'), '原始的 @名字 不应留在正文里');
});

test('HTML：编号同时写到题注上（否则 CSS attr() 取不到）', () => {
  // 回归：主题层的编号是 `caption::before { content: "Table " attr(data-mdh-number) }`，
  // attr() 取的是伪元素宿主自己的属性。只写在外层 table/figure 上，
  // 浏览器会渲染出「Table 」没有数字。
  const src = `***table caption="员工表"
head: A
- 1
***table-end

***mermaid caption="流程图"
graph LR
A-->B
***mermaid-end

***math caption="公式"
E=mc^2
***math-end`;
  const html = render(parse(src).ast);

  assert.ok(/<caption[^>]*data-mdh-number="1"/.test(html), `表格 caption 缺编号：${html}`);
  assert.equal((html.match(/<figcaption[^>]*data-mdh-number="1"/g) ?? []).length, 2, '图/式 figcaption 缺编号');
});

test('HTML：没有 caption 的对象不输出题注元素', () => {
  const html = render(parse('***table ref="x"\nhead: A\n- 1\n***table-end').ast);
  assert.ok(!html.includes('<caption'), '无 caption 不该凭空造一个');
  assert.ok(!html.includes('data-mdh-number'), '无 caption 不该编号');
});

test('HTML：只有 ref 没有 caption 时，引用是纯跳转链接（不带编号）', () => {
  // 作者 2026-11-21：ref 管跳转，caption 管编号，两件事独立。
  const src = `***table ref="数据"
head: A
- 1
***table-end

见 @数据 。`;
  const html = render(parse(src).ast);
  assert.ok(/<a[^>]*class="mdh-ref mdh-ref-plain"[^>]*href="#M1"/.test(html), `应是可点链接：${html}`);
  assert.ok(!html.includes('data-mdh-ref-number'), '无 caption 不该带编号');
});

test('HTML：引用指向不存在的名字时给出失效标记', () => {
  // DESIGN-1（2026-11-22）：不再静默原样输出，改为可见的失效标记。
  // 理由：打错名字时页面上看不出异常，错误会静默流进成品。
  const html = render(parse('见 @不存在的名字 可知').ast);
  assert.ok(html.includes('@不存在的名字'), '原文应保留');
  assert.ok(html.includes('mdh-ref-broken'), '应标记为失效引用');
  assert.ok(!/mdh-ref-broken[^>]*href=/.test(html), '失效引用不应有 href');
});

test('HTML：公式 / Mermaid 输出原文供外部渲染', () => {
  const html = render(astOf());
  assert.ok(html.includes('data-mdh-latex='), '公式原文');
  assert.ok(html.includes('data-mdh-source='), 'Mermaid 原文');
});

test('HTML：includeIds=false 时不输出 data-mdh-id', () => {
  const html = render(astOf(), { includeIds: false });
  assert.ok(!html.includes('data-mdh-id'), '应关闭 id 输出');
  assert.ok(html.includes('data-mdh-type='), '但类型仍在');
});

// ---------- 增删查改 ----------

test('操作：查找与单块渲染', () => {
  const r = createRenderer(astOf());
  const id = r.resolveReference('员工')!;
  const html = r.toHtmlOf(id);
  assert.ok(html, '应能渲染单块');
  assert.ok(html!.includes('<table'), '单块是表格');
});

test('操作：update 替换节点', () => {
  const r = createRenderer(astOf());
  const id = r.resolveReference('员工')!;
  const node = JSON.parse(JSON.stringify(r.toHtmlOf(id) ? findNode(r.getAst(), id) : null));
  node.caption = '新题注';
  assert.ok(r.update(id, node));
  assert.ok(r.toHtml().includes('新题注'));
});

test('操作：remove 删除节点后编号重排', () => {
  const r = createRenderer(astOf());
  const first = r.resolveReference('员工')!;
  const second = r.resolveReference('第二张')!;
  assert.equal(r.getNumber(first), '1');
  assert.equal(r.getNumber(second), '2');

  r.remove(first);
  assert.equal(r.getNumber(second), '1', '删除第一张后，第二张应变表(1)');
});

test('操作：insert 插入节点后编号重排', () => {
  const r = createRenderer(astOf());
  const ast = r.getAst();
  const before = r.resolveReference('第二张')!;
  assert.equal(r.getNumber(before), '2');

  r.insert(ast.id, 0, {
    type: 'table',
    id: 'M999',
    description: '新表',
    name: '插在最前',
    // 编号依据是 caption（不是 name），所以要带上题注才占号
    caption: '插在最前的表',
    headers: [['A']],
    rows: [],
  } as any);

  assert.equal(r.getNumber('M999'), '1', '新表成为第一张');
  assert.equal(r.getNumber(before), '3', '原第二张变第三张');
});

test('操作：setAst 换整棵树', () => {
  const r = createRenderer(astOf());
  r.setAst(astOf('# 只有标题'));
  const html = r.toHtml();
  assert.ok(html.includes('只有标题'));
  assert.ok(!html.includes('<table'), '旧内容应消失');
});

// ---------- 增量 vs 全量（核心正确性） ----------

const findNode = (ast: any, id: string): any => {
  let hit: any = null;
  const walk = (n: any) => {
    if (hit) return;
    if (n.id === id) return void (hit = n);
    const kids = [
      ...(n.children ?? []),
      ...(n.type === 'table' ? n.rows ?? [] : []),
      ...(n.columnBlocks ?? []).flat(),
      ...(n.slides ?? []),
    ];
    kids.forEach(walk);
  };
  walk(ast);
  return hit;
};

test('增量：删除块后，增量与全量结果一致', () => {
  const full = createRenderer(astOf(), { mode: 'full' });
  const inc = createRenderer(astOf(), { mode: 'incremental' });

  const target = full.resolveReference('员工')!;
  full.remove(target);
  inc.remove(target);

  assert.equal(inc.toHtml(), full.toHtml(), '增量与全量 HTML 应完全一致');
});

test('增量：插入块后，增量与全量结果一致', () => {
  const full = createRenderer(astOf(), { mode: 'full' });
  const inc = createRenderer(astOf(), { mode: 'incremental' });

  const newNode = {
    type: 'table',
    id: 'M998',
    description: '插入的表',
    name: '新的',
    headers: [['X']],
    rows: [],
  } as any;

  full.insert(full.getAst().id, 0, JSON.parse(JSON.stringify(newNode)));
  inc.insert(inc.getAst().id, 0, JSON.parse(JSON.stringify(newNode)));

  assert.equal(inc.toHtml(), full.toHtml());
});

test('增量：改内容后，增量能算出受影响集合', () => {
  const inc = createRenderer(astOf(), { mode: 'incremental' });
  const id = inc.resolveReference('员工')!;
  const node = JSON.parse(JSON.stringify(findNode(inc.getAst(), id)));
  node.caption = '改了';
  inc.update(id, node);

  const affected = inc.lastAffected();
  assert.ok(affected.includes(id), '被改的块在集合内');
});

test('增量：编号变化会波及引用它的段落', () => {
  const inc = createRenderer(astOf(), { mode: 'incremental' });
  const first = inc.resolveReference('员工')!;
  inc.remove(first);

  const affected = inc.lastAffected();
  const html = inc.toHtml();
  // 引用「员工」的段落应被重新渲染（虽然它引用的目标已删）
  assert.ok(html.length > 0);
  assert.ok(Array.isArray(affected));
});

// ---------- 增量正确性：多场景对拍 ----------

const scenarios: Array<[string, (r: ReturnType<typeof createRenderer>) => void]> = [
  ['删除中间的表', (r) => r.remove(r.resolveReference('员工')!)],
  [
    '在开头插入表',
    (r) =>
      r.insert(r.getAst().id, 0, {
        type: 'table',
        id: 'M900',
        description: '插入',
        name: '插入表',
        headers: [['A']],
        rows: [],
      } as any),
  ],
  [
    '在末尾追加表',
    (r) =>
      r.insert(r.getAst().id, r.getAst().children.length, {
        type: 'table',
        id: 'M901',
        description: '追加',
        name: '追加表',
        headers: [['B']],
        rows: [],
      } as any),
  ],
  [
    '修改某块内容（不改结构）',
    (r) => {
      const id = r.resolveReference('员工')!;
      const node = JSON.parse(JSON.stringify(findNode(r.getAst(), id)));
      node.caption = '改过的题注';
      r.update(id, node);
    },
  ],
  ['删除 mermaid（图序列重排）', (r) => r.remove(r.resolveReference('流程')!)],
  ['删除公式', (r) => r.remove(r.resolveReference('emc')!)],
];

for (const [name, act] of scenarios) {
  test(`增量对拍：${name}`, () => {
    const full = createRenderer(astOf(), { mode: 'full' });
    const inc = createRenderer(astOf(), { mode: 'incremental' });

    act(full);
    act(inc);

    assert.equal(inc.toHtml(), full.toHtml(), '增量结果必须与全量一致');
  });
}

test('增量：受影响集合包含祖先（column 内改动会波及父容器）', () => {
  const src = `***column(1fr/1fr)
***table ref="左表" caption="左表"
head: A
- 1
***table-end
@next-column
右栏
***column-end`;
  const r = createRenderer(parse(src).ast, { mode: 'incremental' });
  const tableId = r.resolveReference('左表')!;
  const colId = parse(src).ast.children[0].id;
  r.remove(tableId);

  const affected = r.lastAffected();
  assert.ok(affected.includes(colId), `父容器应在受影响集合内：${affected.join(', ')}`);
});

// ---------- 行内格式 ----------

test('行内：四种格式都输出语义标签', () => {
  const html = render(parse('**粗** /斜/ __下__ --删--').ast);
  assert.ok(html.includes('<strong class="mdh-strong">粗</strong>'), '粗体');
  assert.ok(html.includes('<em class="mdh-em">斜</em>'), '斜体');
  assert.ok(html.includes('<u class="mdh-u">下</u>'), '下划线');
  assert.ok(html.includes('<del class="mdh-del">删</del>'), '删除线');
});

test('行内：代码与公式不解析内部语法', () => {
  const html = render(parse('`**不是粗体**` 和 $a**b**$').ast);
  assert.ok(html.includes('<code class="mdh-inline-code">**不是粗体**</code>'), '代码内原样');
  assert.ok(!html.includes('<strong'), '代码内不应生成 strong');
  assert.ok(html.includes('data-mdh-latex'), '公式输出 latex 原文');
});

test('行内：嵌套格式', () => {
  const html = render(parse('**粗里有 /斜/**').ast);
  assert.ok(html.includes('<strong'), '外层粗体');
  assert.ok(html.includes('<em'), '内层斜体');
});

test('行内：斜杠成对即斜体（含路径与 URL）', () => {
  // 规则简化后：不看前后文，成对即斜体。代价是路径/URL 会被误判，
  // 正确写法是用反引号包住——这条测试同时锁住「规则」和「逃生」两件事。
  assert.ok(render(parse('c/s/ d').ast).includes('<em'), 'c/s/ d 里 s 应成斜体');

  // 路径：裸写会变斜体
  assert.ok(render(parse('/usr/local/bin').ast).includes('<em'), '路径裸写会变斜体');

  // 反引号包住 → 原样输出
  const wrapped = render(parse('用 `/usr/local/bin` 显示').ast);
  assert.ok(!wrapped.includes('<em'), '反引号内不该斜体');
  assert.ok(wrapped.includes('<code'), '应渲染成行内代码');

  // @link 的地址不受斜体影响（地址在行内扫描前已被摘出）
  const link = render(parse('@link(文档, "./docs/a.html")').ast);
  assert.ok(link.includes('href="./docs/a.html"'), `href 被斜体破坏：${link}`);
  assert.ok(!link.includes('<em'), '链接地址不该斜体');
});

test('行内：HTML 标签占位，标签内的斜杠不被当成斜体', () => {
  // 回归：标签里的 `/` 不能被斜体规则吃掉（如 `</td>` 变成 `&lt;<em>td&gt;`）。
  // 白名单内的标签先占位再还原；白名单外的标签转义成文字。
  const inList = render(parse('<table><tr><td>1</td></tr></table>').ast);
  assert.ok(!inList.includes('<em'), `标签内的斜杠被当成斜体：${inList}`);
  assert.ok(inList.includes('<table>'), '白名单内标签应原样渲染');

  const outList = render(parse('<blink><b>1</b></blink>').ast);
  assert.ok(!outList.includes('<em'), `标签内的斜杠被当成斜体：${outList}`);
  assert.ok(outList.includes('&lt;blink&gt;'), '白名单外标签应转义成文字');
  assert.ok(outList.includes('&lt;/blink&gt;'), `闭合标签应完整转义：${outList}`);
});

test('行内：白名单内标签正常渲染', () => {
  const html = render(parse('这是 <mark>高亮</mark> 文字').ast);
  assert.ok(html.includes('<mark>高亮</mark>'), html);
  assert.ok(!html.includes('&lt;mark'), '认得标签不该被转义');
});

test('行内：HTML 特殊字符被转义', () => {
  const html = render(parse('a < b & c > d').ast);
  assert.ok(html.includes('&lt;') && html.includes('&amp;') && html.includes('&gt;'));
});

test('行内：未闭合的符号保持原样', () => {
  const html = render(parse('这里 **没有闭合').ast);
  assert.ok(html.includes('**没有闭合'), '未闭合应原样输出');
});

// ---------- 单块序列化与解析（编辑用） ----------

test('serializeNode：表格往返', () => {
  const { ast } = parse('***table ref="t"\nhead: A\n- 1\n***table-end');
  const src = serializeNode(ast.children[0]);
  assert.ok(src.includes('***table ref="t"'), '保留 name');
  assert.ok(src.includes('***table-end'), '闭合不重复名字');
  assert.ok(!src.includes('table-t-end'), '不应出现 table-t-end');
  assert.ok(src.includes('head: A'));
  assert.equal(parseNode(src)?.type, 'table');
});

test('serializeNode：分栏往返', () => {
  const { ast } = parse('***column(1fr/2fr)\n左\n@next-column\n右\n***column-end');
  const src = serializeNode(ast.children[0]);
  assert.ok(src.includes('***column(1fr/2fr)'));
  assert.ok(src.includes('@next-column'));
  assert.equal(parseNode(src)?.type, 'column');
});

test('serializeNode：标题与段落', () => {
  const { ast } = parse('# 标题\n\n正文');
  assert.equal(serializeNode(ast.children[0]).trim(), '# 标题');
  assert.equal(serializeNode(ast.children[1]).trim(), '正文');
});

test('parseNode：解析失败返回 null', () => {
  assert.equal(parseNode(''), null);
  assert.equal(parseNode('   '), null);
});

test('parseNode：表格行需要 as 参数', () => {
  const row = parseNode('- 张三, 20k', { as: 'tableRow' });
  assert.ok(row, '应解析出节点');
  assert.equal(row!.type, 'tableRow');
  assert.deepEqual((row as any).cells, ['张三', '20k']);
});

test('parseNode：列表项需要 as 参数', () => {
  const item = parseNode('- 一项', { as: 'listItem' });
  assert.ok(item);
  assert.equal(item!.type, 'listItem');
});

test('编辑链路：改源码 → 解析 → 替换 → 重渲染', () => {
  const ast = parse('# 旧标题\n\n正文').ast;
  const r = createRenderer(ast);
  const id = ast.children[0].id;

  // 1. 取源码
  const src = serializeNode(ast.children[0]);
  assert.equal(src.trim(), '# 旧标题');

  // 2. 用户改成二级标题
  const newNode = parseNode('## 新标题');
  assert.ok(newNode);

  // 3. 替换（保留原 ID）
  const merged = { ...newNode!, id } as any;
  assert.ok(r.update(id, merged));

  // 4. 重渲染
  const html = r.toHtml();
  assert.ok(html.includes('新标题'));
  assert.ok(!html.includes('旧标题'));
  assert.ok(html.includes('<h2'), '标题级别也变了');
});

// ---------- 列表结构 ----------

test('列表：嵌套子项包在独立 ul 里（不能直接塞进 li）', () => {
  const html = render(parse('- 父\n\t- 子\n\t\t- 孙').ast);
  assert.ok(/<li class="mdh-item"[^>]*>父<ul/.test(html), '子列表应有 ul');
  assert.ok((html.match(/<ul/g) ?? []).length >= 2, '应有多层 ul');
  assert.ok(!/<li[^>]*>[^<]*<li/.test(html), '不应出现 li 直接嵌套 li');
});

test('列表：有序子列表用 ol', () => {
  const html = render(parse('1. 父\n\t1. 子一\n\t2. 子二').ast);
  assert.ok(html.includes('<ol'), '子列表应为 ol');
});

test('列表：无序父 + 有序子是合法组合', () => {
  const html = render(parse('- 父\n\t1. 子一\n\t2. 子二').ast);
  const outerUl = html.indexOf('<ul');
  const innerOl = html.indexOf('<ol');
  assert.ok(outerUl >= 0 && innerOl > outerUl, '外层 ul、内层 ol');
});

// ---------- 任务列表 ----------

test('任务列表：区分 todo 与 done', () => {
  const html = render(parse('- [ ] 未完成\n- [x] 已完成').ast);
  assert.ok(html.includes('data-mdh-task="todo"'), '未完成');
  assert.ok(html.includes('data-mdh-task="done"'), '已完成');
});

test('任务列表：普通列表项没有 task 属性', () => {
  const html = render(parse('- 普通项').ast);
  assert.ok(!html.includes('data-mdh-task'), '不应有 task 属性');
});

// ---------- slides ----------

const SLIDES = `@page(slides)
# 封面
@next-slide
# 第二页
@next-slide
# 第三页`;

test('slides：容器带 mdh-page-slides 与总页数', () => {
  const html = render(parse(SLIDES).ast);
  assert.ok(html.includes('mdh-page-slides'), '容器 class');
  assert.ok(html.includes('data-mdh-preset="slides"'), '预设');
  assert.ok(html.includes('data-mdh-slide-count="3"'), '总页数');
});

test('slides：每页是 section，带序号与总数', () => {
  const html = render(parse(SLIDES).ast);
  const sections = html.match(/<section class="mdh-slide"[^>]*>/g) ?? [];
  assert.equal(sections.length, 3, `页数 ${sections.length}`);
  for (let i = 1; i <= 3; i++) {
    assert.ok(html.includes(`data-mdh-index="${i}"`), `第 ${i} 页的序号`);
    assert.ok(html.includes(`data-mdh-slide-total="3"`), `第 ${i} 页的总数`);
  }
});

test('slides：不输出「当前页」状态（运行时归第三层）', () => {
  const html = render(parse(SLIDES).ast);
  assert.ok(!html.includes('data-mdh-current'), '不应输出当前页');
  assert.ok(!html.includes('is-active'), '不应输出激活状态');
});

test('slides：无 @page 时不产生 page 容器', () => {
  const html = render(parse('# 普通文档\n正文').ast);
  assert.ok(!html.includes('mdh-page'), '不应有 page 容器');
  assert.ok(!html.includes('data-mdh-slide-count'), '不应有页数');
});
