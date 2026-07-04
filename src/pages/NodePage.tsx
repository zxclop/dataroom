/**
 * Folder view — one route serves any depth: a dataroom and a nested folder are
 * both just "a container node". Breadcrumbs, search, upload (button + drag),
 * inline CRUD via dialogs, cascade delete with Undo, and a resizable PDF
 * preview pane. Layers are respected: everything below goes through hooks.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  FileTextIcon,
  FolderIcon,
  FolderXIcon,
  PlusIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { DeleteDialog } from "@/components/delete-dialog";
import { NameDialog } from "@/components/name-dialog";
import { NodeActions } from "@/components/node-actions";
import { RenameInput } from "@/components/rename-input";
import { SearchBox } from "@/components/search-box";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useChildren,
  useCreateContainer,
  useFileBlob,
  usePath,
  useRenameNode,
  useUploadFiles,
} from "@/hooks/use-dataroom";
import { useDeleteWithUndo } from "@/hooks/use-delete-with-undo";
import { cn } from "@/lib/utils";
import { ApiError, ROOT_ID, type DataroomNode } from "@/types";

function formatSize(bytes?: number): string {
  if (bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  return kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

// The split's layout is persisted by hand: this version of react-resizable-panels
// remembers a `defaultLayout` (panel id → %) rather than an `autoSaveId`.
const PREVIEW_LAYOUT_KEY = "dataroom-preview-layout";

function loadPreviewLayout(): Record<string, number> | undefined {
  try {
    const raw = localStorage.getItem(PREVIEW_LAYOUT_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : undefined;
  } catch {
    return undefined;
  }
}

function savePreviewLayout(layout: Record<string, number>): void {
  try {
    localStorage.setItem(PREVIEW_LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // Ignore storage failures (private mode, quota) — resizing still works.
  }
}

export function NodePage() {
  const { nodeId = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const path = usePath(nodeId);
  const children = useChildren(nodeId);
  const upload = useUploadFiles();
  const createFolder = useCreateContainer();
  const rename = useRenameNode();
  const del = useDeleteWithUndo();

  const current = path.data?.[path.data.length - 1] ?? null;
  const dataroomId = path.data?.[0]?.id ?? null;

  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DataroomNode | null>(null);

  const renameTo = (id: string) => async (name: string) => {
    await rename.mutateAsync({ id, name });
    setEditingId(null);
  };
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const previewOpen = selectedFileId !== null;
  // Re-read the saved split each time the preview opens so mid-session resizes
  // are honored (the panel group only consumes defaultLayout on mount).
  const previewLayout = useMemo(loadPreviewLayout, [previewOpen]);

  // Switching folders closes the preview; arriving from a file search opens it.
  const previewParam = (location.state as { previewFileId?: string } | null)?.previewFileId ?? null;
  useEffect(() => {
    setSelectedFileId(previewParam);
  }, [nodeId, previewParam]);

  const isMissing = path.isError; // deleted folder / dead deep link

  const onUpload = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    upload.mutate(
      { parentId: nodeId, files: [...list] },
      {
        onSuccess: (res) => {
          for (const r of res.rejected) {
            toast.error(r.name, {
              description:
                r.reason === "NOT_A_PDF" ? "Only PDF files are supported." : "File is empty.",
            });
          }
          if (res.uploaded.length > 0) {
            toast.success(
              `Uploaded ${res.uploaded.length} file${res.uploaded.length === 1 ? "" : "s"}.`,
            );
          }
        },
        onError: (e) => toast.error(e instanceof ApiError ? e.message : "Upload failed."),
      },
    );
    if (fileInput.current) fileInput.current.value = "";
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    onUpload(e.dataTransfer.files);
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    const isCurrent = deleteTarget.id === current?.id;
    if (deleteTarget.id === selectedFileId) setSelectedFileId(null);
    del(
      { id: deleteTarget.id, name: deleteTarget.name, parentId: deleteTarget.parentId },
      // Deleting the folder you are standing in sends you to its parent.
      isCurrent
        ? { onDeleted: () => navigate(deleteTarget.parentId === ROOT_ID ? "/" : `/d/${deleteTarget.parentId}`) }
        : undefined,
    );
    setDeleteTarget(null);
  };

  if (isMissing) {
    return (
      <div className="mx-auto max-w-md px-6 py-24 text-center">
        <FolderXIcon className="mx-auto size-8 text-muted-foreground/60" />
        <p className="mt-3 text-sm font-medium">This folder no longer exists</p>
        <p className="mt-1 text-sm text-muted-foreground">It may have been deleted.</p>
        <Button asChild variant="outline" className="mt-4">
          <Link to="/">Back to datarooms</Link>
        </Button>
      </div>
    );
  }

  const rows = children.data;

  const tableArea = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-6 pt-5 pb-3">
        {current && editingId === current.id ? (
          <div className="w-72">
            <RenameInput
              initial={current.name}
              onCommit={renameTo(current.id)}
              onCancel={() => setEditingId(null)}
            />
          </div>
        ) : (
          <h2 className="truncate text-lg font-semibold tracking-tight">{current?.name ?? "…"}</h2>
        )}
        {current && editingId !== current.id && (
          <NodeActions
            name={current.name}
            onRename={() => setEditingId(current.id)}
            onDelete={() => setDeleteTarget(current)}
          />
        )}
        <div className="ml-auto flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
            <PlusIcon />
            New folder
          </Button>
          <Button size="sm" disabled={upload.isPending} onClick={() => fileInput.current?.click()}>
            <UploadIcon />
            {upload.isPending ? "Uploading…" : "Upload PDF"}
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            hidden
            onChange={(e) => onUpload(e.target.files)}
          />
        </div>
      </div>

      <div
        data-testid="dropzone"
        className="relative min-h-0 flex-1 overflow-auto px-6 pb-6"
        onDragEnter={(e) => {
          e.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => {
          dragDepth.current -= 1;
          if (dragDepth.current <= 0) {
            dragDepth.current = 0;
            setDragging(false);
          }
        }}
        onDrop={onDrop}
      >
        {dragging && (
          <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/5 text-sm font-medium text-primary">
            Drop PDFs to upload
          </div>
        )}

        {children.isPending && <TableSkeleton />}

        {rows && rows.length === 0 && (
          <div className="rounded-lg border border-dashed py-16 text-center">
            <p className="text-sm font-medium">This folder is empty</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Upload a PDF or create a folder to get started.
            </p>
          </div>
        )}

        {rows && rows.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead className="w-28 text-right">Size</TableHead>
                <TableHead className="w-36">Modified</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((node) => (
                <TableRow key={node.id} className="group">
                  <TableCell className="max-w-0">
                    {editingId === node.id ? (
                      <RenameInput
                        initial={node.name}
                        onCommit={renameTo(node.id)}
                        onCancel={() => setEditingId(null)}
                      />
                    ) : node.type === "folder" ? (
                      <Link
                        to={`/d/${node.id}`}
                        draggable={false}
                        className="flex items-center gap-2 font-medium hover:underline"
                      >
                        <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{node.name}</span>
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setSelectedFileId(node.id)}
                        className={cn(
                          "flex w-full items-center gap-2 text-left hover:underline",
                          node.id === selectedFileId && "font-medium",
                        )}
                      >
                        <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{node.name}</span>
                      </button>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {node.type === "file" ? formatSize(node.size) : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(node.updatedAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <div className="opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
                      <NodeActions
                        name={node.name}
                        onRename={() => setEditingId(node.id)}
                        onDelete={() => setDeleteTarget(node)}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-4 border-b px-6 py-3">
        {path.data ? (
          <Breadcrumbs segments={path.data} />
        ) : (
          <Skeleton className="h-4 w-48" />
        )}
        {dataroomId && (
          <div className="ml-auto">
            <SearchBox dataroomId={dataroomId} />
          </div>
        )}
      </header>

      {selectedFileId ? (
        <ResizablePanelGroup
          orientation="horizontal"
          defaultLayout={previewLayout}
          onLayoutChanged={savePreviewLayout}
          className="min-h-0 flex-1"
        >
          {/* Sizes must be percentage strings: bare numbers are treated as pixels. */}
          <ResizablePanel id="table" defaultSize="60%" minSize="35%">
            {tableArea}
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel id="preview" defaultSize="40%" minSize="25%" maxSize="65%">
            <PreviewPane fileId={selectedFileId} onClose={() => setSelectedFileId(null)} />
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <div className="min-h-0 flex-1">{tableArea}</div>
      )}

      <NameDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New folder"
        placeholder="Folder name"
        submitLabel="Create"
        onSubmit={(name) => createFolder.mutateAsync({ parentId: nodeId, type: "folder", name })}
      />

      <DeleteDialog
        node={deleteTarget}
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

/** Breadcrumbs with the middle collapsed into a "…" menu on deep paths. */
function Breadcrumbs({ segments }: { segments: DataroomNode[] }) {
  const collapsed = segments.length > 3;
  const items = collapsed
    ? [
        { kind: "node" as const, node: segments[0] },
        { kind: "ellipsis" as const, hidden: segments.slice(1, -1) },
        { kind: "node" as const, node: segments[segments.length - 1] },
      ]
    : segments.map((node) => ({ kind: "node" as const, node }));

  return (
    <nav className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
      <Link to="/" className="shrink-0 hover:text-foreground">
        Datarooms
      </Link>
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <Fragment key={item.kind === "ellipsis" ? "ellipsis" : item.node.id}>
            <span className="text-muted-foreground/50">/</span>
            {item.kind === "ellipsis" ? (
              <DropdownMenu>
                <DropdownMenuTrigger className="shrink-0 rounded px-1 hover:text-foreground focus:outline-none">
                  …
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {item.hidden.map((n) => (
                    <DropdownMenuItem key={n.id} asChild>
                      <Link to={`/d/${n.id}`}>{n.name}</Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : isLast ? (
              <span className="truncate font-medium text-foreground">{item.node.name}</span>
            ) : (
              <Link to={`/d/${item.node.id}`} className="shrink-0 hover:text-foreground">
                {item.node.name}
              </Link>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-px">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 border-b py-3">
          <Skeleton className="size-4 rounded" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="ml-auto h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

function PreviewPane({ fileId, onClose }: { fileId: string; onClose: () => void }) {
  const blob = useFileBlob(fileId);

  // Object URLs leak until revoked; tie the lifecycle to the blob instance.
  const url = useMemo(() => (blob.data ? URL.createObjectURL(blob.data) : null), [blob.data]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside className="flex h-full flex-col bg-muted/30">
      <div className="flex items-center justify-between border-b bg-background px-4 py-2.5">
        <span className="text-sm font-medium">Preview</span>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close preview">
          <XIcon />
        </Button>
      </div>
      {blob.isPending && <p className="p-4 text-sm text-muted-foreground">Loading…</p>}
      {blob.isError && <p className="p-4 text-sm text-destructive">Could not load this file.</p>}
      {url && <iframe title="PDF preview" src={url} className="min-h-0 w-full flex-1" />}
    </aside>
  );
}
