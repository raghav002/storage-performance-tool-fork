import {
  Alert,
  Badge,
  Button,
  Checkbox,
  NativeSelect,
  Paper,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useState } from "react";
import type { CompareDelta, CompareResult } from "../../types";
import { useComparison, useLastSuccessfulData } from "../../api/queries";
import { dashboardTokens } from "../../theme";
import { formatNumber as fmt } from "../../utils/metrics";
import {
  deltaText,
  flagText,
  groupDeltas,
  phasesOf,
  regressionCount,
  type OverlayMetric,
  type RuleOverrides,
} from "../../utils/catalog";

import { OverlayChart } from "../../components/OverlayChart";

const palette = dashboardTokens.charts.comparison;
const metrics: { key: OverlayMetric; label: string; unit: string }[] = [
  { key: "iops", label: "IOPS", unit: "ops/s" },
  { key: "bandwidth_mib_s", label: "Bandwidth", unit: "MiB/s" },
  { key: "p50_latency_us", label: "P50 latency", unit: "µs" },
  { key: "p99_latency_us", label: "P99 latency", unit: "µs" },
];

export function ComparePage({
  ids,
  baseline,
  onBack,
}: {
  ids: string[];
  baseline: string;
  onBack: () => void;
}) {
  const [base, setBase] = useState(baseline);
  const [rule, setRule] = useState<RuleOverrides>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const comparison = useComparison(ids, base, rule);
  const data = useLastSuccessfulData(comparison.data);
  const error = comparison.error?.message ?? "";
  const [metric, setMetric] = useState<OverlayMetric>("iops");
  const [hiddenRuns, setHiddenRuns] = useState<string[]>([]);
  const [draftRule, setDraftRule] = useState<CompareResult["rule"] | null>(
    null,
  );
  // Initialize editable rule fields when a successful response supplies defaults.
  if (data && data.rule !== draftRule) {
    setDraftRule(data.rule);
    setDraft({
      threshold_pct: String(data.rule.threshold_pct),
      latency_floor_us: String(data.rule.latency_floor_us),
      min_ops: String(data.rule.min_ops),
    });
  }
  const apply = () => {
    const next: RuleOverrides = {};
    const fields = ["threshold_pct", "latency_floor_us", "min_ops"] as const;
    for (const k of fields) {
      const v = Number(draft[k]);
      if (draft[k]?.trim() !== "" && Number.isFinite(v) && v >= 0) next[k] = v;
    }
    if (fields.every((field) => next[field] === rule[field])) {
      void comparison.refetch();
    } else {
      setRule(next);
    }
  };
  if (ids.length < 2)
    return (
      <div className="px-section py-xxl text-center">
        <Title order={2}>Select runs to compare</Title>
        <Text className="mt-xs">
          Choose at least two runs in the results catalog.
        </Text>
        <Button onClick={onBack}>Open results catalog</Button>
      </div>
    );
  const color = (id: string) =>
    palette[Math.max(0, ids.indexOf(id)) % palette.length];
  const runLabel = (id: string) => `Run ${Math.max(0, ids.indexOf(id)) + 1}`;
  const visibleRuns =
    data?.runs.filter((run) => !hiddenRuns.includes(run.id)) ?? [];
  const selectedMetric = metrics.find((m) => m.key === metric) ?? metrics[0];
  const regressions = data ? regressionCount(data.deltas) : 0;
  return (
    <>
      <div className="flex justify-between items-center mb-6.5 gap-md max-[47.5rem]:items-start max-[47.5rem]:flex-col">
        <div className="min-w-0">
          <span className="block text-xs/[inherit] tracking-[0.08125rem] text-[#6b7f99] font-heading mb-compact">
            COMPARE · {ids.length} RUNS
          </span>
          <Title order={1}>Compare runs</Title>
          <Text size="sm" className="mt-xs wrap-anywhere">
            Overlaid per-phase time series and totals, checked against the
            baseline run.
          </Text>
        </div>
        <div className="flex flex-wrap items-center gap-compact max-[47.5rem]:w-full">
          <Button onClick={onBack}>Back to catalog</Button>
        </div>
      </div>
      {error && (
        <Alert color="red" role="alert">
          {error}
        </Alert>
      )}
      {!data ? (
        !error && (
          <Text size="xs" c="var(--spt-text-subtle)">
            Loading comparison…
          </Text>
        )
      ) : (
        <>
          <Paper
            component="section"
            p="panel"
            mb="comfortable"
            className="flex flex-wrap items-end gap-3.5"
            aria-label="Regression rule"
          >
            <div className="basis-full">
              <strong>{data.rule.label}</strong>
              <Text size="sm" className="mt-xxs">
                {data.rule.description}
              </Text>
            </div>
            <NativeSelect
              label="Baseline"
              className="min-w-0 max-w-full"
              value={data.baseline}
              onChange={(e) => setBase(e.target.value)}
            >
              {data.runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.id}
                </option>
              ))}
            </NativeSelect>
            <TextInput
              label="Threshold %"
              className="w-27.5"
              type="number"
              min={0}
              step={1}
              value={draft.threshold_pct ?? ""}
              onChange={(e) =>
                setDraft({ ...draft, threshold_pct: e.target.value })
              }
            />
            <TextInput
              label="Latency floor µs"
              className="w-27.5"
              type="number"
              min={0}
              value={draft.latency_floor_us ?? ""}
              onChange={(e) =>
                setDraft({ ...draft, latency_floor_us: e.target.value })
              }
            />
            <TextInput
              label="Min operations"
              className="w-27.5"
              type="number"
              min={0}
              value={draft.min_ops ?? ""}
              onChange={(e) => setDraft({ ...draft, min_ops: e.target.value })}
            />
            <Button variant="filled" onClick={apply}>
              Apply
            </Button>
            <Text
              fw="var(--mantine-font-weight-semibold)"
              c={regressions ? "#b42318" : "#1f7a4d"}
              className="min-w-0 basis-full wrap-anywhere"
              role="status"
            >
              {regressions
                ? `${regressions} metric${regressions === 1 ? "" : "s"} past the threshold vs ${data.baseline}.`
                : `No metric past the threshold vs ${data.baseline}.`}{" "}
              Threshold check, not statistical significance.
            </Text>
          </Paper>
          {Object.entries(data.settings_differences ?? {}).some(
            ([, d]) => d.length,
          ) && (
            <Alert color="yellow" role="note" aria-label="Settings differences">
              <strong>
                Settings differ from the baseline; deltas may reflect
                configuration, not storage.
              </strong>
              <ul>
                {Object.entries(data.settings_differences).map(([id, diffs]) =>
                  diffs.map((d) => (
                    <li key={id + d}>
                      {id}: {d}
                    </li>
                  )),
                )}
              </ul>
            </Alert>
          )}
          <Paper
            component="section"
            className="mb-panel p-panel max-[47.5rem]:p-4.25"
          >
            <div className="flex flex-wrap items-end justify-between gap-md">
              <div className="min-w-0">
                <Title order={2}>Time series</Title>
                <Text size="caption" className="mt-xs">
                  Compare the same phase across runs. The baseline uses a
                  thicker line.
                </Text>
              </div>
              <NativeSelect
                label="Metric"
                aria-label="Comparison metric"
                className="max-w-full"
                value={metric}
                onChange={(event) =>
                  setMetric(event.target.value as OverlayMetric)
                }
              >
                {metrics.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label} ({m.unit})
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div
              role="group"
              aria-label="Visible comparison runs"
              className="my-lg grid gap-sm"
            >
              {data.runs.map((run) => (
                <Checkbox
                  key={run.id}
                  color={color(run.id)}
                  checked={!hiddenRuns.includes(run.id)}
                  onChange={(event) => {
                    const visible = event.currentTarget.checked;
                    setHiddenRuns((current) =>
                      visible
                        ? current.filter((id) => id !== run.id)
                        : [...current, run.id],
                    );
                  }}
                  label={
                    <span className="wrap-anywhere">
                      {runLabel(run.id)} · {run.id}
                      {run.id === data.baseline && (
                        <Badge component="span" size="sm" ml="xs">
                          Baseline
                        </Badge>
                      )}
                    </span>
                  }
                />
              ))}
            </div>
            {visibleRuns.length ? (
              <div className="grid min-w-0 gap-md">
                {phasesOf(data.series).map((phase) => (
                  <OverlayChart
                    key={phase}
                    phase={phase}
                    metric={metric}
                    title={selectedMetric.label}
                    unit={selectedMetric.unit}
                    baseline={data.baseline}
                    lines={visibleRuns.map((run) => ({
                      id: run.id,
                      label: runLabel(run.id),
                      color: color(run.id),
                      points: data.series[run.id]?.[phase] ?? [],
                    }))}
                  />
                ))}
                {phasesOf(data.series).length === 0 && (
                  <Text size="sm">
                    None of the selected runs recorded interval metrics.
                  </Text>
                )}
              </div>
            ) : (
              <Alert role="note">
                Select a run above to show its time series.
              </Alert>
            )}
            <Text size="xs" c="var(--spt-text-subtle)" className="mt-md">
              Missing values remain gaps. Each phase uses its own scale. Points
              may be averaged when a phase has more than 2,000 samples.
            </Text>
          </Paper>
          <DeltaTable deltas={data.deltas} baseline={data.baseline} />
        </>
      )}
    </>
  );
}

export function DeltaTable({
  deltas,
  baseline,
}: {
  deltas: CompareDelta[];
  baseline: string;
}) {
  const grouped = groupDeltas(deltas);
  return (
    <Paper component="section" className="mb-panel" aria-label="Delta table">
      <Title order={2} className="wrap-anywhere">
        Deltas vs {baseline}
      </Title>
      {deltas.length === 0 ? (
        <Text size="xs" c="var(--spt-text-subtle)">
          No shared phases to compare.
        </Text>
      ) : (
        <Table.ScrollContainer
          minWidth="var(--spt-table-min-width)"
          aria-label="Comparison deltas scroll area"
        >
          <Table aria-label="Comparison deltas" stickyHeader>
            <Table.Thead>
              <Table.Tr>
                <Table.Th scope="col">Phase</Table.Th>
                <Table.Th scope="col">Metric</Table.Th>
                <Table.Th scope="col">Run</Table.Th>
                <Table.Th scope="col" ta="right">
                  Baseline
                </Table.Th>
                <Table.Th scope="col" ta="right">
                  Value
                </Table.Th>
                <Table.Th scope="col" ta="right">
                  Δ
                </Table.Th>
                <Table.Th scope="col">Flag</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {[...grouped].flatMap(([phase, byMetric]) =>
                [...byMetric].flatMap(([, rows]) =>
                  rows.map((d) => (
                    <Table.Tr key={`${phase}-${d.metric}-${d.run_id}`}>
                      <Table.Td>{phase}</Table.Td>
                      <Table.Td>{d.label}</Table.Td>
                      <Table.Td ff="monospace" fz="caption">
                        {d.run_id}
                      </Table.Td>
                      <Table.Td ta="right">{fmt(d.baseline, 2)}</Table.Td>
                      <Table.Td ta="right">{fmt(d.value, 2)}</Table.Td>
                      <Table.Td ta="right">{deltaText(d)}</Table.Td>
                      <Table.Td>
                        <Badge
                          color={
                            d.flag === "regressed"
                              ? "red"
                              : d.flag === "improved"
                                ? "teal"
                                : [
                                      "not_comparable",
                                      "insufficient",
                                      "no_data",
                                    ].includes(d.flag)
                                  ? "yellow"
                                  : "gray"
                          }
                          radius="xl"
                          title={d.reason}
                        >
                          {flagText[d.flag] ?? d.flag}
                        </Badge>
                        {d.reason && (
                          <Text
                            component="small"
                            size="caption"
                            c="var(--spt-text-muted)"
                            lh="normal"
                            className="mt-0.75 block"
                          >
                            {d.reason}
                          </Text>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  )),
                ),
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      <Text size="caption" className="px-comfortable pb-md">
        Flags are a threshold check, not statistical significance. One run per
        side cannot show variance; repeat runs before drawing conclusions.
      </Text>
    </Paper>
  );
}
