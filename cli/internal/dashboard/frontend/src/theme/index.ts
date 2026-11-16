import { createTheme, rem } from "@mantine/core";
import { components } from "./components";
import { dashboardTokens } from "./tokens";

export { cssVariablesResolver } from "./cssVariables";
export { dashboardTokens, type DashboardTokens } from "./tokens";

const fontFamily =
  'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

export const theme = createTheme({
  fontFamily,
  fontFamilyMonospace: "ui-monospace, SFMono-Regular, Menlo, monospace",
  primaryColor: "spt",
  primaryShade: 6,
  colors: {
    spt: [
      "#eef4ff",
      "#eaf2fd",
      "#d4e4f8",
      "#78a9ee",
      "#347bd1",
      "#2273d6",
      "#1469c7",
      "#1766c1",
      "#1a65ba",
      "#125bb1",
    ],
  },
  fontSizes: {
    xxs: rem(9),
    xs: rem(10),
    caption: rem(11),
    sm: rem(12),
    control: rem(13),
    md: rem(14),
    emphasis: rem(15),
    lg: rem(16),
    xl: rem(20),
    metricMobile: rem(23),
    metricCompact: rem(24),
    metric: rem(29),
    metricWide: rem(34),
  },
  fontWeights: {
    regular: "400",
    medium: "500",
    semibold: "600",
    heading: "650",
    bold: "700",
  },
  headings: {
    fontFamily,
    fontWeight: "650",
    sizes: {
      h1: { fontSize: rem(27), lineHeight: "normal" },
      h2: { fontSize: rem(17), lineHeight: "normal" },
      h3: { fontSize: rem(13), lineHeight: "normal" },
    },
  },
  lineHeights: {
    body: "1.65",
    help: "1.5",
    code: "1.7",
  },
  radius: {
    xs: rem(3),
    sm: rem(5),
    chip: rem(6),
    control: rem(7),
    md: rem(8),
    lg: rem(10),
    xl: rem(14),
  },
  defaultRadius: "md",
  spacing: {
    xxs: rem(4),
    xs: rem(8),
    compact: rem(10),
    sm: rem(12),
    md: rem(16),
    comfortable: rem(18),
    lg: rem(20),
    panel: rem(22),
    section: rem(24),
    wide: rem(28),
    xl: rem(30),
    xxl: rem(36),
    xxxl: rem(48),
  },
  cursorType: "pointer",
  components,
  other: { dashboard: dashboardTokens },
});
