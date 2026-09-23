// MVP item 7: checks on uploaded files before they reach storage.

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4 MB (Vercel caps request bodies at ~4.5 MB)

export const DOCUMENT_KINDS = ["booking", "visa", "identity", "school", "housing", "other"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  booking: "Booking confirmation",
  visa: "Visa or permit",
  identity: "Passport or ID",
  school: "School document",
  housing: "Housing document",
  other: "Other",
};

type AllowedType = { mime: "application/pdf" | "image/jpeg" | "image/png"; ext: string; magic: number[] };

const ALLOWED: AllowedType[] = [
  { mime: "application/pdf", ext: "pdf", magic: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { mime: "image/png", ext: "png", magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: "image/jpeg", ext: "jpg", magic: [0xff, 0xd8, 0xff] },
];

export type UploadCheck =
  | { ok: true; mime: AllowedType["mime"]; ext: string; fileName: string }
  | { ok: false; error: string };

// Keeps a readable name but drops paths and odd characters.
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N} ._()-]/gu, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
  return cleaned.replace(/^\.+/, "") || "document";
}

// Decides the file type from its first bytes, not from what the browser claims.
export function checkUpload(name: string, size: number, firstBytes: Uint8Array): UploadCheck {
  if (size <= 0) return { ok: false, error: "The file is empty." };
  if (size > MAX_UPLOAD_BYTES) return { ok: false, error: "Files can be up to 4 MB." };
  const type = ALLOWED.find((t) => t.magic.every((byte, i) => firstBytes[i] === byte));
  if (!type) return { ok: false, error: "Only PDF, JPG and PNG files can be uploaded." };
  return { ok: true, mime: type.mime, ext: type.ext, fileName: cleanFileName(name) };
}

export function storagePath(assignmentId: string, randomId: string, ext: string): string {
  return `${assignmentId}/${randomId}.${ext}`;
}
