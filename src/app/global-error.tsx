"use client";

import { BRAND_NAME } from "@/brand/brand";
import { appUrl } from "@/lib/base-path";
import { useEffect, useState } from "react";

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

export default function GlobalError({
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
        boundary: "app/global-error",
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
    <html lang="en">
      <head>
        <title>{`${BRAND_NAME} — Recovery`}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          backgroundColor: "#f6f3ec",
          color: "#181b22",
          fontFamily:
            'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}
      >
        <main
          role="alert"
          style={{
            width: "100%",
            maxWidth: "448px",
            borderRadius: "16px",
            border: "1px solid #dfd8ca",
            backgroundColor: "#fdfbf7",
            padding: "24px",
            boxShadow: "0 2px 10px rgba(24, 27, 34, 0.05)",
          }}
        >
          <div
            style={{
              display: "inline-block",
              marginBottom: "12px",
              padding: "4px 10px",
              borderRadius: "999px",
              backgroundColor: "rgba(217, 78, 40, 0.12)",
              color: "#b83d1b",
              fontSize: "12px",
              fontWeight: 600,
              letterSpacing: "0.02em",
            }}
          >
            {BRAND_NAME} Recovery
          </div>

          <h1
            style={{
              margin: "0 0 8px 0",
              fontSize: "21px",
              lineHeight: 1.3,
              fontWeight: 600,
              fontFamily: 'Georgia, "Times New Roman", serif',
            }}
          >
            Something went wrong loading {BRAND_NAME}
          </h1>

          <p
            style={{
              margin: "0 0 20px 0",
              fontSize: "14px",
              lineHeight: 1.55,
              color: "#5f6672",
            }}
          >
            You can retry rendering the workspace right away, or start a new
            board. Your saved board stays in this browser.
          </p>

          {resetNotice ? (
            <p
              style={{
                margin: "0 0 16px 0",
                padding: "8px 12px",
                borderRadius: "8px",
                backgroundColor: "#ebe5d9",
                fontSize: "12px",
                color: "#181b22",
              }}
            >
              {resetNotice}
            </p>
          ) : null}

          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
            <button
              type="button"
              onClick={handleRetry}
              style={{
                appearance: "none",
                border: "1px solid #1c2028",
                borderRadius: "8px",
                backgroundColor: "#1c2028",
                color: "#f8f6f1",
                padding: "8px 14px",
                fontSize: "14px",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <button
              type="button"
              onClick={handleStartNewBoard}
              style={{
                appearance: "none",
                border: "1px solid #dfd8ca",
                borderRadius: "8px",
                backgroundColor: "#f6f3ec",
                color: "#181b22",
                padding: "8px 14px",
                fontSize: "14px",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Start a new board
            </button>
          </div>

          {digest ? (
            <p
              style={{
                margin: "16px 0 0 0",
                fontSize: "11px",
                color: "#5f6672",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              Error reference: {digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
