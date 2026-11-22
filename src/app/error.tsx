"use client";

import { useEffect, useState } from "react";
import { IconPlus, IconReset, IconWarning } from "@/brand/icons";
import { appUrl } from "@/lib/base-path";
import { Button } from "@/components/ui/button";

function getErrorDigest(error: unknown): string | null {
  if (
    error &&
    typeof error === "object" &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string"
  ) {
    return (error as { digest: string }).digest;
  }
  return null;
}

export default function AppError({
  error,
  retry,
  reset,
}: {
  error: unknown;
  retry?: () => void;
  reset?: () => void;
}) {
  const [resetNotice, setResetNotice] = useState<string | null>(null);
  const digest = getErrorDigest(error);

  useEffect(() => {
    const errorClass = error instanceof Error ? error.name : "UnknownError";
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        boundary: "app/error",
        errorClass,
        ...(digest ? { digest } : {}),
      })
    );
  }, [error, digest]);

  const handleRetry = () => {
    if (typeof retry === "function") {
      retry();
    } else if (typeof reset === "function") {
      reset();
    } else if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  // A new room, never a delete: the saved board may be someone's only copy.
  const handleStartNewBoard = () => {
    setResetNotice("Your saved board is untouched. Opening a new one. Press Back to return to it.");
    window.setTimeout(() => window.location.assign(appUrl("/new")), 150);
  };

  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-background p-6 text-foreground">
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm"
        role="alert"
      >
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#d94e28]/12 text-[#d94e28]">
            <IconWarning className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="font-editorial text-xl font-semibold tracking-tight text-foreground">
              The whiteboard hit an unexpected snag
            </h1>
            <p className="text-xs text-muted-foreground">
              Your workspace paused to prevent data corruption.
            </p>
          </div>
        </div>

        <p className="mb-5 text-sm leading-relaxed text-muted-foreground">
          Try reloading the canvas first. If the error keeps happening, start a
          new board: the saved one stays in this browser.
        </p>

        {resetNotice ? (
          <p className="mb-4 rounded-lg bg-muted px-3 py-2 text-xs text-foreground">
            {resetNotice}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2.5">
          <Button type="button" onClick={handleRetry}>
            <IconReset className="h-4 w-4" aria-hidden="true" />
            Try again
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleStartNewBoard}
          >
            <IconPlus className="h-4 w-4" aria-hidden="true" />
            Start a new board
          </Button>
        </div>

        {digest ? (
          <p className="mt-4 font-mono text-[11px] text-muted-foreground">
            Error reference: {digest}
          </p>
        ) : null}
      </div>
    </main>
  );
}
