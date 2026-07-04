# CLAUDE.md — agent context for this repo

## What this is
Data Room MVP: client-only SPA for due-diligence document management.
Spec with acceptance criteria: `docs/SPEC.md` — read it before changing behavior.

## Stack
Vite · React 19 · TypeScript (strict) · Tailwind v4 · shadcn/ui · TanStack Query v5 · react-router v7 · idb (IndexedDB) · Vitest + fake-indexeddb

## Commands
- `npm run dev` — dev server
- `npm run build` — typecheck (`tsc -b`) + production build; must stay green
- `npx vitest run` — tests; must stay green
- `npx shadcn@latest add <component>` — add UI primitives (never hand-write them)

## Architecture (layers, top → bottom)
1. `src/pages/*` — route components. Render query state, fire mutations. No direct DB/API imports except via hooks.
2. `src/hooks/use-dataroom.ts` — TanStack Query wrappers. Owns query keys and invalidation. One hook per operation.
3. `src/api/dataroom.ts` — the "server". Async functions + simulated latency. The only module allowed to touch `lib/db`. Swapping to a real backend = rewriting only this file.
4. `src/lib/db.ts` — IndexedDB schema (idb). `nodes` = metadata, `blobs` = PDF bytes.
5. `src/types.ts` — domain model + `ApiError` codes. `src/lib/names.ts` — name validation/conflict logic (pure, unit-tested).

## Domain invariants (do not violate)
- Flat node store; hierarchy only via `parentId`; root sentinel is `ROOT_ID`, never `null`.
- Datarooms only at root; folders/files only inside. Enforced by `CHILD_RULES` in the API layer.
- Sibling names unique case-insensitively across both types. Explicit create/rename → reject conflict (`NAME_TAKEN`); upload → auto-rename via `nextAvailableName`.
- Files: PDF only, non-empty. Metadata and blob are written in one transaction.
- Delete is two-phase: `softDeleteNode` (sets `deletedAt`, whole subtree) → UI undo window → `purgeNode`. `purgeExpired()` runs at startup as the safety net. Restore must precede purge.

## Conventions
- Adding a feature: extend `api/dataroom.ts` → expose a hook in `use-dataroom.ts` → consume in a page. Never skip layers.
- All user-visible failures come from `ApiError` codes mapped to copy (see SPEC table). No raw error messages in the UI.
- UI text is English; sentence case; terse.
- Design language: legal-grade minimalism (Harvey/Linear): white, zinc grays, 1px borders, one accent, no decorative color, no features without implementation.
- Tests: pure logic in `lib/*.test.ts`; API behavior in `api/*.test.ts` against fake-indexeddb. New invariants get a test.

## Known placeholders (walking skeleton)
`window.prompt/confirm/alert` in pages are stand-ins for shadcn `Dialog`/`AlertDialog`/`sonner` toasts. The preview pane's fixed 52% width becomes a shadcn `Resizable` split. Replace during the polish pass; behavior is already final.
