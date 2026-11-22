"use client";

import { useState } from "react";
import { IconDownload, IconReset } from "@/brand/icons";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { listSavedCopies, type StorageLike } from "@/lib/jev/recovery-buffer";
import type { StoredBoardSnapshot } from "@/lib/jev/sync-validation";
import { downloadSavedCopy } from "./UnreadableBoard";

interface RestoreCopyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  getStorage: () => StorageLike | null;
  roomId: string;
  onRestore: (snapshot: StoredBoardSnapshot) => void;
}

const ROW =
  "flex min-h-[48px] w-full items-center justify-between gap-3 rounded-xl border border-border bg-card/70 px-3 py-2 text-left transition-colors hover:border-[#D94E28]/50 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const BADGE = "rounded-md border px-1.5 py-0.5 text-[10px] font-semibold";

function savedTime(at: number): string {
  const date = new Date(at);
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (date.toDateString() === new Date().toDateString()) return `Today, ${time}`;
  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

/** Mounted each time the dialog opens, so the list is read then and holds still while it is on screen. */
function SavedCopies({ getStorage, roomId, onRestore }: Omit<RestoreCopyDialogProps, "open" | "onOpenChange">) {
  const [copies] = useState(() => listSavedCopies(getStorage(), roomId));
  if (copies.length === 0) return <p className="text-xs text-muted-foreground">No earlier copy saved</p>;
  return (
    <ul aria-label="Saved copies" className="flex min-w-0 flex-col gap-1.5">
      {copies.map((copy, i) => (
        <li key={i}>
          {copy.kind === "unreadable" ? (
            <button type="button" onClick={() => downloadSavedCopy(copy.raw)} className={ROW}>
              <span className="min-w-0 text-xs text-muted-foreground">This copy can&apos;t be opened</span>
              <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-foreground">
                <IconDownload className="h-3.5 w-3.5" aria-hidden="true" />
                Download
              </span>
            </button>
          ) : (
            <button type="button" onClick={() => onRestore(copy.entry.snapshot)} className={ROW}>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[13px] font-semibold text-foreground">{savedTime(copy.entry.savedAt)}</span>
                  {copy.newest && <span className={`${BADGE} border-border text-muted-foreground`}>Newest</span>}
                  {copy.fullest && (
                    <span className={`${BADGE} border-[#D94E28]/40 bg-[#D94E28]/15 text-[#C2411D] dark:text-[#FF8562]`}>
                      Fullest
                    </span>
                  )}
                </span>
                <span className="truncate text-[11px] text-muted-foreground">
                  {copy.entry.reason === "manual" ? "Before a restore: " : ""}
                  {copy.entry.snapshot.boardTitle}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[11px] text-foreground/80">
                {copy.entry.snapshot.elements.length}{" "}
                {copy.entry.snapshot.elements.length === 1 ? "element" : "elements"}
              </span>
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function RestoreCopyDialog({ open, onOpenChange, ...list }: RestoreCopyDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-cols-1 overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-8 text-base">
            <IconReset className="h-4 w-4 text-[#C2411D] dark:text-[#FF8562]" aria-hidden="true" />
            Restore earlier copy
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            Saved in this browser as you edit. The board you have now is kept as a copy first.
          </DialogDescription>
        </DialogHeader>
        <SavedCopies {...list} />
      </DialogContent>
    </Dialog>
  );
}
