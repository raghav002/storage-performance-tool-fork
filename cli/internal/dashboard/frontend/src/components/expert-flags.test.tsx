// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { State } from "../types";
import { Configure } from "./Configure";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

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
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/runs" && init?.method === "POST")
        posts.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ runs: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  const onStarted = vi.fn(async () => {});
  render(
    <Configure
      state={state}
      mode="expert"
      offline={false}
      onRefresh={async () => {}}
      onStarted={onStarted}
    />,
  );
  return { posts, onStarted };
}

const group = (title: string) =>
  screen.getByText(title, { selector: "strong" }).closest("details")!;

describe("expert flag groups", () => {
  it("opens the applied group and collapses the preview-only ones", () => {
    renderExpert();
    expect(group("Run size & limits").open).toBe(true);
    const data = group("Object data");
    expect(data.open).toBe(false);
    expect(within(data).getByText("Preview only")).toBeTruthy();
    fireEvent.click(data.querySelector("summary")!);
    expect(data.open).toBe(true);
    fireEvent.click(data.querySelector("summary")!);
    expect(data.open).toBe(false);
  });

  it("counts, previews and resets changed flags", () => {
    renderExpert();
    const results = group("Results");
    fireEvent.click(screen.getByLabelText(/^Save item list/));
    expect(within(results).getByText("1 changed")).toBeTruthy();
    expect(screen.getByText(/--save-items/, { selector: "pre" })).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Reset Save item list" }),
    );
    expect(within(results).queryByText("1 changed")).toBeNull();
    expect(screen.queryByText(/--save-items/, { selector: "pre" })).toBeNull();
  });

  it("shows flag errors without blocking a run", () => {
    renderExpert();
    const parts = screen.getByLabelText(/^Concurrent parts per object/);
    fireEvent.change(parts, { target: { value: "4" } });
    expect(screen.getByText("Set a part size first.")).toBeTruthy();
    expect(
      within(group("Multipart upload")).getByText("1 to fix"),
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Review run" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("sends only the four core settings with a run", async () => {
    const { posts } = renderExpert();
    fireEvent.click(screen.getByLabelText(/^Save item list/));
    fireEvent.change(screen.getByLabelText(/^Region/), {
      target: { value: "us-east-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review run" }));
    expect(screen.getByRole("note").textContent).toMatch(
      /2 preview-only flags are set \(--region, --save-items\)/,
    );
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
      mode: "expert",
      object_count: 100,
      object_size: "64KiB",
      threads: 1,
      max_runtime_seconds: 60,
    });
  });

  it("imports a mock command into its workload's groups", () => {
    renderExpert();
    fireEvent.click(screen.getByRole("button", { name: /CLI command/ }));
    fireEvent.change(screen.getByLabelText("Paste an SPT command"), {
      target: { value: "spt run mock --threads 4 --cleanup --min-hosts 1" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Import supported settings" }),
    );
    expect(
      (screen.getByRole("radio", { name: /Mock driver/ }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(screen.getByText(/including 2 preview-only flags/)).toBeTruthy();
    expect(
      (screen.getByLabelText(/^Add a delete phase/) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(
      (screen.getByLabelText(/^Minimum client machines/) as HTMLInputElement)
        .value,
    ).toBe("1");
    expect(screen.queryByText("Object data")).toBeNull();
  });

  it("changes nothing when a command is rejected", () => {
    renderExpert();
    fireEvent.click(screen.getByRole("button", { name: /CLI command/ }));
    fireEvent.change(screen.getByLabelText("Paste an SPT command"), {
      target: { value: "spt run mock --threads 4 --access-key AKIA" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Import supported settings" }),
    );
    expect(screen.getByText(/Nothing was changed/)).toBeTruthy();
    expect(
      (screen.getByRole("radio", { name: /S3 write/ }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(
      (screen.getByLabelText(/^Parallel threads/) as HTMLInputElement).value,
    ).toBe("1");
  });

  it("saves and reloads a profile with its workload and flags", () => {
    renderExpert();
    fireEvent.click(screen.getByRole("radio", { name: /Mock driver/ }));
    fireEvent.click(screen.getByLabelText(/^Add a delete phase/));
    fireEvent.change(screen.getByLabelText(/^Parallel threads/), {
      target: { value: "4" },
    });
    fireEvent.change(screen.getByLabelText("Save this configuration"), {
      target: { value: "smoke" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    expect(screen.getByText(/with 1 preview-only flag\./)).toBeTruthy();

    // Change everything, then load the profile back.
    fireEvent.click(screen.getByRole("radio", { name: /S3 write/ }));
    fireEvent.change(screen.getByLabelText(/^Parallel threads/), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Saved profile/ }));
    fireEvent.change(screen.getByLabelText("Saved configurations"), {
      target: { value: "smoke" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Load profile" }));
    expect(
      (screen.getByRole("radio", { name: /Mock driver/ }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(
      (screen.getByLabelText(/^Parallel threads/) as HTMLInputElement).value,
    ).toBe("4");
    expect(
      (screen.getByLabelText(/^Add a delete phase/) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(localStorage.getItem("spt-dashboard-expert-profiles-v2")).toContain(
      '"workload":"mock"',
    );
  });
});
