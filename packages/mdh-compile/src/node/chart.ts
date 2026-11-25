/**
 * 图表插件（Node 宿主）
 *
 * 运行环境：Node（Chart.js 需要 canvas 上下文，用 Playwright 的 Chromium）
 * 与 mermaid 共用同一个浏览器实例，避免重复启动。
 *
 * 配置生成全在 shared/chart-config.ts —— 两个宿主出图必须一致。
 * 浏览器宿主见 ../browser/chart.ts。
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { CompilePlugin } from '../types.ts';
import {
  EMPTY_CHART,
  parseChartPayload,
  toChartConfig,
  type ChartData,
} from '../shared/chart-config.ts';
import { CHART_SIZE } from '../shared/theme.ts';
import { missingDep } from '../shared/missing-dependency.ts';

const require = (() => {
  // ESM 用 import.meta.url；CJS 下 import.meta 为空对象，退到 __filename
  let base: string;
  try {
    // @ts-ignore 打包成 CJS 时 import.meta 为空对象
    base = import.meta.url || __filename;
  } catch {
    base = typeof __filename !== 'undefined' ? __filename : process.cwd() + '/';
  }
  return createRequire(base);
})();

const CHART_RE = /<div class="mdh-chart-body" data-mdh-chart="([^"]*)"><\/div>/g;

export interface ChartPluginOptions {
  /** 画布尺寸 */
  width?: number;
  height?: number;
}

/** 缓存的浏览器（各自持有，实际上与 mermaid 各启一个） */
let cached: { browser: any; page: any } | null = null;

async function getPage(): Promise<any> {
  if (cached) return cached.page;

  const { chromium } = await import('playwright').catch(() => {
    throw missingDep('playwright', '图表渲染（需要真实浏览器 canvas）');
  });

  let chartPath: string;
  try {
    chartPath = require
      .resolve('chart.js')
      .replace(/[\\/]dist[\\/]chart\.(cjs|js)$/, '/dist/chart.umd.js');
  } catch {
    throw missingDep('chart.js', '图表（***chart）');
  }
  const chartJs = readFileSync(chartPath, 'utf8');

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<!DOCTYPE html><html><body></body></html>');
  await page.addScriptTag({ content: chartJs });

  cached = { browser, page };
  return page;
}

export async function disposeChart(): Promise<void> {
  if (!cached) return;
  await cached.browser.close();
  cached = null;
}

export function chartPlugin(options: ChartPluginOptions = {}): CompilePlugin {
  const width = options.width ?? CHART_SIZE.width;
  const height = options.height ?? CHART_SIZE.height;

  return {
    name: 'chart',
    env: 'node',
    async transform(html: string): Promise<string> {
      const payloads: ChartData[] = [];
      const re = new RegExp(CHART_RE.source, 'g');
      let m: RegExpExecArray | null;
      while ((m = re.exec(html)) !== null) payloads.push(parseChartPayload(m[1]));

      if (payloads.length === 0) return html;

      const page = await getPage();
      const images: string[] = [];

      for (let i = 0; i < payloads.length; i++) {
        const config = toChartConfig(payloads[i]);
        const dataUrl = await page.evaluate(
          async ({ cfg, w, h, id }: { cfg: unknown; w: number; h: number; id: string }) => {
            const doc = document;
            const holder = doc.createElement('div');
            holder.id = id;
            holder.style.width = `${w}px`;
            holder.style.height = `${h}px`;
            doc.body.appendChild(holder);

            const canvas = doc.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            holder.appendChild(canvas);

            const Chart = (globalThis as any).Chart;
            if (!Chart) return '__ERROR__Chart.js 未加载';

            try {
              new Chart(canvas, cfg as any);
              await new Promise((r) => setTimeout(r, 150));
              const url = canvas.toDataURL('image/png');
              holder.remove();
              return url;
            } catch (e) {
              holder.remove();
              return `__ERROR__${(e as Error).message}`;
            }
          },
          { cfg: config, w: width, h: height, id: `mdh-chart-${i}-${Date.now()}` },
        );
        images.push(dataUrl);
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

export { EMPTY_CHART };
