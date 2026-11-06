import { Text } from "@mantine/core";
import type { State } from "../../types";
import { utc } from "../../utils/metrics";

export function AppFooter({
  state,
  received,
}: {
  state: State | null;
  received: string;
}) {
  return (
    <Text
      component="footer"
      size="xs"
      c="var(--spt-text-subtle)"
      lh="normal"
      ta="center"
      className="mx-auto max-w-387.5 px-xxl pb-6.25 max-[71.875rem]:px-section max-[47.5rem]:px-md max-[47.5rem]:pb-lg"
    >
      {state?.branding?.product_name ?? "Storage Performance Tool"} ·{" "}
      {received
        ? `State received ${utc(received)}`
        : "Waiting for server state"}{" "}
      · Refreshes every 2 seconds
    </Text>
  );
}
