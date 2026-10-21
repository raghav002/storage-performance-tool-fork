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
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>Phase results</h2>
          <p>Each phase has its own counters and timing.</p>
        </div>
      </div>
      {m.phase_summaries?.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {[
                  "Phase",
                  "Successful",
                  "Failed",
                  "Corrupt",
                  "Duration",
                  "IOPS",
                  "MiB/s",
                  "P50 (µs)",
                ].map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {m.phase_summaries.map((r) => (
                <tr key={r.phase}>
                  <td>
                    <button
                      className="table-link"
                      onClick={() => onSelect(phaseCode(r.phase))}
                    >
                      {phaseName(r.phase)}
                    </button>
                  </td>
                  <td>{fmt(r.successful_ops)}</td>
                  <td>{fmt(r.failed_ops)}</td>
                  <td>{fmt(r.corrupt_ops)}</td>
                  <td>{elapsed(r.duration_seconds)}</td>
                  <td>{fmt(r.iops, 2)}</td>
                  <td>{fmt(r.bandwidth_mib_s, 2)}</td>
                  <td>{fmt(r.p50_latency_us, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="form-help">
          Final phase results will appear as SPT writes its output.
        </p>
      )}
    </section>
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
    <details className="panel">
      <summary>
        SPT measured details{" "}
        <span className="summary-note">{phaseName(phase)} phase</span>
      </summary>
      <p className="form-help">
        All fields available from the dashboard API are retained below. A dash
        means SPT did not report a value.
      </p>
      {m.spt_summary_report && (
        <details className="raw-details">
          <summary>SPT run summary</summary>
          <pre>{m.spt_summary_report}</pre>
        </details>
      )}
      <div className="guided-core-grid">
        {groups.map((g) => (
          <section className="timing" key={g.title}>
            <h3>{g.title}</h3>
            <dl>
              {g.values.map(([name, value]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <details className="raw-details">
        <summary>Source measurements and metadata</summary>
        <div className="actions">
          <a
            className="button-link"
            href={`/api/runs/${encodeURIComponent(m.run_id)}/csv?kind=samples`}
            download
          >
            Export all samples CSV
          </a>
        </div>
        <pre>{JSON.stringify(raw, null, 2)}</pre>
      </details>
    </details>
  );
}
