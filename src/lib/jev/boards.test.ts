// Charles, 22 Nov 2026: a room id in the link without query params, and several saved pages for one person.
// The worst failure here is losing or hiding a board, so migration starts from storage the live build wrote.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listBoards,
  MAX_NEW_BOARDS,
  NEW_BOARDS_KEY,
  resolveBoard,
  roomSecretStorageKey,
  type BoardAddress,
  type BoardStorage,
} from "./boards";
import { boardPath, generateRoomCredentials, ROOM_ID_PATTERN } from "./room-auth";
import { readSavedBoard } from "./saved-board";
import { boardStorageKey } from "./storage-keys";

const FIXTURE = JSON.parse(
  readFileSync(path.join(__dirname, "__fixtures__", "prod-storage-e7fe246.json"), "utf8")
) as { boards: Record<string, string>; storage: Record<string, string> };
const NOW = 1_795_370_000_000;

class MemoryStorage implements BoardStorage {
  readonly map: Map<string, string>;
  writes: string[] = [];
  removed: string[] = [];
  full = false;
  constructor(entries: Record<string, string> = {}) {
    this.map = new Map(Object.entries(entries));
  }
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.full) throw new Error("QuotaExceededError");
    this.writes.push(key);
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.removed.push(key);
    this.map.delete(key);
  }
}

const prod = () => new MemoryStorage(FIXTURE.storage);
const open = (storage: BoardStorage | null, at: Partial<BoardAddress> = {}) =>
  resolveBoard(storage, { pathname: "/", hash: "", collab: false, now: NOW, ...at });

function opened(storage: BoardStorage | null, at: Partial<BoardAddress> = {}) {
  const board = open(storage, at);
  if (board.kind !== "open") throw new Error(`expected a board, got ${board.kind}`);
  return board;
}

function oldLink(name: string) {
  const hash = FIXTURE.boards[name].slice(1);
  const params = new URLSearchParams(hash.slice(1));
  return { hash, id: params.get("room")!, secret: params.get("k")! };
}

const board = (extra: object = {}) =>
  JSON.stringify({ elements: [], boardTitle: "Mine", hasLocalEdits: true, baseTimestamp: NOW - 1000, ...extra });

afterEach(() => vi.unstubAllEnvs());

describe("boards the live build saved keep working", () => {
  it.each(Object.keys(FIXTURE.boards))("old link %s: same room, same data, clean link", (name) => {
    const storage = prod();
    const link = oldLink(name);
    const result = opened(storage, { hash: link.hash });
    expect(result.roomId).toBe(link.id);
    expect(result.roomSecret).toBe(link.secret);
    expect(result.url).toBe(`/b/${link.id}`);
    expect(result.joining).toBe(false);
    expect(storage.getItem(roomSecretStorageKey(link.id))).toBe(link.secret);
    for (const [key, value] of Object.entries(FIXTURE.storage)) expect(storage.getItem(key), key).toBe(value);
    expect(storage.removed).toEqual([]);
  });

  it.each(Object.keys(FIXTURE.boards))("clean link %s works without ever seeing the old one", (name) => {
    const { id } = oldLink(name);
    const storage = prod();
    expect(opened(storage, { pathname: `/b/${id}` })).toMatchObject({ roomId: id, url: `/b/${id}`, joining: false });
    expect(storage.writes).toEqual([]);
  });

  it("every one is listed, newest edit first, never-edited ones last", () => {
    const list = listBoards(prod(), NOW);
    expect(list.map((b) => b.id).sort()).toEqual(Object.keys(FIXTURE.boards).map((n) => oldLink(n).id).sort());
    expect(list.map((b) => b.id)).toEqual(
      ["latest", "practice", "starter", "title_only", "checkout", "blank"].map((n) => oldLink(n).id)
    );
    const byId = new Map(list.map((b) => [b.id, b]));
    expect(byId.get(oldLink("checkout").id)).toMatchObject({ title: "Checkout", count: 4, hasCopies: true });
    expect(byId.get(oldLink("starter").id)).toMatchObject({ title: "URL shortener", count: 59 });
    expect(byId.get(oldLink("blank").id)).toMatchObject({ edited: null, count: 0 });
  });

  it("plain / always opens a fresh new board, never an existing saved board", () => {
    const storage = prod();
    const first = opened(storage);
    const second = opened(storage);
    expect(first.createdNew).toBe(true);
    expect(second.createdNew).toBe(true);
    expect(first.roomId).not.toBe(oldLink("latest").id);
    expect(second.roomId).not.toBe(first.roomId);
    // Existing saved boards are untouched and still open via their exact /b/<id> path.
    expect(listBoards(storage, NOW).map((b) => b.id)).not.toContain(first.roomId);
    expect(opened(storage, { pathname: `/b/${oldLink("latest").id}` }).roomId).toBe(oldLink("latest").id);
  });

  it("an old link whose key was cut off still opens the board this browser has", () => {
    const { id } = oldLink("checkout");
    expect(opened(prod(), { hash: `#room=${id}&k=cut` }).roomId).toBe(id);
    expect(opened(prod(), { hash: `#room=${id}` }).roomId).toBe(id);
  });

  it("an old link pasted over another board's address wins", () => {
    const at = { pathname: `/b/${oldLink("latest").id}`, hash: oldLink("checkout").hash };
    expect(opened(prod(), at).roomId).toBe(oldLink("checkout").id);
  });

  it("a board left only as saved copies is listed and opens", () => {
    const { id } = oldLink("checkout");
    const storage = prod();
    storage.map.delete(boardStorageKey(id));
    expect(listBoards(storage, NOW).find((b) => b.id === id)).toMatchObject({ hasCopies: true });
    expect(opened(storage, { pathname: `/b/${id}` }).joining).toBe(false);
  });

  it("a board that can't be read is listed and opened, never written", () => {
    const storage = prod();
    const id = "unreadable_AAAAAAAAAAAAAA";
    storage.map.set(boardStorageKey(id), '{"elements":[{"id":"cut');
    expect(listBoards(storage, NOW).find((b) => b.id === id)).toMatchObject({ count: null, unreadable: true });
    expect(opened(storage, { pathname: `/b/${id}` }).roomId).toBe(id);
    expect(storage.writes).toEqual([]);
  });

  it("a board that can't be opened never takes over /, however new it is", () => {
    const storage = prod();
    const id = "futurebuild_AAAAAAAAAAAA";
    storage.map.set(boardStorageKey(id), board({ elements: [{ id: "x", kind: "from-a-newer-build" }], editedAt: NOW }));
    const res = opened(storage);
    expect(res.createdNew).toBe(true);
    expect(res.roomId).not.toBe(id);
    expect(listBoards(storage, NOW).map((b) => b.id)).toContain(id);
  });

  it("an untitled board is named by what is on it", () => {
    const elements = [{ label: "Checkout Service" }, { label: "" }, { label: "Orders DB" }];
    const storage = new MemoryStorage({ [boardStorageKey("named")]: board({ boardTitle: "Untitled Sheet", elements }) });
    expect(listBoards(storage, NOW)[0].title).toBe("Checkout Service, Orders DB");
  });

  it("a name never replaces a title someone typed, and has an end", () => {
    const named = [{ label: "x".repeat(500) }];
    const storage = new MemoryStorage({
      [boardStorageKey("typed")]: board({ boardTitle: "Roadmap", elements: named, editedAt: NOW }),
      [boardStorageKey("long")]: board({ boardTitle: "Untitled Sheet", elements: named, editedAt: NOW - 1 }),
    });
    expect(listBoards(storage, NOW).map((b) => b.title)).toEqual(["Roadmap", "x".repeat(80)]);
  });

  it("a damaged key can't crash the list's links", () => {
    expect(() => boardPath("\ud800bad")).not.toThrow();
  });

  it("a board saved before ids were 128-bit is neither hidden nor refused", () => {
    const storage = new MemoryStorage({ [boardStorageKey("jev-ab12")]: board() });
    expect(listBoards(storage, NOW).map((b) => b.id)).toEqual(["jev-ab12"]);
    expect(opened(storage, { pathname: "/b/jev-ab12" }).url).toBe("/b/jev-ab12");
  });

  it("the time of the last edit written by this build beats what is guessed from the elements", () => {
    const id = oldLink("checkout").id;
    const storage = prod();
    const saved = JSON.parse(storage.getItem(boardStorageKey(id))!);
    const raw = JSON.stringify({ ...saved, editedAt: NOW - 5 });
    storage.map.set(boardStorageKey(id), raw);
    expect(listBoards(storage, NOW)[0]).toMatchObject({ id, edited: NOW - 5 });
    expect(readSavedBoard(raw).kind).toBe("board");
  });

  it("an impossible timestamp falls back on the times in the board", () => {
    const storage = new MemoryStorage({ [boardStorageKey("past")]: board({ editedAt: -1e20 }) });
    expect(listBoards(storage, NOW)[0].edited).toBe(NOW - 1000);
  });

  it("a timestamp from the future cannot pin a board above later edits", () => {
    const storage = new MemoryStorage({ [boardStorageKey("future")]: board({ editedAt: NOW + 9e9 }) });
    expect(listBoards(storage, NOW)[0].edited).toBe(NOW);
  });
});

describe("new boards", () => {
  it("/ in an empty browser makes one, with a clean 128-bit link, and saves no board yet", () => {
    const storage = new MemoryStorage();
    const result = opened(storage);
    expect(result).toMatchObject({ createdNew: true, joining: false, url: `/b/${result.roomId}` });
    expect(result.roomId).toMatch(ROOM_ID_PATTERN);
    expect(Buffer.from(result.roomId, "base64url").length * 8).toBeGreaterThanOrEqual(128);
    expect([...storage.map.keys()]).toEqual([NEW_BOARDS_KEY]);
  });

  it("reloading it is the same board and the same secret", () => {
    const storage = new MemoryStorage();
    const first = opened(storage);
    expect(opened(storage, { pathname: first.url })).toEqual(first);
  });

  it("visiting / again opens an independent fresh room without polluting saved boards", () => {
    const storage = new MemoryStorage();
    const first = opened(storage);
    const second = opened(storage);
    expect(first.createdNew && second.createdNew).toBe(true);
    expect(second.roomId).not.toBe(first.roomId);
    expect(listBoards(storage, NOW)).toEqual([]);
  });

  it("/new always makes another, even with boards saved", () => {
    const storage = prod();
    const a = opened(storage, { pathname: "/new" });
    const b = opened(storage, { pathname: "/new" });
    expect(a.createdNew && b.createdNew).toBe(true);
    expect(a.roomId).not.toBe(b.roomId);
  });

  it("boards never edited cost a bounded amount, and never a saved board", () => {
    const storage = prod();
    for (let i = 0; i < 300; i += 1) opened(storage, { pathname: "/new" });
    expect(JSON.parse(storage.getItem(NEW_BOARDS_KEY)!)).toHaveLength(MAX_NEW_BOARDS);
    expect(storage.map.size).toBe(Object.keys(FIXTURE.storage).length + 1);
    expect(storage.removed).toEqual([]);
  });

  it("a full storage still opens boards and evicts nothing", () => {
    const storage = prod();
    storage.full = true;
    expect(opened(storage, { pathname: "/new" }).createdNew).toBe(true);
    expect(opened(storage, { hash: oldLink("checkout").hash }).roomId).toBe(oldLink("checkout").id);
    expect(Object.fromEntries(storage.map)).toEqual(FIXTURE.storage);
    expect(storage.removed).toEqual([]);
  });

  it("a damaged list of new boards is not fatal", () => {
    for (const bad of ["{", "{}", '[null,1,{"id":7}]']) {
      expect(opened(new MemoryStorage({ [NEW_BOARDS_KEY]: bad })).createdNew).toBe(true);
    }
  });
});

describe("a board this browser doesn't have", () => {
  const theirs = generateRoomCredentials();

  it.each([
    ["clean link", { pathname: `/b/${theirs.roomId}` }],
    ["clean link with a key", { pathname: `/b/${theirs.roomId}`, hash: `#k=${theirs.roomSecret}` }],
    ["old link", { hash: `#room=${theirs.roomId}&k=${theirs.roomSecret}` }],
    ["garbage", { pathname: "/b/not-a-board" }],
    ["bad escape", { pathname: "/b/%E0%A4%A" }],
    ["prototype name", { pathname: "/b/__proto__" }],
  ])("%s: says so and stores nothing", (_name, at) => {
    const storage = prod();
    const result = open(storage, at);
    expect(result.kind).toBe("missing");
    expect(storage.writes).toEqual([]);
  });

  it("strips the key from the address it leaves", () => {
    const result = open(new MemoryStorage(), { hash: `#room=${theirs.roomId}&k=${theirs.roomSecret}` });
    expect(result).toMatchObject({ kind: "missing", url: `/b/${theirs.roomId}` });
  });

  it("says when storage is blocked, and can still start a board", () => {
    expect(open(null, { pathname: `/b/${theirs.roomId}` })).toMatchObject({ kind: "missing", storageBlocked: true });
    expect(opened(null).createdNew).toBe(true);
  });
});

describe("self-hosted collaboration", () => {
  const theirs = generateRoomCredentials();

  it("a share link joins, keeps the key in the fragment, and stores nothing until there is a board", () => {
    const storage = new MemoryStorage();
    for (const at of [
      { pathname: `/b/${theirs.roomId}`, hash: `#k=${theirs.roomSecret}` },
      { hash: `#room=${theirs.roomId}&k=${theirs.roomSecret}` },
    ]) {
      expect(opened(storage, { ...at, collab: true })).toMatchObject({
        ...theirs,
        joining: true,
        createdNew: false,
        url: `/b/${theirs.roomId}#k=${theirs.roomSecret}`,
      });
    }
    expect(storage.writes).toEqual([]);
  });

  it("without the key there is no joining", () => {
    expect(open(new MemoryStorage(), { pathname: `/b/${theirs.roomId}`, collab: true }).kind).toBe("missing");
  });

  it("a saved board with no stored key gets one that lasts", () => {
    const storage = prod();
    const at = { pathname: `/b/${oldLink("checkout").id}`, collab: true };
    const first = opened(storage, at);
    expect(first.roomSecret.length).toBeGreaterThanOrEqual(22);
    expect(opened(storage, at).roomSecret).toBe(first.roomSecret);
  });

  it("the link's key wins over a stored one", () => {
    const storage = prod();
    const { id, hash, secret } = oldLink("checkout");
    storage.map.set(roomSecretStorageKey(id), theirs.roomSecret);
    expect(opened(storage, { hash, collab: true }).roomSecret).toBe(secret);
  });

  it("with collaboration off a link can't replace the key this browser keeps", () => {
    const storage = prod();
    const { id } = oldLink("checkout");
    storage.map.set(roomSecretStorageKey(id), theirs.roomSecret);
    opened(storage, { hash: `#room=${id}&k=${"x".repeat(32)}` });
    expect(storage.getItem(roomSecretStorageKey(id))).toBe(theirs.roomSecret);
  });
});

describe("NEXT_PUBLIC_BASE_PATH", () => {
  it("is honoured in both directions", () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/skot");
    const { id, hash } = oldLink("checkout");
    expect(opened(prod(), { pathname: "/skot", hash }).url).toBe(`/skot/b/${id}`);
    expect(opened(prod(), { pathname: `/skot/b/${id}/` }).roomId).toBe(id);
    expect(opened(prod(), { pathname: "/skot/new" }).createdNew).toBe(true);
    expect(opened(prod(), { pathname: "/skot/" }).createdNew).toBe(true);
  });
});
