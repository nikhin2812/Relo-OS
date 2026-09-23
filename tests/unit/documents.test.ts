import { describe, expect, it } from "vitest";

import { MAX_UPLOAD_BYTES, checkUpload, cleanFileName, storagePath } from "@/lib/documents";

const bytes = (...b: number[]) => new Uint8Array([...b, 0, 0, 0, 0, 0, 0, 0, 0]);
const PDF = bytes(0x25, 0x50, 0x44, 0x46, 0x2d);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const JPG = bytes(0xff, 0xd8, 0xff, 0xe0);

describe("checkUpload", () => {
  it("accepts PDF, PNG and JPG by their content", () => {
    expect(checkUpload("visa.pdf", 1000, PDF)).toMatchObject({ ok: true, mime: "application/pdf", ext: "pdf" });
    expect(checkUpload("photo.png", 1000, PNG)).toMatchObject({ ok: true, mime: "image/png", ext: "png" });
    expect(checkUpload("scan.jpeg", 1000, JPG)).toMatchObject({ ok: true, mime: "image/jpeg", ext: "jpg" });
  });

  it("goes by content, not by the file name", () => {
    expect(checkUpload("looks-like.pdf", 100, new TextEncoder().encode("<html>not a pdf</html>"))).toMatchObject({ ok: false });
    expect(checkUpload("renamed.exe", 1000, PDF)).toMatchObject({ ok: true, ext: "pdf" });
  });

  it("rejects empty and oversized files", () => {
    expect(checkUpload("a.pdf", 0, PDF)).toEqual({ ok: false, error: "The file is empty." });
    expect(checkUpload("a.pdf", MAX_UPLOAD_BYTES + 1, PDF)).toEqual({ ok: false, error: "Files can be up to 4 MB." });
    expect(checkUpload("a.pdf", MAX_UPLOAD_BYTES, PDF).ok).toBe(true);
  });
});

describe("cleanFileName", () => {
  it("drops folders and odd characters but keeps a readable name", () => {
    expect(cleanFileName("C:\\Users\\me\\Passport scan (2).pdf")).toBe("Passport scan (2).pdf");
    expect(cleanFileName("../../etc/passwd")).toBe("passwd");
    expect(cleanFileName('<script>"x".pdf')).toBe("_script__x_.pdf");
    expect(cleanFileName("...hidden")).toBe("hidden");
    expect(cleanFileName("")).toBe("document");
  });

  it("limits the length", () => {
    expect(cleanFileName("a".repeat(500) + ".pdf").length).toBe(150);
  });
});

describe("storagePath", () => {
  it("files every document under its relocation", () => {
    expect(storagePath("40000000-0000-0000-0000-000000000001", "abc", "pdf")).toBe(
      "40000000-0000-0000-0000-000000000001/abc.pdf",
    );
  });
});
