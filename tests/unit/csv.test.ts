import { describe, expect, it } from "vitest";

import { csvCell, parseCsv, readImportRows, toCsv } from "@/lib/csv";

describe("toCsv", () => {
  it("quotes commas, quotes and line breaks", () => {
    expect(toCsv([["a", "b,c", 'say "hi"', "two\nlines"]])).toBe('a,"b,c","say ""hi""","two\nlines"\r\n');
  });

  it("neutralises cells a spreadsheet would run as formulas", () => {
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(csvCell("+1+1")).toBe("'+1+1");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("writes numbers and empty values plainly", () => {
    expect(toCsv([[1500000, null, undefined, ""]])).toBe("1500000,,,\r\n");
  });
});

describe("parseCsv", () => {
  it("reads quoted fields, doubled quotes and line breaks inside quotes", () => {
    expect(parseCsv('name,note\r\n"Doe, Jane","said ""hi""\nthen left"\r\n')).toEqual([
      ["name", "note"],
      ["Doe, Jane", 'said "hi"\nthen left'],
    ]);
  });

  it("ignores a byte-order mark and blank lines, and handles a missing final newline", () => {
    expect(parseCsv("﻿a,b\n\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("rejects an unclosed quote", () => {
    expect(() => parseCsv('a\n"oops')).toThrow(/never closed/);
  });

  it("round-trips what toCsv writes", () => {
    const rows = [["x", "a,b", 'q"q', "line\nbreak"]];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});

describe("readImportRows", () => {
  const header = "employee_name,family_size,origin,destination,move_date,budget";

  it("maps columns by header name, in any order, with the optional email", () => {
    const result = readImportRows(
      "budget,employee_name,family_size,origin,destination,move_date,employee_email\n1500000,Jane Example (Demo),3,Pune,Dubai,2026-12-01,jane@demo.test",
    );
    expect(result).toEqual({
      rows: [
        {
          line: 2,
          values: {
            employee_name: "Jane Example (Demo)",
            family_size: "3",
            origin: "Pune",
            destination: "Dubai",
            move_date: "2026-12-01",
            budget: "1500000",
            employee_email: "jane@demo.test",
          },
        },
      ],
    });
  });

  it("reports missing and unknown columns", () => {
    expect(readImportRows("employee_name,origin\nA,B")).toEqual({ error: expect.stringMatching(/Missing column: family_size/) });
    expect(readImportRows(`${header},salary\nA,1,B,C,2026-12-01,1,99`)).toEqual({ error: "Unknown column: salary" });
  });

  it("needs at least one relocation and caps the batch size", () => {
    expect(readImportRows(header)).toEqual({ error: expect.stringMatching(/at least one/) });
    const many = [header, ...Array.from({ length: 3 }, () => "A,1,B,C,2026-12-01,1")].join("\n");
    expect(readImportRows(many, 2)).toEqual({ error: "Import up to 2 relocations at a time." });
  });

  it("numbers rows by their line in the file", () => {
    const result = readImportRows(`${header}\nA,1,B,C,2026-12-01,1\nD,2,E,F,2026-12-02,2`);
    expect("rows" in result && result.rows.map((r) => r.line)).toEqual([2, 3]);
  });
});
