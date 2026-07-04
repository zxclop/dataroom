import { ApiError } from "@/types";

/** "report.pdf" -> { base: "report", ext: ".pdf" }; "notes" -> { base: "notes", ext: "" } */
export function splitName(name: string): { base: string; ext: string } {
  const i = name.lastIndexOf(".");
  // A leading dot (".env") is part of the base, not an extension.
  if (i <= 0) return { base: name, ext: "" };
  return { base: name.slice(0, i), ext: name.slice(i) };
}

const COUNTER_RE = /^(.*) \((\d+)\)$/;

/**
 * Resolve a name conflict the way Dropbox/Drive do:
 *   report.pdf     -> report (1).pdf
 *   report (1).pdf -> report (2).pdf   (increments, never "(1) (1)")
 *
 * `taken` must contain lowercased names of live siblings.
 */
export function nextAvailableName(desired: string, taken: ReadonlySet<string>): string {
  if (!taken.has(desired.toLowerCase())) return desired;

  const { base, ext } = splitName(desired);
  const m = base.match(COUNTER_RE);
  const stem = m ? m[1] : base;
  let n = m ? parseInt(m[2], 10) + 1 : 1;

  // Bounded loop: taken is finite, so a free slot always exists.
  for (;;) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
    n++;
  }
}

export const MAX_NAME_LENGTH = 255;

/**
 * Normalize + validate a user-entered name.
 * Throws ApiError(INVALID_NAME) so callers surface one consistent message.
 */
export function normalizeName(raw: string): string {
  const name = raw.trim();
  if (name.length === 0) {
    throw new ApiError("INVALID_NAME", "Name cannot be empty.");
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new ApiError("INVALID_NAME", `Name is longer than ${MAX_NAME_LENGTH} characters.`);
  }
  if (/[/\\]/.test(name)) {
    throw new ApiError("INVALID_NAME", "Name cannot contain slashes.");
  }
  return name;
}

/** PDF check: trust either the browser-reported MIME or the extension. */
export function isPdf(file: { name: string; type: string }): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}
