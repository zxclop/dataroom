/**
 * The delete UX, in one place: soft-delete now, raise an Undo toast, and purge
 * once the window closes. Both the home screen and the folder view share this
 * path so the timer/toast/purge logic is never duplicated. The query hooks it
 * composes (soft-delete, restore) still own cache correctness.
 */
import { useCallback } from "react";
import { toast } from "sonner";
import { purgeNode } from "@/api/dataroom";
import { ApiError } from "@/types";
import { useRestoreNode, useSoftDelete } from "./use-dataroom";

export const UNDO_WINDOW_MS = 5_000;

interface DeleteTarget {
  id: string;
  name: string;
  parentId: string;
}

export function useDeleteWithUndo() {
  const softDelete = useSoftDelete();
  const restore = useRestoreNode();

  return useCallback(
    (node: DeleteTarget, opts?: { onDeleted?: () => void }) => {
      softDelete.mutate(
        { id: node.id, parentId: node.parentId },
        {
          onSuccess: (res) => {
            opts?.onDeleted?.();

            // The purge is armed independently of the toast so that closing
            // the tab still gets swept by purgeExpired() on next startup.
            let undone = false;
            let toastId: string | number | undefined;

            const timer = setTimeout(() => {
              if (!undone) {
                void purgeNode(node.id);
                // Dismiss the toast so Undo can't be clicked after the node
                // has already been purged from the database.
                if (toastId !== undefined) toast.dismiss(toastId);
              }
            }, UNDO_WINDOW_MS);

            const inside = res.affected - 1; // affected counts the node itself
            toastId = toast(`Deleted "${node.name}"`, {
              description:
                inside > 0 ? `${inside} item${inside === 1 ? "" : "s"} inside also removed.` : undefined,
              duration: UNDO_WINDOW_MS,
              action: {
                label: "Undo",
                onClick: () => {
                  undone = true;
                  clearTimeout(timer);
                  restore.mutate({ id: node.id, parentId: node.parentId });
                },
              },
            });
          },
          onError: (e) => {
            toast.error(e instanceof ApiError ? e.message : "Delete failed.");
          },
        },
      );
    },
    [softDelete, restore],
  );
}
