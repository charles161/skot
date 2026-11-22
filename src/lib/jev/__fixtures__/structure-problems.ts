// Test oracle: architecture mistakes an option must not make. Used by the option tests to check the local
// options are sound (every new node is fed, no cache hung off the database, no replica writing into the primary).
import type { JevElement, PredictedAction } from "@/lib/jev/types";

const isStoreEl = (e: JevElement) => e.kind === "database" || e.kind === "blob";
const isCacheEl = (e: JevElement) => e.kind === "cache" || /cache|redis|memcache/i.test(e.label);
const isReplicaEl = (e: JevElement) => /replica/i.test(e.label);

/**
 * Architecture mistakes an option must not make: a cache hung off the database instead of sitting on the
 * caller's read path, or a replica writing into the primary.
 */
export function structureProblems(option: PredictedAction, elements: JevElement[]): string[] {
  const all = new Map([...elements, ...option.addElements].map((e) => [e.id, e]));
  const arrows = [...elements, ...option.addElements].filter((e) => e.kind === "arrow" && e.fromId && e.toId);
  const problems: string[] = [];
  for (const a of option.addElements.filter((e) => e.kind === "arrow")) {
    const from = all.get(a.fromId!);
    const to = all.get(a.toId!);
    if (!from || !to) continue;
    if (isStoreEl(from) && !isCacheEl(from) && isCacheEl(to)) problems.push(`${from.label} feeds cache ${to.label}`);
    if (isReplicaEl(from) && isStoreEl(to) && !isReplicaEl(to)) problems.push(`replica ${from.label} writes into ${to.label}`);
  }
  const fresh = option.addElements.filter((e) => e.kind !== "arrow");
  const unfed = fresh.filter((n) => n.kind !== "actor" && !arrows.some((a) => a.toId === n.id));
  const blank = !elements.some((e) => e.kind !== "arrow" && e.kind !== "freedraw");
  for (const n of blank ? unfed.slice(1) : unfed) problems.push(`${n.label} has no input`);
  for (const cache of option.addElements.filter((e) => e.kind !== "arrow" && isCacheEl(e))) {
    const neighbours = arrows
      .filter((a) => a.fromId === cache.id || a.toId === cache.id)
      .map((a) => all.get(a.fromId === cache.id ? a.toId! : a.fromId!))
      .filter((x): x is JevElement => Boolean(x));
    if (neighbours.length > 0 && neighbours.every((n) => isStoreEl(n) || isCacheEl(n))) {
      problems.push(`cache ${cache.label} has no caller, only stores`);
    }
  }
  return problems;
}

/** A bigger option holds every node of the smaller one, so Tab only ever adds to the picture. */
