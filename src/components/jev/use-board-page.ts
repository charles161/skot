"use client";

import { useEffect, useState } from "react";
import { hasImportHash } from "@/lib/jev/board-import";
import type { BoardSaver } from "@/lib/jev/board-saver";
import {
  browserBoardStorage,
  readAddress,
  resolveBoard,
  type MissingBoardInfo,
  type OpenBoard,
} from "@/lib/jev/boards";
import type { SaveOutcome } from "@/lib/jev/saved-board";

const STAYED = {
  tone: "error",
  text: "Not saved, so this board was not left. Use Save board (.json) to keep a copy.",
} as const;

/*
 * One document, one board. Moving to another board always loads a document, so no state of the board left
 * can be saved as the board arrived at.
 */
class BoardPage {
  private shown: { id: string; secret: string; url: string } | null = null;
  private saver: BoardSaver | null = null;

  constructor(
    private readonly collab: boolean,
    private readonly notify: (notice: typeof STAYED) => void
  ) {}

  open = (): OpenBoard | MissingBoardInfo => {
    const { pathname, hash } = window.location;
    const board = resolveBoard(browserBoardStorage(), { pathname, hash, collab: this.collab, now: Date.now() });
    this.shown =
      board.kind === "open"
        ? { id: board.roomId, secret: board.roomSecret, url: board.url }
        : { id: board.id, secret: "", url: board.url };
    window.history.replaceState(window.history.state, "", board.url);
    // Next's router patches history after this runs, and only then can it learn the address: without it
    // "Try again" on the error screen would fetch the address arrived by (/new would make another board).
    window.setTimeout(() => window.history.replaceState(null, "", window.location.href), 0);
    return board;
  };

  attach = (saver: BoardSaver) => {
    this.saver = saver;
  };

  save = (): SaveOutcome | "unchanged" => {
    try {
      return this.saver?.save(Date.now()) ?? "unchanged";
    } catch {
      return "storage_failed"; // the browser refused storage altogether
    }
  };

  /** A label still being typed is part of the board: losing focus commits it. */
  saveToLeave = (): boolean => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const outcome = this.save();
    return outcome === "saved" || outcome === "unchanged";
  };

  /** `to` is only built once this board is safe. */
  leave = (to: () => string) => {
    if (this.saveToLeave()) window.location.assign(to());
    else this.notify(STAYED);
  };

  /** Back, forward or a typed fragment changed the address without loading a document. */
  private addressChanged = () => {
    const { pathname, hash } = window.location;
    const { id, secret } = readAddress(pathname, hash);
    const { shown } = this;
    const sameBoard =
      shown &&
      !hasImportHash(hash) &&
      id === shown.id &&
      (!this.collab || !secret || secret === shown.secret);
    if (sameBoard) {
      window.history.replaceState(window.history.state, "", shown.url);
    } else if (this.saveToLeave()) {
      window.location.reload();
    } else if (shown) {
      // __NA: Next leaves the entry alone rather than rendering the route of the address just refused.
      window.history.pushState({ ...window.history.state, __NA: true }, "", shown.url);
      this.notify(STAYED);
    }
  };

  listen = () => {
    const onPopState = (event: PopStateEvent) => {
      // Next would remount this document's workspace under the other address, dropping what isn't saved.
      event.stopImmediatePropagation();
      this.addressChanged();
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!this.saveToLeave()) event.preventDefault();
    };
    const onPageHide = () => void this.saveToLeave();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") this.save();
    };
    // Out of the back/forward cache the board in memory is as old as when it was left.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    window.addEventListener("popstate", onPopState, true);
    window.addEventListener("hashchange", this.addressChanged);
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("popstate", onPopState, true);
      window.removeEventListener("hashchange", this.addressChanged);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  };
}

export function useBoardPage(collab: boolean, notify: (notice: typeof STAYED) => void): BoardPage {
  const [page] = useState(() => new BoardPage(collab, notify));
  useEffect(() => page.listen(), [page]);
  return page;
}
