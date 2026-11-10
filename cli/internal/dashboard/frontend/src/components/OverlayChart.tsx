import {
  Box,
  Paper,
  Slider,
  Text,
  Title,
  px,
  useMantineTheme,
} from "@mantine/core";
import { useCallback, useMemo, useState } from "react";
import type { ChartOption, EChartsType } from "../charts/echarts";
import { lineSymbols } from "../charts/lineSymbols";
import type { SeriesPoint } from "../types";
import { overlayExtent, type OverlayMetric } from "../utils/catalog";
import { elapsed, formatChartValue, numeric } from "../utils/metrics";
import { EChart } from "./EChart";

type Props = {
  phase: string;
  metric: OverlayMetric;
  title: string;
  unit: string;
  baseline: string;
  lines: { id: string; label: string; color: string; points: SeriesPoint[] }[];
};

export function OverlayChart({
  phase,
  metric,
  title,
  unit,
  baseline,
  lines,
}: Props) {
  const theme = useMantineTheme();
  const rootFontSize =
    Number.parseFloat(getComputedStyle(document.documentElement).fontSize) ||
    16;
  const tooltipFontSize = Number(px(theme.fontSizes.sm)) * (rootFontSize / 16);
  const data = useMemo(
    () =>
      lines.map((line) => ({
        ...line,
        points: line.points.filter((p) => Number.isFinite(p.t) && p.t >= 0),
      })),
    [lines],
  );
  const times = useMemo(
    () =>
      [...new Set(data.flatMap((line) => line.points.map((p) => p.t)))].sort(
        (a, b) => a - b,
      ),
    [data],
  );
  const [selectedTime, setSelectedTime] = useState<number | null>(null);
  const active = Math.max(0, times.indexOf(selectedTime ?? times[0]));
  const time = times[active];
  const { maxT, maxV, count } = useMemo(
    () =>
      overlayExtent(
        data.map((line) => line.points),
        metric,
      ),
    [data, metric],
  );
  const option = useMemo<ChartOption>(() => {
    return {
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "line" },
        textStyle: { fontSize: tooltipFontSize },
        valueFormatter: (value) =>
          numeric(value) === null
            ? "Not reported"
            : `${formatChartValue(value)} ${unit}`,
      },
      xAxis: {
        type: "value",
        max: maxT || 1,
        axisLine: { show: true },
        splitLine: { show: false },
        axisLabel: { formatter: elapsed },
        axisPointer: {
          snap: false,
          label: { formatter: ({ value }) => `${formatChartValue(value)}s` },
        },
      },
      yAxis: {
        type: "value",
        max: maxV === 0 ? 1 : undefined,
        axisLine: { show: false },
      },
      series: data.map((line) => {
        const points: [number, number | null][] = line.points.map((point) => [
          point.t,
          numeric(point[metric]),
        ]);
        return {
          id: line.id,
          name: `${line.label}${line.id === baseline ? " (baseline)" : ""}`,
          type: "line",
          data: points,
          encode: { x: 0, y: 1, tooltip: [1] },
          ...lineSymbols(points, line.color),
          lineStyle: { color: line.color, width: line.id === baseline ? 3 : 2 },
          itemStyle: { color: line.color },
          emphasis: { focus: "series" },
        };
      }),
    };
  }, [data, metric, unit, baseline, tooltipFontSize, maxT, maxV]);
  const inspect = useCallback(
    (chart: EChartsType) => {
      if (selectedTime === null || time === undefined) return;
      chart.dispatchAction({
        type: "updateAxisPointer",
        currTrigger: "mousemove",
        x: chart.convertToPixel({ xAxisIndex: 0 }, time),
        y: chart.getHeight() / 2,
      });
    },
    [selectedTime, time],
  );

  return (
    <Paper
      component="section"
      p="md"
      radius="md"
      className="min-w-0"
      aria-label={`${phase} comparison`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-sm">
        <Title order={3} size="lg" className="min-w-0 wrap-anywhere">
          {phase}
        </Title>
        <Text size="caption">
          {title} · {unit}
        </Text>
      </div>
      <Text size="caption" className="mt-xs">
        Seconds since each run’s first phase sample
      </Text>
      {count > 0 ? (
        <EChart
          option={option}
          label={`${phase} ${title} over elapsed seconds for ${lines.length} runs, in ${unit}. Baseline: ${baseline}. Plotted values are available in the inspector below.`}
          className="h-70 w-full min-w-0 max-[47.5rem]:h-60"
          onReady={inspect}
        />
      ) : (
        <Text size="sm" className="flex h-40 items-center justify-center">
          No samples for this metric.
        </Text>
      )}
      {times.length > 0 && (
        <Box pt="md" className="border-t-[0.0625rem] border-subtle-border">
          <div className="mb-md flex flex-wrap items-baseline justify-between gap-sm">
            <Text size="sm" fw="var(--mantine-font-weight-semibold)">
              Sample inspector
            </Text>
            <Text size="caption" className="tabular-nums">
              {formatChartValue(time)}s into phase
            </Text>
          </div>
          <Slider
            min={0}
            max={Math.max(1, times.length - 1)}
            step={1}
            value={active}
            disabled={times.length < 2}
            thumbLabel={`Inspect ${phase} comparison sample`}
            thumbValueText={(index) =>
              `${formatChartValue(times[index])} seconds into phase`
            }
            label={(index) => `${formatChartValue(times[index])}s`}
            onChange={(index) => setSelectedTime(times[index])}
          />
          <ul
            className="m-0 mt-md grid list-none gap-sm p-0"
            aria-live={selectedTime === null ? "off" : "polite"}
          >
            {data.map((line) => {
              const point = line.points.find((p) => p.t === time);
              const value = numeric(point?.[metric]);
              return (
                <li
                  key={line.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-sm gap-y-xs text-sm"
                >
                  <span className="min-w-0 wrap-anywhere">
                    <Box
                      component="span"
                      bg={line.color}
                      aria-hidden="true"
                      className="mr-xs inline-block h-0.75 w-4.5 align-middle"
                    />
                    {line.label} · {line.id}
                    {line.id === baseline ? " (baseline)" : ""}
                  </span>
                  <Text
                    component="strong"
                    size="sm"
                    c="var(--spt-text-primary)"
                    className="tabular-nums"
                  >
                    {!point
                      ? "No sample at this time"
                      : value === null
                        ? "Not reported"
                        : `${formatChartValue(value)} ${unit}`}
                  </Text>
                </li>
              );
            })}
          </ul>
          <Text size="xs" c="var(--spt-text-subtle)" className="mt-sm">
            Use the slider or arrow keys to inspect plotted values. Points may
            be averaged when a phase has more than 2,000 samples. Values are not
            interpolated between runs.
          </Text>
        </Box>
      )}
    </Paper>
  );
}
