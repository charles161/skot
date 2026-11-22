"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { IconClose, IconCopy, IconDownload, IconReset, IconUpload, IconWarning, IconCheck } from "@/brand/icons";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  IMPORT_HASH_PREFIX,
  MAX_IMPORT_PAYLOAD_CHARS,
  buildBoardFile,
  encodeImportHash,
  hasImportHash,
  openImportHash,
  parseBoardFile,
  stageImportedBoard,
} from "@/lib/jev/board-import";
import { hasSavedCopies, type StorageLike } from "@/lib/jev/recovery-buffer";
import { formatRoomHash } from "@/lib/jev/room-auth";
import type { StoredBoardSnapshot } from "@/lib/jev/sync-validation";
import { sanitizeExportFilename } from "@/lib/jev/svg-export";

export const OPEN_FAILED_MESSAGE = "Could not open that board";
const NOTICE_MS = 5000;

export interface BoardNotice {
  tone: "error" | "info";
  text: string;
}

function replaceHash(hash: string) {
  const url = new URL(window.location.href);
  url.hash = hash;
  window.history.replaceState({}, "", url.toString());
}

/**
 * `#import=` in the URL: resolved on first load before the workspace creates its room; an `#import=` link
 * pasted into an open tab only changes the fragment, so it reloads into the same path.
 * Returns true while the import is still being decoded.
 */
export function useImportFragment(onNotice: (notice: BoardNotice) => void): boolean {
  const [pendingHash, setPendingHash] = useState<string | null>(() =>
    typeof window !== "undefined" && hasImportHash(window.location.hash) ? window.location.hash : null
  );

  useEffect(() => {
    if (pendingHash === null) return;
    let cancelled = false;
    void openImportHash(pendingHash, window.localStorage)
      .catch(() => null)
      .then((roomHash) => {
        if (cancelled) return;
        replaceHash(roomHash ?? "");
        if (!roomHash) onNotice({ tone: "error", text: OPEN_FAILED_MESSAGE });
        setPendingHash(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pendingHash, onNotice]);

  useEffect(() => {
    const onHashChange = () => {
      if (hasImportHash(window.location.hash)) window.location.reload();
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return pendingHash !== null;
}

function openStagedRoom(snapshot: StoredBoardSnapshot) {
  const creds = stageImportedBoard(snapshot, window.localStorage);
  const url = new URL(window.location.href);
  url.hash = formatRoomHash(creds.roomId, creds.roomSecret);
  window.history.pushState({}, "", url.toString());
  window.location.reload();
}

export function useBoardFileActions(
  getSnapshot: () => StoredBoardSnapshot & { boardTitle: string },
  onNotice: (notice: BoardNotice) => void
) {
  const inputRef = useRef<HTMLInputElement>(null);

  const onFileChosen = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const snapshot = parseBoardFile(await file.text().catch(() => ""));
    if (!snapshot) {
      onNotice({ tone: "error", text: OPEN_FAILED_MESSAGE });
      return;
    }
    try {
      openStagedRoom(snapshot);
    } catch {
      onNotice({ tone: "error", text: OPEN_FAILED_MESSAGE });
    }
  };

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept=".json,application/json"
      aria-label="Open board file"
      data-testid="open-board-input"
      className="hidden"
      onChange={(event) => void onFileChosen(event)}
    />
  );

  const openFile = () => inputRef.current?.click();

  const saveFile = () => {
    const snapshot = getSnapshot();
    const blob = new Blob([buildBoardFile(snapshot)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = sanitizeExportFilename(snapshot.boardTitle, "json");
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyShareLink = async () => {
    const hash = await encodeImportHash(getSnapshot());
    if (hash.length - IMPORT_HASH_PREFIX.length > MAX_IMPORT_PAYLOAD_CHARS) {
      onNotice({ tone: "error", text: "This board is too big for a link. Use Save board (.json) instead." });
      return;
    }
    const url = new URL(window.location.href);
    url.hash = hash;
    try {
      await navigator.clipboard.writeText(url.toString());
      onNotice({ tone: "info", text: "Link copied. Anyone who opens it gets their own copy of this board." });
    } catch {
      onNotice({ tone: "error", text: "The browser blocked the clipboard. Use Save board (.json) instead." });
    }
  };

  return { fileInput, openFile, saveFile, copyShareLink };
}

export function BoardFileMenuItems({ actions }: { actions: ReturnType<typeof useBoardFileActions> }) {
  return (
    <>
      <DropdownMenuItem onClick={actions.openFile} className="gap-2 text-xs">
        <IconUpload className="h-3.5 w-3.5" aria-hidden="true" />
        Open board (.json)
      </DropdownMenuItem>
      <DropdownMenuItem onClick={actions.saveFile} className="gap-2 text-xs">
        <IconDownload className="h-3.5 w-3.5" aria-hidden="true" />
        Save board (.json)
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => void actions.copyShareLink()} className="gap-2 text-xs">
        <IconCopy className="h-3.5 w-3.5" aria-hidden="true" />
        Copy share link
      </DropdownMenuItem>
    </>
  );
}

/** Mounted with the menu, so it looks afresh each time the menu opens. */
export function RestoreCopyMenuItem({
  getStorage,
  roomId,
  onOpen,
}: {
  getStorage: () => StorageLike | null;
  roomId: string;
  onOpen: () => void;
}) {
  const [hasCopies] = useState(() => hasSavedCopies(getStorage(), roomId));
  return (
    <DropdownMenuItem disabled={!hasCopies} onClick={onOpen} className="gap-2 text-xs">
      <IconReset className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="flex flex-col">
        Restore earlier copy
        {!hasCopies && <span className="text-[10px]">No earlier copy saved</span>}
      </span>
    </DropdownMenuItem>
  );
}

export function useBoardNotice() {
  const [notice, setNotice] = useState<BoardNotice | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const show = useCallback((next: BoardNotice) => setNotice(next), []);
  const dismiss = useCallback(() => setNotice(null), []);
  return { notice, show, dismiss };
}

export function BoardNoticeToast({ notice, onDismiss }: { notice: BoardNotice | null; onDismiss: () => void }) {
  if (!notice) return null;
  const isError = notice.tone === "error";
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-28 z-40 flex justify-center px-3">
      <div
        role={isError ? "alert" : "status"}
        aria-live={isError ? "assertive" : "polite"}
        data-testid="board-notice"
        className={`jev-glass pointer-events-auto flex max-w-[min(520px,calc(100vw-24px))] items-center gap-2.5 rounded-2xl border px-3.5 py-2 shadow-[0_14px_36px_-12px_rgba(15,23,42,0.28)] ${
          isError ? "border-[#D94E28]/40" : "border-border"
        }`}
      >
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${
            isError ? "bg-[#D94E28]/15 text-[#C2411D] dark:text-[#FF8562]" : "bg-secondary text-foreground"
          }`}
        >
          {isError ? (
            <IconWarning className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <IconCheck className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </span>
        <span className="min-w-0 text-xs font-medium text-foreground">{notice.text}</span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notice"
          className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0 sm:min-w-0"
        >
          <IconClose className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
