import { Box, Paper, Text, Title } from "@mantine/core";
import { useMemo } from "react";
import type { ChartOption } from "../charts/echarts";
import type { Row } from "../types";
import {
  formatChartAxisValue,
  formatChartValue,
  numeric,
  phaseName,
} from "../utils/metrics";
import { EChart } from "./EChart";

type Props = {
  summaries: Row[];
  field: "iops" | "bandwidth_mib_s" | "p50_latency_us";
  title: string;
  unit: string;
  color: string;
};

export function PhaseSummaryChart({
  summaries,
  field,
  title,
  unit,
  color,
}: Props) {
  const data = useMemo(
    () =>
      summaries.map((row) => ({
        phase: phaseName(row.phase),
        value: numeric(row[field]),
      })),
    [summaries, field],
  );
  const hasValues = data.some((row) => row.value !== null);
  const option = useMemo<ChartOption>(
    () => ({
      grid: { left: 72, right: 64, top: 12, bottom: 36 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        valueFormatter: (value) =>
          numeric(value) === null
            ? "Not reported"
            : `${formatChartValue(value)} ${unit}`,
      },
      xAxis: {
        type: "value",
        // A fallback scale is only needed when every reported value is zero.
        max: data.every((row) => row.value === null || row.value === 0)
          ? 1
          : undefined,
        splitNumber: 3,
      },
      yAxis: {
        type: "category",
        inverse: true,
        data: data.map((row) => row.phase),
        axisLine: { show: false },
        axisLabel: {
          lineHeight: 16,
          formatter: (label, index) =>
            data[index].value === null ? `${label}\nNot reported` : label,
        },
      },
      series: [
        {
          id: field,
          name: title,
          type: "bar",
          data: data.map((row) => row.value),
          barMaxWidth: 20,
          itemStyle: { color, borderRadius: [0, 4, 4, 0] },
          label: {
            show: true,
            position: "right",
            formatter: ({ dataIndex }) => {
              const value = data[dataIndex].value;
              return value === null
                ? "Not reported"
                : formatChartAxisValue(value);
            },
          },
        },
      ],
    }),
    [data, field, title, unit, color],
  );
  const description = `${title} by phase, in ${unit}. ${data
    .map(
      (row) =>
        `${row.phase}: ${row.value === null ? "not reported" : `${formatChartValue(row.value)} ${unit}`}`,
    )
    .join(". ")}.`;

  return (
    <Paper component="article" p="md" radius="md" className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-xs">
        <Title order={3} size="lg">
          {title}
        </Title>
        <Text size="caption">{unit}</Text>
      </div>
      <Text size="caption" className="mt-xs">
        {field === "p50_latency_us" ? "50th percentile" : "Phase rate"}
      </Text>
      <Box h={Math.max(144, data.length * 48 + 60)}>
        {hasValues ? (
          <EChart
            option={option}
            label={description}
            className="h-full w-full min-w-0"
          />
        ) : (
          <Text
            size="sm"
            className="flex h-full items-center justify-center text-center"
          >
            No reported values for {data.map((row) => row.phase).join(", ")}.
          </Text>
        )}
      </Box>
    </Paper>
  );
}
