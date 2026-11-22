"use client";

import { BRAND_NAME, BRAND_TAGLINE } from "@/brand/brand";
import React from "react";
import { IconArrowRight, IconFork, IconLayers, IconTarget, IconWand } from "@/brand/icons";
import { StarterBoardsRow } from "./StarterBoardsPicker";

interface FirstRunEmptyStateProps {
  onDrawCheckout: () => void;
  onMorphSequence: () => void;
  onForkArchitecture: () => void;
  onPractice: () => void;
  onStarterBoard: (id: string) => void;
}

export function FirstRunEmptyState({
  onDrawCheckout,
  onMorphSequence,
  onForkArchitecture,
  onPractice,
  onStarterBoard,
}: FirstRunEmptyStateProps) {
  const starters = [
    {
      id: "checkout",
      title: "Draw a checkout system",
      eyebrow: "Write-to-Draw",
      description:
        "Customer, Checkout API, Risk Check, Payment Gateway, and Ledger DB.",
      icon: <IconWand className="h-4 w-4" aria-hidden="true" />,
      accentClass:
        "bg-[#D94E28]/12 text-[#C2411D] dark:bg-[#F0643E]/16 dark:text-[#FF8562] group-hover:bg-[#D94E28] group-hover:text-white",
      borderHover: "hover:border-[#D94E28]/45",
      delayMs: 40,
      onClick: onDrawCheckout,
    },
    {
      id: "sequence",
      title: "Morph to sequence",
      eyebrow: "Notation Morph",
      description:
        "Load a live request flow and morph it into a reversible Sequence diagram.",
      icon: <IconLayers className="h-4 w-4" aria-hidden="true" />,
      accentClass:
        "bg-[#2563EB]/12 text-[#1D4ED8] dark:bg-[#38BDF8]/15 dark:text-[#38BDF8] group-hover:bg-[#2563EB] group-hover:text-white dark:group-hover:bg-[#38BDF8] dark:group-hover:text-[#0F172A]",
      borderHover: "hover:border-[#2563EB]/45 dark:hover:border-[#38BDF8]/45",
      delayMs: 110,
      onClick: onMorphSequence,
    },
    {
      id: "fork",
      title: "Fork my architecture",
      eyebrow: "Fork It! · 3 takes",
      description:
        "Preview Queue, Cache-First, and Edge-Split alternatives right beside your draft.",
      icon: <IconFork className="h-4 w-4" aria-hidden="true" />,
      accentClass:
        "bg-[#0F766E]/12 text-[#0F766E] dark:bg-[#34D399]/15 dark:text-[#34D399] group-hover:bg-[#0F766E] group-hover:text-white dark:group-hover:bg-[#34D399] dark:group-hover:text-[#0F172A]",
      borderHover: "hover:border-[#0F766E]/45 dark:hover:border-[#34D399]/45",
      delayMs: 180,
      onClick: onForkArchitecture,
    },
  ];

  return (
    <div
      role="region"
      aria-label="Start sketching on Skot"
      className="pointer-events-none fixed inset-x-0 bottom-[84px] top-[120px] z-10 flex items-center justify-center px-3 sm:bottom-24 sm:top-20 sm:px-6"
    >
      <div className="pointer-events-auto flex max-h-full w-full max-w-[min(780px,calc(100vw-24px))] flex-col items-center overflow-y-auto py-2">
        <div
          className="jev-reveal mb-5 flex flex-col items-center text-center sm:mb-7"
          style={{ animationDelay: "0ms" }}
        >
          <span className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-card/85 px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground shadow-2xs">
            {BRAND_NAME} · Blank Sheet
          </span>
          <h1 className="font-editorial text-[26px] font-semibold leading-[1.12] tracking-[-0.02em] text-foreground sm:text-[36px]">
            {BRAND_TAGLINE.charAt(0).toUpperCase() + BRAND_TAGLINE.slice(1)}.
          </h1>
          <p className="mt-1.5 max-w-[460px] text-[13px] leading-relaxed text-muted-foreground sm:text-[14px]">
            Type a name below and press Enter to add it. Or pick a flow, or draw
            straight on the sheet.
          </p>
        </div>

        <div className="grid w-full grid-cols-1 gap-2.5 sm:grid-cols-3 sm:gap-3.5">
          {starters.map((card) => (
            <button
              key={card.id}
              type="button"
              onClick={card.onClick}
              style={{ animationDelay: `${card.delayMs}ms` }}
              className={`jev-glass jev-reveal group flex min-h-[44px] flex-col justify-between gap-3 rounded-2xl p-3.5 text-left shadow-[0_12px_32px_-16px_rgba(15,23,42,0.22)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_38px_-16px_rgba(15,23,42,0.28)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:p-4 ${card.borderHover}`}
            >
              <div>
                <div className="mb-2.5 flex items-center justify-between gap-2">
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-xl transition-colors ${card.accentClass}`}
                  >
                    {card.icon}
                  </span>
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
                    {card.eyebrow}
                  </span>
                </div>
                <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-foreground">
                  {card.title}
                </h2>
                <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
                  {card.description}
                </p>
              </div>

              <div className="flex items-center gap-1 font-mono text-[10.5px] font-semibold text-foreground/85 transition-colors group-hover:text-foreground">
                <span>Try now</span>
                <IconArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </div>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onPractice}
          style={{ animationDelay: "220ms" }}
          className="jev-glass jev-reveal group mt-2.5 flex min-h-[44px] w-full items-center gap-3 rounded-2xl px-3.5 py-2.5 text-left shadow-[0_12px_32px_-16px_rgba(15,23,42,0.22)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[#D94E28]/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:mt-3.5 sm:px-4"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#D94E28]/12 text-[#C2411D] transition-colors group-hover:bg-[#D94E28] group-hover:text-white dark:bg-[#F0643E]/16 dark:text-[#FF8562]">
            <IconTarget className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold tracking-[-0.01em] text-foreground">Practice a problem</span>
            <span className="block text-[12px] leading-snug text-muted-foreground">
              URL shortener, chat, feed and more. Timer on, AI silent until you ask for a review.
            </span>
          </span>
          <IconArrowRight className="h-3.5 w-3.5 shrink-0 text-foreground/70 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </button>
        <StarterBoardsRow onPick={onStarterBoard} />

        {/* Subtle keyboard hint row */}
        <div
          className="jev-reveal mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 font-mono text-[11px] text-muted-foreground sm:mt-6"
          style={{ animationDelay: "240ms" }}
        >
          {[
            ["Enter", "Add what you typed"],
            ["Tab", "Bigger options"],
            ["/", "Commands"],
          ].map(([key, what], i) => (
            <React.Fragment key={key}>
              {i > 0 && (
                <span aria-hidden="true" className="opacity-35">
                  ·
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <kbd className="rounded-md border border-border bg-card/90 px-1.5 py-0.5 text-[10px] font-semibold text-foreground shadow-2xs">
                  {key}
                </kbd>
                <span>{what}</span>
              </span>
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
