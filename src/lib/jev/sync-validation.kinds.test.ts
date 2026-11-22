import { describe, expect, it } from "vitest";
import {
  jevElementSchema,
  parseRawDataChannelMessage,
  parseStoredBoardSnapshot,
} from "@/lib/jev/sync-validation";
import { loadRecoverySnapshots } from "@/lib/jev/recovery-buffer";
import { elementsContentEqual } from "@/lib/jev/board-sync";
import { ARROW_ENDS, ELEMENT_KINDS, SHAPE_KINDS, type JevElement } from "@/lib/jev/types";

function shape(kind: JevElement["kind"], i: number): JevElement {
  return {
    id: `s_${kind}`,
    kind,
    x: i * 200,
    y: 0,
    width: 120,
    height: 80,
    label: kind,
    ...(kind === "entity" ? { sublabel: "id uuid PK\nuser_id uuid FK" } : {}),
    ...(kind === "class" ? { sublabel: "- id: int\n--\n+ save(): void" } : {}),
    ...(kind === "fragment" ? { label: "alt", sublabel: "[hit]\n[miss]" } : {}),
    ...(kind === "freedraw" ? { points: [{ x: 0, y: 0 }, { x: 4, y: 6 }] } : {}),
    tone: "ink",
    seed: i + 1,
    createdAt: 10,
    updatedAt: 20,
    rev: 3,
  };
}

function arrowsForEveryEnd(fromId: string, toId: string): JevElement[] {
  return ARROW_ENDS.map((end, i) => ({
    id: `a_${end}`,
    kind: "arrow",
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    label: "",
    tone: "ink",
    seed: 100 + i,
    fromId,
    toId,
    startEnd: ARROW_ENDS[(i + 3) % ARROW_ENDS.length],
    endEnd: end,
    createdAt: 10,
    updatedAt: 20,
    rev: 1,
  }));
}

const shapes = ELEMENT_KINDS.filter((k) => k !== "arrow").map((k, i) => shape(k, i));
const elements: JevElement[] = [...shapes, ...arrowsForEveryEnd("s_entity", "s_class")];

function syncState(els: unknown[]) {
  return JSON.stringify({ kind: "sync_state", peerId: "peer_1", elements: els, boardTitle: "Kinds", ts: 5 });
}

describe("sync-validation: every element kind and arrow end round-trips", () => {
  it("covers every shape kind and every arrow end", () => {
    expect(new Set(shapes.map((s) => s.kind))).toEqual(new Set([...SHAPE_KINDS, "freedraw"]));
    const ends = new Set(elements.flatMap((e) => (e.kind === "arrow" ? [e.startEnd, e.endEnd] : [])));
    expect(ends).toEqual(new Set(ARROW_ENDS));
  });

  it("survives the local storage snapshot unchanged", () => {
    const parsed = parseStoredBoardSnapshot(JSON.stringify({ elements, boardTitle: "Kinds" }));
    expect(parsed?.elements).toEqual(elements);
    parsed!.elements.forEach((el, i) => expect(elementsContentEqual(el, elements[i])).toBe(true));
  });

  it("survives a sync_state wire message unchanged", () => {
    const msg = parseRawDataChannelMessage(syncState(elements));
    expect(msg?.kind).toBe("sync_state");
    if (msg?.kind !== "sync_state") return;
    expect(msg.elements).toEqual(elements);
  });

  it("survives the recovery buffer unchanged", () => {
    const buffer = [
      {
        id: "rec_1",
        savedAt: 1,
        reason: "manual",
        removedCount: 0,
        previousElementCount: elements.length,
        snapshot: { elements, boardTitle: "Kinds" },
      },
    ];
    const storage = { getItem: () => JSON.stringify(buffer), setItem: () => {}, removeItem: () => {} };
    expect(loadRecoverySnapshots(storage, "room")[0]?.snapshot.elements).toEqual(elements);
  });

  it("rejects an unknown kind on every path", () => {
    const bad = [{ ...shapes[0], kind: "hexagon" }];
    expect(jevElementSchema.safeParse(bad[0]).success).toBe(false);
    expect(parseStoredBoardSnapshot(JSON.stringify({ elements: bad }))).toBeNull();
    expect(parseRawDataChannelMessage(syncState(bad))).toBeNull();
  });

  it("rejects unknown start or end markers on every path", () => {
    const [arrow] = arrowsForEveryEnd("s_entity", "s_class");
    for (const bad of [{ ...arrow, endEnd: "crowsfoot" }, { ...arrow, startEnd: "ARROW" }, { ...arrow, endEnd: 3 }]) {
      expect(jevElementSchema.safeParse(bad).success).toBe(false);
      expect(parseStoredBoardSnapshot(JSON.stringify({ elements: [bad] }))).toBeNull();
      expect(parseRawDataChannelMessage(syncState([bad]))).toBeNull();
    }
  });

  it("treats a change of only the end marker as a content change", () => {
    const [arrow] = arrowsForEveryEnd("s_entity", "s_class");
    expect(elementsContentEqual(arrow, { ...arrow, endEnd: "er_one_many" })).toBe(false);
    expect(elementsContentEqual(arrow, { ...arrow, startEnd: undefined })).toBe(false);
  });
});
