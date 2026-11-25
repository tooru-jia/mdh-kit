/**
 * 浏览器端入口：把第二层与第一层的能力打包给页面用
 */
import { createRenderer } from '../../mdh-render/src/index.ts';
import { serializeNode, parseNode, parse } from '@mdh/core';

declare global {
  interface Window {
    MDHRender?: typeof createRenderer;
    MDHCore?: { serializeNode: typeof serializeNode; parseNode: typeof parseNode; parse: typeof parse };
  }
}

window.MDHRender = createRenderer;
window.MDHCore = { serializeNode, parseNode, parse };
