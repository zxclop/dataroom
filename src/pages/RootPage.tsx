/**
 * Home screen: the list of datarooms. One dataroom per transaction.
 * Create opens a dialog (inline conflict errors); each row carries a
 * rename/delete menu. Delete cascades with an Undo window.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { FolderIcon, PlusIcon } from "lucide-react";
import { DeleteDialog } from "@/components/delete-dialog";
import { NameDialog } from "@/components/name-dialog";
import { NodeActions } from "@/components/node-actions";
import { RenameInput } from "@/components/rename-input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useChildren, useCreateContainer, useRenameNode } from "@/hooks/use-dataroom";
import { useDeleteWithUndo } from "@/hooks/use-delete-with-undo";
import { ROOT_ID, type DataroomNode } from "@/types";

export function RootPage() {
  const rooms = useChildren(ROOT_ID);
  const create = useCreateContainer();
  const rename = useRenameNode();
  const del = useDeleteWithUndo();

  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DataroomNode | null>(null);

  const renameTo = (id: string) => async (name: string) => {
    await rename.mutateAsync({ id, name });
    setEditingId(null);
  };

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Datarooms</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A separate space for each transaction.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <PlusIcon />
          New dataroom
        </Button>
      </header>

      {rooms.isPending && (
        <div className="space-y-px">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 border-b py-3">
              <Skeleton className="size-5 rounded" />
              <Skeleton className="h-4 w-40" />
            </div>
          ))}
        </div>
      )}

      {rooms.isError && (
        <p className="text-sm text-destructive">Failed to load datarooms.</p>
      )}

      {rooms.data?.length === 0 && (
        <div className="rounded-lg border border-dashed py-16 text-center">
          <FolderIcon className="mx-auto size-8 text-muted-foreground/60" />
          <p className="mt-3 text-sm font-medium">No datarooms yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create your first one to start organizing documents.
          </p>
          <Button className="mt-4" variant="outline" onClick={() => setCreateOpen(true)}>
            <PlusIcon />
            New dataroom
          </Button>
        </div>
      )}

      {rooms.data && rooms.data.length > 0 && (
        <ul className="divide-y">
          {rooms.data.map((room) => (
            <li key={room.id} className="group flex items-center gap-3 py-1 pr-1">
              {editingId === room.id ? (
                <div className="flex flex-1 items-center gap-3 py-1">
                  <FolderIcon className="size-5 shrink-0 text-muted-foreground" />
                  <div className="max-w-xs flex-1">
                    <RenameInput
                      initial={room.name}
                      onCommit={renameTo(room.id)}
                      onCancel={() => setEditingId(null)}
                    />
                  </div>
                </div>
              ) : (
                <Link
                  to={`/d/${room.id}`}
                  draggable={false}
                  className="flex min-w-0 flex-1 items-center gap-3 py-2 text-sm"
                >
                  <FolderIcon className="size-5 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium group-hover:underline">{room.name}</span>
                </Link>
              )}
              {editingId !== room.id && (
                <div className="opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
                  <NodeActions
                    name={room.name}
                    onRename={() => setEditingId(room.id)}
                    onDelete={() => setDeleteTarget(room)}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <NameDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New dataroom"
        placeholder="e.g. Project Alpha"
        submitLabel="Create"
        onSubmit={(name) => create.mutateAsync({ parentId: ROOT_ID, type: "dataroom", name })}
      />

      <DeleteDialog
        node={deleteTarget}
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) del({ id: deleteTarget.id, name: deleteTarget.name, parentId: ROOT_ID });
          setDeleteTarget(null);
        }}
      />
    </main>
  );
}
