import { Badge, Box, SegmentedControl, Text } from "@mantine/core";
import type { RunMode, State } from "../../types";

export function AppHeader({
  state,
  error,
  mode,
  onModeChange,
}: {
  state: State | null;
  error: string;
  mode: RunMode;
  onModeChange: (mode: RunMode) => void;
}) {
  return (
    <Box
      component="header"
      bg="#ffffffc9"
      className="flex h-19 items-center justify-between border-b-[0.0625rem] border-divider px-xxl max-[71.875rem]:px-section max-[47.5rem]:h-auto max-[47.5rem]:min-h-19 max-[47.5rem]:flex-wrap max-[47.5rem]:gap-xs max-[47.5rem]:p-md"
    >
      <Text component="span" size="sm" c="var(--spt-text-muted)" lh="normal">
        Benchmark workspace
      </Text>
      <div className="flex items-center gap-lg max-[47.5rem]:gap-compact">
        <Badge
          color={error ? "yellow" : "spt"}
          c={
            error
              ? "var(--spt-status-warning-text)"
              : "var(--mantine-color-spt-7)"
          }
          fz="xxs"
          tt="uppercase"
          lh="normal"
          px="xs"
          styles={{
            root: {
              paddingBlock: "0.3125rem",
              borderColor: error
                ? "var(--spt-status-warning-border)"
                : "var(--mantine-color-spt-2)",
              letterSpacing: "0.05rem",
            },
          }}
        >
          {error
            ? "OFFLINE"
            : state?.connection?.mode === "attached"
              ? "ATTACHED · READ ONLY"
              : state
                ? "SPT API"
                : "CONNECTING"}
        </Badge>
        <SegmentedControl<RunMode>
          aria-label="Display mode"
          name="display-mode"
          value={mode}
          data={[
            { value: "guided", label: "Guided" },
            { value: "expert", label: "Expert" },
          ]}
          onChange={onModeChange}
        />
      </div>
    </Box>
  );
}
