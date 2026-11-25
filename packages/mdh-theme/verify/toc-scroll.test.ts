/**
 * 挂载层（第三层）能力验证：目录跳转
 *
 * scrollToToc 是「能力」，不是「手势」——
 * 什么时候跳由宿主决定，这里只验「跳得对不对」。
 *
 * 用 jsdom 造一个真实 DOM：预览容器 + 目录 + 标题。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

/** 造一个带目录和标题的预览容器，返回 { dom, container, it } */
async function setup(bodyHtml: string) {
  const dom = new JSDOM(
    `<!doctype html><html><body><div id="host" class="mdh-doc">${bodyHtml}</div></body></html>`,
    { pretendToBeVisual: true },
  );

  // mdh-interact-core 是 IIFE，挂到 global
  const g = globalThis as any;
  g.window = dom.window;
  g.document = dom.window.document;
  g.CSS = dom.window.CSS ?? { escape: (s: string) => s };
  if (!dom.window.CSS?.escape) {
    (dom.window as any).CSS = { escape: (s: string) => s };
  }
  g.HTMLElement = dom.window.HTMLElement;
  g.Element = dom.window.Element;

  // jsdom 不实现滚动 API，补空实现——
  // 这里验的是「找对了标题」，滚动本身由浏览器负责
  (dom.window as any).Element.prototype.scrollIntoView = function () {};
  (dom.window as any).Element.prototype.scrollTo = function () {};

  const { readFileSync } = await import('node:fs');
  const coreSrc = readFileSync(
    new URL('../src/mdh-interact-core.js', import.meta.url),
    'utf8',
  );
  // 在 jsdom 的 window 上执行 IIFE
  dom.window.eval(coreSrc);

  const container = dom.window.document.getElementById('host') as HTMLElement;
  const it = (dom.window as any).MDHInteractCore.create(container, {});
  return { dom, container, it };
}

/** 一段带目录和标题的 HTML（模拟渲染器输出） */
const DOC = `
<nav class="mdh-toc" data-mdh-block="toc">
  <div class="mdh-toc-list-wrap">
    <ul class="mdh-toc-list">
      <li class="mdh-toc-item" data-mdh-toc-level="1">
        <a class="mdh-toc-link" href="#M2" data-mdh-toc-text="第一章">第一章</a>
      </li>
      <li class="mdh-toc-item" data-mdh-toc-level="2">
        <a class="mdh-toc-link" href="#M3" data-mdh-toc-text="小节 A">小节 A</a>
      </li>
    </ul>
  </div>
</nav>
<h1 data-mdh-id="M2" data-mdh-type="heading">第一章</h1>
<h2 data-mdh-id="M3" data-mdh-type="heading">小节 A</h2>
`;

test('scrollToToc：传目录链接元素，返回对应标题', async () => {
  const { dom, container, it } = await setup(DOC);
  const link = container.querySelector('.mdh-toc-link') as HTMLElement;

  const heading = it.scrollToToc(link);

  assert.ok(heading, '应返回标题元素');
  assert.equal(heading!.tagName, 'H1');
  assert.equal(heading!.textContent.trim(), '第一章');
  dom.window.close();
});

test('scrollToToc：传标题文字也能跳', async () => {
  const { dom, container, it } = await setup(DOC);
  const heading = it.scrollToToc('小节 A');
  assert.ok(heading);
  assert.equal(heading!.textContent.trim(), '小节 A');
  dom.window.close();
});

test('scrollToToc：按文字优先于按 ID（ID 漂移时仍能跳）', async () => {
  // 目录 href 指向 M99（不存在的 ID），但文字能对上
  const brokenDoc = DOC.replace('href="#M2"', 'href="#M99"');
  const { dom, container, it } = await setup(brokenDoc);
  const link = container.querySelector('.mdh-toc-link') as HTMLElement;

  const heading = it.scrollToToc(link);
  assert.ok(heading, 'ID 对不上时应靠文字匹配成功');
  assert.equal(heading!.textContent.trim(), '第一章');
  dom.window.close();
});

test('scrollToToc：文字和 ID 都对不上时返回 null', async () => {
  const { dom, container, it } = await setup(DOC);
  const ghostLink = dom.window.document.createElement('a');
  ghostLink.className = 'mdh-toc-link';
  ghostLink.setAttribute('data-mdh-toc-text', '不存在的标题');
  ghostLink.setAttribute('href', '#M404');
  container.appendChild(ghostLink);

  assert.equal(it.scrollToToc(ghostLink), null);
  dom.window.close();
});

test('scrollToToc：空参数返回 null 不抛错', async () => {
  const { dom, it } = await setup(DOC);
  assert.equal(it.scrollToToc(''), null);
  dom.window.close();
});

test('scrollToToc：容器可滚动时滚容器，不滚 window', async () => {
  const { dom, container, it } = await setup(DOC);

  // 把容器伪装成可滚动层
  Object.defineProperty(container, 'scrollHeight', { value: 3000, configurable: true });
  Object.defineProperty(container, 'clientHeight', { value: 500, configurable: true });
  Object.defineProperty(dom.window, 'getComputedStyle', {
    value: () => ({ overflowY: 'auto' }),
    configurable: true,
  });
  let scrolledTo: { top: number } | null = null;
  // 覆盖掉 setup 里的空实现，记录实际调用
  (container as any).scrollTo = (o: { top: number }) => {
    scrolledTo = o;
  };
  container.scrollTop = 100;

  it.scrollToToc('小节 A');
  assert.ok(scrolledTo, 'scrollTo 应被调用');
  assert.equal(typeof (scrolledTo as any).top, 'number', 'top 应是数字');
  dom.window.close();
});

test('scrollToToc：能力已挂到返回对象上', async () => {
  const { dom, it } = await setup(DOC);
  assert.equal(typeof it.scrollToToc, 'function');
  dom.window.close();
});
