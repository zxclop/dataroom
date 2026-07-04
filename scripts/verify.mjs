// Full reviewer-checklist verification against the running dev server.
// Isolated context. Run: node scripts/verify.mjs [baseURL]
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:5174";
const T = 8000;

const PDF = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF";
function pdfFile(name) {
  const p = join(tmpdir(), name);
  writeFileSync(p, PDF);
  return p;
}

const pageErrors = [];
const results = [];
let failed = false;

async function step(name, fn) {
  try {
    await fn();
    results.push(`  ✓ ${name}`);
  } catch (err) {
    failed = true;
    results.push(`  ✗ ${name}\n      ${String(err.message).split("\n")[0]}`);
    throw err;
  }
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
page.setDefaultTimeout(T);
page.on("pageerror", (e) => pageErrors.push(e.message));

const vis = (loc) => loc.first().waitFor({ state: "visible", timeout: T });
const gone = (loc) => loc.first().waitFor({ state: "detached", timeout: T });
const dialog = () => page.getByRole("dialog");
const count = (loc) => loc.count();

async function createFolder(name) {
  await page.getByRole("button", { name: "New folder" }).click();
  await dialog().getByRole("textbox").fill(name);
  await dialog().getByRole("button", { name: "Create" }).click();
  await vis(page.getByRole("link", { name, exact: true }));
}
async function enter(name) {
  await page.getByRole("link", { name, exact: true }).click();
  await vis(page.getByRole("heading", { name, exact: true }));
}
async function uploadViaInput(paths) {
  await page.setInputFiles('input[type="file"]', paths);
}
async function dropFiles(specs) {
  const dt = await page.evaluateHandle((list) => {
    const d = new DataTransfer();
    for (const s of list) d.items.add(new File([new Uint8Array(s.bytes)], s.name, { type: s.type }));
    return d;
  }, specs);
  const zone = page.getByTestId("dropzone");
  await zone.dispatchEvent("dragenter", { dataTransfer: dt });
  await zone.dispatchEvent("drop", { dataTransfer: dt });
}

try {
  // --- First impression ---
  await step("empty home explains the first step", async () => {
    await page.goto(BASE, { waitUntil: "networkidle" });
    await vis(page.getByText("No datarooms yet"));
    await vis(page.getByRole("button", { name: "New dataroom" }).first());
  });

  await step("create dataroom → empty folder explains next step", async () => {
    await page.getByRole("button", { name: "New dataroom" }).first().click();
    await dialog().getByRole("textbox").fill("Alpha");
    await dialog().getByRole("button", { name: "Create" }).click();
    await enter("Alpha");
    await vis(page.getByText("This folder is empty"));
  });

  // --- Happy path: nesting + breadcrumbs ---
  await step("nest 4 levels deep", async () => {
    await createFolder("L1");
    await enter("L1");
    await createFolder("L2");
    await enter("L2");
    await createFolder("L3");
    await enter("L3");
    await vis(page.getByText("This folder is empty"));
  });

  await step("breadcrumbs: middle collapses, ancestors clickable", async () => {
    // Path is Alpha/L1/L2/L3 (>3) → middle collapsed into a … menu.
    await vis(page.getByText("…"));
    await page.getByText("…").click();
    await page.getByRole("menuitem", { name: "L1" }).click();
    await vis(page.getByRole("heading", { name: "L1", exact: true }));
    await page.getByRole("link", { name: "Datarooms" }).click();
    await vis(page.getByRole("heading", { name: "Datarooms" }));
  });

  // --- Multi-upload + preview + resize + Esc ---
  await step("upload 3 PDFs at once", async () => {
    await enter("Alpha");
    await enter("L1");
    await uploadViaInput([pdfFile("a.pdf"), pdfFile("b.pdf"), pdfFile("c.pdf")]);
    await vis(page.getByRole("button", { name: "a.pdf", exact: true }));
    await vis(page.getByRole("button", { name: "b.pdf", exact: true }));
    await vis(page.getByRole("button", { name: "c.pdf", exact: true }));
  });

  await step("preview opens, Esc closes (focus on page)", async () => {
    await page.getByRole("button", { name: "a.pdf", exact: true }).click();
    await vis(page.locator('iframe[title="PDF preview"]'));
    await page.keyboard.press("Escape"); // focus is on the file button, not the iframe
    await gone(page.locator('iframe[title="PDF preview"]'));
  });

  await step("divider drags to both extremes without breaking, ✕ closes", async () => {
    await page.getByRole("button", { name: "a.pdf", exact: true }).click();
    await vis(page.locator('iframe[title="PDF preview"]'));
    for (const targetX of [40, 1240]) {
      const b = await page.locator('[data-slot="resizable-handle"]').boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(targetX, b.y + b.height / 2, { steps: 10 });
      await page.mouse.up();
    }
    await vis(page.locator('iframe[title="PDF preview"]')); // survived extremes
    await vis(page.getByRole("button", { name: "a.pdf", exact: true })); // table readable
    await page.getByRole("button", { name: "Close preview" }).click();
    await gone(page.locator('iframe[title="PDF preview"]'));
  });

  // --- Edge: auto-rename report → (1) → (2) ---
  await step("same-name upload → report (1).pdf, then report (2).pdf", async () => {
    await page.getByRole("link", { name: "Datarooms" }).click();
    await enter("Alpha");
    await createFolder("Uploads");
    await enter("Uploads");
    await uploadViaInput([pdfFile("report.pdf")]);
    await vis(page.getByRole("button", { name: "report.pdf", exact: true }));
    await uploadViaInput([pdfFile("report.pdf")]);
    await vis(page.getByRole("button", { name: "report (1).pdf", exact: true }));
    await uploadViaInput([pdfFile("report.pdf")]);
    await vis(page.getByRole("button", { name: "report (2).pdf", exact: true }));
  });

  await step("uploading a file NAMED report (1).pdf → report (2).pdf, never (1) (1)", async () => {
    await page.getByRole("link", { name: "Datarooms" }).click();
    await enter("Alpha");
    await createFolder("Uploads2");
    await enter("Uploads2");
    await uploadViaInput([pdfFile("report.pdf")]);
    await uploadViaInput([pdfFile("report.pdf")]); // report (1).pdf
    await vis(page.getByRole("button", { name: "report (1).pdf", exact: true }));
    await uploadViaInput([pdfFile("report (1).pdf")]); // literal name
    await vis(page.getByRole("button", { name: "report (2).pdf", exact: true }));
    if ((await count(page.getByText("report (1) (1).pdf"))) !== 0) {
      throw new Error("produced 'report (1) (1).pdf'");
    }
  });

  // --- Edge: duplicate folder name → inline error (not alert/silence) ---
  await step("create folder with existing name → inline error, dialog stays open", async () => {
    await page.getByRole("link", { name: "Datarooms" }).click();
    await enter("Alpha");
    await createFolder("Dup");
    await page.getByRole("button", { name: "New folder" }).click();
    await dialog().getByRole("textbox").fill("dup"); // case-insensitive clash
    await dialog().getByRole("button", { name: "Create" }).click();
    await vis(dialog().getByText(/already exists/i));
    await vis(dialog()); // still open, not dismissed
    await dialog().getByRole("button", { name: "Cancel" }).click();
    await gone(dialog());
  });

  // --- Edge: rename to empty / to sibling ---
  await step("inline rename to empty → inline reason, keeps editing", async () => {
    await page.getByRole("button", { name: "Actions for Dup" }).click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    const input = page.getByRole("textbox", { name: "New name" });
    await input.fill("");
    await input.press("Enter");
    await vis(page.getByText(/cannot be empty/i));
    await input.press("Escape");
  });

  await step("inline rename to a sibling's name → inline NAME_TAKEN", async () => {
    await createFolder("Sibling");
    await page.getByRole("button", { name: "Actions for Sibling" }).click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    const input = page.getByRole("textbox", { name: "New name" });
    await input.fill("Dup");
    await input.press("Enter");
    await vis(page.getByText(/already exists/i));
    await input.press("Escape");
  });

  // --- Edge: drag&drop non-PDF + mix ---
  await step("drag&drop non-PDF → highlight then clear reason", async () => {
    await createFolder("Drops");
    await enter("Drops");
    const dt = await page.evaluateHandle(() => new DataTransfer());
    await page.getByTestId("dropzone").dispatchEvent("dragenter", { dataTransfer: dt });
    await vis(page.getByText("Drop PDFs to upload"));
    await dropFiles([{ name: "logo.png", type: "image/png", bytes: [1, 2, 3] }]);
    await gone(page.getByText("Drop PDFs to upload"));
    await vis(page.getByText(/only pdf files are supported/i));
  });

  await step("drag&drop mix PDF+PNG → PDF in, PNG rejected with reason", async () => {
    await dropFiles([
      { name: "good.pdf", type: "application/pdf", bytes: [37, 80, 68, 70] },
      { name: "bad.png", type: "image/png", bytes: [1, 2, 3] },
    ]);
    await vis(page.getByRole("button", { name: "good.pdf", exact: true }));
    await vis(page.getByText(/uploaded 1 file/i));
  });

  // --- Edge: delete folder with content + Undo ---
  await step("delete folder with content → shows count + Undo restores", async () => {
    await page.getByRole("link", { name: "Datarooms" }).click();
    await enter("Alpha");
    await createFolder("Bin");
    await enter("Bin");
    await uploadViaInput([pdfFile("x.pdf"), pdfFile("y.pdf")]);
    await vis(page.getByRole("button", { name: "y.pdf", exact: true }));
    await page.getByRole("link", { name: "Datarooms" }).click();
    await enter("Alpha");
    await page.getByRole("button", { name: "Actions for Bin" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await vis(page.getByRole("alertdialog").getByText(/2 items/i));
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await vis(page.getByRole("button", { name: "Undo" }));
    await gone(page.getByRole("link", { name: "Bin", exact: true }));
    await page.getByRole("button", { name: "Undo" }).click();
    await vis(page.getByRole("link", { name: "Bin", exact: true }));
  });

  // --- Edge: delete the folder you're standing in → go to parent ---
  await step("delete current folder → redirect to parent (no white screen)", async () => {
    await createFolder("Standing");
    await enter("Standing");
    await page.getByRole("button", { name: "Actions for Standing" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await vis(page.getByRole("heading", { name: "Alpha", exact: true })); // back at parent
  });

  // --- Technical: deep-link load, reload persistence, dead-end ---
  let alphaUrl = "";
  await step("F5 on a deep link renders (not 404)", async () => {
    await page.getByRole("link", { name: "Datarooms" }).click();
    await enter("Alpha");
    alphaUrl = page.url();
    await page.goto(alphaUrl, { waitUntil: "networkidle" }); // simulate direct hit / F5
    await vis(page.getByRole("heading", { name: "Alpha", exact: true }));
    await vis(page.getByRole("link", { name: "Uploads", exact: true }));
  });

  await step("reload keeps data (IndexedDB)", async () => {
    await page.reload({ waitUntil: "networkidle" });
    await vis(page.getByRole("link", { name: "Uploads", exact: true }));
  });

  await step("deep link to a deleted folder → friendly dead-end", async () => {
    await enter("Sibling"); // any live folder
    const deadUrl = page.url();
    await page.getByRole("link", { name: "Datarooms" }).click();
    await enter("Alpha");
    await page.getByRole("button", { name: "Actions for Sibling" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await page.waitForTimeout(6000); // let the undo window pass and purge run
    await page.goto(deadUrl, { waitUntil: "networkidle" });
    await vis(page.getByText(/no longer exists/i));
    await vis(page.getByRole("link", { name: /back to datarooms/i }));
  });

  // --- Technical: narrow window doesn't break the table ---
  await step("narrow window keeps the table intact", async () => {
    await page.setViewportSize({ width: 640, height: 800 });
    await page.goto(alphaUrl, { waitUntil: "networkidle" });
    await vis(page.getByRole("heading", { name: "Alpha", exact: true }));
    await vis(page.getByRole("link", { name: "Uploads", exact: true }));
    await page.screenshot({ path: "scripts/verify-narrow.png" });
  });

  results.push("\nALL SCENARIOS PASSED");
} catch {
  results.push("\nSTOPPED AT FAILURE ABOVE");
  await page.screenshot({ path: "scripts/verify-failure.png", fullPage: true }).catch(() => {});
} finally {
  console.log(results.join("\n"));
  if (pageErrors.length) {
    console.log("\nUncaught page errors:");
    for (const e of pageErrors) console.log("  ! " + e);
  }
  await browser.close();
  const ok = !failed && pageErrors.length === 0;
  console.log(ok ? "\nVERIFY: PASS" : "\nVERIFY: FAIL");
  process.exit(ok ? 0 : 1);
}
