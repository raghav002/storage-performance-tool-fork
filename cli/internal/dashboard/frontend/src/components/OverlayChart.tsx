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
import {
  elapsed,
  formatChartAxisValue,
  formatChartValue,
  numeric,
} from "../utils/metrics";
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
      grid: { left: 68, right: 20, top: 18, bottom: 38 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "line" },
        textStyle: { fontSize: px(theme.fontSizes.sm) },
        valueFormatter: (value) =>
          numeric(value) === null
            ? "Not reported"
            : `${formatChartValue(value)} ${unit}`,
      },
      xAxis: {
        type: "value",
        min: 0,
        max: maxT || 1,
        splitNumber: 4,
        axisLine: { show: true },
        splitLine: { show: false },
        axisLabel: { formatter: elapsed, hideOverlap: true },
        axisPointer: {
          snap: false,
          label: { formatter: ({ value }) => `${formatChartValue(value)}s` },
        },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: maxV === 0 ? 1 : undefined,
        splitNumber: 4,
        axisLine: { show: false },
        axisLabel: { formatter: formatChartAxisValue, hideOverlap: true },
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
  }, [data, metric, unit, baseline, theme.fontSizes.sm, maxT, maxV]);
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
        <Title order={3} size="lg">
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
          label={`${phase} ${title} over elapsed seconds for ${lines.length} runs, in ${unit}. Baseline: ${baseline}. Exact values are available in the sample inspector below.`}
          className="h-[280px] w-full min-w-0 [@media(max-width:760px)]:h-[240px]"
          onReady={inspect}
        />
      ) : (
        <Text size="sm" className="flex h-[160px] items-center justify-center">
          No samples for this metric.
        </Text>
      )}
      {times.length > 0 && (
        <Box pt="md" className="border-t border-subtle-border">
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
                      className="mr-xs inline-block h-[3px] w-[18px] align-middle"
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
            Use the slider or arrow keys to read exact sample times. Values are
            not interpolated between runs.
          </Text>
        </Box>
      )}
    </Paper>
  );
}
