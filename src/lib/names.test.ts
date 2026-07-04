import { describe, expect, it } from "vitest";
import { isPdf, nextAvailableName, normalizeName, splitName } from "./names";

const taken = (...names: string[]) => new Set(names.map((n) => n.toLowerCase()));

describe("splitName", () => {
  it("splits a regular file name", () => {
    expect(splitName("report.pdf")).toEqual({ base: "report", ext: ".pdf" });
  });
  it("keeps multi-dot bases intact", () => {
    expect(splitName("q3.final.pdf")).toEqual({ base: "q3.final", ext: ".pdf" });
  });
  it("treats extensionless names as pure base", () => {
    expect(splitName("Financials")).toEqual({ base: "Financials", ext: "" });
  });
  it("does not treat a leading dot as an extension", () => {
    expect(splitName(".env")).toEqual({ base: ".env", ext: "" });
  });
});

describe("nextAvailableName", () => {
  it("returns the name unchanged when free", () => {
    expect(nextAvailableName("report.pdf", taken("other.pdf"))).toBe("report.pdf");
  });
  it("appends (1) on first conflict", () => {
    expect(nextAvailableName("report.pdf", taken("report.pdf"))).toBe("report (1).pdf");
  });
  it("finds the next free slot", () => {
    expect(
      nextAvailableName("report.pdf", taken("report.pdf", "report (1).pdf", "report (2).pdf")),
    ).toBe("report (3).pdf");
  });
  it("increments an existing counter instead of nesting them", () => {
    expect(nextAvailableName("report (1).pdf", taken("report (1).pdf"))).toBe("report (2).pdf");
  });
  it("is case-insensitive", () => {
    expect(nextAvailableName("Report.PDF", taken("report.pdf"))).toBe("Report (1).PDF");
  });
  it("handles folders (no extension)", () => {
    expect(nextAvailableName("Financials", taken("financials"))).toBe("Financials (1)");
  });
});

describe("normalizeName", () => {
  it("trims whitespace", () => {
    expect(normalizeName("  q3.pdf  ")).toBe("q3.pdf");
  });
  it("rejects empty and whitespace-only", () => {
    expect(() => normalizeName("   ")).toThrowError(/empty/i);
  });
  it("rejects slashes", () => {
    expect(() => normalizeName("a/b")).toThrowError(/slash/i);
  });
  it("rejects names over 255 chars", () => {
    expect(() => normalizeName("x".repeat(256))).toThrowError(/255/);
  });
});

describe("isPdf", () => {
  it("accepts by MIME type", () => {
    expect(isPdf({ name: "scan", type: "application/pdf" })).toBe(true);
  });
  it("accepts by extension when MIME is missing", () => {
    expect(isPdf({ name: "scan.PDF", type: "" })).toBe(true);
  });
  it("rejects everything else", () => {
    expect(isPdf({ name: "notes.docx", type: "application/msword" })).toBe(false);
  });
});
