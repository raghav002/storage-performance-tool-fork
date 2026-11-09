import {
  Accordion,
  Button,
  Code,
  Paper,
  Table,
  Text,
  Title,
} from "@mantine/core";
import type { Metrics, Row } from "../types";
import {
  elapsed,
  formatNumber as fmt,
  phaseCode,
  phaseName,
  utc,
} from "../utils/metrics";

export function PhaseResults({
  metrics: m,
  onSelect,
}: {
  metrics: Metrics;
  onSelect: (phase: string) => void;
}) {
  return (
    <Paper
      component="section"
      className="mb-panel p-panel max-[47.5rem]:p-4.25"
    >
      <div className="flex justify-between items-center gap-3.75 mb-comfortable max-[47.5rem]:items-start">
        <div>
          <Title order={2}>Phase results</Title>
          <Text size="caption" className="mt-1.25 max-[47.5rem]:max-w-62.5">
            Each phase has its own counters and timing.
          </Text>
        </div>
      </div>
      {m.phase_summaries?.length ? (
        <Table.ScrollContainer
          minWidth={0}
          aria-label="Phase results scroll area"
        >
          <Table aria-label="Phase results" verticalSpacing="md">
            <Table.Thead>
              <Table.Tr>
                {[
                  "Phase",
                  "Successful",
                  "Failed",
                  "Corrupt",
                  "Duration",
                  "IOPS",
                  "MiB/s",
                  "P50 (µs)",
                ].map((h, index) => (
                  <Table.Th
                    key={h}
                    scope="col"
                    ta={index === 0 ? "left" : "right"}
                  >
                    {h}
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {m.phase_summaries.map((r) => (
                <Table.Tr key={r.phase}>
                  <Table.Td>
                    <Button
                      variant="subtle"
                      size="compact-xs"
                      onClick={() => onSelect(phaseCode(r.phase))}
                    >
                      {phaseName(r.phase)}
                    </Button>
                  </Table.Td>
                  <Table.Td ta="right">{fmt(r.successful_ops)}</Table.Td>
                  <Table.Td ta="right">{fmt(r.failed_ops)}</Table.Td>
                  <Table.Td ta="right">{fmt(r.corrupt_ops)}</Table.Td>
                  <Table.Td ta="right">{elapsed(r.duration_seconds)}</Table.Td>
                  <Table.Td ta="right">{fmt(r.iops, 2)}</Table.Td>
                  <Table.Td ta="right">{fmt(r.bandwidth_mib_s, 2)}</Table.Td>
                  <Table.Td ta="right">{fmt(r.p50_latency_us, 1)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      ) : (
        <Text size="sm" className="my-comfortable">
          Final phase results will appear as SPT writes its output.
        </Text>
      )}
    </Paper>
  );
}

export function MeasuredDetails({
  row,
  phase,
  metrics: m,
}: {
  row?: Row;
  phase: string;
  metrics: Metrics;
}) {
  const groups: { title: string; values: [string, string][] }[] = [
    {
      title: "Counts and data",
      values: [
        ["Successful operations", fmt(row?.cumulative_ops)],
        ["Failed operations", fmt(row?.count_failed)],
        ["Corrupt operations", fmt(row?.corrupt_ops)],
        ["Bytes processed", fmt(row?.bytes_processed)],
        ["Phase duration", elapsed(row?.duration_seconds)],
        ["Average IOPS", fmt(row?.average_iops ?? row?.iops, 2)],
      ],
    },
    {
      title: "Latency · µs",
      values: [
        ["P50", fmt(row?.p50_latency_us, 1)],
        ["P99", fmt(row?.latency_p99_us, 1)],
        ["Mean", fmt(row?.latency_mean_us, 1)],
        ["Minimum", fmt(row?.latency_min_us, 1)],
        ["Maximum", fmt(row?.latency_max_us, 1)],
      ],
    },
    {
      title: "Execution",
      values: [
        ["Concurrency", fmt(row?.concurrency)],
        ["Mean concurrency", fmt(row?.concurrency_mean, 2)],
        ["Nodes", fmt(row?.node_count)],
        ["Step", row?.step_id ?? "—"],
        ["Measurement time", utc(row?.timestamp)],
      ],
    },
  ];
  // The sample lists can run to megabytes; the CSV export below carries them.
  const { samples, chart_samples, ...metadata } = m;
  const raw = {
    ...metadata,
    sample_count: (chart_samples ?? samples ?? []).length,
  };
  return (
    <Accordion mb="panel">
      <Accordion.Item value="section">
        <Accordion.Control>
          SPT measured details{" "}
          <span className="text-xs/[inherit] font-normal ml-sm text-muted max-[47.5rem]:block max-[47.5rem]:mt-xs max-[47.5rem]:mr-0 max-[47.5rem]:mb-0 max-[47.5rem]:ml-md">
            {phaseName(phase)} phase
          </span>
        </Accordion.Control>
        <Accordion.Panel>
          <Text size="sm" className="my-comfortable">
            All fields available from the dashboard API are retained below. A
            dash means SPT did not report a value.
          </Text>
          {m.spt_summary_report && (
            <Accordion mt="panel">
              <Accordion.Item value="section">
                <Accordion.Control>SPT run summary</Accordion.Control>
                <Accordion.Panel>
                  <Code block>{m.spt_summary_report}</Code>
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>
          )}
          <div className="grid grid-cols-3 gap-comfortable max-[71.875rem]:grid-cols-2 max-[47.5rem]:grid-cols-1">
            {groups.map((g) => (
              <section className="p-md bg-[#f8fafc] rounded-md" key={g.title}>
                <Title order={3}>{g.title}</Title>
                <dl className="mb-0">
                  {g.values.map(([name, value]) => (
                    <div
                      className="px-0 py-1.75 flex justify-between gap-compact border-b-[0.0625rem] border-b-[#e8edf4] text-caption/[inherit]"
                      key={name}
                    >
                      <dt className="text-[#748399] max-w-[60%]">{name}</dt>
                      <dd className="m-0 text-right wrap-anywhere max-w-[62%] tabular-nums">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
          <Accordion mt="panel">
            <Accordion.Item value="section">
              <Accordion.Control>
                Source measurements and metadata
              </Accordion.Control>
              <Accordion.Panel>
                <div className="flex flex-wrap items-center gap-compact">
                  <Button
                    component="a"
                    href={`/api/runs/${encodeURIComponent(m.run_id)}/csv?kind=samples`}
                    download
                  >
                    Export all samples CSV
                  </Button>
                </div>
                <Code block>{JSON.stringify(raw, null, 2)}</Code>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
