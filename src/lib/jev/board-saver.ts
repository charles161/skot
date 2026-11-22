import { mergeWithStored } from "./board-tabs";
import { lastEdited, parseBoardData, storeRoomSecret } from "./boards";
import { readSavedBoard, writeSavedBoard, type SaveOutcome } from "./saved-board";
import { boardStorageKey } from "./storage-keys";
import type { StoredBoardSnapshot } from "./sync-validation";

export type BoardRecord = StoredBoardSnapshot & { editedAt?: number };

interface BoardSaverOptions {
  storage: () => Pick<Storage, "getItem" | "setItem"> | null;
  roomId: string;
  roomSecret: string;
  /** The board as it is now. */
  read: () => BoardRecord;
  /** Put on screen what another tab saved, merged with what this one has. `read` returns it at once. */
  adopt: (board: StoredBoardSnapshot) => void;
  canSave: () => boolean;
  loadedRaw: string | null;
  now: number;
}

const contentOf = ({ elements, boardTitle }: BoardRecord) => JSON.stringify([elements, boardTitle]);

/**
 * The one writer of a board. It is bound to that board when it opens, so it never takes a key from the address.
 * It never writes over what it hasn't seen: what another tab saved since is merged first. It writes only what
 * changed here, so a tab that is just looking follows without saving.
 */
export class BoardSaver {
  /** The stored value this tab has taken in. */
  private seen: string | null;
  private saved: string | null;
  /** Content and title as storage has them, to tell what was changed here. */
  private content: string;
  private title: string | undefined;
  private editedAt: number | null;
  private secretStored = false;

  constructor(private readonly options: BoardSaverOptions) {
    const loaded = parseBoardData(options.loadedRaw);
    const board = options.read();
    this.seen = options.loadedRaw;
    this.editedAt = lastEdited(loaded, options.now);
    this.content = contentOf(board);
    this.title = board.boardTitle;
    // With no epoch saved, each tab would make up its own: the one this board was given is saved at once.
    this.saved = loaded && !loaded.boardEpoch ? null : JSON.stringify(board);
  }

  save(now: number): SaveOutcome | "unchanged" {
    const { storage: getStorage, roomId, roomSecret, read, canSave, adopt } = this.options;
    const key = boardStorageKey(roomId);
    let storage = getStorage();
    let current: string | null = null;
    try {
      current = storage?.getItem(key) ?? null;
    } catch {
      storage = null;
    }

    if (storage && current !== this.seen) {
      const stored = readSavedBoard(current);
      if (stored.kind === "board") {
        const mine = read();
        const { board, isStored } = mergeWithStored(mine, stored.snapshot, {
          content: contentOf(mine) !== this.content,
          title: mine.boardTitle !== this.title,
        });
        adopt(board);
        this.seen = current;
        this.editedAt = lastEdited(parseBoardData(current), now);
        this.content = contentOf(stored.snapshot);
        this.title = stored.snapshot.boardTitle;
        if (isStored) {
          const followed = read();
          this.saved = JSON.stringify(followed);
          this.content = contentOf(followed);
          this.title = followed.boardTitle;
          return "unchanged";
        }
        this.saved = null;
      }
    }

    if (!canSave()) return "unchanged";
    const board = read();
    const json = JSON.stringify(board);
    if (json === this.saved) return "unchanged";
    if (!storage) return "storage_failed";

    const content = contentOf(board);
    const editedAt = content === this.content ? this.editedAt : now;
    const written = JSON.stringify(editedAt === null ? board : { ...board, editedAt });
    const outcome = writeSavedBoard(storage, key, written);
    if (outcome !== "saved") return outcome;

    this.seen = written;
    this.saved = json;
    this.content = content;
    this.title = board.boardTitle;
    this.editedAt = editedAt;
    if (roomSecret && !this.secretStored) {
      storeRoomSecret(storage, roomId, roomSecret);
      this.secretStored = true;
    }
    return outcome;
  }
}
