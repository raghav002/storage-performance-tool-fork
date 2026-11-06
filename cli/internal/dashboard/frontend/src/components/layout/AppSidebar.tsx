import { Box, NavLink, Text, UnstyledButton } from "@mantine/core";
import {
  ArrowLeftRight,
  ExternalLink,
  History,
  LayoutDashboard,
  ListFilter,
  Plus,
} from "lucide-react";
import type { State } from "../../types";
import type { Page } from "../../pages/types";
import { Status } from "../Status";
import { runWorkloadType, workloadLabel } from "../../utils/catalog";

export function AppSidebar({
  state,
  error,
  page,
  onNavigate,
}: {
  state: State | null;
  error: string;
  page: Page;
  onNavigate: (page: Page) => void;
}) {
  const clients = state?.storage?.hosts.length ?? 1;
  return (
    <Box
      component="aside"
      bg="var(--spt-surface-panel)"
      className="sticky top-0 flex h-screen w-58.75 shrink-0 flex-col border-r-[0.0625rem] border-divider px-lg py-xl max-[71.875rem]:w-48.75 max-[71.875rem]:px-3.5 max-[71.875rem]:py-6.25 max-[47.5rem]:static max-[47.5rem]:h-auto max-[47.5rem]:w-full max-[47.5rem]:border-r-0 max-[47.5rem]:border-b-[0.0625rem] max-[47.5rem]:px-comfortable max-[47.5rem]:py-3.75"
    >
      <UnstyledButton
        component="a"
        href="#dashboard"
        className="flex items-center gap-sm"
        onClick={() => onNavigate("dashboard")}
      >
        <Text
          component="span"
          bg="var(--mantine-primary-color-filled)"
          c="var(--spt-text-inverse)"
          bdrs="lg"
          size="emphasis"
          fw="var(--mantine-font-weight-heading)"
          lh="normal"
          className="grid size-10.5 shrink-0 place-items-center"
        >
          SPT
        </Text>
        <div className="min-w-0">
          <Text
            size="sm"
            c="var(--spt-text-primary)"
            fw="var(--mantine-font-weight-heading)"
            lh="normal"
          >
            {state?.branding?.product_name ?? "Storage Performance Tool"}
          </Text>
          <Text
            component="small"
            size="xxs"
            c="var(--spt-text-subtle)"
            lh="normal"
            className="mt-1.5 block tracking-[0.0625rem] max-[47.5rem]:hidden"
          >
            {(
              state?.branding?.environment_label ?? "BENCHMARK CONSOLE"
            ).toUpperCase()}
          </Text>
        </div>
      </UnstyledButton>
      <Text
        size="xs"
        c="var(--spt-text-subtle)"
        lh="normal"
        className="mx-sm mt-xxxl mb-3.5 tracking-[0.09375rem] max-[47.5rem]:hidden"
      >
        WORKSPACE
      </Text>
      <nav
        aria-label="Main navigation"
        className="grid gap-xs max-[47.5rem]:mt-3.75 max-[47.5rem]:flex max-[47.5rem]:flex-wrap"
      >
        <NavLink
          component="button"
          type="button"
          label="Configure run"
          leftSection={<Plus size="1rem" aria-hidden="true" />}
          active={page === "configure"}
          aria-current={page === "configure" ? "page" : undefined}
          onClick={() => onNavigate("configure")}
        />
        <NavLink
          component="button"
          type="button"
          label="Live dashboard"
          leftSection={<LayoutDashboard size="1rem" aria-hidden="true" />}
          active={page === "dashboard"}
          aria-current={page === "dashboard" ? "page" : undefined}
          onClick={() => onNavigate("dashboard")}
        />
        <NavLink
          component="button"
          type="button"
          label="Run history"
          leftSection={<History size="1rem" aria-hidden="true" />}
          active={page === "history"}
          aria-current={page === "history" ? "page" : undefined}
          onClick={() => onNavigate("history")}
        />
        <NavLink
          component="button"
          type="button"
          label="Results catalog"
          leftSection={<ListFilter size="1rem" aria-hidden="true" />}
          active={page === "catalog"}
          aria-current={page === "catalog" ? "page" : undefined}
          onClick={() => onNavigate("catalog")}
        />
        <NavLink
          component="button"
          type="button"
          label="Compare runs"
          leftSection={<ArrowLeftRight size="1rem" aria-hidden="true" />}
          active={page === "compare"}
          aria-current={page === "compare" ? "page" : undefined}
          onClick={() => onNavigate("compare")}
        />
        <NavLink
          component="button"
          type="button"
          label="Connect to active run"
          leftSection={<ExternalLink size="1rem" aria-hidden="true" />}
          active={page === "connect"}
          aria-current={page === "connect" ? "page" : undefined}
          onClick={() => onNavigate("connect")}
        />
      </nav>
      <div className="mx-sm mt-xxl mb-section border-t-[0.0625rem] border-divider pt-section wrap-anywhere max-[47.5rem]:hidden">
        <Text
          size="xxs"
          c="var(--spt-text-muted)"
          fw="var(--mantine-font-weight-heading)"
          lh="normal"
          className="mb-compact tracking-[0.08125rem]"
        >
          STORAGE TARGET
        </Text>
        <Text
          component="strong"
          size="sm"
          c="var(--spt-text-primary)"
          fw="var(--mantine-font-weight-bold)"
          lh="normal"
        >
          {state?.target.endpoint_label || "Awaiting server"}
        </Text>
        <Text size="caption" className="mt-xs mb-sm">
          {state?.target.bucket || "No bucket reported"}
        </Text>
        {state && (
          <Status status={state.target.ready ? "ready" : "needs setup"} />
        )}
      </div>
      <Text
        component="div"
        size="caption"
        c="var(--spt-text-muted)"
        lh="normal"
        className="mt-auto max-[47.5rem]:hidden"
      >
        <Box
          component="span"
          aria-hidden="true"
          bg={state && !error ? "var(--spt-chart-bandwidth)" : "#e2a243"}
          bdrs="50%"
          className="mr-xs inline-block size-1.75"
        />
        {error
          ? "Connection unavailable"
          : state
            ? "SPT server connected"
            : "Connecting to server"}
        <Text size="xs" className="my-xs">
          {clients} client machine{clients === 1 ? "" : "s"} ·{" "}
          {workloadLabel(runWorkloadType(state?.metrics, state?.job))}
        </Text>
      </Text>
    </Box>
  );
}
