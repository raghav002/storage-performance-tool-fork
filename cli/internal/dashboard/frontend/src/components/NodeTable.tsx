import { Paper, Table, Text, Title } from "@mantine/core";
import type { NodeRow } from "../types";
import { formatNumber as fmt } from "../utils/metrics";

/** Per-client-machine live metrics, read from each node's own SPT API. */
export function NodeTable({ nodes }: { nodes: NodeRow[] }) {
  if (!nodes.length) return null;
  return (
    <Paper
      component="section"
      className="mb-panel"
      aria-label="Client machines"
    >
      <Title order={2}>Client machines</Title>
      <Table.ScrollContainer
        minWidth="var(--spt-table-min-width)"
        aria-label="Client machine metrics scroll area"
      >
        <Table aria-label="Client machine metrics" stickyHeader>
          <Table.Thead>
            <Table.Tr>
              <Table.Th scope="col">Host</Table.Th>
              <Table.Th scope="col">Status</Table.Th>
              <Table.Th scope="col">Phase</Table.Th>
              <Table.Th scope="col" ta="right">
                Successful
              </Table.Th>
              <Table.Th scope="col" ta="right">
                Failed
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
            {nodes.map((n) => (
              <Table.Tr key={n.host + (n.node_id ?? "")}>
                <Table.Td ff="monospace" fz="caption">
                  {n.host}
                  {n.node_id && (
                    <Text
                      component="small"
                      size="xxs"
                      c="var(--spt-text-muted)"
                      lh="normal"
                      className="mt-[5px] block"
                    >
                      {n.node_id}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  {n.status === "reporting" ? "Reporting" : "Unavailable"}
                </Table.Td>
                <Table.Td>{n.op_type || "—"}</Table.Td>
                <Table.Td ta="right">{fmt(n.successful_ops)}</Table.Td>
                <Table.Td ta="right">{fmt(n.failed_ops)}</Table.Td>
                <Table.Td ta="right">{fmt(n.iops, 1)}</Table.Td>
                <Table.Td ta="right">{fmt(n.bandwidth_mib_s, 2)}</Table.Td>
                <Table.Td ta="right">{fmt(n.p50_latency_us, 1)}</Table.Td>
                <Table.Td ta="right">{fmt(n.p99_latency_us, 1)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <Text size="caption" className="px-comfortable pb-md">
        Live values from each machine’s SPT API. A machine shows as unavailable
        when its API cannot be reached; that does not by itself mean its run
        failed.
      </Text>
    </Paper>
  );
}
