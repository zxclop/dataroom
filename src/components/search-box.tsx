/**
 * Name search, scoped to the current dataroom. Substring, case-insensitive;
 * results show each hit's path and navigate on click. Empty query shows
 * nothing; a non-empty query with no hits says so.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileTextIcon, FolderIcon, SearchIcon } from "lucide-react";
import type { SearchHit } from "@/api/dataroom";
import { Input } from "@/components/ui/input";
import { useSearch } from "@/hooks/use-dataroom";

export function SearchBox({ dataroomId }: { dataroomId: string }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const results = useSearch(query, dataroomId);
  const q = query.trim();

  const go = (hit: SearchHit) => {
    setQuery("");
    setOpen(false);
    if (hit.node.type === "folder") {
      navigate(`/d/${hit.node.id}`);
    } else {
      // Files open in the preview of their containing folder.
      navigate(`/d/${hit.node.parentId}`, { state: { previewFileId: hit.node.id } });
    }
  };

  return (
    <div className="relative w-64">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        className="pl-8"
        placeholder="Search this dataroom"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        // Ignore drops: dropping a link/file here would otherwise let the
        // browser paste its URL (a node id) into the query and search on it.
        onDrop={(e) => e.preventDefault()}
      />

      {open && q.length > 0 && (
        <div className="absolute z-30 mt-1 max-h-80 w-full overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          {results.isPending && (
            <p className="px-2 py-2 text-sm text-muted-foreground">Searching…</p>
          )}
          {results.data?.length === 0 && (
            <p className="px-2 py-2 text-sm text-muted-foreground">No matches.</p>
          )}
          {results.data?.map((hit) => (
            <button
              key={hit.node.id}
              type="button"
              // Keep the input focused through mousedown so onBlur doesn't fire first.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => go(hit)}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
            >
              {hit.node.type === "folder" ? (
                <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{hit.node.name}</span>
              {hit.path && (
                <span className="ml-auto shrink-0 pl-3 text-xs text-muted-foreground">{hit.path}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
