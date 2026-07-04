// Seeds a realistic dataroom in an isolated context and captures the folder
// view (with the PDF preview open) to docs/screenshot.png for the README.
// Run: node scripts/screenshot.mjs [baseURL]
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:5174";

// Build a valid single-page PDF that renders visible text, computing the xref
// byte offsets in code so the file is correct (avoids a blank preview).
function buildPdf(title) {
  const objs = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>",
    `<</Length 90>>\nstream\nBT /F1 28 Tf 72 700 Td (${title}) Tj 0 -40 Td /F1 14 Tf (Confidential — due diligence) Tj ET\nendstream`,
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xrefStart = body.length;
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) body += String(off).padStart(10, "0") + " 00000 n \n";
  body += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(body, "latin1");
}

function pdf(name, title) {
  const p = join(tmpdir(), name);
  writeFileSync(p, buildPdf(title));
  return p;
}

const browser = await chromium.launch();
const page = await browser.newContext({
  viewport: { width: 1400, height: 850 },
  deviceScaleFactor: 2,
}).then((c) => c.newPage());
page.setDefaultTimeout(10000);

const dialog = () => page.getByRole("dialog");

await page.goto(BASE, { waitUntil: "networkidle" });

await page.getByRole("button", { name: "New dataroom" }).first().click();
await dialog().getByRole("textbox").fill("Project Atlas");
await dialog().getByRole("button", { name: "Create" }).click();
await page.getByRole("link", { name: "Project Atlas" }).click();

await page.getByRole("button", { name: "New folder" }).click();
await dialog().getByRole("textbox").fill("Financials");
await dialog().getByRole("button", { name: "Create" }).click();

await page.getByRole("link", { name: "Financials" }).click();
await page.setInputFiles('input[type="file"]', [
  pdf("q3-report.pdf", "Q3 Report"),
  pdf("cap-table.pdf", "Cap Table"),
  pdf("audit-2024.pdf", "Audit 2024"),
]);
await page.getByRole("button", { name: "New folder" }).click();
await dialog().getByRole("textbox").fill("Statements");
await dialog().getByRole("button", { name: "Create" }).click();

// Note: headless Chromium doesn't paint PDFs in an iframe, so the hero shot is
// the (reliable) full-width folder view. Grab a preview-open shot in a real
// browser if you want to show the PDF pane.
await page.getByRole("heading", { name: "Financials" }).waitFor({ state: "visible" });
await page.waitForTimeout(500);

mkdirSync("docs", { recursive: true });
await page.screenshot({ path: "docs/screenshot.png" });
console.log("Saved docs/screenshot.png");
await browser.close();
