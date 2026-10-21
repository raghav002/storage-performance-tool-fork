import type { HistoryRun } from "../types";
import { Status } from "./Status";
import { formatNumber as fmt, phaseName } from "../utils/metrics";

export function RunHistory({
  runs,
  loading,
  error,
  onOpen,
  onRefresh,
}: {
  runs: HistoryRun[];
  loading: boolean;
  error: string;
  onOpen: (runID: string) => void;
  onRefresh: () => void;
}) {
  const localTime = (value?: string) => {
    const date = new Date(value ?? "");
    return Number.isNaN(date.getTime())
      ? "Time unavailable"
      : new Intl.DateTimeFormat(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(date);
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">SAVED BENCHMARKS</span>
          <h1>Run history</h1>
          <p>SPT result folders saved on the project VM.</p>
        </div>
        <div className="actions">
          <button onClick={onRefresh} disabled={loading}>
            Refresh history
          </button>
        </div>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <section className="panel run-history-panel">
        {loading && !runs.length ? (
          <p className="history-empty">Loading saved runs…</p>
        ) : runs.length ? (
          <div className="table-wrap">
            <table className="run-history-table">
              <thead>
                <tr>
                  <th>Started · local time</th>
                  <th>Run</th>
                  <th>Workload settings</th>
                  <th>Status</th>
                  <th>Phase results · successful / failed</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.run_id}>
                    <td>{localTime(run.started_at)}</td>
                    <td className="history-run-id">{run.run_id}</td>
                    <td>
                      {run.options?.object_count ?? "—"} ×{" "}
                      {run.options?.object_size ?? "—"}
                      <small>{run.options?.threads ?? "—"} thread(s)</small>
                    </td>
                    <td>
                      <Status status={run.status} />
                    </td>
                    <td>
                      {run.phase_summaries.length ? (
                        run.phase_summaries.map((phase) => (
                          <span className="history-phase" key={phase.phase}>
                            {phaseName(phase.phase)} {fmt(phase.successful_ops)}
                            /{fmt(phase.failed_ops)}
                          </span>
                        ))
                      ) : (
                        <span className="subtle">No phase totals saved</span>
                      )}
                    </td>
                    <td>
                      <button onClick={() => onOpen(run.run_id)}>
                        View results
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="history-empty">
            <h2>No saved benchmark runs</h2>
            <p>Completed and partial SPT results will appear here.</p>
          </div>
        )}
        <p className="history-footnote">
          Times are shown in this computer’s local time. Older runs may have
          partial results if SPT stopped before writing its final summaries.
        </p>
      </section>
    </>
  );
}
