import { Box, Text, Title, useMantineTheme } from "@mantine/core";
import { useCallback, useMemo } from "react";
import type { ElementEvent } from "echarts/core";
import type { ChartOption, EChartsType } from "../charts/echarts";
import type { Sample } from "../types";
import { elapsed, formatChartValue } from "../utils/metrics";
import { EChart } from "./EChart";

type Props = {
  samples: Sample[];
  title: string;
  unit: string;
  series: {
    key: "throughput" | "bandwidth" | "p50" | "p99";
    label: string;
    color: string;
  }[];
  start: number;
  end: number;
  active: number | null;
  pinned: boolean;
  onInspect: (index: number | null, pinned?: boolean) => void;
};

export function TrendChart({
  samples,
  title,
  unit,
  series,
  start,
  end,
  active,
  pinned,
  onInspect,
}: Props) {
  const theme = useMantineTheme();
  const inspected = active === null ? samples.at(-1) : samples[active];
  const hasValues = samples.some((sample) =>
    series.some((line) => sample[line.key] !== null),
  );
  const option = useMemo<ChartOption>(
    () => ({
      tooltip: {
        trigger: "axis",
        triggerOn: "none",
        valueFormatter: (value) => `${formatChartValue(value)} ${unit}`,
      },
      axisPointer: { triggerOn: "none" },
      xAxis: {
        type: "value",
        min: start,
        max: end > start ? end : start + 1,
        axisLine: { show: true },
        splitLine: { show: false },
        axisLabel: { formatter: elapsed },
        axisPointer: {
          show: true,
          status: "hide",
          snap: false,
          animation: false,
          triggerTooltip: true,
          label: { show: false },
          lineStyle: {
            color: theme.other.dashboard.charts.inspector,
            type: "dashed",
            width: 1,
          },
        },
      },
      yAxis: {
        type: "value",
        axisLine: { show: false },
      },
      series: series.map((line) => ({
        id: line.key,
        name: line.label,
        type: "line",
        data: samples.map((sample) => [sample.elapsed, sample[line.key]]),
        encode: { x: 0, y: 1, tooltip: [1] },
        // Keep isolated measurements visible without covering dense lines in dots.
        symbolSize: (_value, params) => {
          const i = params.dataIndex;
          return samples[i]?.[line.key] !== null &&
            (i === 0 || samples[i - 1][line.key] === null) &&
            (i === samples.length - 1 || samples[i + 1][line.key] === null)
            ? 7
            : 0;
        },
        lineStyle: { color: line.color },
        itemStyle: { color: line.color },
      })),
    }),
    [samples, series, start, end, unit, theme],
  );

  const bindInspection = useCallback(
    (chart: EChartsType) => {
      const selected = active === null ? undefined : samples[active];
      chart.dispatchAction(
        selected
          ? {
              type: "updateAxisPointer",
              currTrigger: "mousemove",
              x: chart.convertToPixel({ xAxisIndex: 0 }, selected.elapsed),
              y: chart.getHeight() / 2,
            }
          : { type: "updateAxisPointer", currTrigger: "leave" },
      );
      const inspect = (event: ElementEvent, pinned: boolean) => {
        const point = [event.offsetX, event.offsetY];
        if (!chart.containPixel({ gridIndex: 0 }, point)) return;
        const time = chart.convertFromPixel({ xAxisIndex: 0 }, event.offsetX);
        if (
          typeof time !== "number" ||
          !Number.isFinite(time) ||
          !samples.length
        )
          return;
        const index = samples.reduce(
          (best, sample, i) =>
            Math.abs(sample.elapsed - time) <
            Math.abs(samples[best].elapsed - time)
              ? i
              : best,
          0,
        );
        onInspect(index, pinned);
      };
      const move = (event: ElementEvent) => {
        if (!pinned) inspect(event, false);
      };
      const click = (event: ElementEvent) => inspect(event, true);
      const leave = () => onInspect(null);
      chart.getZr().on("mousemove", move);
      chart.getZr().on("click", click);
      chart.getZr().on("globalout", leave);
      return () => {
        if (chart.isDisposed()) return;
        chart.getZr().off("mousemove", move);
        chart.getZr().off("click", click);
        chart.getZr().off("globalout", leave);
      };
    },
    [samples, onInspect, active, pinned],
  );

  return (
    <section
      aria-label={`${title} trend`}
      tabIndex={-1}
      className="min-w-0 border-t-[0.0625rem] border-subtle-border pt-lg"
    >
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <div>
          <Title order={3} size="lg">
            {title}
          </Title>
          <Text size="caption" c="var(--spt-text-muted)">
            {unit}
          </Text>
        </div>
        <div
          className="flex flex-wrap items-center gap-lg"
          aria-label={`${title} values`}
          role="group"
        >
          {series.map((line) => (
            <div key={line.key} className="flex items-center gap-xs">
              <Box
                component="span"
                aria-hidden="true"
                bg={line.color}
                className="h-0.75 w-4.5 rounded-full"
              />
              <Text component="span" size="sm">
                {line.label}
              </Text>
              <Text
                component="strong"
                size="md"
                c="var(--spt-text-primary)"
                className="tabular-nums"
              >
                {formatChartValue(inspected?.[line.key])}
              </Text>
            </div>
          ))}
        </div>
      </div>
      {hasValues ? (
        <EChart
          option={option}
          label={`${title} over elapsed time, in ${unit}`}
          className="h-65 w-full min-w-0 max-[47.5rem]:h-60"
          onReady={bindInspection}
        />
      ) : (
        <Text size="sm" className="flex h-45 items-center justify-center">
          No measured {title.toLowerCase()} in this window.
        </Text>
      )}
    </section>
  );
}
