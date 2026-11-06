import { rem } from "@mantine/core";

export const dashboardTokens = {
  text: {
    primary: "#203047",
    secondary: "#30435d",
    muted: "#65768c",
    description: "#64738a",
    subtle: "#7a8799",
    inverse: "#ffffff",
  },
  surfaces: {
    page: "#f4f6fa",
    panel: "#ffffff",
    control: "#ffffff",
    subtle: "#f7f9fc",
    hover: "#f0f5fb",
    selected: "#eaf2fd",
    review: "#f0f5fc",
    code: "#f6f8fb",
    track: "#edf1f6",
  },
  borders: {
    panel: "#e0e7f0",
    control: "#dce3ed",
    divider: "#e3e9f1",
    subtle: "#edf1f6",
  },
  actions: {
    primary: "#176aca",
    primaryHover: "#125bb1",
  },
  focus: {
    color: "#78a9ee",
    width: rem(3),
    offset: rem(3),
  },
  layout: { tableMinWidth: rem(980) },
  status: {
    success: { text: "#267a60", background: "#eaf6f1" },
    warning: {
      text: "#a76a1a",
      background: "#fff1df",
      border: "#f2dfbb",
    },
    error: {
      text: "#8b4c2c",
      background: "#fff0e8",
      border: "#edcfbe",
    },
  },
  validation: {
    text: "#a3401c",
    border: "#c9623a",
    thresholdFailure: "#ad4635",
  },
  charts: {
    throughput: "#347bd1",
    bandwidth: "#188a82",
    latencyP50: "#7a63ce",
    latencyP99: "#b096e7",
    grid: "#eaf0f6",
    inspector: "#8393a8",
    comparison: [
      "#1d4ed8",
      "#c2410c",
      "#15803d",
      "#7e22ce",
      "#b91c1c",
      "#0f766e",
    ],
  },
  connectionGraph: {
    pending: "#ffffff",
    pendingBorder: "#b7c3d3",
    passed: "#2a9d74",
    failed: "#d0503c",
    link: "#cfd8e4",
    dashboardFill: "#eaf2fd",
    dashboardBorder: "#176aca",
  },
};

export type DashboardTokens = typeof dashboardTokens;
