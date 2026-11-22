"use client";

import { useState } from "react";
import { IconLayers, IconPlus, IconWarning } from "@/brand/icons";
import { Button } from "@/components/ui/button";
import { browserBoardStorage, listBoards, newBoardPath, type MissingBoardInfo } from "@/lib/jev/boards";
import { MyBoardsDialog } from "./MyBoards";

const leave = (to: () => string) => window.location.assign(to());

/** Shown in place of a board this browser doesn't have. Nothing here makes storage for it. */
export function MissingBoard({ board }: { board: MissingBoardInfo }) {
  const [listOpen, setListOpen] = useState(false);
  const [hasBoards] = useState(() => listBoards(browserBoardStorage(), Date.now()).length > 0);
  return (
    <>
      <main
        className="flex min-h-dvh w-full items-center justify-center bg-background p-6 text-foreground"
      >
        <div role="alert" className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h1 className="flex items-center gap-2 font-editorial text-xl font-semibold">
            <IconWarning className="h-5 w-5 shrink-0 text-[#C2411D] dark:text-[#FF8562]" aria-hidden="true" />
            This board isn&apos;t in this browser
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {board.storageBlocked
              ? "Boards are saved in the browser they were made in, and this browser is blocking storage, so none can be opened."
              : "Boards are saved in the browser they were made in (for now), so this link only opens the board there."}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            If someone sent it to you, ask them for a copy: Board menu, then Copy share link.
          </p>
          <div className="mt-5 flex flex-wrap gap-2.5">
            <Button type="button" className="min-h-[44px]" onClick={() => leave(newBoardPath)}>
              <IconPlus className="h-4 w-4" aria-hidden="true" />
              New board
            </Button>
            {hasBoards && (
              <Button type="button" variant="outline" className="min-h-[44px]" onClick={() => setListOpen(true)}>
                <IconLayers className="h-4 w-4" aria-hidden="true" />
                My boards
              </Button>
            )}
          </div>
        </div>
      </main>
      <MyBoardsDialog open={listOpen} onOpenChange={setListOpen} onLeave={leave} />
    </>
  );
}
