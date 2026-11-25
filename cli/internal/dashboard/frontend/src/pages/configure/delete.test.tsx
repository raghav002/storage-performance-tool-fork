// @vitest-environment jsdom
import { afterEach, beforeAll, afterAll, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { State } from "../../types";
import { theme } from "../../theme";
import { DeleteOutcome } from "../dashboard/DeleteOutcome";
import { ConfigurePage } from "./ConfigurePage";
import { initialDeleteOptions } from "./DeleteFields";
import { fallbackLimits, validateOptions } from "../../utils/validation";
import { apiClient } from "../../api/client";
import { rowPhase, phaseName } from "../../utils/metrics";
import { toDraft, parseExpertCommand } from "./configuration";
import { runWorkloadType } from "../../utils/catalog";
import { PhaseResults } from "../../components/RunMetrics";

const originalAdapter = apiClient.defaults.adapter;
const clients: QueryClient[] = [];
beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    })),
  );
});
afterAll(() => vi.unstubAllGlobals());
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((c) => c.clear());
  apiClient.defaults.adapter = originalAdapter;
});

function state(): State {
  return {
    target: {
      ready: true,
      bucket: "bench",
      endpoint: "https://storage.invalid",
    },
    job: null,
    metrics: null,
    limits: fallbackLimits,
    storage: {
      hosts: ["127.0.0.1"],
      endpoint: "https://storage.invalid",
      max_hosts: 8,
      verification: {
        status: "passed",
        summary: "Ready",
        nodes: [
          { host: "127.0.0.1", status: "passed", message: "Ready", checks: [] },
        ],
        endpoint: { label: "Storage", status: "passed", message: "Ready" },
      },
    },
  };
}

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  const started = vi.fn();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <MantineProvider theme={theme} env="test" withCssVariables={false}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </MantineProvider>
  );
  const view = render(
    <ConfigurePage
      state={state()}
      mode="guided"
      offline={false}
      onStarted={started}
    />,
    { wrapper },
  );
  return { ...view, wrapper, started };
}

it.each([true, false])(
  "groups Guided Delete settings, reviews choices, and submits typed Delete options with cleanup=%s",
  async (cleanupEnabled) => {
    let submitted: Record<string, unknown> | undefined;
    apiClient.defaults.adapter = async (config) => {
      expect(config.url).toBe("/api/runs");
      submitted = JSON.parse(config.data);
      return {
        data: {
          job: { run_id: "mt-dashboard-test", status: "running" },
          message: "Started",
        },
        status: 202,
        statusText: "Accepted",
        headers: { "content-type": "application/json" },
        config,
      };
    };
    const { started } = setup();
    fireEvent.click(screen.getByRole("radio", { name: "Delete" }));
    for (const name of [
      "Objects",
      "Load",
      "Verification",
      "Failure policy",
      "Cleanup",
    ])
      expect(screen.getByRole("group", { name })).toBeTruthy();
    expect(screen.queryByLabelText("Safety time limit")).toBeNull();
    expect(
      (screen.getByLabelText("Seed object size") as HTMLSelectElement).value,
    ).toBe("1KiB");
    fireEvent.change(screen.getByLabelText("Objects per request"), {
      target: { value: "100" },
    });
    fireEvent.click(
      screen.getByLabelText("Check objects exist before deletion"),
    );
    fireEvent.click(
      screen.getByLabelText("Check objects are absent after deletion"),
    );
    fireEvent.change(screen.getByLabelText("Failure budget"), {
      target: { value: "percentage" },
    });
    fireEvent.change(screen.getByLabelText("Allowed failures (%)"), {
      target: { value: "5" },
    });
    fireEvent.change(screen.getByLabelText("Failure budget grace (seconds)"), {
      target: { value: "30" },
    });
    const cleanupCheckbox = screen.getByLabelText(
      "Retry deletion of leftover test objects",
    ) as HTMLInputElement;
    expect(cleanupCheckbox.checked).toBe(true);
    if (!cleanupEnabled) fireEvent.click(cleanupCheckbox);
    expect(cleanupCheckbox.checked).toBe(cleanupEnabled);
    fireEvent.click(screen.getByRole("button", { name: "Review run" }));
    expect(screen.getByText(/Objects per request: 100/)).toBeTruthy();
    expect(
      screen.getByText(/Existing data is not selected.*no runtime limit/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
    await waitFor(() => expect(started).toHaveBeenCalledOnce());
    expect(submitted).toMatchObject({
      workload: "delete",
      mode: "guided",
      object_count: 10,
      object_size: "1KiB",
      max_runtime_seconds: 0,
      delete: {
        batch_size: 100,
        validate_inventory: true,
        verify: true,
        max_failure_percent: 5,
        failure_budget_grace_seconds: 30,
        cleanup: cleanupEnabled,
      },
    });
    expect(
      (submitted!.delete as Record<string, unknown>).max_failed_objects,
    ).toBeUndefined();
  },
);

it("keeps Delete out of the Expert form and restores normal write settings", () => {
  const { rerender } = setup();
  fireEvent.click(screen.getByRole("radio", { name: "Delete" }));
  rerender(
    <ConfigurePage
      state={state()}
      mode="expert"
      offline={false}
      onStarted={() => {}}
    />,
  );
  expect(screen.queryByRole("radio", { name: "Delete" })).toBeNull();
  expect(
    (
      screen.getByRole("radio", {
        name: "S3 write + verify",
      }) as HTMLInputElement
    ).checked,
  ).toBe(true);
  expect(screen.queryByLabelText("Objects per request")).toBeNull();
});

it("validates custom Delete presets and exclusive budgets", () => {
  const limits = {
    ...fallbackLimits,
    delete: {
      ...fallbackLimits.delete!,
      object_sizes: ["2KiB"],
      batch_sizes: [5],
    },
  };
  const o = initialDeleteOptions(limits);
  expect(o.object_size).toBe("2KiB");
  expect(validateOptions(o, limits)).toEqual({});
  expect(
    validateOptions({ ...o, max_runtime_seconds: 60 }, limits)
      .max_runtime_seconds,
  ).toBeTruthy();
  expect(
    validateOptions(
      { ...o, delete: { ...o.delete!, max_failure_percent: 5 } },
      limits,
    ).delete,
  ).toBeTruthy();
  expect(() => toDraft(o)).toThrow(/Delete settings/);
  expect(() =>
    parseExpertCommand("spt run delete --object-count 10", o, limits),
  ).toThrow(/write-verify/);
  expect(runWorkloadType(null, { options: o })).toBe("delete");
});

it("keeps measured deletion and cleanup in separate phase rows", () => {
  const base = {
    successful_ops: 3,
    failed_ops: 0,
    bandwidth_mib_s: null,
    iops: 1,
  };
  const measured = {
    ...base,
    step_id: "002-delete",
    phase: "DELETE",
    op_type: "DELETE",
  };
  const residual = {
    ...base,
    step_id: "003-cleanup",
    phase: "CLEANUP",
    op_type: "DELETE",
  };
  expect(rowPhase(measured, "delete")).toBe("DELETE");
  expect(rowPhase(residual, "delete")).toBe("CLEANUP");
  expect(phaseName("DELETE", "delete")).toBe("Delete");
  const onSelect = vi.fn();
  render(
    <MantineProvider theme={theme} env="test">
      <PhaseResults
        metrics={{
          run_id: "r",
          workload_type: "delete",
          is_active: false,
          is_aggregate: true,
          samples: [],
          phase_summaries: [measured, residual],
        }}
        onSelect={onSelect}
      />
    </MantineProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  fireEvent.click(screen.getByRole("button", { name: "Cleanup" }));
  expect(onSelect.mock.calls).toEqual([["DELETE"], ["CLEANUP"]]);
});

it("marks missing finished Delete evidence unavailable rather than still waiting", () => {
  render(
    <MantineProvider theme={theme} env="test">
      <DeleteOutcome />
    </MantineProvider>,
  );
  expect(
    screen.getByText(/DELETE object outcomes are unavailable/),
  ).toBeTruthy();
  expect(screen.queryByText(/Waiting for DELETE/)).toBeNull();
});
