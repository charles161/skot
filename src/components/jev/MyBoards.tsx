"use client";

import { useState } from "react";
import { IconLayers, IconPlus } from "@/brand/icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { browserBoardStorage, listBoards, newBoardPath, type BoardSummary } from "@/lib/jev/boards";
import { DEFAULT_BOARD_TITLE } from "@/lib/jev/prediction-engine";
import { boardPath } from "@/lib/jev/room-auth";
import { BADGE, ROW, savedTime } from "./RestoreCopyDialog";

interface MyBoardsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current?: { id: string; title: string; count: number };
  onLeave: (to: () => string) => void;
}

function lastEdit(board: BoardSummary): string {
  if (board.unreadable) return "Can't be read; kept untouched";
  if (board.edited !== null) return savedTime(board.edited);
  return board.hasCopies ? "Earlier copies saved" : "Never edited";
}

/** Mounted each time the dialog opens, so the list is read then and holds still while it is on screen. */
function Boards({ current, onLeave, onOpenChange }: Omit<MyBoardsDialogProps, "open">) {
  const [boards] = useState(() => {
    const saved = listBoards(browserBoardStorage(), Date.now());
    if (!current || saved.some((board) => board.id === current.id)) return saved;
    // Nothing is saved for a board until it is edited; it is still the board on screen.
    const title = current.title || DEFAULT_BOARD_TITLE;
    const shown = { id: current.id, title, count: current.count, edited: null, unreadable: false, hasCopies: false };
    return [shown, ...saved];
  });
  if (boards.length === 0) return <p className="text-xs text-muted-foreground">No boards in this browser yet</p>;
  return (
    <ul aria-label="Boards in this browser" className="flex min-w-0 flex-col gap-1.5">
      {boards.map((board) => {
        const isCurrent = board.id === current?.id;
        return (
          <li key={board.id} className="min-w-0">
            <a
              href={boardPath(board.id)}
              aria-current={isCurrent ? "page" : undefined}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; // its own tab or window
                event.preventDefault();
                onOpenChange(false); // what stops it leaving is said on the board, under this dialog
                if (!isCurrent) onLeave(() => boardPath(board.id));
              }}
              className={ROW}
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-[13px] font-semibold text-foreground">{board.title}</span>
                <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  {lastEdit(board)}
                  {isCurrent && <span className={`${BADGE} border-border`}>Open now</span>}
                </span>
              </span>
              {board.count !== null && (
                <span className="shrink-0 font-mono text-[11px] text-foreground/80">
                  {board.count} {board.count === 1 ? "element" : "elements"}
                </span>
              )}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

export function MyBoardsDialog({ open, ...list }: MyBoardsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={list.onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-cols-1 overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-8 text-base">
            <IconLayers className="h-4 w-4 text-[#C2411D] dark:text-[#FF8562]" aria-hidden="true" />
            My boards
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            Saved in this browser as you edit, newest first.
          </DialogDescription>
        </DialogHeader>
        <Boards {...list} />
        <Button
          type="button"
          variant="outline"
          className="min-h-[44px]"
          onClick={() => {
            list.onOpenChange(false);
            list.onLeave(newBoardPath);
          }}
        >
          <IconPlus className="h-4 w-4" aria-hidden="true" />
          New board
        </Button>
      </DialogContent>
    </Dialog>
  );
}

const leaveNow = (to: () => string) => window.location.assign(to());

/** My boards where no board is on screen (missing or unreadable), so there is nothing to save first. */
export function MyBoardsButton() {
  const [open, setOpen] = useState(false);
  const [hasBoards] = useState(() => listBoards(browserBoardStorage(), Date.now()).length > 0);
  if (!hasBoards) return null;
  return (
    <>
      <Button type="button" variant="outline" className="min-h-[44px]" onClick={() => setOpen(true)}>
        <IconLayers className="h-4 w-4" aria-hidden="true" />
        My boards
      </Button>
      <MyBoardsDialog open={open} onOpenChange={setOpen} onLeave={leaveNow} />
    </>
  );
}

export function BoardsMenuItems({ onOpen, onLeave }: { onOpen: () => void; onLeave: (to: () => string) => void }) {
  return (
    <>
      <DropdownMenuItem onClick={onOpen} className="gap-2 text-xs">
        <IconLayers className="h-3.5 w-3.5" aria-hidden="true" />
        My boards
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => onLeave(newBoardPath)} className="gap-2 text-xs">
        <IconPlus className="h-3.5 w-3.5" aria-hidden="true" />
        New board
      </DropdownMenuItem>
    </>
  );
}
