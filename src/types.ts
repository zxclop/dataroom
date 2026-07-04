/**
 * Domain model — flat, normalized.
 *
 * Every entity in the tree (dataroom, folder, file) is a Node in a single
 * key-value store. Hierarchy is expressed via `parentId` only:
 *
 *   ROOT_ID  ─┬─ dataroom "Project Alpha"
 *             │    ├─ folder "Financials"
 *             │    │    └─ file "q3-report.pdf"
 *             │    └─ file "nda.pdf"
 *             └─ dataroom "Project Beta"
 *
 * Why flat instead of a nested tree object:
 * - rename/move = O(1) update of one record (no deep mutation)
 * - children of X = filter by parentId (indexed in IndexedDB)
 * - cascade delete = collect descendants iteratively, delete in one tx
 * - trivially serializable to a future backend (rows in a table)
 */

export const ROOT_ID = "ROOT" as const;
// IndexedDB indexes cannot contain `null`, so the top level is modeled
// as a sentinel parent id instead of `parentId: null`.

export type NodeType = "dataroom" | "folder" | "file";

export interface DataroomNode {
  id: string;
  /** ROOT_ID for datarooms; a node id for everything nested. */
  parentId: string;
  type: NodeType;
  /** Display name. Unique (case-insensitive) among live siblings. */
  name: string;
  createdAt: number;
  updatedAt: number;

  /** Soft-delete timestamp; set while the "Undo" window is open. */
  deletedAt: number | null;

  // --- file-only fields ---
  /** Byte size of the stored blob. */
  size?: number;
  mimeType?: string;
}

/** Node types allowed as children of a given parent type. */
export const CHILD_RULES: Record<"root" | NodeType, NodeType[]> = {
  root: ["dataroom"],
  dataroom: ["folder", "file"],
  folder: ["folder", "file"],
  file: [],
};

export type ApiErrorCode =
  | "NAME_TAKEN"
  | "INVALID_NAME"
  | "NOT_FOUND"
  | "INVALID_PARENT"
  | "NOT_A_PDF"
  | "EMPTY_FILE";

export class ApiError extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}
