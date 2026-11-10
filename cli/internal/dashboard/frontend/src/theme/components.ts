import {
  Accordion,
  Alert,
  Badge,
  Button,
  Code,
  Drawer,
  Fieldset,
  Input,
  NavLink,
  Paper,
  Progress,
  Radio,
  SegmentedControl,
  Table,
  Text,
  Title,
  rem,
} from "@mantine/core";

export const components = {
  Alert: Alert.extend({
    defaultProps: {
      variant: "light",
      radius: "md",
      p: "md",
      my: "comfortable",
    },
    vars: (_theme, { color, variant }) => ({
      root:
        variant === "light"
          ? {
              "--alert-bg":
                color === "red"
                  ? "var(--spt-status-error-background)"
                  : color === "yellow"
                    ? "var(--spt-status-warning-background)"
                    : "var(--spt-surface-subtle)",
              "--alert-bd": `0.0625rem solid ${color === "red" ? "var(--spt-status-error-border)" : color === "yellow" ? "var(--spt-status-warning-border)" : "var(--spt-border-panel)"}`,
              "--alert-color":
                color === "red"
                  ? "var(--spt-status-error-text)"
                  : color === "yellow"
                    ? "var(--spt-status-warning-text)"
                    : "var(--spt-text-muted)",
            }
          : {},
    }),
    styles: {
      message: {
        color: "inherit",
        lineHeight: "var(--mantine-line-height-body)",
      },
    },
    classNames: { message: "wrap-anywhere" },
  }),
  Progress: Progress.extend({
    defaultProps: { size: rem(6), radius: "sm", color: "spt" },
    styles: { root: { backgroundColor: "var(--spt-surface-track)" } },
  }),
  Code: Code.extend({
    defaultProps: {
      color: "var(--spt-surface-code)",
      c: "var(--spt-text-primary)",
      fz: "caption",
    },
    styles: (_theme, { block }) => ({
      root: block
        ? {
            maxHeight: rem(350),
            padding: "var(--mantine-spacing-md)",
            borderRadius: "var(--mantine-radius-md)",
            lineHeight: "var(--mantine-line-height-code)",
          }
        : {},
    }),
  }),
  Accordion: Accordion.extend({
    defaultProps: {
      variant: "separated",
      radius: "lg",
      keepMounted: true,
      keepMountedMode: "display-none",
    },
    styles: {
      item: {
        backgroundColor: "var(--spt-surface-panel)",
        borderColor: "var(--spt-border-panel)",
      },
      control: {
        color: "var(--spt-text-primary)",
        fontSize: "var(--mantine-font-size-control)",
        fontWeight: "var(--mantine-font-weight-semibold)",
      },
    },
    classNames: {
      control:
        "hover:bg-(--spt-surface-hover) focus-visible:outline-solid focus-visible:outline-(length:--spt-focus-width) focus-visible:outline-focus focus-visible:outline-offset-(--spt-focus-offset)",
    },
  }),
  Drawer: Drawer.extend({
    defaultProps: {
      position: "right",
      size: "min(27.5rem, 100%)",
      padding: "section",
      overlayProps: { backgroundOpacity: 0.42 },
    },
    styles: {
      content: { backgroundColor: "var(--spt-surface-panel)" },
      header: { backgroundColor: "var(--spt-surface-panel)" },
    },
    classNames: {
      content: "flex flex-col",
      body: "flex flex-1 flex-col gap-comfortable",
    },
  }),
  Table: Table.extend({
    defaultProps: {
      horizontalSpacing: "sm",
      verticalSpacing: "sm",
      withRowBorders: true,
      tabularNums: true,
      borderColor: "var(--spt-border-subtle)",
    },
    classNames: { td: "not-first:text-muted" },
    styles: {
      table: { whiteSpace: "nowrap", lineHeight: "normal" },
      th: {
        backgroundColor: "var(--spt-surface-subtle)",
        color: "var(--spt-text-subtle)",
        fontSize: "var(--mantine-font-size-xs)",
        fontWeight: "var(--mantine-font-weight-medium)",
      },
      td: { verticalAlign: "middle" },
    },
  }),
  TableScrollContainer: Table.ScrollContainer.extend({
    defaultProps: { type: "native", tabIndex: 0, role: "region" },
    classNames: {
      scrollContainer:
        "focus-visible:outline-solid focus-visible:outline-(length:--spt-focus-width) focus-visible:outline-focus focus-visible:outline-offset-(--spt-focus-offset)",
    },
  }),
  Input: Input.extend({
    defaultProps: { size: "sm", radius: "control" },
    vars: (_theme, { size }) => ({
      wrapper: size === "sm" ? { "--input-height": rem(38) } : {},
    }),
    classNames: {
      input:
        "focus-visible:outline-solid focus-visible:outline-(length:--spt-focus-width) focus-visible:outline-focus focus-visible:outline-offset-(--spt-focus-offset)",
    },
    styles: (_theme, { error }) => ({
      input: {
        color: "var(--spt-text-secondary)",
        backgroundColor: "var(--spt-surface-control)",
        borderColor: error
          ? "var(--spt-validation-border)"
          : "var(--spt-border-control)",
      },
    }),
  }),
  InputWrapper: Input.Wrapper.extend({
    defaultProps: {
      inputWrapperOrder: ["label", "input", "description", "error"],
      errorProps: { role: "alert" },
    },
    styles: {
      label: { color: "var(--spt-text-muted)", marginBottom: rem(9) },
      description: {
        fontSize: "var(--mantine-font-size-caption)",
        lineHeight: "var(--mantine-line-height-help)",
        marginTop: rem(9),
      },
      error: {
        color: "var(--spt-validation-text)",
        fontSize: "var(--mantine-font-size-caption)",
        lineHeight: "var(--mantine-line-height-help)",
        marginTop: rem(9),
      },
    },
  }),
  Fieldset: Fieldset.extend({
    defaultProps: { variant: "unstyled" },
    styles: (_theme, { disabled }) => ({
      root: { minWidth: 0, margin: 0, opacity: disabled ? 0.55 : undefined },
      legend: {
        fontSize: "var(--mantine-font-size-control)",
        fontWeight: "var(--mantine-font-weight-heading)",
        marginTop: rem(6),
        marginBottom: 0,
      },
    }),
  }),
  Radio: Radio.extend({
    defaultProps: { size: "sm" },
    styles: {
      label: {
        fontSize: "var(--mantine-font-size-md)",
        fontWeight: "var(--mantine-font-weight-bold)",
      },
      description: {
        color: "var(--spt-text-muted)",
        fontSize: "var(--mantine-font-size-sm)",
        lineHeight: "var(--mantine-line-height-body)",
      },
    },
  }),
  NavLink: NavLink.extend({
    defaultProps: { variant: "light", bdrs: "md" },
    classNames: {
      root: "min-h-11.25 p-3.25 focus-visible:outline-solid focus-visible:outline-(length:--spt-focus-width) focus-visible:outline-focus focus-visible:outline-offset-(--spt-focus-offset) max-[47.5rem]:min-h-9.25 max-[47.5rem]:w-auto max-[47.5rem]:px-sm max-[47.5rem]:py-2.25",
    },
    styles: (_theme, { active }) => ({
      root: {
        color: active
          ? "var(--mantine-color-spt-7)"
          : "var(--spt-text-secondary)",
      },
      label: {
        fontSize: "var(--mantine-font-size-control)",
        fontWeight: "var(--mantine-font-weight-semibold)",
      },
    }),
  }),
  SegmentedControl: SegmentedControl.extend({
    defaultProps: {
      size: "sm",
      radius: "md",
      withItemsBorders: false,
      bg: "var(--spt-surface-track)",
    },
    classNames: { label: "text-secondary data-active:text-primary" },
    vars: () => ({
      root: {
        "--sc-padding": "0.4375rem 0.8125rem",
        "--sc-shadow": "0 0.0625rem 0.25rem #20304716",
      },
    }),
    styles: {
      root: { padding: rem(3) },
      label: {
        fontWeight: "var(--mantine-font-weight-semibold)",
        borderRadius: "var(--mantine-radius-md)",
      },
      indicator: { borderRadius: "var(--mantine-radius-md)" },
    },
  }),
  Button: Button.extend({
    defaultProps: {
      variant: "default",
      size: "sm",
      radius: "md",
      fw: "var(--mantine-font-weight-semibold)",
    },
    classNames: {
      root: "focus-visible:outline-solid focus-visible:outline-(length:--spt-focus-width) focus-visible:outline-focus focus-visible:outline-offset-(--spt-focus-offset)",
    },
    vars: (_theme, { variant, color, size }) => ({
      root: {
        ...(size === "sm"
          ? { "--button-height": rem(38), "--button-padding-x": rem(14) }
          : size === "compact-sm"
            ? { "--button-height": rem(29), "--button-padding-x": rem(9) }
            : {}),
        ...(color
          ? {}
          : variant === "default"
            ? {
                "--button-bg": "var(--spt-surface-control)",
                "--button-hover": "var(--spt-surface-hover)",
                "--button-color": "var(--spt-text-secondary)",
                "--button-bd": "0.0625rem solid var(--spt-border-control)",
              }
            : variant === "filled"
              ? {
                  "--button-bg": "var(--spt-action-primary)",
                  "--button-hover": "var(--spt-action-primary-hover)",
                  "--button-color": "var(--spt-text-inverse)",
                }
              : {}),
      },
    }),
  }),
  Paper: Paper.extend({
    defaultProps: {
      withBorder: true,
      radius: "lg",
      bg: "var(--spt-surface-panel)",
    },
    styles: { root: { borderColor: "var(--spt-border-panel)" } },
  }),
  Badge: Badge.extend({
    defaultProps: {
      variant: "light",
      size: "sm",
      radius: "sm",
      h: "auto",
      py: "xxs",
      px: rem(7),
      fz: "xs",
      lh: 1.5,
      fw: "var(--mantine-font-weight-regular)",
      tt: "capitalize",
    },
    styles: { root: { letterSpacing: "normal" } },
    vars: (_theme, { color, variant }) => ({
      root:
        variant === "light" && (color === "teal" || color === "yellow")
          ? {
              "--badge-bg": `var(--spt-status-${color === "teal" ? "success" : "warning"}-background)`,
              "--badge-color": `var(--spt-status-${color === "teal" ? "success" : "warning"}-text)`,
            }
          : {},
    }),
  }),
  Text: Text.extend({
    defaultProps: {
      size: "md",
      c: "var(--spt-text-description)",
      lh: "var(--mantine-line-height-body)",
    },
  }),
  Title: Title.extend({
    classNames: {
      root: "data-[order=1]:max-[47.5rem]:text-[1.4375rem]",
    },
    styles: (_theme, { order }) => ({
      root: { letterSpacing: order === 1 ? rem(-0.7) : undefined },
    }),
  }),
};
