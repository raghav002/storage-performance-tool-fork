import { Text } from "@mantine/core";
import type { DeleteOptions } from "../../types";

export function DeleteReview({ options: x }: { options: DeleteOptions }) {
  const post = x.verify ?? x.validate_inventory;
  return (
    <div className="grid gap-sm">
      <Text size="sm">
        Creates its own test objects, then measures deletion. Existing data is
        not selected. This run ends after its finite inventory; no runtime limit
        is applied.
      </Text>
      <Text size="sm">
        Objects per request: {x.batch_size}. Pre-validation:{" "}
        {x.validate_inventory ? "on" : "off"}. Post-verification:{" "}
        {post ? "on" : "off"}. Verification timeout:{" "}
        {x.verification_timeout_seconds}s per enabled check.
      </Text>
      <Text size="sm">
        Failure budget:{" "}
        {x.max_failure_percent !== undefined
          ? `${x.max_failure_percent}%`
          : `${x.max_failed_objects} objects`}
        {x.max_failure_percent !== undefined && x.max_failure_percent > 0
          ? `; grace ${x.failure_budget_grace_seconds ?? 30}s`
          : ""}
        . Residual cleanup: {x.cleanup ? "on" : "off"}.
      </Text>
      {!post && (
        <Text size="sm">
          Accepted DELETE requests do not confirm object removal.
        </Text>
      )}
    </div>
  );
}
