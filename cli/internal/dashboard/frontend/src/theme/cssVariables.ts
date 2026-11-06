import type { CSSVariablesResolver } from "@mantine/core";

export const cssVariablesResolver: CSSVariablesResolver = (theme) => {
  const tokens = theme.other.dashboard;

  return {
    variables: {
      "--spt-focus-width": tokens.focus.width,
      "--spt-focus-offset": tokens.focus.offset,
      "--spt-table-min-width": tokens.layout.tableMinWidth,
    },
    light: {
      "--mantine-color-body": tokens.surfaces.page,
      "--mantine-color-text": tokens.text.primary,
      "--spt-text-primary": tokens.text.primary,
      "--spt-text-secondary": tokens.text.secondary,
      "--spt-text-muted": tokens.text.muted,
      "--spt-text-description": tokens.text.description,
      "--spt-text-subtle": tokens.text.subtle,
      "--spt-text-inverse": tokens.text.inverse,
      "--spt-surface-page": tokens.surfaces.page,
      "--spt-surface-panel": tokens.surfaces.panel,
      "--spt-surface-control": tokens.surfaces.control,
      "--spt-surface-subtle": tokens.surfaces.subtle,
      "--spt-surface-hover": tokens.surfaces.hover,
      "--spt-surface-selected": tokens.surfaces.selected,
      "--spt-surface-review": tokens.surfaces.review,
      "--spt-surface-code": tokens.surfaces.code,
      "--spt-surface-track": tokens.surfaces.track,
      "--spt-border-panel": tokens.borders.panel,
      "--spt-border-control": tokens.borders.control,
      "--spt-border-divider": tokens.borders.divider,
      "--spt-border-subtle": tokens.borders.subtle,
      "--spt-action-primary": tokens.actions.primary,
      "--spt-action-primary-hover": tokens.actions.primaryHover,
      "--spt-focus-color": tokens.focus.color,
      "--spt-status-success-text": tokens.status.success.text,
      "--spt-status-success-background": tokens.status.success.background,
      "--spt-status-warning-text": tokens.status.warning.text,
      "--spt-status-warning-background": tokens.status.warning.background,
      "--spt-status-warning-border": tokens.status.warning.border,
      "--spt-status-error-text": tokens.status.error.text,
      "--spt-status-error-background": tokens.status.error.background,
      "--spt-status-error-border": tokens.status.error.border,
      "--spt-validation-text": tokens.validation.text,
      "--spt-validation-border": tokens.validation.border,
      "--spt-threshold-failure": tokens.validation.thresholdFailure,
      "--spt-chart-throughput": tokens.charts.throughput,
      "--spt-chart-bandwidth": tokens.charts.bandwidth,
      "--spt-chart-latency-p50": tokens.charts.latencyP50,
    },
    dark: {},
  };
};
