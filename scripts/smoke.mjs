// Headless smoke test for the Data Room app. Drives the real UI in Chromium
// against the running dev server. Isolated browser context (won't touch your
// browser profile / IndexedDB). Run: node scripts/smoke.mjs [baseURL]
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:5174";
const T = 8000; // per-action timeout; app has ~150ms simulated latency

// A minimal but valid-enough PDF so upload passes (PDF by extension, size > 0).
const PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 300]>>endobj
trailer<</Root 1 0 R>>
%%EOF`;
const pdfPath = join(tmpdir(), "report.pdf");
writeFileSync(pdfPath, PDF);

const pageErrors = [];
let passed = 0;
let failed = false;
const results = [];

async function step(name, fn) {
  try {
    await fn();
    passed++;
    results.push(`  ✓ ${name}`);
  } catch (err) {
    results.push(`  ✗ ${name}\n      ${err.message.split("\n")[0]}`);
    throw Object.assign(new Error(`Step failed: ${name}`), { cause: err });
  }
}

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.setDefaultTimeout(T);
page.on("pageerror", (e) => pageErrors.push(e.message));

const vis = (loc) => loc.first().waitFor({ state: "visible", timeout: T });
const gone = (loc) => loc.first().waitFor({ state: "detached", timeout: T });
const dialog = () => page.getByRole("dialog");

try {
  await step("home loads", async () => {
    await page.goto(BASE, { waitUntil: "networkidle" });
    await vis(page.getByRole("heading", { name: "Datarooms" }));
  });

  await step("create dataroom (dialog)", async () => {
    await page.getByRole("button", { name: "New dataroom" }).first().click();
    await dialog().getByRole("textbox").fill("Project Alpha");
    await dialog().getByRole("button", { name: "Create" }).click();
    await vis(page.getByRole("link", { name: "Project Alpha" }));
  });

  await step("open dataroom", async () => {
    await page.getByRole("link", { name: "Project Alpha" }).click();
    await vis(page.getByRole("heading", { name: "Project Alpha" }));
  });

  await step("create folder (dialog)", async () => {
    await page.getByRole("button", { name: "New folder" }).click();
    await dialog().getByRole("textbox").fill("Financials");
    await dialog().getByRole("button", { name: "Create" }).click();
    await vis(page.getByRole("link", { name: "Financials" }));
  });

  await step("duplicate name rejected inline (NAME_TAKEN)", async () => {
    await page.getByRole("button", { name: "New folder" }).click();
    await dialog().getByRole("textbox").fill("financials");
    await dialog().getByRole("button", { name: "Create" }).click();
    await vis(dialog().getByText(/already exists/i));
    await dialog().getByRole("button", { name: "Cancel" }).click();
    await gone(dialog());
  });

  await step("upload PDF", async () => {
    await page.setInputFiles('input[type="file"]', pdfPath);
    await vis(page.getByRole("button", { name: "report.pdf", exact: true }));
  });

  await step("duplicate upload auto-renames (report (1).pdf)", async () => {
    await page.setInputFiles('input[type="file"]', pdfPath);
    await vis(page.getByRole("button", { name: "report (1).pdf", exact: true }));
  });

  await step("preview opens (iframe + resizable split)", async () => {
    await page.getByRole("button", { name: "report.pdf", exact: true }).click();
    await vis(page.locator('iframe[title="PDF preview"]'));
    const panels = await page.locator("[data-panel]").count();
    if (panels < 2) throw new Error(`expected >=2 resizable panels, got ${panels}`);
  });

  await step("Esc closes preview", async () => {
    await page.keyboard.press("Escape");
    await gone(page.locator('iframe[title="PDF preview"]'));
  });

  await step("inline rename via row menu (Enter commits)", async () => {
    await page.getByRole("button", { name: "Actions for Financials" }).click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    const input = page.getByRole("textbox", { name: "New name" });
    await vis(input);
    await input.fill("Legal");
    await input.press("Enter");
    await vis(page.getByRole("link", { name: "Legal" }));
  });

  await step("open delete confirm (with count)", async () => {
    await page.getByRole("button", { name: "Actions for Legal" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await vis(page.getByRole("alertdialog"));
  });

  await step("confirm delete → Undo toast, row gone", async () => {
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await vis(page.getByRole("button", { name: "Undo" }));
    await gone(page.getByRole("link", { name: "Legal" }));
  });

  await step("Undo restores the row", async () => {
    await page.getByRole("button", { name: "Undo" }).click();
    await vis(page.getByRole("link", { name: "Legal" }));
  });

  await step("search finds file by name, navigates to preview", async () => {
    await page.getByRole("link", { name: "Legal" }).click(); // empty folder
    await vis(page.getByText("This folder is empty"));
    await page.getByPlaceholder("Search this dataroom").fill("report");
    const hit = page.getByText("report (1).pdf").first(); // results dropdown entry
    await vis(hit);
    await hit.click();
    await vis(page.locator('iframe[title="PDF preview"]'));
  });

  await step("deep link to missing folder → dead-end", async () => {
    await page.goto(`${BASE}/d/does-not-exist`, { waitUntil: "networkidle" });
    await vis(page.getByText(/no longer exists/i));
    await vis(page.getByRole("link", { name: /back to datarooms/i }));
  });

  results.push(`\n${passed} steps passed`);
} catch {
  failed = true;
  results.push(`\nFAILED after ${passed} passing step(s)`);
  await page.screenshot({ path: "scripts/smoke-failure.png", fullPage: true }).catch(() => {});
} finally {
  console.log(results.join("\n"));
  if (pageErrors.length) {
    console.log("\nUncaught page errors:");
    for (const e of pageErrors) console.log("  ! " + e);
  }
  await browser.close();
  const ok = !failed && pageErrors.length === 0;
  console.log(ok ? "\nSMOKE: PASS" : "\nSMOKE: FAIL");
  process.exit(ok ? 0 : 1);
}
