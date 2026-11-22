// 22 Nov 2026: Post-deploy verify never ran on a deploy. It waited for repository_dispatch, and this repo has
// never received one: Vercel reports a deploy here only as a "Vercel" commit status.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const workflow = parse(readFileSync(path.join(__dirname, "../.github/workflows/post-deploy.yml"), "utf8"));
const job = workflow.jobs["verify-prod"];

const MAIN = "a940b94efddec687b34539ea576196753c195113";
const OLD_MAIN = "1e68d4b8cf6f0fa11384b5ef8638c0521345ebde";
const VERCEL = { context: "Vercel", state: "success", sha: MAIN, sender: { login: "vercel[bot]" } };

/** The job's own `if:`, evaluated. It uses only operators that mean the same in JavaScript. */
function runs(github: { event_name: string; sha: string; event: object }): boolean {
  return Boolean(new Function("github", `return (${job.if});`)({ ...github }));
}
const status = (event: object, sha = MAIN) => runs({ event_name: "status", sha, event: { ...VERCEL, ...event } });

describe("Post-deploy verify runs after a production deploy", () => {
  it("listens for the commit status, the only deploy signal Vercel sends this repo", () => {
    expect(Object.keys(workflow.on).sort()).toEqual(["schedule", "status", "workflow_dispatch"]);
  });

  it("runs when Vercel says main's head is deployed", () => {
    expect(status({})).toBe(true);
  });

  it.each([
    ["the preview of the same commit, before main moved to it", {}, OLD_MAIN],
    ["deploy still going", { state: "pending" }, MAIN],
    ["deploy failed", { state: "failure" }, MAIN],
    ["another check", { context: "Verify features" }, MAIN],
    ["someone else's status named Vercel", { sender: { login: "someone" } }, MAIN],
  ])("stays out of %s", (_name, event, sha) => {
    expect(status(event, sha)).toBe(false);
  });

  it.each(["schedule", "workflow_dispatch"])("still runs on %s", (event_name) => {
    expect(runs({ event_name, sha: MAIN, event: {} })).toBe(true);
  });

  it("queues at the job, so a status it skips can't push a waiting verification out of the queue", () => {
    expect(workflow.concurrency).toBeUndefined();
    expect(job.concurrency).toEqual({ group: "post-deploy", "cancel-in-progress": false });
  });

  it("checks out main's head and asks for nothing new", () => {
    const checkout = job.steps.find((step: { uses?: string }) => step.uses?.startsWith("actions/checkout"));
    expect(checkout.with?.ref ?? "${{ github.sha }}").toBe("${{ github.sha }}");
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(job.permissions).toEqual({ contents: "read", issues: "write" });
    expect(readFileSync(path.join(__dirname, "../.github/workflows/post-deploy.yml"), "utf8")).not.toMatch(/secrets\.(?!GITHUB_TOKEN)/);
  });
});
