// Round-2 judges, prod: "Tab does two jobs": sometimes it completed the name, sometimes it moved through the
// options, and nothing on screen said which. The completion is now shown in the bar, in grey, after the caret.
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ThoughtBar } from "@/components/jev/ThoughtBar";

const bar = (value: string, completion: string | null) =>
  renderToStaticMarkup(
    <ThoughtBar inputRef={createRef<HTMLInputElement>()} value={value} completion={completion} onChange={() => {}} onSubmit={() => {}} onClear={() => {}} />
  );
const ghost = (html: string) => html.match(/<span data-completion-ghost[^>]*>(.*?)<\/span>/)?.[1] ?? null;

describe("the completion Tab will accept is visible in the bar", () => {
  it("shows the rest of the name in grey after what was typed", () => {
    expect(ghost(bar("api", "API Gateway"))).toBe(" Gateway");
    expect(ghost(bar("post", "Postgres DB"))).toBe("gres DB");
  });

  it("shows nothing when there is no completion, or the text is not the start of it", () => {
    expect(ghost(bar("api gateway", null))).toBeNull();
    expect(ghost(bar("kaf", "Event Bus"))).toBeNull();
    expect(ghost(bar("", "API Gateway"))).toBeNull();
  });
});
