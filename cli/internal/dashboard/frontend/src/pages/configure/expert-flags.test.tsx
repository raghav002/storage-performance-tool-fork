// @vitest-environment jsdom
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render as renderComponent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { apiClient } from "../../api/client";
import { queryClient } from "../../api/queryClient";
import { theme } from "../../theme";
import type { State } from "../../types";
import { ConfigurePage } from "./ConfigurePage";

const originalAdapter = apiClient.defaults.adapter;

beforeAll(() => {
  // jsdom lacks the observers Mantine uses for its indicators and media queries.
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
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
});

afterAll(() => vi.unstubAllGlobals());

afterEach(() => {
  cleanup();
  apiClient.defaults.adapter = originalAdapter;
  localStorage.clear();
});

// Storage and client machines verified, so the workload step is unlocked.
const state = {
  target: { ready: true, mock_ready: true },
  job: null,
  metrics: null,
  storage: {
    hosts: ["127.0.0.1"],
    endpoint: "",
    max_hosts: 8,
    verification: {
      status: "passed",
      summary: "",
      nodes: [{ host: "127.0.0.1", status: "passed", message: "", checks: [] }],
      endpoint: { label: "", status: "passed", message: "" },
    },
  },
} as unknown as State;

function renderExpert() {
  const posts: unknown[] = [];
  apiClient.defaults.adapter = async (config) => {
    if (config.url === "/api/runs" && config.method === "post")
      posts.push(JSON.parse(String(config.data)));
    return {
      data: { job: null },
      status: 202,
      statusText: "",
      headers: { "content-type": "application/json" },
      config,
    };
  };
  const onStarted = vi.fn();
  const client = new QueryClient({
    defaultOptions: queryClient.getDefaultOptions(),
  });
  renderComponent(
    <ConfigurePage
      state={state}
      mode="expert"
      offline={false}
      onStarted={onStarted}
    />,
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <MantineProvider
          theme={theme}
          forceColorScheme="light"
          env="test"
          withCssVariables={false}
          withGlobalClasses={false}
        >
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        </MantineProvider>
      ),
    },
  );
  return { posts, onStarted };
}

const groupButton = (title: string) =>
  screen.getByRole("button", { name: title });
const tags = (group: string, workload = "write-verify") =>
  screen.getByTestId(`tags-${workload}-${group}`);

// Mantine shows a panel on the next animation frame, so wait for its contents.
async function openGroup(title: string) {
  fireEvent.click(groupButton(title));
  await waitFor(() =>
    expect(groupButton(title).getAttribute("aria-expanded")).toBe("true"),
  );
}
const dedupe = () =>
  screen.findByRole("switch", { name: /^Allow deduplication/ });
const field = (name: RegExp) => screen.findByRole("textbox", { name });
async function preview() {
  fireEvent.click(screen.getByRole("button", { name: "Preview CLI settings" }));
  return (await screen.findByText(/^spt run /)).textContent ?? "";
}

describe("expert flag groups", () => {
  it("opens the applied group and collapses the preview-only ones", () => {
    renderExpert();
    expect(groupButton("Run size & limits").getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(within(tags("run-size")).getByText("Applied to runs")).toBeTruthy();
    for (const title of ["Object data", "Multipart upload", "Endpoint routing"])
      expect(groupButton(title).getAttribute("aria-expanded")).toBe("false");
    expect(within(tags("object-data")).getByText("Preview only")).toBeTruthy();
    expect(screen.getByText(/runs only the four settings above/)).toBeTruthy();
  });

  it("counts, previews and resets changed flags", async () => {
    renderExpert();
    await openGroup("Object data");
    fireEvent.click(await dedupe());
    expect(within(tags("object-data")).getByText("1 changed")).toBeTruthy();
    expect(await preview()).toContain("--object-data-dedupable=false");
    fireEvent.click(
      screen.getByRole("button", { name: "Reset Allow deduplication" }),
    );
    expect(within(tags("object-data")).queryByText(/changed/)).toBeNull();
    expect(screen.getByText(/^spt run /).textContent).not.toContain(
      "dedupable",
    );
  });

  it("resets a whole group", async () => {
    renderExpert();
    await openGroup("Object data");
    fireEvent.click(await dedupe());
    fireEvent.change(await field(/^Compressibility/), {
      target: { value: "40" },
    });
    expect(within(tags("object-data")).getByText("2 changed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset group" }));
    expect(within(tags("object-data")).queryByText(/changed/)).toBeNull();
  });

  it("shows flag errors without blocking a run", async () => {
    renderExpert();
    await openGroup("Multipart upload");
    fireEvent.change(await field(/^Part size/), {
      target: { value: "huge" },
    });
    expect(screen.getByText(/Enter a size such as/)).toBeTruthy();
    expect(within(tags("multipart")).getByText("1 to fix")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Review run" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("sends only the four core settings with a run", async () => {
    const { posts, onStarted } = renderExpert();
    await openGroup("Object data");
    fireEvent.click(await dedupe());
    fireEvent.click(screen.getByRole("button", { name: "Review run" }));
    expect(screen.getByText(/1 preview-only flag is set/)).toBeTruthy();
    expect(
      screen.getAllByText(/--object-data-dedupable/).length,
    ).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(posts).toEqual([
      {
        mode: "expert",
        object_count: 100,
        object_size: "64KiB",
        threads: 1,
        max_runtime_seconds: 60,
      },
    ]);
  });

  it("saves and reloads a profile with its workload and flags", async () => {
    renderExpert();
    fireEvent.click(screen.getByRole("radio", { name: /Mock driver/ }));
    await openGroup("Cleanup");
    fireEvent.click(
      await screen.findByRole("switch", { name: /^Add a delete phase/ }),
    );
    fireEvent.change(screen.getByLabelText("Save this configuration"), {
      target: { value: "Smoke" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    expect(
      screen.getByText(/Saved in this browser with 1 preview-only flag/),
    ).toBeTruthy();
    const saved = JSON.parse(
      localStorage.getItem("spt-dashboard-expert-profiles-v2") ?? "[]",
    );
    expect(saved[0]).toMatchObject({
      name: "Smoke",
      workload: "mock",
      advanced: { cleanup: true },
    });

    fireEvent.click(screen.getByRole("radio", { name: /S3 write \+ verify/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Saved profile/ }));
    fireEvent.change(screen.getByLabelText("Saved configurations"), {
      target: { value: "Smoke" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Load profile" }));
    expect(
      (screen.getByRole("radio", { name: /Mock driver/ }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(within(tags("cleanup", "mock")).getByText("1 changed")).toBeTruthy();
  });

  it("lists profiles saved before expert flags as write-verify", () => {
    localStorage.setItem(
      "spt-dashboard-expert-profiles-v1",
      JSON.stringify([
        {
          name: "Old",
          options: {
            object_count: 50,
            object_size: "1MiB",
            threads: 2,
            max_runtime_seconds: 120,
          },
        },
      ]),
    );
    renderExpert();
    fireEvent.click(screen.getByRole("button", { name: /^Saved profile/ }));
    expect(
      screen.getByRole("option", { name: "Old · Write + verify" }),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Saved configurations"), {
      target: { value: "Old" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Load profile" }));
    expect(
      (
        screen.getByRole("spinbutton", {
          name: /^Maximum objects/,
        }) as HTMLInputElement
      ).value,
    ).toBe("50");
  });

  it("keeps each workload's flags when switching drivers", async () => {
    renderExpert();
    await openGroup("Object data");
    fireEvent.click(await dedupe());
    fireEvent.click(screen.getByRole("radio", { name: /Mock driver/ }));
    expect(screen.queryByRole("button", { name: "Object data" })).toBeNull();
    expect(groupButton("Cleanup")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /S3 write \+ verify/ }));
    expect(within(tags("object-data")).getByText("1 changed")).toBeTruthy();
  });
});
