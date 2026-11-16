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
  act,
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

// Dispatches a paste event carrying text, as a browser does.
function paste(target: Element, text: string): Event {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: () => text },
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}
const dialog = () => screen.findByRole("dialog");
const radio = (name: RegExp) =>
  screen.getByRole("radio", { name }) as HTMLInputElement;
const spin = (name: RegExp) =>
  screen.getByRole("spinbutton", { name }) as HTMLInputElement;

describe("expert flag groups", () => {
  it("applies every group of both workloads", () => {
    renderExpert();
    expect(groupButton("Run size & limits").getAttribute("aria-expanded")).toBe(
      "true",
    );
    for (const title of ["Object data", "Multipart upload", "Endpoint routing"])
      expect(groupButton(title).getAttribute("aria-expanded")).toBe("false");
    expect(within(tags("run-size")).getByText("Applied to runs")).toBeTruthy();
    expect(
      within(tags("object-data")).getByText("Applied to runs"),
    ).toBeTruthy();
    expect(screen.queryByText(/runs only the four settings above/)).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: /Mock driver/ }));
    expect(
      within(tags("cleanup", "mock")).getByText("Applied to runs"),
    ).toBeTruthy();
    expect(screen.queryByText(/runs only the four settings above/)).toBeNull();
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

  it("blocks a write-verify run while a flag is invalid", async () => {
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
    ).toBe(true);
  });

  it("blocks a mock run while a flag is invalid", async () => {
    renderExpert();
    fireEvent.click(screen.getByRole("radio", { name: /Mock driver/ }));
    await openGroup("Distribution & engine");
    fireEvent.change(await field(/^Minimum client machines/), {
      target: { value: "99" },
    });
    expect(
      within(tags("distribution", "mock")).getByText("1 to fix"),
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Review run" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("sends changed write-verify flags with the run", async () => {
    const { posts, onStarted } = renderExpert();
    await openGroup("Object data");
    fireEvent.click(await dedupe());
    fireEvent.click(screen.getByRole("button", { name: "Review run" }));
    expect(screen.getByText("SPT flags (1)")).toBeTruthy();
    expect(screen.queryByText(/preview-only flag/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    // Only the changed flag is sent; unchanged ones keep the server's defaults.
    expect(posts).toEqual([
      {
        mode: "expert",
        object_count: 100,
        object_size: "64KiB",
        threads: 1,
        max_runtime_seconds: 60,
        flags: { "object-data-dedupable": false },
      },
    ]);
  });

  it("sends changed mock flags with the run", async () => {
    const { posts, onStarted } = renderExpert();
    fireEvent.click(screen.getByRole("radio", { name: /Mock driver/ }));
    await openGroup("Cleanup");
    fireEvent.click(
      await screen.findByRole("switch", { name: /^Add a delete phase/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Review run" }));
    expect(screen.getByText("SPT flags (1)")).toBeTruthy();
    expect(screen.queryByText(/preview-only flag/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(posts).toEqual([
      {
        mode: "expert",
        object_count: 100,
        object_size: "64KiB",
        threads: 1,
        max_runtime_seconds: 60,
        driver: "mock",
        flags: { cleanup: true },
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
      screen.getByText(/Saved in this browser with 1 flag\./),
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
  it("applies a command pasted anywhere and resets the rest", async () => {
    renderExpert();
    fireEvent.change(spin(/^Parallel threads/), { target: { value: "4" } });
    paste(document.body, "spt run mock --object-count 500 --cleanup");
    const prompt = await dialog();
    expect(within(prompt).getByText("Apply this command?")).toBeTruthy();
    expect(
      within(prompt).getByText(/switches from Write \+ verify/),
    ).toBeTruthy();
    expect(within(prompt).getByText("Sets 2 flags:")).toBeTruthy();
    expect(within(prompt).getByText("--object-count 500")).toBeTruthy();
    fireEvent.click(within(prompt).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(radio(/Mock driver/).checked).toBe(true);
    expect(spin(/^Maximum objects/).value).toBe("500");
    expect(spin(/^Parallel threads/).value).toBe("1");
    expect(within(tags("cleanup", "mock")).getByText("1 changed")).toBeTruthy();
    expect(
      screen.getByText(/Command applied: Mock driver with 2 flags/),
    ).toBeTruthy();
  });

  it("keeps a pasted command out of the workspace field it lands on", async () => {
    renderExpert();
    const field = spin(/^Maximum objects/);
    const event = paste(field, "spt run write-verify --threads 2");
    expect(event.defaultPrevented).toBe(true);
    expect(await dialog()).toBeTruthy();
  });

  it("lets the CLI command box keep a pasted command", async () => {
    renderExpert();
    fireEvent.click(screen.getByRole("button", { name: /^CLI command/ }));
    const box = screen.getByLabelText("Paste an SPT command");
    const event = paste(box, "spt run write-verify --threads 2");
    expect(event.defaultPrevented).toBe(false);
    expect(await dialog()).toBeTruthy();
  });

  it("ignores other text and pastes into fields outside the workspace", async () => {
    renderExpert();
    expect(paste(document.body, "hello").defaultPrevented).toBe(false);
    const host = screen.getByLabelText("Client machine 1");
    expect(paste(host, "spt run mock").defaultPrevented).toBe(false);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("explains a rejected command and changes nothing", async () => {
    renderExpert();
    paste(
      document.body,
      "spt run mock --secret-key abc123 --duration 5m --object-count 7",
    );
    const prompt = await dialog();
    expect(
      within(prompt).getByText("This command can't be applied"),
    ).toBeTruthy();
    expect(within(prompt).getByText(/--secret-key: Credentials/)).toBeTruthy();
    expect(
      within(prompt).getByText(/--duration: Dashboard runs are count-based/),
    ).toBeTruthy();
    expect(prompt.textContent).not.toContain("abc123");
    fireEvent.click(within(prompt).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(radio(/S3 write \+ verify/).checked).toBe(true);
    expect(spin(/^Maximum objects/).value).toBe("100");
  });

  it("closes the prompt on Escape without applying", async () => {
    renderExpert();
    paste(document.body, "spt run mock --object-count 500");
    const prompt = await dialog();
    fireEvent.keyDown(prompt, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(radio(/S3 write \+ verify/).checked).toBe(true);
    expect(spin(/^Maximum objects/).value).toBe("100");
  });

  it("imports a command through the CLI command box", async () => {
    renderExpert();
    fireEvent.click(screen.getByRole("button", { name: /^CLI command/ }));
    fireEvent.change(screen.getByLabelText("Paste an SPT command"), {
      target: { value: "spt run write-verify --threads 3 --checksum crc32" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import command" }));
    const prompt = await dialog();
    fireEvent.click(within(prompt).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(spin(/^Parallel threads/).value).toBe("3"));
    expect(within(tags("object-data")).getByText("1 changed")).toBeTruthy();
  });
  it("shows a flag's description when hovering its name", async () => {
    renderExpert();
    await openGroup("Multipart upload");
    // Keyboard and screen-reader users get the description without hovering.
    expect(
      (await field(/^Part size/)).getAttribute("aria-description"),
    ).toMatch(/^Upload each object in parts/);
    fireEvent.mouseEnter(screen.getByText("Part size"));
    expect((await screen.findByRole("tooltip")).textContent).toMatch(
      /^Upload each object in parts of this size\./,
    );
  });

  it("describes the four core settings the same way", async () => {
    renderExpert();
    const name = screen
      .getAllByText("Safety time limit (seconds)")
      .find((el) => el.classList.contains("cursor-help"))!;
    fireEvent.mouseEnter(name);
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Stop the run after this many seconds, even if objects remain.",
    );
  });
});
