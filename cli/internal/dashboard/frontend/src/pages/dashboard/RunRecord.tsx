import { Accordion } from "@mantine/core";
import type { State } from "../../types";
import { elapsed, formatNumber as fmt, utc } from "../../utils/metrics";

export function RunRecord({
  job,
  metrics,
}: {
  job: State["job"] | undefined;
  metrics: State["metrics"] | undefined;
}) {
  return (
    <Accordion mb="panel">
      <Accordion.Item value="section">
        <Accordion.Control>Run record and settings</Accordion.Control>
        <Accordion.Panel>
          <div className="mx-0 my-panel flex flex-wrap gap-panel text-caption/[inherit] text-muted">
            <span>Started: {utc(job?.started_at)}</span>
            <span>Finished: {utc(job?.finished_at)}</span>
            <span>Exit code: {fmt(job?.returncode)}</span>
          </div>
          <dl className="grid grid-cols-2 gap-lg max-[47.5rem]:grid-cols-1">
            <div>
              <dt className="text-muted text-caption/[inherit] mb-1.75">
                Objects
              </dt>
              <dd className="m-0 text-control/[inherit] font-semibold wrap-anywhere">
                {fmt(job?.options?.object_count)}
              </dd>
            </div>
            <div>
              <dt className="text-muted text-caption/[inherit] mb-1.75">
                Object size
              </dt>
              <dd className="m-0 text-control/[inherit] font-semibold wrap-anywhere">
                {job?.options?.object_size ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted text-caption/[inherit] mb-1.75">
                Threads
              </dt>
              <dd className="m-0 text-control/[inherit] font-semibold wrap-anywhere">
                {fmt(job?.options?.threads)}
              </dd>
            </div>
            <div>
              <dt className="text-muted text-caption/[inherit] mb-1.75">
                Safety time limit
              </dt>
              <dd className="m-0 text-control/[inherit] font-semibold wrap-anywhere">
                {elapsed(job?.options?.max_runtime_seconds)}
              </dd>
            </div>
            <div>
              <dt className="text-muted text-caption/[inherit] mb-1.75">
                Run prefix
              </dt>
              <dd className="m-0 text-control/[inherit] font-semibold wrap-anywhere">
                {job?.prefix ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted text-caption/[inherit] mb-1.75">
                Source
              </dt>
              <dd className="m-0 text-control/[inherit] font-semibold wrap-anywhere">
                {metrics?.source_file ?? "—"}
              </dd>
            </div>
          </dl>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
