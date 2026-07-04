# Data Room MVP — Spec

Scope: a client-only SPA for organizing due-diligence documents. PDF only.
Persistence: IndexedDB (survives reload). No auth, no sharing — deliberately
out of scope; see README → "What I'd build next".

## Data model

Single flat store of nodes. Hierarchy via `parentId` (sentinel `ROOT` at top).

| Invariant | Rule |
|---|---|
| Hierarchy | datarooms live at root; folders/files live inside datarooms or folders |
| Naming | names are unique among live siblings, case-insensitive, single namespace (a folder and a file cannot share a name) |
| Name format | 1–255 chars after trim; `/` and `\` forbidden |
| Files | PDF only (MIME or `.pdf` extension), size > 0 bytes |
| Deletion | cascade over the whole subtree, soft-delete first (undo window), then purge |

## User stories & acceptance criteria

### 1. Datarooms
As a deal manager, I create separate datarooms per transaction.

- [ ] Create a dataroom from the home screen; empty name and duplicates are rejected inline
- [ ] Rename a dataroom; same validation as create
- [ ] Delete a dataroom → everything inside is deleted (cascade), with count shown in the confirm step and Undo available
- [ ] Home screen lists datarooms; empty state explains the first step

### 2. Folders
As a user, I organize documents in nested folders.

- [ ] Create a folder inside a dataroom or another folder (any depth)
- [ ] Name conflicts on explicit create are rejected with an inline error (user typed the name on purpose — do not auto-rename)
- [ ] Rename inline; Enter commits, Escape cancels; invalid names show why
- [ ] Delete shows "…and N items inside" and offers Undo for 5 s
- [ ] Breadcrumbs show the full path; every ancestor is clickable; deep paths collapse the middle into `…`

### 3. Files
As a user, I upload and read PDFs without leaving the app.

- [ ] Upload via button and via drag-and-drop onto the folder area (drop zone highlights)
- [ ] Multiple files per gesture; non-PDF and empty files are rejected per-file with a visible reason, valid files still upload
- [ ] Name conflicts on upload auto-resolve Drive-style: `report.pdf → report (1).pdf`; `report (1).pdf → report (2).pdf`
- [ ] Click a file → preview pane opens on the right (browser-native PDF render); Esc or ✕ closes; switching folders closes it
- [ ] Preview pane is resizable (25–65 %), width persists across sessions; table stays readable at every width
- [ ] Rename and delete work as for folders (delete = single item, still undoable)

### 4. Search
As a user, I find a document by name from anywhere in the dataroom.

- [ ] Substring match, case-insensitive, scoped to the current dataroom
- [ ] Results show the item's path ("Alpha / Financials") and navigate on click
- [ ] Empty query shows nothing; no matches state says so

### 5. Resilience
- [ ] Reloading the page loses nothing (IndexedDB)
- [ ] A deep link to a deleted folder shows a friendly dead-end with a way back
- [ ] Deleting the folder you are standing in navigates you to its parent
- [ ] All mutations show pending state; failures surface a readable message, never a silent no-op

## Error codes (API layer → UI copy)

| Code | Shown as |
|---|---|
| `NAME_TAKEN` | "…already exists here." (inline, next to the input) |
| `INVALID_NAME` | reason text from validation |
| `NOT_A_PDF` / `EMPTY_FILE` | per-file toast on upload |
| `NOT_FOUND` | dead-end screen or "item no longer exists" toast |
| `INVALID_PARENT` | should be unreachable from the UI; guards the API layer |

## Out of scope (deliberate)

Auth, sharing/permissions, blob storage backend, file versioning, moving
nodes between folders (drag-to-move), previews for non-PDF types.
