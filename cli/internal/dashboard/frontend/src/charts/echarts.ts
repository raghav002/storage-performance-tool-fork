import { px, type MantineTheme } from "@mantine/core";
import { BarChart, LineChart } from "echarts/charts";
import {
  AriaComponent,
  AxisPointerComponent,
  GridComponent,
  MarkPointComponent,
  TooltipComponent,
} from "echarts/components";
import { init, use as registerCharts } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { formatChartAxisValue } from "../utils/metrics";

registerCharts([
  LineChart,
  BarChart,
  GridComponent,
  MarkPointComponent,
  TooltipComponent,
  AxisPointerComponent,
  AriaComponent,
  CanvasRenderer,
]);

export { init };
export type { EChartsOption as ChartOption, EChartsType } from "echarts";

export function createChartTheme(theme: MantineTheme, rootFontSize = 16) {
  const { charts, text, borders, surfaces } = theme.other.dashboard;
  const fontScale = rootFontSize / 16;
  const axis = {
    axisLine: { lineStyle: { color: borders.panel } },
    axisTick: { show: false },
    axisLabel: {
      color: text.muted,
      fontSize: Number(px(theme.fontSizes.sm)) * fontScale,
    },
    nameTextStyle: { color: text.secondary },
    splitLine: { lineStyle: { color: charts.grid } },
  };

  return {
    color: charts.comparison,
    backgroundColor: "transparent",
    textStyle: {
      fontFamily: theme.fontFamily,
      fontSize: Number(px(theme.fontSizes.sm)) * fontScale,
      color: text.secondary,
    },
    grid: { left: 68, right: 20, top: 18, bottom: 38 },
    valueAxis: {
      ...axis,
      min: 0,
      splitNumber: 4,
      axisLabel: {
        ...axis.axisLabel,
        formatter: formatChartAxisValue,
        hideOverlap: true,
      },
    },
    categoryAxis: { ...axis, splitLine: { show: false } },
    tooltip: {
      confine: true,
      renderMode: "richText",
      backgroundColor: surfaces.panel,
      borderColor: borders.panel,
      borderWidth: 1,
      textStyle: {
        fontFamily: theme.fontFamily,
        fontSize: Number(px(theme.fontSizes.md)) * fontScale,
        color: text.primary,
      },
    },
    line: {
      lineStyle: { width: 2 },
      smooth: false,
      connectNulls: false,
      showSymbol: true,
      symbol: "circle",
      emphasis: { scale: false },
    },
  };
}
