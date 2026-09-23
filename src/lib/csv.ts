// Small, strict CSV helpers for spec section 7 (import and export).

// Spreadsheet apps run cells starting with these characters as formulas.
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

// Parses RFC 4180 CSV: quoted fields, doubled quotes, commas and line breaks
// inside quotes, CRLF or LF line endings, and a leading byte-order mark.
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"' && field === "") {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (inQuotes) throw new Error("A quoted value is never closed");
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop blank lines.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

export const IMPORT_COLUMNS = ["employee_name", "family_size", "origin", "destination", "move_date", "budget", "employee_email"] as const;
const REQUIRED = IMPORT_COLUMNS.filter((c) => c !== "employee_email");

export type ImportRow = { line: number; values: Record<(typeof IMPORT_COLUMNS)[number], string> };

// Maps the header row to our columns; unknown columns are rejected so typos surface.
export function readImportRows(csv: string, maxRows = 200): { rows: ImportRow[] } | { error: string } {
  let table: string[][];
  try {
    table = parseCsv(csv);
  } catch (e) {
    return { error: (e as Error).message };
  }
  if (table.length < 2) return { error: "The file needs a header row and at least one relocation." };
  const header = table[0].map((h) => h.trim().toLowerCase());
  const unknown = header.filter((h) => !(IMPORT_COLUMNS as readonly string[]).includes(h));
  if (unknown.length) return { error: `Unknown column: ${unknown.join(", ")}` };
  const missing = REQUIRED.filter((c) => !header.includes(c));
  if (missing.length) return { error: `Missing column: ${missing.join(", ")}` };
  if (table.length - 1 > maxRows) return { error: `Import up to ${maxRows} relocations at a time.` };

  return {
    rows: table.slice(1).map((cells, i) => ({
      line: i + 2,
      values: Object.fromEntries(
        IMPORT_COLUMNS.map((c) => [c, (cells[header.indexOf(c)] ?? "").trim()]),
      ) as ImportRow["values"],
    })),
  };
}
