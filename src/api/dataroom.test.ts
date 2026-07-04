/**
 * Integration tests for the API layer, running against fake-indexeddb.
 * These pin the behaviors the UI depends on: sibling uniqueness, batch
 * upload semantics, cascade soft-delete -> restore -> purge.
 */
import { beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { __resetDBForTests } from "@/lib/db";
import { ApiError, ROOT_ID } from "@/types";
import * as api from "./dataroom";

function pdf(name: string, bytes = 3): File {
  return new File([new Uint8Array(bytes)], name, { type: "application/pdf" });
}

beforeEach(() => {
  // Fresh database per test: new IDB factory + reset the module singleton.
  globalThis.indexedDB = new IDBFactory();
  __resetDBForTests();
});

async function seedRoomWithFolder() {
  const room = await api.createContainer({ parentId: ROOT_ID, type: "dataroom", name: "Alpha" });
  const folder = await api.createContainer({ parentId: room.id, type: "folder", name: "Financials" });
  return { room, folder };
}

describe("createContainer", () => {
  it("creates datarooms at root and folders inside", async () => {
    const { room, folder } = await seedRoomWithFolder();
    expect((await api.listChildren(ROOT_ID)).map((n) => n.id)).toEqual([room.id]);
    expect((await api.listChildren(room.id)).map((n) => n.id)).toEqual([folder.id]);
  });

  it("rejects duplicate sibling names case-insensitively", async () => {
    const { room } = await seedRoomWithFolder();
    await expect(
      api.createContainer({ parentId: room.id, type: "folder", name: "financials" }),
    ).rejects.toMatchObject({ code: "NAME_TAKEN" });
  });

  it("rejects folders at root", async () => {
    await expect(
      api.createContainer({ parentId: ROOT_ID, type: "folder", name: "Loose folder" }),
    ).rejects.toMatchObject({ code: "INVALID_PARENT" });
  });
});

describe("uploadFiles", () => {
  it("stores valid PDFs and reports rejects without aborting the batch", async () => {
    const { folder } = await seedRoomWithFolder();
    const res = await api.uploadFiles({
      parentId: folder.id,
      files: [pdf("a.pdf"), new File(["x"], "b.docx", { type: "text/plain" }), pdf("empty.pdf", 0)],
    });
    expect(res.uploaded.map((n) => n.name)).toEqual(["a.pdf"]);
    expect(res.rejected).toEqual([
      { name: "b.docx", reason: "NOT_A_PDF" },
      { name: "empty.pdf", reason: "EMPTY_FILE" },
    ]);
  });

  it("auto-renames conflicts, including duplicates within one batch", async () => {
    const { folder } = await seedRoomWithFolder();
    await api.uploadFiles({ parentId: folder.id, files: [pdf("report.pdf")] });
    const res = await api.uploadFiles({
      parentId: folder.id,
      files: [pdf("report.pdf"), pdf("report.pdf")],
    });
    expect(res.uploaded.map((n) => n.name)).toEqual(["report (1).pdf", "report (2).pdf"]);
  });

  it("round-trips file bytes", async () => {
    const { folder } = await seedRoomWithFolder();
    const res = await api.uploadFiles({ parentId: folder.id, files: [pdf("a.pdf", 5)] });
    const blob = await api.getFileBlob(res.uploaded[0].id);
    expect(blob.size).toBe(5);
  });
});

describe("renameNode", () => {
  it("renames and bumps updatedAt", async () => {
    const { folder } = await seedRoomWithFolder();
    const renamed = await api.renameNode({ id: folder.id, name: "Legal" });
    expect(renamed.name).toBe("Legal");
    expect(renamed.updatedAt).toBeGreaterThanOrEqual(renamed.createdAt);
  });

  it("treats renaming to the same name as a no-op", async () => {
    const { folder } = await seedRoomWithFolder();
    await expect(api.renameNode({ id: folder.id, name: "Financials" })).resolves.toBeDefined();
  });

  it("rejects a sibling's name", async () => {
    const { room } = await seedRoomWithFolder();
    await api.createContainer({ parentId: room.id, type: "folder", name: "Legal" });
    await expect(api.renameNode({ id: (await api.listChildren(room.id))[1].id, name: "Financials" }))
      .rejects.toMatchObject({ code: "NAME_TAKEN" });
  });
});

describe("delete lifecycle", () => {
  it("soft-deletes a subtree, restore brings it all back", async () => {
    const { room, folder } = await seedRoomWithFolder();
    await api.uploadFiles({ parentId: folder.id, files: [pdf("a.pdf"), pdf("b.pdf")] });

    const res = await api.softDeleteNode(folder.id);
    expect(res.affected).toBe(3); // folder + 2 files
    expect(await api.listChildren(room.id)).toEqual([]);

    await api.restoreNode(folder.id);
    expect((await api.listChildren(room.id)).map((n) => n.name)).toEqual(["Financials"]);
    expect((await api.listChildren(folder.id)).length).toBe(2);
  });

  it("purge removes metadata and blobs permanently", async () => {
    const { room, folder } = await seedRoomWithFolder();
    const up = await api.uploadFiles({ parentId: folder.id, files: [pdf("a.pdf")] });

    await api.softDeleteNode(folder.id);
    await api.purgeNode(folder.id);

    expect(await api.listChildren(room.id)).toEqual([]);
    await expect(api.getFileBlob(up.uploaded[0].id)).rejects.toBeInstanceOf(ApiError);
  });

  it("frees the name for reuse after soft delete", async () => {
    const { room, folder } = await seedRoomWithFolder();
    await api.softDeleteNode(folder.id);
    await expect(
      api.createContainer({ parentId: room.id, type: "folder", name: "Financials" }),
    ).resolves.toBeDefined();
  });

  it("purgeExpired sweeps stale tombstones on startup", async () => {
    const { room, folder } = await seedRoomWithFolder();
    await api.softDeleteNode(folder.id);
    await api.purgeExpired(0); // everything soft-deleted "long ago"
    await api.restoreNode(folder.id); // restoring a purged node is a no-op
    expect(await api.listChildren(room.id)).toEqual([]);
  });
});

describe("countDescendants", () => {
  it("counts live descendants, excluding the node itself", async () => {
    const { room, folder } = await seedRoomWithFolder();
    await api.uploadFiles({ parentId: folder.id, files: [pdf("a.pdf"), pdf("b.pdf")] });
    expect(await api.countDescendants(folder.id)).toBe(2); // 2 files
    expect(await api.countDescendants(room.id)).toBe(3); // folder + 2 files
  });

  it("ignores soft-deleted descendants", async () => {
    const { folder } = await seedRoomWithFolder();
    const up = await api.uploadFiles({ parentId: folder.id, files: [pdf("a.pdf"), pdf("b.pdf")] });
    await api.softDeleteNode(up.uploaded[0].id);
    expect(await api.countDescendants(folder.id)).toBe(1);
  });
});

describe("getPath", () => {
  it("returns the ancestor chain for breadcrumbs", async () => {
    const { folder } = await seedRoomWithFolder();
    const sub = await api.createContainer({ parentId: folder.id, type: "folder", name: "Q3" });
    const path = await api.getPath(sub.id);
    expect(path.map((n) => n.name)).toEqual(["Alpha", "Financials", "Q3"]);
  });
});

describe("searchByName", () => {
  it("finds by substring with a readable path, scoped to a dataroom", async () => {
    const { room, folder } = await seedRoomWithFolder();
    void room;
    await api.uploadFiles({ parentId: folder.id, files: [pdf("Q3-report.pdf")] });
    const other = await api.createContainer({ parentId: ROOT_ID, type: "dataroom", name: "Beta" });
    await api.uploadFiles({
      parentId: (await api.createContainer({ parentId: other.id, type: "folder", name: "Docs" })).id,
      files: [pdf("q3-summary.pdf")],
    });

    const scoped = await api.searchByName("q3", room.id);
    expect(scoped.map((h) => h.node.name)).toEqual(["Q3-report.pdf"]);
    expect(scoped[0].path).toBe("Alpha / Financials");

    const global = await api.searchByName("q3");
    expect(global.length).toBe(2);
  });
});
