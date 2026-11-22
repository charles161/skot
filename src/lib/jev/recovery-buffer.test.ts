import { describe, expect, it } from "vitest";
import type { JevElement } from "@/lib/jev/types";
import {
  loadRecoverySnapshots,
  MAX_RECOVERY_SNAPSHOTS,
  popRecoverySnapshot,
  pushRecoverySnapshot,
  type StorageLike,
} from "@/lib/jev/recovery-buffer";

function makeMemoryStorage(opts?: { maxBytes?: number }): StorageLike & {
  store: Map<string, string>;
} {
  const store = new Map<string, string>();
  return {
    store,
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      if (opts?.maxBytes !== undefined && value.length > opts.maxBytes) {
        throw new Error("QuotaExceededError");
      }
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
  };
}

function makeEl(id: string, label: string): JevElement {
  return {
    id,
    kind: "node",
    x: 100,
    y: 100,
    width: 160,
    height: 70,
    label,
    tone: "cobalt",
    seed: 11,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    rev: 2,
  };
}

describe("JW-10 / JW-13: bounded 8-snapshot local recovery ring buffer with Zod validation", () => {
  it("keeps at most the last 8 snapshots per room, pops newest first, and isolates rooms", () => {
    const storage = makeMemoryStorage();
    expect(MAX_RECOVERY_SNAPSHOTS).toBe(8);

    for (let i = 1; i <= 10; i += 1) {
      pushRecoverySnapshot(storage, "room_A", {
        id: `rec_${i}`,
        savedAt: 1000 + i,
        reason: i % 3 === 0 ? "periodic" : i % 2 === 0 ? "remote_change_threshold" : "authoritative_replace",
        removedCount: 5,
        editedCount: 2,
        previousElementCount: 6,
        snapshot: {
          elements: [makeEl(`el_${i}`, `Snapshot ${i}`)],
          boardTitle: `Title ${i}`,
          titleRev: i,
          hasLocalEdits: true,
        },
      });
    }

    pushRecoverySnapshot(storage, "room_B", {
      id: "rec_other_room",
      savedAt: 5000,
      reason: "peer_quarantine",
      removedCount: 4,
      previousElementCount: 4,
      snapshot: {
        elements: [makeEl("el_b", "Room B")],
        boardTitle: "Room B",
        hasLocalEdits: true,
      },
    });

    const loadedA = loadRecoverySnapshots(storage, "room_A");
    expect(loadedA).toHaveLength(8);
    // Newest 8 kept: 10 down to 3 (snapshots 1 and 2 evicted)
    expect(loadedA.map((e) => e.id)).toEqual([
      "rec_10",
      "rec_9",
      "rec_8",
      "rec_7",
      "rec_6",
      "rec_5",
      "rec_4",
      "rec_3",
    ]);

    const popped = popRecoverySnapshot(storage, "room_A");
    expect(popped.entry?.id).toBe("rec_10");
    expect(popped.entry?.snapshot.boardTitle).toBe("Title 10");
    expect(popped.remaining.map((e) => e.id)).toEqual([
      "rec_9",
      "rec_8",
      "rec_7",
      "rec_6",
      "rec_5",
      "rec_4",
      "rec_3",
    ]);

    // Room B untouched
    expect(loadRecoverySnapshots(storage, "room_B").map((e) => e.id)).toEqual([
      "rec_other_room",
    ]);
  });

  it("validates snapshots strictly via Zod on read and rejects corrupted, invalid-tone, or prototype-polluting entries", () => {
    const storage = makeMemoryStorage();

    // Corrupted JSON
    storage.setItem("jev_recovery_room_corrupt", "{bad-json");
    expect(loadRecoverySnapshots(storage, "room_corrupt")).toEqual([]);

    // Invalid tone inside snapshot
    storage.setItem(
      "jev_recovery_room_bad_tone",
      JSON.stringify([
        {
          id: "rec_bad",
          savedAt: 1000,
          reason: "authoritative_replace",
          removedCount: 4,
          previousElementCount: 4,
          snapshot: {
            elements: [{ ...makeEl("el_1", "Bad"), tone: "neon-xss" }],
            boardTitle: "Bad",
          },
        },
      ])
    );
    expect(loadRecoverySnapshots(storage, "room_bad_tone")).toEqual([]);

    // Prototype pollution key
    storage.setItem(
      "jev_recovery_room_proto",
      '[{"id":"rec_p","savedAt":1000,"reason":"authoritative_replace","removedCount":4,"previousElementCount":4,"snapshot":{"elements":[],"__proto__":{"polluted":true}}}]'
    );
    expect(loadRecoverySnapshots(storage, "room_proto")).toEqual([]);
  });

  it("gracefully trims oldest entries if localStorage quota is exceeded", () => {
    const storage = makeMemoryStorage({ maxBytes: 1200 });
    for (let i = 1; i <= 5; i += 1) {
      pushRecoverySnapshot(storage, "room_quota", {
        id: `rec_q_${i}`,
        savedAt: 2000 + i,
        reason: "authoritative_replace",
        removedCount: 4,
        previousElementCount: 4,
        snapshot: {
          elements: [makeEl(`el_${i}`, `Node ${i} ${"x".repeat(80)}`)],
          boardTitle: `Title ${i}`,
          hasLocalEdits: true,
        },
      });
    }
    const loaded = loadRecoverySnapshots(storage, "room_quota");
    expect(loaded.length).toBeGreaterThanOrEqual(1);
    expect(loaded[0].id).toBe("rec_q_5");
  });
});
