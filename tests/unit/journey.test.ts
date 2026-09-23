import { describe, expect, it } from "vitest";

import { buildJourney, taskProgress } from "@/lib/journey";

const services = [
  { id: "s1", title: "Work and family visas", description: "Visas", start_date: "2026-09-16", due_date: "2026-11-01", provider_name: "Falcon" },
  { id: "s2", title: "One-way flights", description: "Flights", start_date: "2026-11-01", due_date: "2026-11-15", provider_name: null },
  { id: "s3", title: "Undated service", description: "", start_date: null, due_date: null, provider_name: null },
];
const milestones = [
  { id: "m1", title: "Visas approved", due_date: "2026-11-01" },
  { id: "m2", title: "Family arrives", due_date: "2026-11-15" },
];
const tasks = [
  { id: "t1", title: "Upload passport copies", due_date: "2026-09-23", status: "todo" as const, service_key: "immigration" },
  { id: "t2", title: "Confirm travel dates", due_date: "2026-11-01", status: "done" as const, service_key: "flights" },
];

describe("buildJourney", () => {
  const journey = buildJourney(services, milestones, tasks, "2026-10-01");

  it("puts everything on one timeline in date order", () => {
    expect(journey.map((i) => i.date)).toEqual([...journey.map((i) => i.date)].sort());
    expect(journey[0]).toMatchObject({ kind: "service", title: "Work and family visas" });
  });

  it("shows key dates before services and to-dos on the same day", () => {
    const sameDay = journey.filter((i) => i.date === "2026-11-01").map((i) => i.kind);
    expect(sameDay).toEqual(["milestone", "service", "task"]);
  });

  it("leaves out services with no dates", () => {
    expect(journey.some((i) => i.title === "Undated service")).toBe(false);
  });

  it("marks unfinished to-dos past their date as overdue, never finished ones", () => {
    const upload = journey.find((i) => i.id === "t1");
    const travel = journey.find((i) => i.id === "t2");
    expect(upload).toMatchObject({ kind: "task", overdue: true, done: false });
    expect(travel).toMatchObject({ kind: "task", overdue: false, done: true });
  });

  it("carries provider names but no money fields", () => {
    const visas = journey.find((i) => i.id === "s1");
    expect(visas).toMatchObject({ provider: "Falcon", endDate: "2026-11-01" });
    for (const item of journey) {
      expect(Object.keys(item).join(",")).not.toMatch(/cost|budget|rate|price/i);
    }
  });
});

describe("taskProgress", () => {
  it("counts finished to-dos", () => {
    expect(taskProgress(tasks)).toEqual({ done: 1, total: 2 });
    expect(taskProgress([])).toEqual({ done: 0, total: 0 });
  });
});
