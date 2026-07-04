/**
 * In-place rename: the row's name turns into this input. Enter commits, Escape
 * cancels, blur commits; a rejected name (taken/invalid) shows why right below
 * and keeps editing. The parent unmounts it on a successful commit.
 */
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/types";

interface RenameInputProps {
  initial: string;
  /** Resolves on success (parent then closes edit); throws ApiError on conflict. */
  onCommit: (name: string) => Promise<void>;
  onCancel: () => void;
}

export function RenameInput({ initial, onCommit, onCancel }: RenameInputProps) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const done = useRef(false); // guards Enter/Escape from also firing on blur
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const commit = async () => {
    if (busy || done.current) return;
    const name = value.trim();
    if (name === initial) {
      done.current = true;
      onCancel(); // no change → treat as a quiet cancel
      return;
    }
    if (name === "") {
      setError("Name cannot be empty.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCommit(name);
      done.current = true; // success → parent unmounts this input
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Rename failed.");
      setBusy(false);
      ref.current?.focus();
    }
  };

  const cancel = () => {
    done.current = true;
    onCancel();
  };

  return (
    <span className="relative block">
      <Input
        ref={ref}
        aria-label="New name"
        aria-invalid={error !== null}
        value={value}
        disabled={busy}
        className="h-8"
        onChange={(e) => {
          setValue(e.target.value);
          if (error) setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        onBlur={() => {
          if (!done.current) void commit();
        }}
      />
      {error && (
        <span className="absolute top-full left-0 z-20 mt-1 rounded bg-destructive px-1.5 py-0.5 text-xs text-white shadow-md">
          {error}
        </span>
      )}
    </span>
  );
}
