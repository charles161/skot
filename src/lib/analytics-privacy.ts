/** The path analytics may record: the route, never which board. */
export function hideBoardInPath(pathname: string): string {
  return pathname.replace(/\/b\/[^/]+/, "/b/[id]");
}

/** Drop the board id, query and fragment (secret or shared board) before Vercel Analytics or Speed Insights send. */
export function scrubAnalyticsUrl<T extends { url: string }>(event: T): T {
  return { ...event, url: hideBoardInPath(event.url.replace(/[?#].*$/, "")) };
}
