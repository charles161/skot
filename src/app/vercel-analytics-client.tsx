"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { hideBoardInPath, scrubAnalyticsUrl } from "@/lib/analytics-privacy";

// The /next wrappers take the route from the address, board id and all, so this passes what they would otherwise.
const VERCEL_NEXT = {
  framework: "next",
  basePath: process.env.NEXT_PUBLIC_VERCEL_OBSERVABILITY_BASEPATH,
  configString: process.env.NEXT_PUBLIC_VERCEL_OBSERVABILITY_CLIENT_CONFIG,
};

export function SkotAnalytics() {
  const pathname = usePathname();
  // The route the document loaded at: rewriting / to the board's link is not a second page view.
  const [route] = useState(() => hideBoardInPath(pathname ?? "/"));
  return (
    <>
      <Analytics {...VERCEL_NEXT} route={route} path={route} beforeSend={scrubAnalyticsUrl} />
      <SpeedInsights {...VERCEL_NEXT} route={route} beforeSend={scrubAnalyticsUrl} />
    </>
  );
}
