/**
 * One dialog for both "create" and "rename". The caller supplies an async
 * onSubmit that throws an ApiError on conflict/invalid input; the dialog shows
 * that message inline (next to the field) and stays open so the user can fix
 * the name — matching the SPEC's "rejected inline, do not auto-rename" rule.
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/types";

interface NameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  submitLabel: string;
  initialValue?: string;
  placeholder?: string;
  onSubmit: (name: string) => Promise<unknown>;
}

export function NameDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  initialValue = "",
  placeholder,
  onSubmit,
}: NameDialogProps) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // A single dialog instance is reused across rows/rooms; reset on each open.
  useEffect(() => {
    if (open) {
      setValue(initialValue);
      setError(null);
      setSubmitting(false);
    }
  }, [open, initialValue]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = value.trim();
    if (name === "" || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(name);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={handleSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>

          <div className="py-4">
            <Input
              autoFocus
              value={value}
              placeholder={placeholder}
              aria-invalid={error !== null}
              onChange={(e) => {
                setValue(e.target.value);
                if (error) setError(null);
              }}
            />
            {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={value.trim() === "" || submitting}>
              {submitting ? "Saving…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
