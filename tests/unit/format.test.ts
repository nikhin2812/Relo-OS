import { describe, expect, it } from "vitest";

import { formatDate, formatINR } from "@/lib/format";

describe("formatINR", () => {
  it("formats ₹15 lakh the Indian way", () => {
    expect(formatINR(1500000)).toBe("₹15,00,000");
  });

  it("accepts numbers stored as text by the database", () => {
    expect(formatINR("1500000.00")).toBe("₹15,00,000");
  });

  it("refuses non-numbers", () => {
    expect(() => formatINR("abc")).toThrow();
  });
});

describe("formatDate", () => {
  it("shows the demo move date without shifting timezone", () => {
    expect(formatDate("2026-11-15")).toBe("15 Nov 2026");
  });
});
