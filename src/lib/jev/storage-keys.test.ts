import { describe, expect, it } from "vitest";
import { BOARD_STORAGE_PREFIX, boardStorageKey } from "@/lib/jev/storage-keys";
import { getCreatorTokenStorageKey } from "@/lib/jev/room-auth";
import { getBeforeRestoreStorageKey, getRecoveryStorageKey } from "@/lib/jev/recovery-buffer";
import { FEEDBACK_STORAGE_KEY } from "@/lib/jev/feedback-store";

// These keys hold users' saved boards in localStorage. Renaming them silently wipes every saved board,
// so they keep the pre-rename "jev_" prefix forever.
describe("legacy localStorage keys survive the Skot rename", () => {
  it("board, creator token, recovery and feedback keys are unchanged", () => {
    expect(BOARD_STORAGE_PREFIX).toBe("jev_board_");
    expect(boardStorageKey("r1")).toBe("jev_board_r1");
    expect(getCreatorTokenStorageKey("r1")).toBe("jev_creator_token_r1");
    expect(getRecoveryStorageKey("r1")).toBe("jev_recovery_r1");
    expect(getBeforeRestoreStorageKey("r1")).toBe("jev_before_restore_r1");
    expect(FEEDBACK_STORAGE_KEY).toBe("jev_suggestion_feedback_v1");
  });
});
