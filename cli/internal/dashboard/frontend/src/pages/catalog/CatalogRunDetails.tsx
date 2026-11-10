import { Table } from "@mantine/core";
import type { CatalogRun } from "../../types";
import { RunLog } from "../../components/RunLog";
import { formatNumber as fmt } from "../../utils/metrics";
import { RunArtifacts } from "./RunArtifacts";

export function CatalogRunDetails({ run }: { run: CatalogRun }) {
  return (
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
                    <Table.Td ta="right">{fmt(p.bandwidth_mib_s, 2)}</Table.Td>
                    <Table.Td ta="right">{fmt(p.p50_latency_us, 1)}</Table.Td>
                    <Table.Td ta="right">{fmt(p.p99_latency_us, 1)}</Table.Td>
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
  );
}
