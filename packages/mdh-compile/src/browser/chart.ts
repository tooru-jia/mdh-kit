/**
 * 图表插件（浏览器宿主）
 *
 * 与 Node 宿主的区别：那边起 Playwright 画 canvas 再 toDataURL，
 * 这边直接在隐藏 div 里画，拿到的同样是 dataURL 图片。
 *
 * 配置生成全在 shared/chart-config.ts —— 两个宿主出图必须一致。
 */
import type { CompilePlugin } from '../types.ts';
import {
  parseChartPayload,
  toChartConfig,
  type ChartData,
} from '../shared/chart-config.ts';
import { CHART_SIZE } from '../shared/theme.ts';
import { missingDep } from '../shared/missing-dependency.ts';

const CHART_RE = /<div class="mdh-chart-body" data-mdh-chart="([^"]*)"><\/div>/g;

export interface ChartPluginOptions {
  width?: number;
  height?: number;
}

/**
 * 取 Chart 构造函数：
 *   ① 页面全局 window.Chart（CDN 版 / B 档）
 *   ② 动态 import('chart.js/auto')（A/C 档内嵌时打进产物）
 *   ③ 都没有 → null，调用方降级
 */
async function getChart(): Promise<any | null> {
  const g = globalThis as any;
  if (g.Chart) return g.Chart;
  try {
    const m = await import('chart.js/auto');
    return (m as any).default ?? m;
  } catch {
    return null;
  }
}

/** 浏览器宿主无需释放资源，保留同名导出以便调用方代码一致 */
export async function disposeChart(): Promise<void> {
  /* no-op */
}

export function chartPlugin(options: ChartPluginOptions = {}): CompilePlugin {
  const width = options.width ?? CHART_SIZE.width;
  const height = options.height ?? CHART_SIZE.height;

  return {
    name: 'chart',
    env: 'browser',
    async transform(html: string): Promise<string> {
      const payloads: ChartData[] = [];
      const scan = new RegExp(CHART_RE.source, 'g');
      let m: RegExpExecArray | null;
      while ((m = scan.exec(html)) !== null) payloads.push(parseChartPayload(m[1]));

      if (payloads.length === 0) return html;

      const Chart = await getChart();
      // ③ 无 Chart 可用 → 依赖缺失，报错（不降级：图表缺了就是空白/源码，算渲染不出来）
      if (!Chart) throw missingDep('chart.js', '图表（***chart）');
      const images: string[] = [];

      for (const payload of payloads) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        // 必须挂在文档里 Chart.js 才能正确测量
        canvas.style.cssText = 'position:fixed;left:-9999px;top:0;';
        document.body.appendChild(canvas);

        try {
          const chart = new (Chart as any)(canvas, toChartConfig(payload));
          images.push(canvas.toDataURL('image/png'));
          chart.destroy();
        } catch {
          images.push('__ERROR__');
        } finally {
          canvas.remove();
        }
      }

      let idx = 0;
      return html.replace(new RegExp(CHART_RE.source, 'g'), (_m, enc: string) => {
        const img = images[idx++];
        if (!img || img.startsWith('__ERROR__')) {
          return `<div class="mdh-chart-body mdh-chart-failed" data-mdh-chart="${enc}">图表渲染失败</div>`;
        }
        return `<div class="mdh-chart-body" data-mdh-chart="${enc}"><img src="${img}" alt="图表" style="max-width:100%"></div>`;
      });
    },
  };
}
