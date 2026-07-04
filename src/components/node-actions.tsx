/** Row overflow menu: Rename / Delete. Shared by datarooms, folders and files. */
import { MoreHorizontalIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface NodeActionsProps {
  onRename: () => void;
  onDelete: () => void;
  /** For the accessible label, e.g. "Actions for Financials". */
  name: string;
}

export function NodeActions({ onRename, onDelete, name }: NodeActionsProps) {
  return (
    // Non-modal so opening a dialog from an item never leaves the body with a
    // stuck `pointer-events: none` (a well-known Radix menu ↔ dialog interaction).
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${name}`}>
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-32">
        <DropdownMenuItem onSelect={onRename}>
          <PencilIcon />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2Icon />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
