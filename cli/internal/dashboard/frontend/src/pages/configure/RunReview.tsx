import { Button, Code, Text, Title } from "@mantine/core";
import type { Driver, Options, RunMode } from "../../types";
import { formatNumber as fmt } from "../../utils/metrics";
import { expertCommand, type ExpertDraft } from "./configuration";

export function RunReview({
  config,
  driver,
  mode,
  clients,
  totalBytes,
  draft,
  busy,
  ready,
  onEdit,
  onStart,
}: {
  config: Options;
  driver: Driver;
  mode: RunMode;
  clients: number;
  totalBytes: number;
  draft: ExpertDraft;
  busy: boolean;
  ready: boolean;
  onEdit: () => void;
  onStart: () => void;
}) {
  return (
    <>
      <div className="p-lg bg-surface-review rounded-md mb-lg">
        <Title order={2}>
          {driver === "mock" ? "Mock driver" : "Write + verify"} ·{" "}
          {mode === "expert" ? "Expert" : "Guided"} · {clients} client machine
          {clients === 1 ? "" : "s"}
        </Title>
        <dl className="grid grid-cols-2 gap-lg max-[47.5rem]:grid-cols-1">
          <div>
            <dt className="text-muted text-caption/[inherit] mb-1.75">
              Maximum objects
            </dt>
            <dd className="m-0 text-control/[inherit] font-semibold wrap-anywhere">
              {config.object_count}
            </dd>
          </div>
          <div>
            <dt className="text-muted text-caption/[inherit] mb-1.75">
              Object size
            </dt>
            <dd className="m-0 text-control/[inherit] font-semibold wrap-anywhere">
              {config.object_size}
            </dd>
          </div>
          <div>
            <dt className="text-muted text-caption/[inherit] mb-1.75">
              Parallel threads
            </dt>
            <dd className="m-0 text-control/[inherit] font-semibold wrap-anywhere">
              {config.threads}
            </dd>
          </div>
          <div>
            <dt className="text-muted text-caption/[inherit] mb-1.75">
              Safety time limit
            </dt>
            <dd className="m-0 text-control/[inherit] font-semibold wrap-anywhere">
              {config.max_runtime_seconds}s
            </dd>
          </div>
        </dl>
        {driver === "mock" ? (
          <Text size="sm" className="mt-xs">
            Mock run: no data is written to S3. Results show SPT's mock driver,
            not storage performance.
          </Text>
        ) : (
          <Text size="sm" className="mt-xs">
            Up to {fmt(totalBytes / 1048576, 2)} MiB of test data. A unique
            prefix isolates this run. Cleanup is best effort.
          </Text>
        )}
        {mode === "expert" && (
          <div className="mt-3.5">
            <strong className="text-sm/[inherit]">CLI settings preview</strong>
            <Code
              block
              className="whitespace-pre-wrap wrap-anywhere"
              p="sm"
              fz="xs"
            >
              {expertCommand(draft, driver)}
            </Code>
            <small className="font-normal text-[#738198] text-xs/[inherit]">
              The server generates the complete command and validates all
              options.
            </small>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-compact">
        <Button disabled={busy} onClick={onEdit}>
          Edit settings
        </Button>
        <Button
          variant="filled"
          loading={busy}
          disabled={busy || !ready}
          onClick={onStart}
        >
          {busy ? "Starting…" : "Start run"}
        </Button>
      </div>
      <Text size="sm" className="my-comfortable">
        {driver === "mock"
          ? "Starting runs SPT with the mock driver on the verified client machines."
          : "Starting runs a real benchmark on the configured storage target."}
      </Text>
    </>
  );
}
