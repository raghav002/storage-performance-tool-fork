import {
  Alert,
  Badge,
  Button,
  Checkbox,
  NativeSelect,
  Paper,
  Slider,
  Text,
  Title,
} from "@mantine/core";
import { useCallback, useMemo, useState } from "react";
import type { Metrics, Sample } from "../types";
import { TrendChart } from "./TrendChart";
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
    field: "interval_iops" as const,
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
    field: "bandwidth_mib_s" as const,
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
    field: "p50_latency_us" as const,
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
  const [windowSize, setWindowSize] = useState<number | null>(null),
    [position, setPosition] = useState<number | null>(null);
  const width = windowSize ?? Math.max(1, last - first),
    end = position === null ? last : Math.min(last, Math.max(first, position)),
    start = Math.max(first, end - width);
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
      if (sample && pinned && windowSize !== null) setPosition(end);
    },
    [shown, end, windowSize],
  );
  const summaries = (m.phase_summaries ?? []).filter(
    (r) => cleanup || phaseCode(r.phase) !== "DELETE",
  );
  return (
    <Paper
      component="section"
      className="fleet mb-panel p-panel [@media(max-width:760px)]:p-[17px] min-w-0"
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
          <div data-spt-legacy="" className="fleet-toolbar">
            <NativeSelect
              label="Time window"
              aria-label="Time window"
              value={windowSize ?? "all"}
              onChange={(e) => {
                setWindowSize(
                  e.target.value === "all" ? null : Number(e.target.value),
                );
                setPosition(null);
              }}
            >
              {[
                ["all", "Entire phase"],
                ["60", "1 minute"],
                ["300", "5 minutes"],
                ["3600", "1 hour"],
                ["86400", "1 day"],
              ].map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
              {windowSize !== null &&
                ![60, 300, 3600, 86400].includes(windowSize) && (
                  <option value={windowSize}>
                    Custom · {elapsed(windowSize)}
                  </option>
                )}
            </NativeSelect>
            <div data-spt-legacy="" className="button-group">
              <Button
                size="compact-sm"
                fz="caption"
                disabled={samples.length < 2}
                onClick={() => {
                  setWindowSize(Math.max(1, width / 2));
                  setInspection(null);
                }}
              >
                Zoom in
              </Button>
              <Button
                size="compact-sm"
                fz="caption"
                disabled={windowSize === null}
                onClick={() => {
                  setWindowSize(width * 2 >= last - first ? null : width * 2);
                  setInspection(null);
                }}
              >
                Zoom out
              </Button>
              <Button
                size="compact-sm"
                fz="caption"
                onClick={() => {
                  setWindowSize(null);
                  setPosition(null);
                  setInspection(null);
                }}
              >
                Fit phase
              </Button>
              <Button
                size="compact-sm"
                fz="caption"
                disabled={position === null}
                onClick={() => {
                  setPosition(null);
                  setInspection(null);
                }}
              >
                Follow latest
              </Button>
            </div>
            {!m.is_active && shown.length > 0 && (
              <Button
                component="a"
                href={`/api/runs/${encodeURIComponent(m.run_id)}/csv?kind=window&phase=${phase}&start=${start}&end=${end}`}
                download
              >
                Export window CSV
              </Button>
            )}
          </div>
          {samples.length > 1 && (
            <label data-spt-legacy="" className="timeline-pan">
              Move time window
              <input
                data-spt-legacy=""
                aria-label="Move time window"
                type="range"
                min={Math.min(last, first + width)}
                max={last}
                step="any"
                disabled={windowSize === null || width >= last - first}
                value={end}
                onChange={(e) => {
                  setPosition(Number(e.target.value));
                  setInspection(null);
                }}
              />
              <span data-spt-legacy="">
                {elapsed(start)} – {elapsed(end)} {timeOriginLabel}
              </span>
            </label>
          )}
          {!samples.length && (
            <Alert role="note">
              No interval history recorded for this phase. Final phase averages
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
          <Paper
            p="md"
            radius="md"
            bg="var(--spt-surface-subtle)"
            mt="md"
            onKeyDown={(event) => {
              if (event.key === "Escape") setInspection(null);
            }}
          >
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
          <div data-spt-legacy="" className="comparison-grid">
            {graphs.map((g) => {
              const field = g.key === "throughput" ? "iops" : g.field;
              const max = Math.max(
                1,
                ...summaries.map((r) => numeric(r[field]) ?? 0),
              );
              return (
                <article data-spt-legacy="" className="comparison" key={g.key}>
                  <Title order={3}>
                    {g.label} <span data-spt-legacy="">{g.unit}</span>
                  </Title>
                  {summaries.map((r) => {
                    const v = numeric(r[field]);
                    return (
                      <div
                        data-spt-legacy=""
                        className="comparison-row"
                        key={r.phase}
                      >
                        <span data-spt-legacy="">{phaseName(r.phase)}</span>
                        <div data-spt-legacy="">
                          {v !== null && (
                            <i
                              data-spt-legacy=""
                              style={{
                                width: `${(v / max) * 100}%`,
                                background: g.series[0].color,
                              }}
                            />
                          )}
                        </div>
                        <strong data-spt-legacy="">{fmt(v, 2)}</strong>
                      </div>
                    );
                  })}
                </article>
              );
            })}
          </div>
          <Text size="xs" c="var(--spt-text-subtle)" className="tabular-nums">
            These bars show phase rates and P50 latency, not interval history.
            Cleanup normally transfers no object payload.
          </Text>
        </>
      )}
    </Paper>
  );
}
