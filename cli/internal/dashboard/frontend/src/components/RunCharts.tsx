import {
  Alert,
  Badge,
  Button,
  Checkbox,
  NativeSelect,
  Paper,
  RangeSlider,
  Slider,
  Text,
  Title,
} from "@mantine/core";
import { useCallback, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Download,
  Maximize2,
  Pause,
  Play,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { Metrics, Sample } from "../types";
import { TrendChart } from "./TrendChart";
import { PhaseSummaryChart } from "./PhaseSummaryChart";
import { dashboardTokens } from "../theme";
import {
  elapsed,
  formatChartValue,
  formatNumber as fmt,
  numeric,
  phaseCode,
  phaseName,
  utc,
} from "../utils/metrics";

const graphs = [
  {
    key: "throughput" as const,
    summaryField: "iops" as const,
    label: "IOPS",
    unit: "ops/s",
    series: [
      {
        key: "throughput" as const,
        label: "IOPS",
        color: dashboardTokens.charts.throughput,
      },
    ],
  },
  {
    key: "bandwidth" as const,
    summaryField: "bandwidth_mib_s" as const,
    label: "Bandwidth",
    unit: "MiB/s",
    series: [
      {
        key: "bandwidth" as const,
        label: "Bandwidth",
        color: dashboardTokens.charts.bandwidth,
      },
    ],
  },
  {
    key: "p50" as const,
    summaryField: "p50_latency_us" as const,
    label: "Latency",
    unit: "µs",
    series: [
      {
        key: "p50" as const,
        label: "P50",
        color: dashboardTokens.charts.latencyP50,
      },
      {
        key: "p99" as const,
        label: "P99",
        color: dashboardTokens.charts.latencyP99,
      },
    ],
  },
];

type TimeWindow = { duration: number | null; end: number | null };

function timeBounds(window: TimeWindow, first: number, last: number) {
  // Match the millisecond precision of parsed timestamps before calculating bounds.
  const firstMs = Math.round(first * 1000),
    lastMs = Math.round(last * 1000);
  const width = Math.min(
    lastMs - firstMs,
    window.duration === null
      ? lastMs - firstMs
      : Math.round(window.duration * 1000),
  );
  const end =
    window.end === null
      ? lastMs
      : Math.min(
          lastMs,
          Math.max(firstMs + width, Math.round(window.end * 1000)),
        );
  return [(end - width) / 1000, end / 1000] as const;
}

export function Charts({
  metrics: m,
  phase,
  startedAt,
}: {
  metrics: Metrics;
  phase: string;
  startedAt?: string;
}) {
  const samples = useMemo(() => {
    const history =
      m.chart_samples ?? (m.is_aggregate ? [] : (m.samples ?? []));
    const rows = history
      .filter(
        (r) =>
          phaseCode(r.op_type) === phase &&
          Number.isFinite(Date.parse(r.timestamp ?? "")),
      )
      .sort((a, b) => Date.parse(a.timestamp!) - Date.parse(b.timestamp!));
    const start = Date.parse(startedAt ?? ""),
      origin = Number.isFinite(start)
        ? start
        : Date.parse(rows[0]?.timestamp ?? "");
    return rows.map((r): Sample => ({
      row: r,
      timestamp: r.timestamp!,
      elapsed: Math.max(0, (Date.parse(r.timestamp!) - origin) / 1000),
      throughput: numeric(r.interval_iops),
      bandwidth: numeric(r.bandwidth_mib_s),
      p50: numeric(r.p50_latency_us),
      p99: numeric(r.latency_p99_us),
    }));
  }, [m.chart_samples, m.is_aggregate, m.samples, phase, startedAt]);
  const [mode, setMode] = useState<"timeline" | "summary">("timeline"),
    [cleanup, setCleanup] = useState(false),
    [inspection, setInspection] = useState<{
      timestamp: string;
      pinned: boolean;
    } | null>(null);
  const first = samples[0]?.elapsed ?? 0,
    last = samples.at(-1)?.elapsed ?? first;
  const [timeWindow, setTimeWindow] = useState<TimeWindow>({
    duration: null,
    end: null,
  });
  const [start, end] = timeBounds(timeWindow, first, last);
  const width = end - start,
    span = last - first,
    minimumWindow = Math.min(1, span),
    canAdjust = span > 0,
    following = timeWindow.end === null;
  const shown = useMemo(
    () => samples.filter((s) => s.elapsed >= start && s.elapsed <= end),
    [samples, start, end],
  );
  const display =
    !samples.length && (m.phase_summaries?.length ?? 0) > 0 ? "summary" : mode;
  const active = inspection
    ? shown.findIndex((sample) => sample.timestamp === inspection.timestamp)
    : -1;
  const inspected = inspection ? shown[active] : shown.at(-1);
  const timeOriginLabel = Number.isFinite(Date.parse(startedAt ?? ""))
    ? "from run start"
    : "from first available phase sample";
  const inspect = useCallback(
    (index: number | null, pinned = false) => {
      const sample = index === null ? undefined : shown[index];
      setInspection((current) => {
        if (current?.pinned && !pinned) return current;
        if (!sample) return null;
        return current?.timestamp === sample.timestamp &&
          current.pinned === pinned
          ? current
          : { timestamp: sample.timestamp, pinned };
      });
      if (sample && pinned && canAdjust)
        setTimeWindow({ duration: width, end });
    },
    [shown, end, width, canAdjust],
  );
  function changeWindow(next: TimeWindow) {
    const [left, right] = timeBounds(next, first, last);
    setTimeWindow(next);
    setInspection((current) => {
      if (!current?.pinned) return null;
      const sample = samples.find((s) => s.timestamp === current.timestamp);
      return sample && sample.elapsed >= left && sample.elapsed <= right
        ? current
        : null;
    });
  }
  function zoomWindow(factor: number) {
    const duration = Math.min(span, Math.max(minimumWindow, width * factor));
    changeWindow({
      duration: following && duration >= span ? null : duration,
      end: following ? null : (start + end + duration) / 2,
    });
  }
  const summaries = (m.phase_summaries ?? []).filter(
    (r) => cleanup || phaseCode(r.phase) !== "DELETE",
  );
  return (
    <Paper
      component="section"
      className="mb-panel p-panel [@media(max-width:760px)]:p-[17px] min-w-0"
      onKeyDown={(event) => {
        if (event.key === "Escape") setInspection(null);
      }}
    >
      <div className="mb-comfortable flex flex-wrap items-start justify-between gap-sm">
        <div className="min-w-0">
          <Title order={2} size="xl">
            Measured performance
          </Title>
          <Text size="caption" className="mt-[5px] max-[760px]:max-w-[250px]">
            {display === "timeline"
              ? `${phaseName(phase)} phase · ${samples.length} recorded samples`
              : "Phase summary"}
          </Text>
        </div>
        <NativeSelect
          aria-label="Chart view"
          className="max-w-full"
          value={display}
          onChange={(e) => {
            setMode(e.target.value as "timeline" | "summary");
            setInspection(null);
          }}
        >
          <option value="timeline" disabled={!samples.length}>
            Over time
          </option>
          <option value="summary" disabled={!m.phase_summaries?.length}>
            Phase comparison
          </option>
        </NativeSelect>
      </div>
      {display === "timeline" ? (
        <>
          <Paper p="md" radius="md" bg="var(--spt-surface-subtle)">
            <div className="flex flex-wrap items-end gap-md">
              <NativeSelect
                label="Time window"
                className="w-[160px] max-w-full"
                value={timeWindow.duration ?? "all"}
                disabled={!canAdjust}
                onChange={(event) => {
                  changeWindow({
                    duration:
                      event.target.value === "all"
                        ? null
                        : Number(event.target.value),
                    end: null,
                  });
                  setInspection(null);
                }}
              >
                {[
                  ["all", "Entire phase"],
                  ["60", "1 minute"],
                  ["300", "5 minutes"],
                  ["3600", "1 hour"],
                  ["86400", "1 day"],
                ].map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
                {timeWindow.duration !== null &&
                  ![60, 300, 3600, 86400].includes(timeWindow.duration) && (
                    <option value={timeWindow.duration}>
                      Custom · {elapsed(timeWindow.duration)}
                    </option>
                  )}
              </NativeSelect>
              <div className="flex flex-wrap gap-xs">
                <Button
                  size="compact-sm"
                  variant="default"
                  leftSection={<ZoomIn size={14} aria-hidden="true" />}
                  disabled={!canAdjust || width <= minimumWindow}
                  onClick={() => zoomWindow(0.5)}
                >
                  Zoom in
                </Button>
                <Button
                  size="compact-sm"
                  variant="default"
                  leftSection={<ZoomOut size={14} aria-hidden="true" />}
                  disabled={!canAdjust || width >= span}
                  onClick={() => zoomWindow(2)}
                >
                  Zoom out
                </Button>
                <Button
                  size="compact-sm"
                  variant="default"
                  leftSection={<Maximize2 size={14} aria-hidden="true" />}
                  disabled={!canAdjust}
                  onClick={() => {
                    changeWindow({ duration: null, end: null });
                    setInspection(null);
                  }}
                >
                  Fit phase
                </Button>
              </div>
              {(m.is_active || !following) && (
                <Button
                  size="compact-sm"
                  variant={following ? "default" : "light"}
                  leftSection={
                    following ? (
                      <Pause size={14} aria-hidden="true" />
                    ) : (
                      <Play size={14} aria-hidden="true" />
                    )
                  }
                  disabled={!canAdjust}
                  onClick={() => {
                    changeWindow({
                      duration: following ? width : timeWindow.duration,
                      end: following ? end : null,
                    });
                    if (!following) setInspection(null);
                  }}
                >
                  {following ? "Pause window" : "Follow latest"}
                </Button>
              )}
              {!m.is_active && shown.length > 0 && (
                <Button
                  component="a"
                  size="compact-sm"
                  variant="light"
                  leftSection={<Download size={14} aria-hidden="true" />}
                  href={`/api/runs/${encodeURIComponent(m.run_id)}/csv?kind=window&phase=${phase}&start=${start}&end=${end}`}
                  download
                >
                  Export window CSV
                </Button>
              )}
            </div>
            <div className="mt-lg flex flex-wrap items-center justify-between gap-sm">
              <Text size="sm" fw="var(--mantine-font-weight-semibold)">
                Visible time range
              </Text>
              <Badge variant="light" color={following ? "spt" : "gray"}>
                {following
                  ? m.is_active
                    ? "Following latest"
                    : "Latest window"
                  : m.is_active
                    ? "Paused window"
                    : "Fixed window"}
              </Badge>
            </div>
            <Text size="caption" className="mt-xs tabular-nums">
              {elapsed(start)} – {elapsed(end)} {timeOriginLabel} ·{" "}
              {shown.length} visible samples
            </Text>
            <div className="mt-md px-xs">
              <RangeSlider
                min={first}
                max={canAdjust ? last : first + 1}
                step={Math.min(1, Math.max(0.001, span / 100))}
                precision={3}
                minRange={minimumWindow}
                pushOnOverlap={false}
                value={[start, end]}
                disabled={!canAdjust}
                thumbFromLabel="Visible window start"
                thumbToLabel="Visible window end"
                thumbValueText={(value) =>
                  `${fmt(value, 3)} seconds ${timeOriginLabel}`
                }
                label={(value) => `${fmt(value, 3)}s`}
                onChange={([left, right]) =>
                  changeWindow({ duration: right - left, end: right })
                }
              />
            </div>
            <div className="mt-md flex flex-wrap items-center justify-between gap-sm">
              <div className="flex flex-wrap gap-xs">
                <Button
                  size="compact-xs"
                  variant="default"
                  leftSection={<ArrowLeft size={14} aria-hidden="true" />}
                  disabled={!canAdjust || start <= first}
                  onClick={() =>
                    changeWindow({ duration: width, end: end - width / 2 })
                  }
                >
                  Earlier
                </Button>
                <Button
                  size="compact-xs"
                  variant="default"
                  rightSection={<ArrowRight size={14} aria-hidden="true" />}
                  disabled={!canAdjust || end >= last}
                  onClick={() =>
                    changeWindow({ duration: width, end: end + width / 2 })
                  }
                >
                  Later
                </Button>
              </div>
              <Text size="xs" c="var(--spt-text-subtle)">
                Drag either handle or use arrow keys to adjust the range.
              </Text>
            </div>
          </Paper>
          {!samples.length && (
            <Alert role="note">
              No interval history recorded for this phase. Phase summaries
              appear once SPT reports them.
            </Alert>
          )}
          {samples.length === 1 && (
            <Alert role="note">
              One measured point is available. It cannot establish a trend.
            </Alert>
          )}
          <div className="mt-lg grid gap-lg">
            {graphs.map((g) => (
              <TrendChart
                key={g.key}
                samples={shown}
                title={g.label}
                unit={g.unit}
                series={g.series}
                start={start}
                end={end}
                active={inspection ? active : null}
                pinned={inspection?.pinned ?? false}
                onInspect={inspect}
              />
            ))}
          </div>
          <Paper p="md" radius="md" bg="var(--spt-surface-subtle)" mt="md">
            <div className="mb-md flex flex-wrap items-center justify-between gap-sm">
              <Text
                size="sm"
                c="var(--spt-text-primary)"
                fw="var(--mantine-font-weight-semibold)"
              >
                Inspect time
              </Text>
              {inspection?.pinned && <Badge>Selected sample</Badge>}
              {inspection && (
                <Button
                  size="compact-xs"
                  variant="subtle"
                  onClick={() => setInspection(null)}
                >
                  Clear selection
                </Button>
              )}
            </div>
            <Slider
              min={0}
              max={Math.max(1, shown.length - 1)}
              step={1}
              value={active < 0 ? Math.max(0, shown.length - 1) : active}
              disabled={shown.length < 2}
              thumbLabel="Inspect chart sample"
              thumbValueText={(index) =>
                `${elapsed(shown[index]?.elapsed)} ${timeOriginLabel}`
              }
              label={(index) => elapsed(shown[index]?.elapsed)}
              onChange={(index) => inspect(index, true)}
            />
            <Text
              size="caption"
              className="mt-md tabular-nums"
              aria-live={inspection ? "polite" : "off"}
            >
              {inspected ? (
                <>
                  {elapsed(inspected.elapsed)} {timeOriginLabel} ·{" "}
                  {utc(inspected.timestamp)}
                  <span className="sr-only">
                    {" "}
                    · IOPS {formatChartValue(inspected.throughput)} ops/s ·
                    bandwidth {formatChartValue(inspected.bandwidth)} MiB/s ·
                    P50 {formatChartValue(inspected.p50)} µs · P99{" "}
                    {formatChartValue(inspected.p99)} µs
                  </span>
                </>
              ) : inspection ? (
                "The selected sample is no longer available in this window. Clear selection to inspect available measurements."
              ) : (
                "No measured samples in this time window."
              )}
            </Text>
            <Text size="xs" c="var(--spt-text-subtle)" className="mt-xs">
              Hover to inspect. Click a plot or use the slider to hold a sample;
              Escape clears selection. All three plots share the time window and
              cursor. Missing values remain gaps.
            </Text>
          </Paper>
        </>
      ) : (
        <>
          <Checkbox
            label="Include cleanup in comparison"
            checked={cleanup}
            onChange={(e) => setCleanup(e.target.checked)}
          />
          {summaries.length ? (
            <div className="my-lg grid grid-cols-1 gap-md min-[1500px]:grid-cols-3">
              {graphs.map((graph) => (
                <PhaseSummaryChart
                  key={graph.key}
                  summaries={summaries}
                  field={graph.summaryField}
                  title={graph.key === "p50" ? "P50 latency" : graph.label}
                  unit={graph.unit}
                  color={graph.series[0].color}
                />
              ))}
            </div>
          ) : (
            <Alert role="note" my="md">
              No phase summaries available for this selection.
            </Alert>
          )}
          <Text size="xs" c="var(--spt-text-subtle)" className="tabular-nums">
            Each chart uses its own scale. Hover for full values; “Not reported”
            means missing data, not zero. P50 is a latency percentile. These are
            phase summaries, not interval history. Cleanup normally transfers no
            object payload.
          </Text>
        </>
      )}
    </Paper>
  );
}
