import { px, type MantineTheme } from "@mantine/core";
import { BarChart, LineChart } from "echarts/charts";
import {
  AriaComponent,
  AxisPointerComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { init, use as registerCharts } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

registerCharts([
  LineChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  AxisPointerComponent,
  DataZoomComponent,
  AriaComponent,
  CanvasRenderer,
]);

export { init };
export type { EChartsOption as ChartOption, EChartsType } from "echarts";

export function createChartTheme(theme: MantineTheme) {
  const { charts, text, borders, surfaces } = theme.other.dashboard;
  const axis = {
    axisLine: { lineStyle: { color: borders.panel } },
    axisTick: { show: false },
    axisLabel: { color: text.muted, fontSize: px(theme.fontSizes.sm) },
    nameTextStyle: { color: text.secondary },
    splitLine: { lineStyle: { color: charts.grid } },
  };

  return {
    color: charts.comparison,
    backgroundColor: "transparent",
    textStyle: {
      fontFamily: theme.fontFamily,
      fontSize: px(theme.fontSizes.sm),
      color: text.secondary,
    },
    valueAxis: axis,
    timeAxis: axis,
    categoryAxis: { ...axis, splitLine: { show: false } },
    legend: {
      textStyle: { color: text.secondary, fontSize: px(theme.fontSizes.sm) },
    },
    tooltip: {
      confine: true,
      renderMode: "richText",
      backgroundColor: surfaces.panel,
      borderColor: borders.panel,
      borderWidth: 1,
      textStyle: {
        fontFamily: theme.fontFamily,
        fontSize: px(theme.fontSizes.md),
        color: text.primary,
      },
    },
    line: { lineStyle: { width: 2 }, smooth: false, connectNulls: false },
  };
}
