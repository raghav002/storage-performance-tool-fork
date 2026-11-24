// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { faq } from "../help/faq";
import { theme } from "../theme";
import { HelpAssistant } from "./HelpAssistant";

beforeAll(() => {
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
afterEach(cleanup);

const stopRun = faq.find((entry) => entry.id === "stop-run")!;

function openHelp() {
  render(
    <MantineProvider
      theme={theme}
      forceColorScheme="light"
      env="test"
      withCssVariables={false}
      withGlobalClasses={false}
    >
      <HelpAssistant />
    </MantineProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Help" }));
}

function ask(text: string) {
  fireEvent.change(screen.getByLabelText("Your question"), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
}

describe("HelpAssistant", () => {
  it("suggests matching questions and shows the chosen answer", () => {
    openHelp();
    ask("how can I cancel the benchmark");
    expect(screen.getByText("Did you mean?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: stopRun.question }));
    expect(screen.getByText(stopRun.answer[0])).toBeTruthy();
    expect(screen.getByText(`Source: ${stopRun.source}`)).toBeTruthy();
  });

  it("offers every question when nothing matches", () => {
    openHelp();
    ask("tell me a joke");
    expect(screen.queryByText("Did you mean?")).toBeNull();
    expect(screen.getByText(/couldn't find a matching question/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Browse all questions" }),
    );
    for (const entry of faq)
      expect(screen.getByRole("button", { name: entry.question })).toBeTruthy();
  });

  it("ignores an empty question and closes with Escape", () => {
    openHelp();
    expect(
      (screen.getByRole("button", { name: "Ask" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Help" }), {
      key: "Escape",
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Help" })).toBeTruthy();
  });
});
