"use client";

import React from "react";
import { IconArrowRight, IconTarget } from "@/brand/icons";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PRACTICE_PROMPTS, type PracticePromptId } from "@/lib/jev/practice-prompts";

interface PracticePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boardHasContent: boolean;
  onStart: (promptId: PracticePromptId) => void;
}

export function PracticePicker({ open, onOpenChange, boardHasContent, onStart }: PracticePickerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <IconTarget className="h-4 w-4 text-[#C2411D] dark:text-[#FF8562]" aria-hidden="true" />
            Practice a problem
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            A timer runs and the AI stays silent. Draw your design, then press Review for a score and comments
            pinned to your shapes.
          </DialogDescription>
        </DialogHeader>

        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label="Practice problems">
          {PRACTICE_PROMPTS.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onStart(p.id)}
                className="group flex h-full min-h-[44px] w-full flex-col gap-1 rounded-xl border border-border bg-card/70 p-3 text-left transition-colors hover:border-[#D94E28]/50 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold text-foreground">{p.title}</span>
                  <span className="shrink-0 rounded-md border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {p.minutes} min
                  </span>
                </span>
                <span className="line-clamp-2 text-[11.5px] leading-snug text-muted-foreground">{p.brief}</span>
                <span className="mt-auto flex items-center gap-1 pt-1 font-mono text-[10.5px] font-semibold text-foreground/80 group-hover:text-foreground">
                  Start
                  <IconArrowRight className="h-3 w-3" aria-hidden="true" />
                </span>
              </button>
            </li>
          ))}
        </ul>

        {boardHasContent && (
          <p className="text-[11px] text-muted-foreground">Starting opens a new board. This one stays in My boards.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
