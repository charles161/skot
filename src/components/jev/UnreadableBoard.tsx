"use client";

import { IconDownload, IconWarning } from "@/brand/icons";
import { Button } from "@/components/ui/button";
import { appUrl } from "@/lib/base-path";

export function downloadSavedCopy(raw: string) {
  const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "skot-board-saved-copy.json";
  link.click();
  URL.revokeObjectURL(url);
}

/** Shown in place of a board whose saved copy can't be read. Nothing here writes or deletes it. */
export function UnreadableBoard({ raw }: { raw: string }) {
  return (
    <main className="flex min-h-dvh w-full items-center justify-center bg-background p-6 text-foreground">
      <div role="alert" className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm">
        <h1 className="flex items-center gap-2 font-editorial text-xl font-semibold">
          <IconWarning className="h-5 w-5 shrink-0 text-[#C2411D] dark:text-[#FF8562]" aria-hidden="true" />
          This board couldn&apos;t be opened
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Its saved copy is untouched in this browser, and Skot will not save over it. Download it to keep it safe.
          If you start a new board, this one stays at this address: press Back to return to it.
        </p>
        <div className="mt-5 flex flex-wrap gap-2.5">
          <Button type="button" onClick={() => downloadSavedCopy(raw)}>
            <IconDownload className="h-4 w-4" aria-hidden="true" />
            Download saved copy
          </Button>
          <Button type="button" variant="outline" onClick={() => window.location.assign(appUrl("/new"))}>
            Start a new board
          </Button>
        </div>
      </div>
    </main>
  );
}
