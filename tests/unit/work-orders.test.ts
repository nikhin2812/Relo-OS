import { describe, expect, it } from "vitest";

import { allowedPortalActions, generateToken, hashToken, isLiveWorkOrder, portalUrl } from "@/lib/work-orders";

describe("work order links", () => {
  it("makes long random tokens that differ every time", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43); // 32 random bytes
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/); // safe in a URL
  });

  it("hashes exactly like the database does (SHA-256, hex)", () => {
    // Same value the database's private.token_hash('abc') returns.
    expect(hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hashToken(generateToken())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("builds the portal link", () => {
    expect(portalUrl("https://relo.example/", "tok_123")).toBe("https://relo.example/portal/tok_123");
  });
});

describe("work order status", () => {
  it("treats sent, accepted, booked and completed as live", () => {
    for (const s of ["sent", "accepted", "booked", "completed"]) expect(isLiveWorkOrder(s)).toBe(true);
    for (const s of ["declined", "cancelled", null, undefined, ""]) expect(isLiveWorkOrder(s)).toBe(false);
  });

  it("offers the provider only the next sensible steps", () => {
    expect(allowedPortalActions("sent")).toEqual(["accept", "book", "decline"]);
    expect(allowedPortalActions("accepted")).toEqual(["book", "decline"]);
    expect(allowedPortalActions("booked")).toEqual(["complete"]);
    expect(allowedPortalActions("completed")).toEqual([]);
    expect(allowedPortalActions("declined")).toEqual([]);
  });
});
