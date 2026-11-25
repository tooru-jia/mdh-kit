/**
 * Chart.js 配置生成（两个宿主共用）
 *
 * 宿主要做的只有一件事：拿这份 config，在某个 canvas 上画出来。
 * 配色、坐标轴、图例位置全在这里，保证两个宿主出图一致。
 */
import {
  AXIS_COLOR,
  CHART_FONT,
  SERIES_COLORS,
  TEXT_COLOR,
} from './theme.ts';

/** chart 块的数据结构（来自第二层的 data-mdh-chart 属性） */
export interface ChartData {
  chartType: 'bar' | 'line' | 'pie';
  headers: string[];
  rows: string[][];
}

/** 空数据兜底，避免坏数据让整个编译挂掉 */
export const EMPTY_CHART: ChartData = { chartType: 'bar', headers: [], rows: [] };

/** 把 CSV 式的数据转成 Chart.js 的 config */
export function toChartConfig(d: ChartData): Record<string, unknown> {
  const labels = d.rows.map((r) => r[0] ?? '');
  const seriesCount = Math.max(0, (d.headers.length ?? 1) - 1);

  const grid = { color: AXIS_COLOR };

  if (d.chartType === 'pie') {
    return {
      type: 'pie',
      data: {
        labels,
        datasets: [
          {
            data: d.rows.map((r) => Number(r[1] ?? 0) || 0),
            backgroundColor: d.rows.map((_, i) => SERIES_COLORS[i % SERIES_COLORS.length]),
            borderColor: '#ffffff',
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: false,
        animation: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: TEXT_COLOR, font: CHART_FONT, boxWidth: 10, padding: 14 },
          },
        },
      },
    };
  }

  const datasets = [];
  for (let s = 0; s < seriesCount; s++) {
    const color = SERIES_COLORS[s % SERIES_COLORS.length];
    datasets.push({
      label: d.headers[s + 1] ?? `系列${s + 1}`,
      data: d.rows.map((r) => Number(r[s + 1] ?? 0) || 0),
      backgroundColor: d.chartType === 'line' ? undefined : color,
      borderColor: color,
      borderWidth: d.chartType === 'line' ? 2 : 1,
      pointBackgroundColor: color,
      pointRadius: d.chartType === 'line' ? 3 : 0,
      tension: d.chartType === 'line' ? 0.3 : undefined,
    });
  }

  return {
    type: d.chartType,
    data: { labels, datasets },
    options: {
      responsive: false,
      animation: false,
      plugins: {
        legend: {
          display: seriesCount > 1,
          position: 'bottom',
          labels: {
            color: TEXT_COLOR,
            font: CHART_FONT,
            boxWidth: 10,
            padding: 14,
            usePointStyle: true,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { color: AXIS_COLOR },
          ticks: { color: TEXT_COLOR, font: CHART_FONT },
        },
        y: {
          beginAtZero: true,
          grid,
          border: { display: false },
          ticks: { color: TEXT_COLOR, font: CHART_FONT },
        },
      },
    },
  };
}

/** 解析第二层写进属性的图表数据 */
export function parseChartPayload(raw: string): ChartData {
  try {
    const json = raw
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
    const d = JSON.parse(json) as ChartData;
    if (!d || !Array.isArray(d.rows) || !Array.isArray(d.headers)) return EMPTY_CHART;
    return d;
  } catch {
    return EMPTY_CHART;
  }
}
