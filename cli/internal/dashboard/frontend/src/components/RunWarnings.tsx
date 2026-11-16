import { Alert, Badge, Paper, Text, Title } from "@mantine/core";
import type { RunWarning } from "../types";

/** Live observations about unreliable telemetry. Text is what was observed only. */
export function RunWarnings({ warnings }: { warnings?: RunWarning[] }) {
  if (!warnings?.length) return null;
  return (
    <Alert
      component="section"
      color="yellow"
      aria-label="Run warnings"
      className="mb-panel"
      title={
        <Title order={2} size="lg">
          Run warnings
        </Title>
      }
    >
      <Text size="sm">
        Observations from SPT metrics and reachability. These describe what was
        seen; they do not claim a root cause.
      </Text>
      <ul className="m-0 mt-md grid list-none gap-sm p-0">
        {warnings.map((warning, index) => (
          <Paper
            component="li"
            key={`${warning.code}-${warning.host ?? ""}-${warning.metric ?? ""}-${index}`}
            p="sm"
            radius="md"
          >
            <div className="flex flex-wrap items-center gap-xs">
              <Text
                component="strong"
                size="sm"
                fw="var(--mantine-font-weight-semibold)"
              >
                {label(warning.code)}
              </Text>
              {warning.host && (
                <Badge
                  color="yellow"
                  variant="light"
                  tt="none"
                  className="max-w-full"
                  title={warning.host}
                >
                  {warning.host}
                </Badge>
              )}
              {warning.metric && (
                <Badge
                  color="yellow"
                  variant="light"
                  tt="none"
                  className="max-w-full"
                  title={warning.metric}
                >
                  {warning.metric}
                </Badge>
              )}
            </div>
            <Text size="sm" className="mt-xs wrap-anywhere">
              {warning.observed}
            </Text>
          </Paper>
        ))}
      </ul>
    </Alert>
  );
}

function label(code: string): string {
  switch (code) {
    case "fleet_partial":
      return "Incomplete fleet aggregate";
    case "node_no_data":
      return "Client metrics unavailable";
    case "sample_delayed":
      return "Delayed telemetry";
    case "metrics_gap":
      return "Telemetry gap";
    case "failed_operations":
      return "Failed operations reported";
    default:
      return code.replaceAll("_", " ");
  }
}
