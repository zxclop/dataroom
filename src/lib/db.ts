import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { DataroomNode } from "@/types";

/**
 * Two stores:
 * - `nodes`: metadata for every dataroom/folder/file (small, indexed)
 * - `blobs`: raw PDF bytes, keyed by the owning file node id
 *
 * Kept separate so listing a folder never deserializes file contents.
 * This mirrors a real backend split: rows in Postgres, bytes in S3 —
 * which is exactly how this module would be swapped for HTTP calls.
 */
interface DataroomDB extends DBSchema {
  nodes: {
    key: string;
    value: DataroomNode;
    indexes: { "by-parent": string };
  };
  blobs: {
    key: string; // file node id
    value: Blob;
  };
}

let dbPromise: Promise<IDBPDatabase<DataroomDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<DataroomDB>> {
  dbPromise ??= openDB<DataroomDB>("dataroom", 1, {
    upgrade(db) {
      const nodes = db.createObjectStore("nodes", { keyPath: "id" });
      nodes.createIndex("by-parent", "parentId");
      db.createObjectStore("blobs");
    },
  });
  return dbPromise;
}

/** Test-only: reset the singleton so each test gets a fresh database. */
export function __resetDBForTests(): void {
  dbPromise = null;
}
