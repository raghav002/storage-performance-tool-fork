// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
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

const group = (title: string) =>
  screen.getByText(title, { selector: "strong" }).closest("details")!;

describe("expert flag groups", () => {
  it("opens the applied group and collapses the preview-only ones", () => {
    renderExpert();
    expect(group("Run size & limits").open).toBe(true);
    const data = group("Object data");
    expect(data.open).toBe(false);
    expect(within(data).getByText("Preview only")).toBeTruthy();
    // Groups keep their description; each flag shows only its default.
    expect(
      within(data).getByText(/What the written bytes look like/),
    ).toBeTruthy();
    expect(
      within(data)
        .getAllByText(/^Default:/)
        .map((el) => el.textContent),
    ).toEqual(["Default: 0", "Default: On", "Default: Off"]);
    expect(within(data).queryByText(/zero-filled/)).toBeNull();
    expect(data.querySelector("[title]")).toBeNull();
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

  it("imports a mock command through the prompt", () => {
    renderExpert();
    fireEvent.click(screen.getByRole("button", { name: /CLI command/ }));
    fireEvent.change(screen.getByLabelText("Paste an SPT command"), {
      target: { value: "spt run mock --threads 4 --cleanup --min-hosts 1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import command" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Apply this command?")).toBeTruthy();
    expect(dialog.textContent).toMatch(/switches from Write \+ verify/);
    expect(
      within(dialog)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["--threads 4", "--cleanup", "--min-hosts 1"]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      (screen.getByRole("radio", { name: /Mock driver/ }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(
      (screen.getByLabelText(/^Add a delete phase/) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(
      (screen.getByLabelText(/^Minimum client machines/) as HTMLInputElement)
        .value,
    ).toBe("1");
    expect(screen.queryByText("Object data")).toBeNull();
    expect(
      screen.getByText(/Command applied: Mock driver with 3 flags/),
    ).toBeTruthy();
  });

  it("opens the prompt for a command pasted anywhere and resets the rest", () => {
    renderExpert();
    fireEvent.change(screen.getByLabelText(/^Parallel threads/), {
      target: { value: "8" },
    });
    fireEvent.click(screen.getByLabelText(/^Save item list/));
    const event = paste(
      document.body,
      "./spt run write-verify --object-count 500",
    );
    expect(event.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(
      (screen.getByLabelText(/^Maximum objects/) as HTMLInputElement).value,
    ).toBe("500");
    // Settings the command leaves out return to their defaults.
    expect(
      (screen.getByLabelText(/^Parallel threads/) as HTMLInputElement).value,
    ).toBe("1");
    expect(
      (screen.getByLabelText(/^Save item list/) as HTMLInputElement).checked,
    ).toBe(false);
  });

  it("keeps a pasted command out of the workspace field it lands on", () => {
    renderExpert();
    const threads = screen.getByLabelText(/^Parallel threads/);
    expect(paste(threads, "spt run mock").defaultPrevented).toBe(true);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("ignores other text and pastes into fields outside the workspace", () => {
    renderExpert();
    const outside = document.createElement("input");
    document.body.appendChild(outside);
    try {
      expect(paste(outside, "spt run mock").defaultPrevented).toBe(false);
      expect(paste(document.body, "hello world").defaultPrevented).toBe(false);
      expect(screen.queryByRole("dialog")).toBeNull();
    } finally {
      outside.remove();
    }
  });

  it("explains a rejected command and changes nothing", () => {
    renderExpert();
    paste(document.body, "spt run mock --threads 4 --access-key AKIAEXAMPLE");
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText("This command can't be applied"),
    ).toBeTruthy();
    expect(dialog.textContent).toMatch(/--access-key: Credentials come only/);
    expect(dialog.textContent).not.toMatch(/AKIAEXAMPLE/);
    expect(within(dialog).queryByRole("button", { name: "Apply" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      (screen.getByRole("radio", { name: /S3 write/ }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(
      (screen.getByLabelText(/^Parallel threads/) as HTMLInputElement).value,
    ).toBe("1");
  });

  it("closes the prompt on Escape without applying", () => {
    renderExpert();
    paste(document.body, "spt run mock --threads 4");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      (screen.getByRole("radio", { name: /S3 write/ }) as HTMLInputElement)
        .checked,
    ).toBe(true);
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
