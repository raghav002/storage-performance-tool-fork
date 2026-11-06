import type { LineSeriesOption } from "echarts/charts";

export function lineSymbols(
  points: [number, number | null][],
  color: string,
): Pick<LineSeriesOption, "showSymbol" | "symbolSize" | "markPoint"> {
  return {
    showSymbol: false,
    symbolSize: 7,
    // Hover symbols are handled by ECharts. Keep lone measurements visible too.
    markPoint: {
      symbol: "circle",
      symbolSize: 7,
      silent: true,
      label: { show: false },
      itemStyle: { color },
      data: points.flatMap(([time, value], index) =>
        value !== null &&
        (index === 0 || points[index - 1][1] === null) &&
        (index === points.length - 1 || points[index + 1][1] === null)
          ? [{ name: String(time), coord: [time, value] }]
          : [],
      ),
    },
  };
}
