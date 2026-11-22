import { lastEdited, parseBoardData, storeRoomSecret } from "./boards";
import { writeSavedBoard, type SaveOutcome } from "./saved-board";
import { boardStorageKey } from "./storage-keys";
import type { StoredBoardSnapshot } from "./sync-validation";

export type BoardRecord = StoredBoardSnapshot & { editedAt?: number };

interface BoardSaverOptions {
  storage: () => Pick<Storage, "getItem" | "setItem"> | null;
  roomId: string;
  roomSecret: string;
  /** The board as it is now. */
  read: () => BoardRecord;
  canSave: () => boolean;
  loadedRaw: string | null;
  now: number;
}

const contentOf = ({ elements, boardTitle }: BoardRecord) => JSON.stringify([elements, boardTitle]);

/**
 * The one writer of a board. It is bound to that board when it opens, so it never takes a key from the address.
 * It writes only what changed here: a tab that was just looking can't save over a newer one as it leaves.
 */
export class BoardSaver {
  private saved: string | null;
  private content: string;
  private editedAt: number | null;
  private secretStored = false;

  constructor(private readonly options: BoardSaverOptions) {
    const loaded = parseBoardData(options.loadedRaw);
    const board = options.read();
    this.editedAt = lastEdited(loaded, options.now);
    this.content = contentOf(board);
    // With no epoch saved, each tab would make up its own: the one this board was given is saved at once.
    this.saved = loaded && !loaded.boardEpoch ? null : JSON.stringify(board);
  }

  save(now: number): SaveOutcome | "unchanged" {
    const { storage: getStorage, roomId, roomSecret, read, canSave } = this.options;
    if (!canSave()) return "unchanged";
    const board = read();
    const json = JSON.stringify(board);
    if (json === this.saved) return "unchanged";
    const storage = getStorage();
    if (!storage) return "storage_failed";

    const content = contentOf(board);
    const editedAt = content === this.content ? this.editedAt : now;
    const record = editedAt === null ? board : { ...board, editedAt };
    const outcome = writeSavedBoard(storage, boardStorageKey(roomId), JSON.stringify(record));
    if (outcome !== "saved") return outcome;

    this.saved = json;
    this.content = content;
    this.editedAt = editedAt;
    if (roomSecret && !this.secretStored) {
      storeRoomSecret(storage, roomId, roomSecret);
      this.secretStored = true;
    }
    return outcome;
  }
}
