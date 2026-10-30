import { describe, expect, it } from "vitest";
import { formatMetric, formatNumber } from "./metrics";

describe("formatMetric", () => {
  it("keeps measured zero distinct from no data and delayed", () => {
    expect(formatMetric(0, 0, "present")).toBe("0");
    expect(formatMetric(0, 0)).toBe("0");
    expect(formatMetric(null, 0, "no_data")).toBe("No data");
    expect(formatMetric(undefined, 0, "no_data")).toBe("No data");
    expect(formatMetric(null, 0, "delayed")).toBe("Delayed");
    expect(formatMetric(12.5, 1, "delayed")).toBe("12.5 (delayed)");
    expect(formatNumber(null)).toBe("—");
  });
});
