/**
 * One hook per operation. Components stay dumb: they render query state and
 * fire mutations; caching and refetching live here, in query keys.
 *
 * Invalidation is targeted: a mutation invalidates the parent's children
 * list — not the whole cache. Rename also touches paths (breadcrumbs) and
 * search results, since both embed node names.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/api/dataroom";
import { ROOT_ID } from "@/types";

export const keys = {
  children: (parentId: string) => ["children", parentId] as const,
  node: (id: string) => ["node", id] as const,
  path: (id: string) => ["path", id] as const,
  descendantCount: (id: string) => ["descendant-count", id] as const,
  search: (q: string, dataroomId?: string) => ["search", q, dataroomId ?? "all"] as const,
};

// --- queries -------------------------------------------------------------

export function useChildren(parentId: string) {
  return useQuery({
    queryKey: keys.children(parentId),
    queryFn: () => api.listChildren(parentId),
  });
}

export function useNode(id: string) {
  return useQuery({
    queryKey: keys.node(id),
    queryFn: () => api.getNode(id),
  });
}

export function usePath(id: string | null) {
  return useQuery({
    queryKey: keys.path(id ?? ROOT_ID),
    queryFn: () => api.getPath(id!),
    enabled: id !== null,
  });
}

/** Live descendant count for the delete confirm; only fetched when a dialog opens. */
export function useDescendantCount(id: string | null) {
  return useQuery({
    queryKey: keys.descendantCount(id ?? ""),
    queryFn: () => api.countDescendants(id!),
    enabled: id !== null,
  });
}

export function useSearch(query: string, dataroomId?: string) {
  return useQuery({
    queryKey: keys.search(query, dataroomId),
    queryFn: () => api.searchByName(query, dataroomId),
    enabled: query.trim().length > 0,
  });
}

/** Blob for the preview pane. Object URL creation stays in the component. */
export function useFileBlob(id: string | null) {
  return useQuery({
    queryKey: ["blob", id],
    queryFn: () => api.getFileBlob(id!),
    enabled: id !== null,
    staleTime: Infinity, // bytes never change in this MVP
  });
}

// --- mutations -----------------------------------------------------------

export function useCreateContainer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createContainer,
    onSuccess: (_node, vars) => {
      void qc.invalidateQueries({ queryKey: keys.children(vars.parentId) });
    },
  });
}

export function useUploadFiles() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.uploadFiles,
    onSuccess: (_result, vars) => {
      void qc.invalidateQueries({ queryKey: keys.children(vars.parentId) });
    },
  });
}

export function useRenameNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.renameNode,
    onSuccess: (node) => {
      void qc.invalidateQueries({ queryKey: keys.children(node.parentId) });
      void qc.invalidateQueries({ queryKey: keys.node(node.id) });
      void qc.invalidateQueries({ queryKey: ["path"] }); // breadcrumbs show names
      void qc.invalidateQueries({ queryKey: ["search"] });
    },
  });
}

/**
 * Delete = soft delete now, purge after the undo window.
 * The component owns the toast/timer; this hook owns cache correctness.
 */
export function useSoftDelete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; parentId: string }) => api.softDeleteNode(vars.id),
    onSuccess: (_res, vars) => {
      void qc.invalidateQueries({ queryKey: keys.children(vars.parentId) });
      void qc.invalidateQueries({ queryKey: ["search"] });
    },
  });
}

export function useRestoreNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; parentId: string }) => api.restoreNode(vars.id),
    onSuccess: (_res, vars) => {
      void qc.invalidateQueries({ queryKey: keys.children(vars.parentId) });
      void qc.invalidateQueries({ queryKey: ["search"] });
    },
  });
}
