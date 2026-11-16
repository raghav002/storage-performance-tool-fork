import { Alert, Button, Text, Title } from "@mantine/core";
import { useArtifacts } from "../../api/queries";

export function RunArtifacts({ runId }: { runId: string }) {
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
