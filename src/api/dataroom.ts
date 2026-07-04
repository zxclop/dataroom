/**
 * The "server". Components never touch IndexedDB directly — they call this
 * module through TanStack Query. Every function is async and goes through a
 * simulated latency, which forces the UI to handle loading/error states
 * honestly. Swapping this for a real backend = replacing function bodies
 * with fetch() calls; nothing above this layer changes.
 */
import { getDB } from "@/lib/db";
import { isPdf, nextAvailableName, normalizeName } from "@/lib/names";
import { ApiError, CHILD_RULES, ROOT_ID, type DataroomNode, type NodeType } from "@/types";

// --- simulated network -------------------------------------------------

let latencyMs = 150;
/** Tests set this to 0. */
export function __setLatency(ms: number): void {
  latencyMs = ms;
}
const delay = () => new Promise<void>((r) => setTimeout(r, latencyMs));

// --- internal helpers ---------------------------------------------------

function newId(): string {
  return crypto.randomUUID();
}

async function requireLiveNode(id: string): Promise<DataroomNode> {
  const db = await getDB();
  const node = await db.get("nodes", id);
  if (!node || node.deletedAt !== null) {
    throw new ApiError("NOT_FOUND", "This item no longer exists.");
  }
  return node;
}

/** Live (non-deleted) children of a parent. */
async function liveChildren(parentId: string): Promise<DataroomNode[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex("nodes", "by-parent", parentId);
  return all.filter((n) => n.deletedAt === null);
}

/** Lowercased names of live siblings — the "taken" set for conflict checks. */
async function takenNames(parentId: string, excludeId?: string): Promise<Set<string>> {
  const siblings = await liveChildren(parentId);
  return new Set(siblings.filter((s) => s.id !== excludeId).map((s) => s.name.toLowerCase()));
}

function assertChildAllowed(parent: DataroomNode | null, childType: NodeType): void {
  const allowed = parent ? CHILD_RULES[parent.type] : CHILD_RULES.root;
  if (!allowed.includes(childType)) {
    throw new ApiError("INVALID_PARENT", `A ${childType} cannot be created here.`);
  }
}

/**
 * Collect ids of a node and all its descendants (BFS over the parent index).
 * Includes soft-deleted descendants so purge/restore act on the whole subtree.
 */
async function collectSubtreeIds(rootId: string): Promise<string[]> {
  const db = await getDB();
  const ids: string[] = [];
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    ids.push(id);
    const children = await db.getAllFromIndex("nodes", "by-parent", id);
    for (const child of children) queue.push(child.id);
  }
  return ids;
}

// --- queries -------------------------------------------------------------

export async function getNode(id: string): Promise<DataroomNode> {
  await delay();
  return requireLiveNode(id);
}

/** Children of ROOT_ID = the list of datarooms. Folders first, natural sort. */
export async function listChildren(parentId: string): Promise<DataroomNode[]> {
  await delay();
  if (parentId !== ROOT_ID) await requireLiveNode(parentId); // 404 for dead links
  const children = await liveChildren(parentId);
  const rank: Record<NodeType, number> = { dataroom: 0, folder: 0, file: 1 };
  return children.sort(
    (a, b) =>
      rank[a.type] - rank[b.type] ||
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
  );
}

/** Ancestor chain from the dataroom down to the node itself (for breadcrumbs). */
export async function getPath(id: string): Promise<DataroomNode[]> {
  await delay();
  const path: DataroomNode[] = [];
  let current: string = id;
  while (current !== ROOT_ID) {
    const node = await requireLiveNode(current);
    path.unshift(node);
    current = node.parentId;
  }
  return path;
}

export interface SearchHit {
  node: DataroomNode;
  /** Human-readable location, e.g. "Project Alpha / Financials". */
  path: string;
}

/** Case-insensitive substring search by name across one dataroom (or all). */
export async function searchByName(query: string, dataroomId?: string): Promise<SearchHit[]> {
  await delay();
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [];

  const db = await getDB();
  const all = (await db.getAll("nodes")).filter((n) => n.deletedAt === null);
  const byId = new Map(all.map((n) => [n.id, n]));

  const pathOf = (n: DataroomNode): { labels: string[]; rootId: string } => {
    const labels: string[] = [];
    let cur = n;
    while (cur.parentId !== ROOT_ID) {
      const parent = byId.get(cur.parentId);
      if (!parent) break; // orphaned by a purge mid-flight; skip silently
      labels.unshift(parent.name);
      cur = parent;
    }
    return { labels, rootId: cur.id };
  };

  const hits: SearchHit[] = [];
  for (const node of all) {
    if (node.type === "dataroom") continue; // rooms are containers, not results
    if (!node.name.toLowerCase().includes(q)) continue;
    const { labels, rootId } = pathOf(node);
    if (dataroomId && rootId !== dataroomId) continue;
    hits.push({ node, path: labels.join(" / ") });
  }
  return hits.sort((a, b) => a.node.name.localeCompare(b.node.name, undefined, { numeric: true }));
}

/**
 * Count live descendants of a node (excluding the node itself). Powers the
 * delete confirmation ("…and N items inside") without mutating anything —
 * the confirm step needs the number before the soft-delete happens.
 */
export async function countDescendants(id: string): Promise<number> {
  await delay();
  await requireLiveNode(id);
  let count = 0;
  const queue = [id];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const child of await liveChildren(current)) {
      count++;
      queue.push(child.id);
    }
  }
  return count;
}

export async function getFileBlob(id: string): Promise<Blob> {
  await delay();
  const node = await requireLiveNode(id);
  if (node.type !== "file") throw new ApiError("NOT_FOUND", "Not a file.");
  const db = await getDB();
  const blob = await db.get("blobs", id);
  if (!blob) throw new ApiError("NOT_FOUND", "File contents are missing.");
  return blob;
}

// --- mutations -----------------------------------------------------------

/**
 * Create a dataroom (parentId = ROOT_ID) or a folder.
 * Explicit creation does NOT auto-rename: the user typed the name on purpose,
 * so a conflict is surfaced as an inline error they can edit.
 */
export async function createContainer(input: {
  parentId: string;
  type: "dataroom" | "folder";
  name: string;
}): Promise<DataroomNode> {
  await delay();
  const name = normalizeName(input.name);

  const parent = input.parentId === ROOT_ID ? null : await requireLiveNode(input.parentId);
  assertChildAllowed(parent, input.type);

  const taken = await takenNames(input.parentId);
  if (taken.has(name.toLowerCase())) {
    throw new ApiError("NAME_TAKEN", `"${name}" already exists here.`);
  }

  const now = Date.now();
  const node: DataroomNode = {
    id: newId(),
    parentId: input.parentId,
    type: input.type,
    name,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  const db = await getDB();
  await db.put("nodes", node);
  return node;
}

export interface UploadResult {
  uploaded: DataroomNode[];
  rejected: { name: string; reason: "NOT_A_PDF" | "EMPTY_FILE" }[];
}

/**
 * Upload a batch of files.
 * Batch semantics: valid files go in, invalid ones are reported — one bad
 * file must not abort the other nine. Name conflicts are auto-resolved
 * ("report (1).pdf") because interrupting a drag-and-drop with N dialogs
 * is hostile; rename is one click away afterwards.
 */
export async function uploadFiles(input: { parentId: string; files: File[] }): Promise<UploadResult> {
  await delay();
  const parent = await requireLiveNode(input.parentId);
  assertChildAllowed(parent, "file");

  const taken = await takenNames(input.parentId);
  const result: UploadResult = { uploaded: [], rejected: [] };

  const db = await getDB();
  const tx = db.transaction(["nodes", "blobs"], "readwrite");
  const now = Date.now();

  for (const file of input.files) {
    if (!isPdf(file)) {
      result.rejected.push({ name: file.name, reason: "NOT_A_PDF" });
      continue;
    }
    if (file.size === 0) {
      result.rejected.push({ name: file.name, reason: "EMPTY_FILE" });
      continue;
    }
    const name = nextAvailableName(normalizeName(file.name), taken);
    taken.add(name.toLowerCase()); // duplicates *within* the same batch, too

    const node: DataroomNode = {
      id: newId(),
      parentId: input.parentId,
      type: "file",
      name,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      size: file.size,
      mimeType: "application/pdf",
    };
    void tx.objectStore("nodes").put(node);
    void tx.objectStore("blobs").put(file, node.id);
    result.uploaded.push(node);
  }

  await tx.done; // metadata + bytes commit atomically
  return result;
}

export async function renameNode(input: { id: string; name: string }): Promise<DataroomNode> {
  await delay();
  const name = normalizeName(input.name);
  const node = await requireLiveNode(input.id);

  if (name === node.name) return node; // no-op, not an error

  const taken = await takenNames(node.parentId, node.id);
  if (taken.has(name.toLowerCase())) {
    throw new ApiError("NAME_TAKEN", `"${name}" already exists here.`);
  }

  const updated: DataroomNode = { ...node, name, updatedAt: Date.now() };
  const db = await getDB();
  await db.put("nodes", updated);
  return updated;
}

export interface DeleteResult {
  /** Total nodes affected (the target + descendants) — for the undo toast. */
  affected: number;
}

/**
 * Soft-delete a subtree: mark every node with deletedAt = now.
 * The UI shows an Undo toast; after it expires it calls purgeNode().
 * If the tab dies before purge, purgeExpired() sweeps on next startup.
 */
export async function softDeleteNode(id: string): Promise<DeleteResult> {
  await delay();
  await requireLiveNode(id);
  const ids = await collectSubtreeIds(id);

  const db = await getDB();
  const tx = db.transaction("nodes", "readwrite");
  const now = Date.now();
  for (const nodeId of ids) {
    const node = await tx.store.get(nodeId);
    if (node && node.deletedAt === null) {
      void tx.store.put({ ...node, deletedAt: now });
    }
  }
  await tx.done;
  return { affected: ids.length };
}

/** Undo: bring a soft-deleted subtree back. */
export async function restoreNode(id: string): Promise<void> {
  await delay();
  const ids = await collectSubtreeIds(id);
  const db = await getDB();
  const tx = db.transaction("nodes", "readwrite");
  for (const nodeId of ids) {
    const node = await tx.store.get(nodeId);
    if (node && node.deletedAt !== null) {
      void tx.store.put({ ...node, deletedAt: null });
    }
  }
  await tx.done;
}

/** Physically remove a subtree: metadata and blobs, one transaction. */
export async function purgeNode(id: string): Promise<void> {
  // No artificial delay: this runs behind an expired undo toast.
  const ids = await collectSubtreeIds(id);
  const db = await getDB();
  const tx = db.transaction(["nodes", "blobs"], "readwrite");
  for (const nodeId of ids) {
    void tx.objectStore("nodes").delete(nodeId);
    void tx.objectStore("blobs").delete(nodeId);
  }
  await tx.done;
}

/**
 * Startup sweep: purge anything whose undo window expired in a previous
 * session (e.g. the tab was closed while the toast was still visible).
 */
export async function purgeExpired(maxAgeMs = 10_000): Promise<void> {
  const db = await getDB();
  const all = await db.getAll("nodes");
  const cutoff = Date.now() - maxAgeMs;
  // Inclusive: a tombstone deleted at T is expired once now >= T + maxAgeMs,
  // i.e. deletedAt <= cutoff. Strict `<` misses same-millisecond deletions
  // (e.g. purgeExpired(0) right after a delete), leaving them un-swept.
  const expiredRoots = all.filter((n) => n.deletedAt !== null && n.deletedAt <= cutoff);
  for (const node of expiredRoots) {
    await purgeNode(node.id);
  }
}
