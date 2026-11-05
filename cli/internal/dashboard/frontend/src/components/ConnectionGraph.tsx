import { useMantineTheme } from "@mantine/core";
import { Check, X } from "lucide-react";
import type { CheckStatus, Verification } from "../types";

const word: Record<CheckStatus, string> = {
  pending: "Checking…",
  passed: "Passed",
  failed: "Failed",
};
const short = (text: string) =>
  text.length > 30 ? `${text.slice(0, 29)}…` : text;

function Node({
  x,
  y,
  label,
  status,
}: {
  x: number;
  y: number;
  label: string;
  status: CheckStatus;
}) {
  const colors = useMantineTheme().other.dashboard.connectionGraph;
  const Icon = status === "passed" ? Check : X;
  return (
    <g>
      <title>{`${label}: ${word[status]}`}</title>
      <circle
        cx={x}
        cy={y}
        r="13"
        fill={colors[status]}
        stroke={status === "pending" ? colors.pendingBorder : colors[status]}
        strokeWidth="2"
      />
      {status !== "pending" && (
        <Icon
          x={x - 8}
          y={y - 8}
          size={16}
          strokeWidth={3}
          color="var(--spt-text-inverse)"
          aria-hidden="true"
        />
      )}
      <text
        x={x}
        y={y + 30}
        textAnchor="middle"
        className="fill-secondary text-caption/[inherit] font-semibold"
      >
        {short(label)}
      </text>
      <text
        x={x}
        y={y + 43}
        textAnchor="middle"
        className="fill-muted text-xs/[inherit]"
      >
        {word[status]}
      </text>
    </g>
  );
}

export function ConnectionGraph({
  verification: v,
}: {
  verification: Verification;
}) {
  const colors = useMantineTheme().other.dashboard.connectionGraph;
  const row = 66,
    height = Math.max(1, v.nodes.length) * row + 14,
    middle = height / 2 - 14,
    left = 90,
    center = 360,
    right = 630;
  const y = (i: number) => 24 + i * row;
  const passed = v.nodes.filter((n) => n.status === "passed").length;
  return (
    <figure className="mx-0 p-comfortable mt-section mb-0 bg-surface-subtle border border-border rounded-md">
      <svg
        className="block w-full h-auto"
        viewBox={`0 0 720 ${height}`}
        role="img"
        aria-label={`Connection check: ${passed} of ${v.nodes.length} client machines passed; S3 endpoint ${word[v.endpoint.status].toLowerCase()}`}
      >
        {v.nodes.map((n, i) => (
          <g key={n.host}>
            <line
              stroke={colors.link}
              strokeWidth={1.5}
              x1={left}
              y1={middle}
              x2={center}
              y2={y(i)}
            />
            <line
              stroke={colors.link}
              strokeWidth={1.5}
              x1={center}
              y1={y(i)}
              x2={right}
              y2={middle}
            />
          </g>
        ))}
        <g>
          <title>Dashboard host</title>
          <circle
            cx={left}
            cy={middle}
            r="13"
            fill={colors.dashboardFill}
            stroke={colors.dashboardBorder}
            strokeWidth="2"
          />
          <text
            x={left}
            y={middle + 30}
            textAnchor="middle"
            className="fill-secondary text-caption/[inherit] font-semibold"
          >
            Dashboard host
          </text>
        </g>
        {v.nodes.map((n, i) => (
          <Node
            key={n.host}
            x={center}
            y={y(i)}
            label={n.host}
            status={n.status}
          />
        ))}
        <Node
          x={right}
          y={middle}
          label={v.endpoint.label || "S3 endpoint"}
          status={v.endpoint.status}
        />
      </svg>
      <figcaption className="mt-sm text-caption/[inherit] text-muted">
        Client machines are checked by SPT. The S3 endpoint is checked for
        reachability from the dashboard host.
      </figcaption>
    </figure>
  );
}
