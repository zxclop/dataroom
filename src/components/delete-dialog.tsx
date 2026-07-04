/**
 * Delete confirmation. For a container it names how many items sit inside
 * (fetched only while the dialog is open) so the user sees the blast radius
 * before confirming — "…and N items inside", per the SPEC. Actual removal is
 * soft-delete + Undo toast, owned by the caller's onConfirm.
 */
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useDescendantCount } from "@/hooks/use-dataroom";
import type { DataroomNode } from "@/types";

type Target = Pick<DataroomNode, "id" | "name" | "type">;

interface DeleteDialogProps {
  node: Target | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function DeleteDialog({ node, open, onOpenChange, onConfirm }: DeleteDialogProps) {
  const isContainer = node?.type !== "file";
  // Only query while open and only for containers (files have no descendants).
  const count = useDescendantCount(open && node && isContainer ? node.id : null);
  const inside = count.data ?? 0;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{node?.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            {isContainer && inside > 0
              ? `This ${node?.type} and ${inside} item${inside === 1 ? "" : "s"} inside will be deleted. `
              : "This item will be deleted. "}
            You can undo for a few seconds.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
