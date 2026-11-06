import {
  Alert,
  Button,
  Checkbox,
  NativeSelect,
  Paper,
  Radio,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useState } from "react";
import { useDebouncedValue } from "@mantine/hooks";
import type { CatalogRun } from "../../types";
import {
  useArtifacts,
  useCatalog,
  useLastSuccessfulData,
} from "../../api/queries";
import { Status } from "../../components/Status";
import { RunLog } from "../../components/RunLog";
import { formatNumber as fmt } from "../../utils/metrics";
import {
  maxCompare,
  previousRun,
  runSettings,
  toggleSelection,
  type CatalogFilters,
} from "../../utils/catalog";

const integrityText: Record<CatalogRun["integrity"], string> = {
  passed: "Integrity passed",
  failed: "Integrity failed",
  incomplete: "Integrity incomplete",
  not_recorded: "Integrity not recorded",
};

export function CatalogPage({
  onCompare,
}: {
  onCompare: (ids: string[], baseline: string) => void;
}) {
  const [filters, setFilters] = useState<CatalogFilters>({
    q: "",
    source: "",
    status: "",
  });
  const [debouncedFilters] = useDebouncedValue(filters, 200);
  const catalog = useCatalog(debouncedFilters);
  const unfiltered = useCatalog({ q: "", source: "", status: "" });
  const data = useLastSuccessfulData(catalog.data);
  const allRuns = unfiltered.data?.runs ?? [];
  const error = catalog.error?.message ?? "";
  const loading = catalog.isFetching;
  const [selected, setSelected] = useState<string[]>([]);
  const [baseline, setBaseline] = useState("");
  const [open, setOpen] = useState("");
  const effectiveBaseline = selected.includes(baseline)
    ? baseline
    : (selected[0] ?? "");
  const runs = data?.runs ?? [];
  return (
    <>
      <div className="flex justify-between items-center mb-6.5 gap-md max-[47.5rem]:items-start max-[47.5rem]:flex-col">
        <div className="min-w-0">
          <span className="block text-xs/[inherit] tracking-[0.08125rem] text-[#6b7f99] font-heading mb-compact">
            RESULTS CATALOG · READ ONLY
          </span>
          <Title order={1}>Results catalog</Title>
          <Text size="sm" className="mt-xs wrap-anywhere">
            Dashboard and CLI runs found under{" "}
            {data?.root ?? "the results folder"}. Nothing here changes or
            deletes results.
          </Text>
        </div>
        <div className="flex flex-wrap items-center gap-compact max-[47.5rem]:w-full">
          <Button
            onClick={() => {
              void catalog.refetch();
              if (
                debouncedFilters.q.trim() ||
                debouncedFilters.source ||
                debouncedFilters.status
              )
                void unfiltered.refetch();
            }}
            disabled={loading}
          >
            Rescan
          </Button>
          <Button
            variant="filled"
            disabled={selected.length < 2}
            onClick={() => onCompare(selected, effectiveBaseline)}
          >
            Compare {selected.length || ""} selected
          </Button>
        </div>
      </div>
      <Paper
        component="section"
        p="panel"
        mb="comfortable"
        className="flex flex-wrap items-end gap-3.5"
        aria-label="Filters"
      >
        <TextInput
          label="Search"
          type="search"
          value={filters.q}
          placeholder="Run name, label, size, endpoint host"
          onChange={(e) => setFilters({ ...filters, q: e.target.value })}
          className="min-w-0 flex-[1_1_17.5rem]"
        />
        <NativeSelect
          label="Source"
          value={filters.source}
          onChange={(e) =>
            setFilters({
              ...filters,
              source: e.target.value as CatalogFilters["source"],
            })
          }
        >
          <option value="">All sources</option>
          <option value="dashboard">Dashboard</option>
          <option value="cli">CLI</option>
        </NativeSelect>
        <NativeSelect
          label="Status"
          value={filters.status}
          onChange={(e) =>
            setFilters({
              ...filters,
              status: e.target.value as CatalogFilters["status"],
            })
          }
        >
          <option value="">All statuses</option>
          <option value="complete">Complete</option>
          <option value="partial">Partial</option>
          <option value="malformed">Malformed</option>
          <option value="failed">Integrity failed</option>
        </NativeSelect>
        <Text size="sm" className="basis-full">
          Select 2–{maxCompare} runs to compare; the baseline is the run the
          others are checked against. "Compare with previous" pairs this run
          with the next older complete run that shares the same workload, object
          size, threads, and (when recorded) object count, host count, and S3
          driver — not an SPT product version. Falls back to the next older
          complete run when no shape match exists.
        </Text>
      </Paper>
      {error && (
        <Alert color="red" role="alert">
          {error}
        </Alert>
      )}
      {data?.truncated && (
        <Alert color="yellow" role="note">
          The results folder is large; only part of it was scanned.
        </Alert>
      )}
      <Paper component="section" className="mb-panel">
        {loading && !data ? (
          <Text className="px-section py-xxl text-center">
            Scanning results…
          </Text>
        ) : runs.length ? (
          <Table.ScrollContainer
            minWidth="var(--spt-table-min-width)"
            aria-label="Results catalog scroll area"
          >
            <Table aria-label="Results catalog" stickyHeader>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th scope="col" ta="center">
                    Compare
                  </Table.Th>
                  <Table.Th scope="col" ta="center">
                    Baseline
                  </Table.Th>
                  <Table.Th scope="col">Run</Table.Th>
                  <Table.Th scope="col">Started · UTC</Table.Th>
                  <Table.Th scope="col">Settings</Table.Th>
                  <Table.Th scope="col">Status</Table.Th>
                  <Table.Th scope="col">Phases · IOPS</Table.Th>
                  <Table.Th scope="col" aria-label="Actions"></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {runs.map((run) => (
                  <CatalogRow
                    key={run.id}
                    run={run}
                    checked={selected.includes(run.id)}
                    full={selected.length >= maxCompare}
                    isBaseline={effectiveBaseline === run.id}
                    open={open === run.id}
                    previous={previousRun(
                      allRuns.length ? allRuns : runs,
                      run.id,
                    )}
                    onToggle={() =>
                      setSelected((s) => toggleSelection(s, run.id))
                    }
                    onBaseline={() => setBaseline(run.id)}
                    onOpen={() => setOpen(open === run.id ? "" : run.id)}
                    onComparePrevious={(prevId) =>
                      onCompare([run.id, prevId], prevId)
                    }
                  />
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        ) : (
          <div className="px-section py-xxl text-center">
            <Title order={2}>No runs found</Title>
            <Text className="mt-xs">
              {filters.q || filters.source || filters.status
                ? "No runs match these filters."
                : "SPT result folders will appear here after a run."}
            </Text>
          </div>
        )}
        <Text size="caption" className="px-comfortable pb-md">
          {data ? `${runs.length} shown of ${data.total} found.` : ""} Malformed
          or partial folders are listed with what is missing.
        </Text>
      </Paper>
    </>
  );
}

function CatalogRow({
  run,
  checked,
  full,
  isBaseline,
  open,
  previous,
  onToggle,
  onBaseline,
  onOpen,
  onComparePrevious,
}: {
  run: CatalogRun;
  checked: boolean;
  full: boolean;
  isBaseline: boolean;
  open: boolean;
  previous: CatalogRun | null;
  onToggle: () => void;
  onBaseline: () => void;
  onOpen: () => void;
  onComparePrevious: (prevId: string) => void;
}) {
  return (
    <>
      <Table.Tr
        bg={
          run.status === "malformed"
            ? "var(--spt-status-warning-background)"
            : undefined
        }
      >
        <Table.Td ta="center">
          <Checkbox
            className="inline-flex"
            aria-label={`Compare ${run.id}`}
            checked={checked}
            disabled={!checked && (full || run.status === "malformed")}
            onChange={onToggle}
          />
        </Table.Td>
        <Table.Td ta="center">
          <Radio
            className="inline-flex"
            name="baseline"
            aria-label={`Use ${run.id} as baseline`}
            checked={isBaseline}
            disabled={!checked}
            onChange={onBaseline}
          />
        </Table.Td>
        <Table.Td
          ff="monospace"
          fz="caption"
          className="min-w-45 max-w-75 whitespace-normal wrap-anywhere"
        >
          {run.id}
          <Text
            component="small"
            size="caption"
            c="var(--spt-text-muted)"
            lh="normal"
            className="mt-0.75 block"
          >
            {run.source === "dashboard" ? "Dashboard" : "CLI"}
            {run.label ? ` · ${run.label}` : ""}
          </Text>
        </Table.Td>
        <Table.Td>
          {run.started_at
            ? run.started_at
                .replace("T", " ")
                .replace(/\.\d+/, "")
                .replace("Z", "")
            : "—"}
        </Table.Td>
        <Table.Td className="min-w-40 whitespace-normal">
          {runSettings(run)}
        </Table.Td>
        <Table.Td>
          <Status status={run.status} />
          <Text
            component="small"
            size="caption"
            c="var(--spt-text-muted)"
            lh="normal"
            className="mt-0.75 block"
          >
            {integrityText[run.integrity]}
          </Text>
        </Table.Td>
        <Table.Td>
          {run.phases.length ? (
            run.phases.map((p) => (
              <Text
                component="span"
                size="caption"
                c="var(--spt-text-secondary)"
                lh="normal"
                className="my-0.75 mr-compact inline-block"
                key={p.key}
              >
                {p.key} {fmt(p.iops, 1)}
              </Text>
            ))
          ) : (
            <Text
              component="span"
              size="xs"
              c="var(--spt-text-subtle)"
              lh="normal"
            >
              No phase totals
            </Text>
          )}
        </Table.Td>
        <Table.Td>
          <div className="flex flex-col items-stretch gap-[0.35rem]">
            <Button
              className="whitespace-nowrap"
              aria-expanded={open}
              onClick={onOpen}
            >
              {open ? "Hide" : "Details"}
            </Button>
            {run.status === "complete" && previous && (
              <Button
                className="whitespace-nowrap"
                type="button"
                title={`Compare with ${previous.name || previous.id}`}
                onClick={() => onComparePrevious(previous.id)}
              >
                Compare with previous
              </Button>
            )}
          </div>
        </Table.Td>
      </Table.Tr>
      {open && (
        <Table.Tr>
          <Table.Td
            bg="var(--spt-surface-subtle)"
            p="md"
            className="whitespace-normal wrap-anywhere"
            colSpan={8}
          >
            {run.issues.length > 0 && (
              <ul className="mx-0 mt-0 mb-sm text-[#9a4b16] text-sm/[inherit]">
                {run.issues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            )}
            <dl className="grid grid-cols-2 gap-lg max-[47.5rem]:grid-cols-1">
              <div>
                <dt className="text-muted text-caption/[inherit] mb-1.75">
                  Endpoint host
                </dt>
                <dd className="m-0 text-control/[inherit] font-semibold wrap-anywhere">
                  {run.endpoint_host ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted text-caption/[inherit] mb-1.75">
                  S3 driver
                </dt>
                <dd className="m-0 text-control/[inherit] font-semibold wrap-anywhere">
                  {run.s3_driver ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted text-caption/[inherit] mb-1.75">
                  CLI / engine
                </dt>
                <dd className="m-0 text-control/[inherit] font-semibold wrap-anywhere">
                  {run.cli_version ?? "—"} / {run.engine_version ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted text-caption/[inherit] mb-1.75">
                  Summary file
                </dt>
                <dd className="m-0 text-control/[inherit] font-semibold wrap-anywhere">
                  {run.summary_file ?? "—"}
                </dd>
              </div>
            </dl>
            {run.phases.length > 0 && (
              <Table.ScrollContainer
                minWidth="var(--spt-table-min-width)"
                aria-label="Catalog phase details scroll area"
              >
                <Table aria-label="Catalog phase details" stickyHeader>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th scope="col">Phase</Table.Th>
                      <Table.Th scope="col" ta="right">
                        Successful
                      </Table.Th>
                      <Table.Th scope="col" ta="right">
                        Failed
                      </Table.Th>
                      <Table.Th scope="col" ta="right">
                        Corrupt
                      </Table.Th>
                      <Table.Th scope="col" ta="right">
                        IOPS
                      </Table.Th>
                      <Table.Th scope="col" ta="right">
                        MiB/s
                      </Table.Th>
                      <Table.Th scope="col" ta="right">
                        P50 µs
                      </Table.Th>
                      <Table.Th scope="col" ta="right">
                        P99 µs
                      </Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {run.phases.map((p) => (
                      <Table.Tr key={p.key}>
                        <Table.Td>{p.key}</Table.Td>
                        <Table.Td ta="right">{fmt(p.successful_ops)}</Table.Td>
                        <Table.Td ta="right">{fmt(p.failed_ops)}</Table.Td>
                        <Table.Td ta="right">{fmt(p.corrupt_ops)}</Table.Td>
                        <Table.Td ta="right">{fmt(p.iops, 2)}</Table.Td>
                        <Table.Td ta="right">
                          {fmt(p.bandwidth_mib_s, 2)}
                        </Table.Td>
                        <Table.Td ta="right">
                          {fmt(p.p50_latency_us, 1)}
                        </Table.Td>
                        <Table.Td ta="right">
                          {fmt(p.p99_latency_us, 1)}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
            <RunArtifacts key={run.id} runId={run.id} />
            {run.status !== "malformed" && (
              <RunLog
                base={`/api/catalog/log?id=${encodeURIComponent(run.id)}`}
                title="Engine logs"
              />
            )}
          </Table.Td>
        </Table.Tr>
      )}
    </>
  );
}

function RunArtifacts({ runId }: { runId: string }) {
  const artifacts = useArtifacts(runId);
  const items = artifacts.data?.artifacts;
  const error = artifacts.error?.message ?? "";
  return (
    <section className="mt-lg" aria-label="Run artifacts">
      <Title order={3} size="md" className="mb-1.25">
        Artifacts
      </Title>
      <Text size="sm" className="my-comfortable">
        CSV, XML, and log files SPT left in this run folder. Only files the
        dashboard recognizes are listed.
      </Text>
      {error && (
        <Alert color="red" role="alert">
          {error}
        </Alert>
      )}
      {items === undefined && !error ? (
        <Text size="xs" c="var(--spt-text-subtle)">
          Loading artifacts…
        </Text>
      ) : items && items.length === 0 ? (
        <div className="px-0 py-sm text-center">
          <Title order={4} size="md">
            No downloadable artifacts
          </Title>
          <Text className="mt-xs">
            This run folder has no CSV, XML, or log files the dashboard can
            offer. Engine log text may also be unavailable for the same reason.
          </Text>
        </div>
      ) : (
        <ul className="mx-0 p-0 list-none mt-sm mb-0 grid gap-[0.65rem]">
          {(items ?? []).map((a) => (
            <li
              className="flex flex-wrap items-center gap-y-xs gap-x-md"
              key={a.name}
            >
              <Button
                component="a"
                href={`/api/catalog/artifact?id=${encodeURIComponent(runId)}&file=${encodeURIComponent(a.name)}`}
                download={a.name}
              >
                Download {a.type}
              </Button>
              <span className="flex flex-wrap gap-y-xs gap-x-sm items-baseline">
                <span className="px-[0.4rem] py-[0.1rem] text-sm/[inherit] font-semibold tracking-[0.04em] rounded-[0.25rem] bg-[#e8eef9] text-[#1e3a8a]">
                  {a.kind.toUpperCase()}
                </span>
                <span className="text-subtle text-xs/[inherit]">{a.name}</span>
                <span className="text-subtle text-xs/[inherit]">
                  {formatBytes(a.size)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
}
