import type { NodeRow } from "../types";
import { formatNumber as fmt } from "../utils/metrics";

/** Per-client-machine live metrics, read from each node's own SPT API. */
export function NodeTable({ nodes }: { nodes: NodeRow[] }) {
  if (!nodes.length) return null;
  return (
    <section
      data-spt-legacy=""
      className="panel run-history-panel"
      aria-label="Client machines"
    >
      <h2 data-spt-legacy="">Client machines</h2>
      <div data-spt-legacy="" className="table-wrap">
        <table data-spt-legacy="" className="run-history-table node-table">
          <thead data-spt-legacy="">
            <tr data-spt-legacy="">
              <th data-spt-legacy="">Host</th>
              <th data-spt-legacy="">Status</th>
              <th data-spt-legacy="">Phase</th>
              <th data-spt-legacy="">Successful</th>
              <th data-spt-legacy="">Failed</th>
              <th data-spt-legacy="">IOPS</th>
              <th data-spt-legacy="">MiB/s</th>
              <th data-spt-legacy="">P50 µs</th>
              <th data-spt-legacy="">P99 µs</th>
            </tr>
          </thead>
          <tbody data-spt-legacy="">
            {nodes.map((n) => (
              <tr data-spt-legacy="" key={n.host + (n.node_id ?? "")}>
                <td data-spt-legacy="" className="history-run-id">
                  {n.host}
                  {n.node_id && <small data-spt-legacy="">{n.node_id}</small>}
                </td>
                <td data-spt-legacy="">
                  {n.status === "reporting" ? "Reporting" : "Unavailable"}
                </td>
                <td data-spt-legacy="">{n.op_type || "—"}</td>
                <td data-spt-legacy="">{fmt(n.successful_ops)}</td>
                <td data-spt-legacy="">{fmt(n.failed_ops)}</td>
                <td data-spt-legacy="">{fmt(n.iops, 1)}</td>
                <td data-spt-legacy="">{fmt(n.bandwidth_mib_s, 2)}</td>
                <td data-spt-legacy="">{fmt(n.p50_latency_us, 1)}</td>
                <td data-spt-legacy="">{fmt(n.p99_latency_us, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p data-spt-legacy="" className="history-footnote">
        Live values from each machine’s SPT API. A machine shows as unavailable
        when its API cannot be reached; that does not by itself mean its run
        failed.
      </p>
    </section>
  );
}
