import { Alert, Paper, Text, Title } from "@mantine/core";
import type { DeleteDetail } from "../../types";
import { formatNumber as fmt } from "../../utils/metrics";

export function DeleteOutcome({
  detail,
  error,
  pending = false,
}: {
  detail?: DeleteDetail;
  error?: string;
  pending?: boolean;
}) {
  if (!detail)
    return (
      <Alert role="note">
        {error ??
          (pending
            ? "Waiting for DELETE object outcomes. Accepted requests alone do not confirm object removal."
            : "DELETE object outcomes are unavailable. Accepted requests alone do not confirm object removal.")}
      </Alert>
    );
  const labels: Record<string, string> = {
    running: "Deletion in progress",
    completed_cleanly: "Deletion completed cleanly",
    completed_within_failure_budget: "Deletion completed within failure budget",
    failed: "Deletion failed",
  };
  return (
    <Paper component="section" className="mb-panel p-panel">
      <Title order={2}>
        {labels[detail.failure_policy.outcome] ?? "Delete outcomes"}
      </Title>
      <Text size="sm">
        Requests: {fmt(detail.requests.full_success)} fully successful,{" "}
        {fmt(detail.requests.partial)} partial, {fmt(detail.requests.failed)}{" "}
        failed.
      </Text>
      <Text size="sm">
        Objects: {fmt(detail.objects.selected)} selected,{" "}
        {fmt(detail.objects.accepted)} accepted, {fmt(detail.objects.failed)}{" "}
        failed, {fmt(detail.objects.unattempted)} unattempted,{" "}
        {fmt(detail.objects.unresolved)} unresolved.
      </Text>
      <Text size="sm">
        {detail.verification.removal_confirmed
          ? `Removal confirmed for ${fmt(detail.verification.verified_absent)} objects.`
          : "Accepted DELETE outcomes do not establish confirmed removal."}
      </Text>
      {detail.verification.notice && (
        <Text size="sm">{detail.verification.notice}</Text>
      )}
    </Paper>
  );
}
