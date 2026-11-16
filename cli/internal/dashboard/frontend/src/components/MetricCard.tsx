import { Box, Paper, Text } from "@mantine/core";

const accentColors: Record<string, string> = {
  blue: "var(--spt-chart-throughput)",
  teal: "var(--spt-chart-bandwidth)",
  purple: "var(--spt-chart-latency-p50)",
  orange: "#d18930",
};

export function MetricCard({
  label,
  value,
  unit,
  detail,
  accent = "blue",
}: {
  label: string;
  value: string;
  unit?: string;
  detail: string;
  accent?: string;
}) {
  return (
    <Paper
      component="article"
      className="relative min-w-0 overflow-hidden p-5.25 max-[71.875rem]:p-md max-[47.5rem]:p-comfortable"
    >
      <Box
        component="span"
        aria-hidden="true"
        bg={accentColors[accent] ?? accentColors.blue}
        className="absolute top-5.75 left-0 h-7.5 w-0.75"
      />
      <Text
        component="span"
        size="caption"
        c="var(--spt-text-muted)"
        lh="normal"
      >
        {label}
      </Text>
      <Text
        component="div"
        fw="var(--mantine-font-weight-heading)"
        className="mt-3.5 mb-2.75 text-metric tracking-[-0.0625rem] wrap-anywhere tabular-nums min-[93.75rem]:text-metric-wide max-[71.875rem]:text-metric-compact max-[47.5rem]:text-metric-mobile"
        c="var(--spt-text-primary)"
        lh="normal"
      >
        {value}
        {unit && (
          <Text
            component="small"
            size="sm"
            c="var(--spt-text-subtle)"
            className="ml-1.75"
            lh="normal"
          >
            {unit}
          </Text>
        )}
      </Text>
      <Text size="xs" className="max-[47.5rem]:text-caption">
        {detail}
      </Text>
    </Paper>
  );
}
