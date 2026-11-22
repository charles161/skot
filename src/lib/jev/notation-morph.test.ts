import { describe, expect, it } from "vitest";
import {
  applyLocalElementsChange,
  mergeRemoteBoardState,
} from "@/lib/jev/board-sync";
import { computeBounds, isShapeElement } from "@/lib/jev/geometry";
import {
  ALL_MORPH_NOTATIONS,
  applyMorphToBoard,
  constrainMorphSpecToSelection,
  detectSelectionMorphState,
  extractMorphSemanticSpec,
  morphSelectionToNotation,
  selectionSpecFromGraph,
  validateMorphSemanticSpec,
  type MorphNotation,
} from "@/lib/jev/notation-morph";
import {
  formatTransitionLabel,
  isCrowsFootEnd,
  parseEntityRows,
  resolveRenderStyle,
} from "@/lib/jev/notation-kinds";
import { serializeBoardToGraph, validateLayoutElements } from "@/lib/jev/semantic-graph";
import {
  parseStoredBoardSnapshot,
  parseWireMessage,
} from "@/lib/jev/sync-validation";
import type { JevElement, MorphSemanticSpec } from "@/lib/jev/types";
import urlShortenerCreateFlow from "./__fixtures__/url-shortener-create-flow.json";
import urlShortenerHld from "./__fixtures__/url-shortener-hld.json";

function makeSketchBoard(): JevElement[] {
  const now = 1_710_000_000_000;
  return [
    {
      id: "ext_client",
      kind: "ellipse",
      x: 40,
      y: 220,
      width: 140,
      height: 70,
      label: "Browser",
      tone: "terracotta",
      seed: 101,
      createdAt: now,
      updatedAt: now,
      rev: 1,
    },
    {
      id: "sk_api",
      kind: "node",
      x: 260,
      y: 220,
      width: 170,
      height: 72,
      label: "Order API",
      tone: "cobalt",
      seed: 102,
      createdAt: now,
      updatedAt: now,
      rev: 1,
    },
    {
      id: "sk_check",
      kind: "diamond",
      x: 500,
      y: 208,
      width: 156,
      height: 96,
      label: "In Stock?",
      tone: "plum",
      seed: 103,
      createdAt: now,
      updatedAt: now,
      rev: 1,
    },
    {
      id: "sk_db",
      kind: "database",
      x: 730,
      y: 212,
      width: 164,
      height: 86,
      label: "Orders DB",
      tone: "teal",
      seed: 104,
      createdAt: now,
      updatedAt: now,
      rev: 1,
    },
    {
      id: "ext_analytics",
      kind: "node",
      x: 980,
      y: 220,
      width: 160,
      height: 72,
      label: "Analytics",
      tone: "slate",
      seed: 105,
      createdAt: now,
      updatedAt: now,
      rev: 1,
    },
    {
      id: "arr_ext_in",
      kind: "arrow",
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      label: "POST /orders",
      tone: "ink",
      seed: 201,
      fromId: "ext_client",
      toId: "sk_api",
      arrowStyle: "curved",
      createdAt: now,
      updatedAt: now,
      rev: 1,
    },
    {
      id: "arr_int_1",
      kind: "arrow",
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      label: "validate",
      tone: "ink",
      seed: 202,
      fromId: "sk_api",
      toId: "sk_check",
      arrowStyle: "curved",
      createdAt: now,
      updatedAt: now,
      rev: 1,
    },
    {
      id: "arr_int_2",
      kind: "arrow",
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      label: "Yes",
      tone: "ink",
      seed: 203,
      fromId: "sk_check",
      toId: "sk_db",
      arrowStyle: "curved",
      createdAt: now,
      updatedAt: now,
      rev: 1,
    },
    {
      id: "arr_ext_out",
      kind: "arrow",
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      label: "cdc",
      tone: "ochre",
      seed: 204,
      fromId: "sk_db",
      toId: "ext_analytics",
      arrowStyle: "curved",
      dashed: true,
      createdAt: now,
      updatedAt: now,
      rev: 1,
    },
  ];
}

describe("Chunk 5b: Notation Morph — reversible in-place semantic morphing", () => {
  it("extracts a rich shared semantic spec covering actors/messages, steps, states/transitions, and entities/relations", () => {
    const board = makeSketchBoard();
    const spec = extractMorphSemanticSpec(["sk_api", "sk_check", "sk_db"], board);

    expect(spec).not.toBeNull();
    expect(spec!.actors.length).toBeGreaterThanOrEqual(3);
    expect(spec!.messages.length).toBeGreaterThanOrEqual(2);
    expect(spec!.steps.length).toBeGreaterThanOrEqual(3);
    expect(spec!.states.length).toBeGreaterThanOrEqual(3);
    expect(spec!.transitions.length).toBeGreaterThanOrEqual(2);
    expect(spec!.entities.length).toBeGreaterThanOrEqual(2);
    expect(spec!.relations.length).toBeGreaterThanOrEqual(1);
    expect(spec!.entities[0].attributes.some((a) => /PK/i.test(a))).toBe(true);
  });

  it("produces genuinely distinct, overlap-free native layouts for all 5 notations", () => {
    const board = makeSketchBoard();
    const sel = ["sk_api", "sk_check", "sk_db"];
    const originalBounds = computeBounds(
      board.filter((e) => sel.includes(e.id))
    )!;
    const externalIds = new Set(["ext_client", "ext_analytics"]);

    expect(ALL_MORPH_NOTATIONS).toEqual([
      "sketch",
      "sequence",
      "flowchart",
      "state",
      "er",
    ]);

    // 1) Sequence: top actor headers + vertical dashed lifelines + horizontal labeled message arrows
    const seqRes = morphSelectionToNotation(sel, board, "sequence");
    expect(seqRes).not.toBeNull();
    expect(seqRes!.notation).toBe("sequence");
    const seqActors = seqRes!.addedElements.filter(
      (e) => e.morphMeta?.role === "actor"
    );
    const seqLifelines = seqRes!.addedElements.filter(
      (e) => e.morphMeta?.role === "lifeline"
    );
    const seqMessages = seqRes!.addedElements.filter(
      (e) => e.morphMeta?.role === "message"
    );
    expect(seqActors.length).toBeGreaterThanOrEqual(3);
    expect(seqLifelines.length).toBe(seqActors.length);
    expect(seqLifelines.every((l) => l.dashed === true)).toBe(true);
    expect(seqMessages.length).toBeGreaterThanOrEqual(2);
    // Horizontal message arrows ordered top-to-bottom
    for (let i = 1; i < seqMessages.length; i++) {
      expect(seqMessages[i].fromPoint!.y).toBeGreaterThan(
        seqMessages[i - 1].fromPoint!.y
      );
    }
    const seqValidation = validateLayoutElements(seqRes!.addedElements, {
      externalElementIds: externalIds,
    });
    expect(seqValidation.ok, seqValidation.errors.join("; ")).toBe(true);

    // 2) Flowchart: Start/End ellipses, process rectangles, decision diamond with Yes/No branches
    const flowRes = morphSelectionToNotation(sel, board, "flowchart");
    expect(flowRes).not.toBeNull();
    const flowEllipses = flowRes!.addedElements.filter(
      (e) => e.kind === "ellipse"
    );
    const flowDiamonds = flowRes!.addedElements.filter(
      (e) => e.kind === "diamond"
    );
    const flowArrows = flowRes!.addedElements.filter((e) => e.kind === "arrow");
    expect(flowEllipses.length).toBeGreaterThanOrEqual(2);
    expect(flowDiamonds.length).toBeGreaterThanOrEqual(1);
    expect(flowArrows.some((a) => /yes/i.test(a.label))).toBe(true);
    expect(flowArrows.some((a) => /no|fail|retry/i.test(a.label))).toBe(true);
    const flowValidation = validateLayoutElements(flowRes!.addedElements, {
      externalElementIds: externalIds,
    });
    expect(flowValidation.ok, flowValidation.errors.join("; ")).toBe(true);

    // 3) State: initial/final pseudo-states, state nodes, labeled event transition arrows
    const stateRes = morphSelectionToNotation(sel, board, "state");
    expect(stateRes).not.toBeNull();
    const stateNodes = stateRes!.addedElements.filter(
      (e) => e.morphMeta?.role === "state"
    );
    const stateTransitions = stateRes!.addedElements.filter(
      (e) => e.morphMeta?.role === "transition" && e.morphMeta.semanticId
    );
    expect(stateNodes.length).toBeGreaterThanOrEqual(3);
    expect(stateTransitions.length).toBeGreaterThanOrEqual(2);
    expect(stateTransitions.every((t) => t.label.trim().length > 0)).toBe(true);
    const stateValidation = validateLayoutElements(stateRes!.addedElements, {
      externalElementIds: externalIds,
    });
    expect(stateValidation.ok, stateValidation.errors.join("; ")).toBe(true);

    // 4) ER: entity cards with PK/attribute sublabels + crow's-foot relationship connectors
    const erRes = morphSelectionToNotation(sel, board, "er");
    expect(erRes).not.toBeNull();
    const erEntities = erRes!.addedElements.filter(
      (e) => e.morphMeta?.role === "entity"
    );
    const erRelations = erRes!.addedElements.filter(
      (e) => e.morphMeta?.role === "relation"
    );
    expect(erEntities.length).toBeGreaterThanOrEqual(2);
    expect(erEntities.every((e) => Boolean(e.sublabel && /PK/i.test(e.sublabel)))).toBe(
      true
    );
    expect(erRelations.length).toBeGreaterThanOrEqual(1);
    expect(
      erRelations.every((r) => isCrowsFootEnd(r.startEnd) && isCrowsFootEnd(r.endEnd))
    ).toBe(true);
    const erValidation = validateLayoutElements(erRes!.addedElements, {
      externalElementIds: externalIds,
    });
    expect(erValidation.ok, erValidation.errors.join("; ")).toBe(true);

    // Anchored in place near original selection bounds center
    const origCenterX = originalBounds.x + originalBounds.width / 2;
    const origCenterY = originalBounds.y + originalBounds.height / 2;
    for (const res of [seqRes!, flowRes!, stateRes!, erRes!]) {
      const b = computeBounds(
        res.addedElements.filter((e) => isShapeElement(e))
      )!;
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      expect(Math.abs(cx - origCenterX)).toBeLessThan(180);
      expect(Math.abs(cy - origCenterY)).toBeLessThan(180);
    }
  });

  it("supports true reversible round-trip Sketch -> Sequence -> Flowchart -> State -> ER -> Sketch in place", () => {
    let board = makeSketchBoard();
    let selection = ["sk_api", "sk_check", "sk_db"];

    const originalApi = board.find((e) => e.id === "sk_api")!;
    const originalCheck = board.find((e) => e.id === "sk_check")!;
    const originalDb = board.find((e) => e.id === "sk_db")!;

    const sequence: MorphNotation[] = [
      "sequence",
      "flowchart",
      "state",
      "er",
      "sketch",
    ];
    let groupId: string | null = null;

    for (const target of sequence) {
      const morph = morphSelectionToNotation(selection, board, target);
      expect(morph, `morph to ${target}`).not.toBeNull();
      if (groupId === null) {
        groupId = morph!.groupId;
      } else {
        expect(morph!.groupId).toBe(groupId);
      }

      board = applyMorphToBoard(board, morph!);
      selection = morph!.nextSelectedIds;

      // External boundary nodes stay untouched and rewired
      expect(board.some((e) => e.id === "ext_client")).toBe(true);
      expect(board.some((e) => e.id === "ext_analytics")).toBe(true);
      expect(
        board.some((e) => e.kind === "arrow" && e.fromId === "ext_client")
      ).toBe(true);
      expect(
        board.some((e) => e.kind === "arrow" && e.toId === "ext_analytics")
      ).toBe(true);

      const detected = detectSelectionMorphState(selection, board);
      expect(detected.notation).toBe(target);
      expect(detected.groupId).toBe(groupId);
    }

    // Back in Sketch: exact original sketch shapes & geometry restored cleanly!
    const restoredApi = board.find((e) => e.id === "sk_api");
    const restoredCheck = board.find((e) => e.id === "sk_check");
    const restoredDb = board.find((e) => e.id === "sk_db");

    expect(restoredApi).toBeDefined();
    expect(restoredCheck).toBeDefined();
    expect(restoredDb).toBeDefined();
    expect(restoredApi!.x).toBe(originalApi.x);
    expect(restoredApi!.y).toBe(originalApi.y);
    expect(restoredApi!.label).toBe(originalApi.label);
    expect(restoredCheck!.kind).toBe("diamond");
    expect(restoredCheck!.x).toBe(originalCheck.x);
    expect(restoredCheck!.y).toBe(originalCheck.y);
    expect(restoredDb!.kind).toBe("database");
    expect(restoredDb!.x).toBe(originalDb.x);
    expect(restoredDb!.y).toBe(originalDb.y);
    // Internal arrows restored too
    expect(
      board.some(
        (e) => e.kind === "arrow" && e.fromId === "sk_api" && e.toId === "sk_check"
      )
    ).toBe(true);
  });

  it("propagates label edits made in a structured notation back to Sketch on round-trip", () => {
    let board = makeSketchBoard();
    const morphToSeq = morphSelectionToNotation(
      ["sk_api", "sk_check", "sk_db"],
      board,
      "sequence"
    )!;
    board = applyMorphToBoard(board, morphToSeq);

    // User renames the first actor in Sequence diagram from "Order API" -> "Checkout API"
    const apiActor = board.find(
      (e) => e.morphMeta?.role === "actor" && e.label === "Order API"
    )!;
    expect(apiActor).toBeDefined();
    board = board.map((e) =>
      e.id === apiActor.id ? { ...e, label: "Checkout API" } : e
    );

    // Morph back to Sketch by selecting only that single edited actor
    const morphBack = morphSelectionToNotation([apiActor.id], board, "sketch")!;
    expect(morphBack).not.toBeNull();
    board = applyMorphToBoard(board, morphBack);

    const restoredApi = board.find((e) => e.id === "sk_api")!;
    expect(restoredApi.label).toBe("Checkout API");
  });

  it("works cleanly even when only 1 single node is selected", () => {
    const board = makeSketchBoard();
    const single = morphSelectionToNotation(["sk_api"], board, "er");
    expect(single).not.toBeNull();
    expect(single!.addedElements.some((e) => e.morphMeta?.role === "entity")).toBe(
      true
    );

    const nextBoard = applyMorphToBoard(board, single!);
    const back = morphSelectionToNotation(
      single!.nextSelectedIds,
      nextBoard,
      "sketch"
    );
    expect(back).not.toBeNull();
    const restoredBoard = applyMorphToBoard(nextBoard, back!);
    expect(restoredBoard.find((e) => e.id === "sk_api")?.label).toBe("Order API");
  });

  it("preserves morphMeta cleanly through sync-validation, localStorage, and WebRTC P2P merge", () => {
    const board = makeSketchBoard();
    const morph = morphSelectionToNotation(
      ["sk_api", "sk_check", "sk_db"],
      board,
      "sequence"
    )!;
    const morphedBoard = applyMorphToBoard(board, morph);

    // Local change stamps revs & tombstones replaced sketch IDs
    const stamped = applyLocalElementsChange(
      board,
      morphedBoard,
      {},
      "peer_a",
      1_710_000_005_000
    );
    expect(stamped.tombstones["sk_api"]).toBeDefined();

    // Wire validation preserves morphMeta & groupRecord
    const wire = parseWireMessage({
      kind: "sync_state",
      peerId: "peer_a",
      boardTitle: "Orders",
      ts: 1_710_000_005_000,
      hasLocalEdits: true,
      elements: stamped.elements,
      tombstones: stamped.tombstones,
    });
    expect(wire).not.toBeNull();
    expect(wire?.kind).toBe("sync_state");
    if (wire && wire.kind === "sync_state") {
      const syncedActor = wire.elements.find(
        (e) => e.morphMeta?.groupRecord !== undefined
      );
      expect(syncedActor).toBeDefined();
      expect(syncedActor?.morphMeta?.groupId).toBe(morph.groupId);
      expect(syncedActor?.morphMeta?.groupRecord?.sketchSnapshot.length).toBeGreaterThanOrEqual(
        3
      );

      // Peer B merges and can independently morph back to Sketch!
      const merged = mergeRemoteBoardState(
        {
          elements: board,
          boardTitle: "Orders",
          tombstones: {},
          hasLocalEdits: false,
        },
        {
          elements: wire.elements,
          boardTitle: wire.boardTitle,
          tombstones: wire.tombstones,
          hasLocalEdits: true,
          senderPeerId: "peer_a",
          verifiedSenderPeerId: "peer_a",
        },
        "peer_b",
        { authoritativePeerId: "peer_a", now: 1_710_000_006_000 }
      );
      expect(merged.changed).toBe(true);
      const peerBMorphBack = morphSelectionToNotation(
        [syncedActor!.id],
        merged.state.elements,
        "sketch"
      );
      expect(peerBMorphBack).not.toBeNull();
    }

    // localStorage snapshot round-trip preserves morphMeta
    const stored = parseStoredBoardSnapshot(
      JSON.stringify({
        elements: stamped.elements,
        boardTitle: "Orders",
        tombstones: stamped.tombstones,
        hasLocalEdits: true,
      })
    );
    expect(stored).not.toBeNull();
    expect(
      stored!.elements.some((e) => e.morphMeta?.groupRecord !== undefined)
    ).toBe(true);

    // Rejects prototype-polluting morph specs
    const poisoned = JSON.parse(
      '{"__proto__":{"polluted":true},"summary":"Bad","actors":[],"messages":[],"steps":[],"states":[],"transitions":[],"entities":[],"relations":[]}'
    );
    expect(validateMorphSemanticSpec(poisoned).ok).toBe(false);
  });
});

const T0 = 1_710_000_000_000;

function shape(
  id: string,
  kind: JevElement["kind"],
  x: number,
  label: string,
  extra: Partial<JevElement> = {}
): JevElement {
  return {
    id,
    kind,
    x,
    y: 200,
    width: 150,
    height: 70,
    label,
    tone: "ink",
    seed: x + 1,
    createdAt: T0,
    updatedAt: T0,
    rev: 1,
    ...extra,
  };
}

function edge(
  id: string,
  fromId: string,
  toId: string,
  label: string,
  extra: Partial<JevElement> = {}
): JevElement {
  return {
    id,
    kind: "arrow",
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    label,
    tone: "ink",
    seed: 900 + id.length,
    fromId,
    toId,
    arrowStyle: "curved",
    createdAt: T0,
    updatedAt: T0,
    rev: 1,
    ...extra,
  };
}

/** Client → API → Postgres, the smallest real HLD. */
function makeHldBoard(): JevElement[] {
  return [
    shape("h_client", "actor", 0, "Client"),
    shape("h_api", "node", 260, "Orders API"),
    shape("h_pg", "database", 520, "Postgres"),
    edge("h_e1", "h_client", "h_api", "POST /orders"),
    edge("h_e2", "h_api", "h_pg", "INSERT order"),
  ];
}
const HLD_SEL = ["h_client", "h_api", "h_pg"];

function baseSpec(over: Partial<MorphSemanticSpec>): MorphSemanticSpec {
  return {
    summary: "Spec",
    actors: [],
    messages: [],
    steps: [],
    states: [],
    transitions: [],
    entities: [],
    relations: [],
    ...over,
  };
}

function morphWith(notation: MorphNotation, spec: MorphSemanticSpec) {
  const res = morphSelectionToNotation(HLD_SEL, makeHldBoard(), notation, {
    specOverride: spec,
  });
  expect(res, `morph to ${notation}`).not.toBeNull();
  return res!.addedElements;
}

const byRole = (els: JevElement[], role: string) =>
  els.filter((e) => e.morphMeta?.role === role);

describe("Notation Morph produces real notation (SD Sensei §4.1)", () => {
  describe("ER: entities with PK/FK rows and crow's-foot relations", () => {
    const erSpec = (cardinality: string, label?: string) =>
      baseSpec({
        entities: [
          { id: "u", name: "User", attributes: ["email text UK"] },
          { id: "o", name: "Order", attributes: ["total int"] },
        ],
        relations: [{ id: "r1", from: "u", to: "o", cardinality, ...(label ? { label } : {}) }],
      });

    it("draws entities as kind entity with an `id uuid PK` row", () => {
      const els = morphWith("er", erSpec("1:N", "places"));
      const entities = byRole(els, "entity");
      expect(entities).toHaveLength(2);
      for (const ent of entities) {
        expect(ent.kind).toBe("entity");
        expect(ent.morphMeta?.notation).toBe("er");
        const rows = parseEntityRows(ent.sublabel);
        expect(rows.filter((r) => r.keys.includes("PK"))).toEqual([
          { name: "id", type: "uuid", keys: ["PK"] },
        ]);
      }
    });

    it("1:N puts er_only_one at the one side, er_zero_many at the many side, FK on the many side, verb label only", () => {
      const els = morphWith("er", erSpec("1:N", "places"));
      const [rel] = byRole(els, "relation");
      const user = els.find((e) => e.label === "User")!;
      const order = els.find((e) => e.label === "Order")!;
      expect(rel.fromId).toBe(user.id);
      expect(rel.toId).toBe(order.id);
      expect(rel.startEnd).toBe("er_only_one");
      expect(rel.endEnd).toBe("er_zero_many");
      expect(rel.label).toBe("places");
      expect(parseEntityRows(order.sublabel)).toContainEqual({ name: "user_id", type: "uuid", keys: ["FK"] });
      expect(parseEntityRows(user.sublabel).some((r) => r.keys.includes("FK"))).toBe(false);
    });

    it("N:1 puts the FK on the from side", () => {
      const els = morphWith("er", erSpec("N:1"));
      const user = els.find((e) => e.label === "User")!;
      const [rel] = byRole(els, "relation");
      expect(rel.startEnd).toBe("er_zero_many");
      expect(rel.endEnd).toBe("er_only_one");
      expect(parseEntityRows(user.sublabel)).toContainEqual({ name: "order_id", type: "uuid", keys: ["FK"] });
    });

    it("1:1 marks the dependent side's FK as unique", () => {
      const els = morphWith("er", erSpec("1:1"));
      const order = els.find((e) => e.label === "Order")!;
      expect(parseEntityRows(order.sublabel)).toContainEqual({ name: "user_id", type: "uuid", keys: ["FK", "UK"] });
    });

    it("never writes cardinality as label text", () => {
      const board = makeSketchBoard();
      const res = morphSelectionToNotation(["sk_api", "sk_check", "sk_db"], board, "er")!;
      const rels = byRole(res.addedElements, "relation");
      expect(rels.length).toBeGreaterThan(0);
      for (const r of rels) {
        expect(r.label).not.toMatch(/\b(1|N|M)\s*:\s*(1|N|M)\b/);
        expect(isCrowsFootEnd(r.startEnd) && isCrowsFootEnd(r.endEnd)).toBe(true);
      }
    });

    it("unknown cardinality defaults to 1:N and says so on the relation", () => {
      const els = morphWith("er", erSpec("lots", "has"));
      const [rel] = byRole(els, "relation");
      expect(rel.startEnd).toBe("er_only_one");
      expect(rel.endEnd).toBe("er_zero_many");
      expect(rel.label).toBe("has (1:N assumed)");
    });

    it("does not duplicate an existing PK or FK row", () => {
      const spec = baseSpec({
        entities: [
          { id: "u", name: "User", attributes: ["user_uuid uuid PK"] },
          { id: "o", name: "Order", attributes: ["id uuid PK", "user_id uuid FK"] },
        ],
        relations: [{ id: "r1", from: "u", to: "o", cardinality: "1:N" }],
      });
      const els = morphWith("er", spec);
      const user = els.find((e) => e.label === "User")!;
      const order = els.find((e) => e.label === "Order")!;
      expect(parseEntityRows(user.sublabel).filter((r) => r.keys.includes("PK"))).toHaveLength(1);
      expect(parseEntityRows(order.sublabel).filter((r) => r.name === "user_id")).toHaveLength(1);
      expect(parseEntityRows(order.sublabel).filter((r) => r.keys.includes("PK"))).toHaveLength(1);
    });
  });

  describe("Sequence: activation bars, UML message ends, fragments", () => {
    const actors = [
      { id: "a", label: "Client" },
      { id: "b", label: "API" },
      { id: "c", label: "DB" },
    ];
    const nested = baseSpec({
      actors,
      messages: [
        { id: "m1", from: "a", to: "b", label: "get order", order: 1 },
        { id: "m2", from: "b", to: "c", label: "SELECT", order: 2 },
        { id: "m3", from: "c", to: "b", label: "rows", order: 3, isReturn: true },
        { id: "m4", from: "b", to: "a", label: "200 OK", order: 4, isReturn: true },
      ],
    });

    function lifelineX(els: JevElement[], actorId: string): number {
      const life = els.find((e) => e.morphMeta?.role === "lifeline" && e.morphMeta.semanticId === actorId)!;
      return life.fromPoint!.x;
    }
    function barsOf(els: JevElement[], actorId: string): JevElement[] {
      const x = lifelineX(els, actorId);
      return byRole(els, "activation").filter((b) => b.x <= x && b.x + b.width >= x);
    }
    const msg = (els: JevElement[], semId: string) =>
      els.find((e) => e.morphMeta?.role === "message" && e.morphMeta.semanticId === semId)!;

    it("puts an activation bar on each participant for its active span", () => {
      const els = morphWith("sequence", nested);
      const bars = byRole(els, "activation");
      expect(bars.length).toBe(3);
      for (const b of bars) {
        expect(b.kind).toBe("activation");
        expect(b.morphMeta?.notation).toBe("sequence");
      }
      const [aBar] = barsOf(els, "a");
      const [bBar] = barsOf(els, "b");
      const [cBar] = barsOf(els, "c");
      const y = (id: string) => msg(els, id).fromPoint!.y;
      expect(bBar.y).toBeLessThanOrEqual(y("m1"));
      expect(bBar.y + bBar.height).toBeGreaterThanOrEqual(y("m4"));
      expect(cBar.y).toBeLessThanOrEqual(y("m2"));
      expect(cBar.y + cBar.height).toBeGreaterThanOrEqual(y("m3"));
      expect(cBar.y).toBeGreaterThan(y("m1"));
      expect(cBar.y + cBar.height).toBeLessThan(y("m4"));
      expect(aBar.y).toBeLessThanOrEqual(y("m1"));
      expect(aBar.y + aBar.height).toBeGreaterThanOrEqual(y("m4"));
    });

    it("starts and ends messages at activation bar edges", () => {
      const els = morphWith("sequence", nested);
      const [aBar] = barsOf(els, "a");
      const [bBar] = barsOf(els, "b");
      const [cBar] = barsOf(els, "c");
      const m1 = msg(els, "m1");
      expect(m1.fromPoint!.x).toBe(aBar.x + aBar.width);
      expect(m1.toPoint!.x).toBe(bBar.x);
      const m3 = msg(els, "m3");
      expect(m3.fromPoint!.x).toBe(cBar.x);
      expect(m3.toPoint!.x).toBe(bBar.x + bBar.width);
    });

    it("uses UML ends: sync = solid filled head, async = solid open head, return = dashed open head", () => {
      const spec = baseSpec({
        actors,
        messages: [
          { id: "m1", from: "a", to: "b", label: "place", order: 1 },
          { id: "m2", from: "b", to: "c", label: "emit", order: 2, async: true },
          { id: "m3", from: "b", to: "a", label: "202", order: 3, isReturn: true },
        ],
      });
      const els = morphWith("sequence", spec);
      const sync = msg(els, "m1");
      const asyncMsg = msg(els, "m2");
      const ret = msg(els, "m3");
      expect([sync.endEnd, Boolean(sync.dashed), sync.startEnd]).toEqual(["arrow", false, "none"]);
      expect([asyncMsg.endEnd, Boolean(asyncMsg.dashed)]).toEqual(["open", false]);
      expect([ret.endEnd, Boolean(ret.dashed)]).toEqual(["open", true]);
    });

    it("takes returns only from arrows drawn back to an open caller, never synthesizes them", () => {
      const flowOf = (board: JevElement[]) =>
        [...extractMorphSemanticSpec(HLD_SEL, board)!.messages]
          .sort((x, y) => x.order - y.order)
          .map((m) => `${m.from}>${m.to}${m.isReturn ? "(r)" : ""}`);
      const [c, api, pg] = ["sem_0", "sem_1", "sem_2"];
      expect(flowOf(makeHldBoard())).toEqual([`${c}>${api}`, `${api}>${pg}`]);
      const withReturns = [
        ...makeHldBoard(),
        edge("h_r1", "h_pg", "h_api", "order_id"),
        edge("h_r2", "h_api", "h_client", "201"),
      ];
      expect(flowOf(withReturns)).toEqual([`${c}>${api}`, `${api}>${pg}`, `${pg}>${api}(r)`, `${api}>${c}(r)`]);
      const spec = extractMorphSemanticSpec(HLD_SEL, makeHldBoard())!;
      expect(spec.actors.find((a) => a.id === c)?.kind).toBe("actor");
      expect(spec.actors.find((a) => a.id === pg)?.kind).toBe("database");
    });

    it("draws a spec alt fragment over its rows with evenly split operands", () => {
      const spec = baseSpec({
        actors,
        messages: [
          { id: "m1", from: "a", to: "b", label: "get", order: 1 },
          { id: "m2", from: "b", to: "a", label: "cached", order: 2, isReturn: true },
          { id: "m3", from: "b", to: "c", label: "SELECT", order: 3 },
          { id: "m4", from: "c", to: "b", label: "rows", order: 4, isReturn: true },
          { id: "m5", from: "b", to: "a", label: "200", order: 5, isReturn: true },
        ],
        fragments: [
          { id: "f1", operator: "alt", guard: "cache hit", fromOrder: 2, toOrder: 5, elseFromOrder: 3, elseGuard: "miss" },
        ],
      });
      const els = morphWith("sequence", spec);
      const frags = byRole(els, "fragment");
      expect(frags).toHaveLength(1);
      const f = frags[0];
      expect(f.kind).toBe("fragment");
      expect(f.morphMeta?.notation).toBe("sequence");
      expect(f.label).toBe("alt");
      expect(f.sublabel).toBe("[cache hit]\n[miss]");
      const y = (id: string) => msg(els, id).fromPoint!.y;
      expect(f.y).toBeLessThan(y("m2"));
      expect(f.y + f.height).toBeGreaterThan(y("m5"));
      expect(f.y).toBeGreaterThan(y("m1"));
      const divider = f.y + f.height / 2;
      expect(divider).toBeGreaterThan(y("m2"));
      expect(divider).toBeLessThan(y("m3"));
      expect(f.x).toBeLessThan(lifelineX(els, "a"));
      expect(f.x + f.width).toBeGreaterThan(lifelineX(els, "c"));
    });

    it("infers loop / alt / opt fragments from message labels", () => {
      const spec = baseSpec({
        actors,
        messages: [
          { id: "m1", from: "a", to: "b", label: "pay", order: 1 },
          { id: "m2", from: "b", to: "c", label: "retry charge", order: 2 },
          { id: "m3", from: "b", to: "c", label: "if cache hit", order: 3 },
          { id: "m4", from: "b", to: "c", label: "on miss", order: 4 },
          { id: "m5", from: "b", to: "a", label: "optional: receipt", order: 5, async: true },
        ],
      });
      const els = morphWith("sequence", spec);
      const frags = byRole(els, "fragment").map((f) => `${f.label}|${f.sublabel}`);
      expect(frags).toEqual(["loop|[retry]", "alt|[cache hit]\n[miss]", "opt|[optional]"]);
    });

    it("is conservative: ordinary labels infer no fragments, and spec.fragments = [] disables inference", () => {
      expect(byRole(morphWith("sequence", nested), "fragment")).toHaveLength(0);
      const res = morphSelectionToNotation(["sk_api", "sk_check", "sk_db"], makeSketchBoard(), "sequence")!;
      expect(byRole(res.addedElements, "fragment")).toHaveLength(0);
      const explicitNone = baseSpec({
        actors,
        fragments: [],
        messages: [{ id: "m1", from: "a", to: "b", label: "retry charge", order: 1 }],
      });
      expect(byRole(morphWith("sequence", explicitNone), "fragment")).toHaveLength(0);
    });

    it("an 'else' without a preceding condition infers nothing", () => {
      const spec = baseSpec({
        actors,
        messages: [
          { id: "m1", from: "a", to: "b", label: "get", order: 1 },
          { id: "m2", from: "b", to: "c", label: "else", order: 2 },
          { id: "m3", from: "b", to: "c", label: "hit count", order: 3 },
        ],
      });
      expect(byRole(morphWith("sequence", spec), "fragment")).toHaveLength(0);
    });
  });

  describe("State: pseudo-states and `event [guard] / action` labels", () => {
    const stateSpec = baseSpec({
      states: [
        { id: "s1", label: "Pending", initial: true },
        { id: "s2", label: "Paid", terminal: true },
        { id: "s3", label: "Cancelled", terminal: true },
      ],
      transitions: [
        { id: "t1", from: "s1", to: "s2", event: "pay", guard: "card ok", action: "charge" },
        { id: "t2", from: "s1", to: "s3", event: "timeout" },
      ],
    });

    it("adds an initial pseudo-state with an arrow into the initial state", () => {
      const els = morphWith("state", stateSpec);
      const initial = els.filter((e) => e.kind === "initial");
      expect(initial).toHaveLength(1);
      expect(initial[0].morphMeta?.role).toBe("pseudo_state");
      expect(initial[0].label).toBe("");
      const pending = els.find((e) => e.morphMeta?.semanticId === "s1" && e.kind !== "arrow")!;
      const into = els.filter((e) => e.kind === "arrow" && e.fromId === initial[0].id);
      expect(into.map((a) => a.toId)).toEqual([pending.id]);
    });

    it("adds one final pseudo-state with arrows from every terminal state", () => {
      const els = morphWith("state", stateSpec);
      const finals = els.filter((e) => e.kind === "final");
      expect(finals).toHaveLength(1);
      expect(finals[0].morphMeta?.role).toBe("pseudo_state");
      const terminalIds = ["s2", "s3"].map(
        (s) => els.find((e) => e.morphMeta?.semanticId === s && e.kind !== "arrow")!.id
      );
      const into = els.filter((e) => e.kind === "arrow" && e.toId === finals[0].id).map((a) => a.fromId);
      expect(into.sort()).toEqual(terminalIds.sort());
    });

    it("labels transitions `event [guard] / action`", () => {
      const els = morphWith("state", stateSpec);
      const t1 = els.find((e) => e.morphMeta?.semanticId === "t1")!;
      const t2 = els.find((e) => e.morphMeta?.semanticId === "t2")!;
      expect(t1.label).toBe(formatTransitionLabel("pay", "card ok", "charge"));
      expect(t1.label).toBe("pay [card ok] / charge");
      expect(t2.label).toBe("timeout");
    });

    it("parses guard and action out of sketch arrow labels", () => {
      const board = makeHldBoard().map((e) =>
        e.id === "h_e2" ? { ...e, label: "save [valid] / emit created" } : e
      );
      const spec = extractMorphSemanticSpec(HLD_SEL, board)!;
      const tr = spec.transitions.find((t) => t.from === "sem_1" && t.to === "sem_2")!;
      expect(tr).toMatchObject({ event: "save", guard: "valid", action: "emit created" });
    });

    it("round-trips guard/action edits made on a transition label", () => {
      let board = makeHldBoard();
      const toState = morphSelectionToNotation(HLD_SEL, board, "state")!;
      board = applyMorphToBoard(board, toState);
      const tr = board.find((e) => e.morphMeta?.role === "transition" && e.morphMeta.semanticId)!;
      board = board.map((e) => (e.id === tr.id ? { ...e, label: "submit [stock ok] / reserve" } : e));
      const toSketch = morphSelectionToNotation(toState.nextSelectedIds, board, "sketch")!;
      board = applyMorphToBoard(board, toSketch);
      const back = morphSelectionToNotation(toSketch.nextSelectedIds, board, "state")!;
      const spec = back.spec.transitions.find((t) => t.id === tr.morphMeta!.semanticId)!;
      expect(spec).toMatchObject({ event: "submit", guard: "stock ok", action: "reserve" });
      const relabelled = back.addedElements.find((e) => e.morphMeta?.semanticId === tr.morphMeta!.semanticId)!;
      expect(relabelled.label).toBe("submit [stock ok] / reserve");
    });
  });

  describe("Column gaps leave room for labels and end markers", () => {
    const LABEL_CHAR_W = 7;
    const gapsBetween = (shapes: JevElement[]) => {
      const row = [...shapes].sort((a, b) => a.x - b.x);
      return row.slice(1).map((s, i) => s.x - (row[i].x + row[i].width));
    };

    it("ER: the gap between related entities fits the verb plus both crow's feet", () => {
      const res = morphSelectionToNotation(HLD_SEL, makeHldBoard(), "er")!;
      const entities = byRole(res.addedElements, "entity");
      const longest = Math.max(...byRole(res.addedElements, "relation").map((r) => r.label.length));
      for (const gap of gapsBetween(entities)) {
        expect(gap).toBeGreaterThanOrEqual(longest * LABEL_CHAR_W + 48);
      }
    });

    it("State: the gap between states fits the transition label", () => {
      const res = morphSelectionToNotation(HLD_SEL, makeHldBoard(), "state")!;
      const states = byRole(res.addedElements, "state");
      const longest = Math.max(
        ...byRole(res.addedElements, "transition").map((t) => t.label.length)
      );
      for (const gap of gapsBetween(states)) {
        expect(gap).toBeGreaterThanOrEqual(longest * LABEL_CHAR_W + 32);
      }
    });
  });

  describe("Reversibility and clean rendering for the new kinds and ends", () => {
    function makeRichSketch(): JevElement[] {
      return [
        shape("r_q", "queue", 0, "Kafka"),
        shape("r_e", "entity", 260, "Order", { sublabel: "id uuid PK\nuser_id uuid FK" }),
        shape("r_c", "cache", 520, "Redis"),
        edge("r_a1", "r_q", "r_e", "", { startEnd: "er_only_one", endEnd: "er_zero_many", arrowStyle: "straight" }),
        edge("r_a2", "r_e", "r_c", "warm", { startEnd: "none", endEnd: "open", dashed: true }),
      ];
    }
    const RICH_SEL = ["r_q", "r_e", "r_c"];
    const KEYS = [
      "id", "kind", "x", "y", "width", "height", "label", "sublabel", "tone", "seed",
      "fromId", "toId", "arrowStyle", "dashed", "startEnd", "endEnd",
    ] as const;
    const pick = (e: JevElement) => Object.fromEntries(KEYS.map((k) => [k, e[k]]));

    for (const notation of ["sequence", "state", "er"] as const) {
      it(`Sketch -> ${notation} -> Sketch restores new kinds and arrow ends exactly`, () => {
        const original = makeRichSketch();
        let board = original;
        const there = morphSelectionToNotation(RICH_SEL, board, notation)!;
        board = applyMorphToBoard(board, there);
        const back = morphSelectionToNotation(there.nextSelectedIds, board, "sketch")!;
        board = applyMorphToBoard(board, back);
        for (const el of original) {
          const restored = board.find((e) => e.id === el.id);
          expect(restored, el.id).toBeDefined();
          expect(pick(restored!)).toEqual(pick(el));
        }
      });

      it(`every ${notation} element carries morphMeta.notation and renders clean on a sketch board`, () => {
        const res = morphSelectionToNotation(RICH_SEL, makeRichSketch(), notation)!;
        const own = res.addedElements.filter((e) => e.morphMeta?.groupId === res.groupId);
        expect(own.length).toBeGreaterThan(0);
        for (const el of own) {
          expect(el.morphMeta?.notation).toBe(notation);
          expect(resolveRenderStyle(el, "sketch")).toBe("clean");
        }
      });
    }

    it("keeps the group record on a participant/state/entity, never on a fragment or activation", () => {
      const spec = baseSpec({
        actors: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
        messages: [{ id: "m1", from: "a", to: "b", label: "retry", order: 1 }],
      });
      const els = morphWith("sequence", spec);
      const holder = els.find((e) => e.morphMeta?.groupRecord)!;
      expect(holder.morphMeta?.role).toBe("actor");
    });

    it("morph specs with guards, fragments and HLD actor kinds survive localStorage", () => {
      const spec = baseSpec({
        actors: [{ id: "a", label: "User", kind: "actor" }, { id: "b", label: "Kafka", kind: "queue" }],
        messages: [{ id: "m1", from: "a", to: "b", label: "send", order: 1 }],
        states: [{ id: "s1", label: "New", initial: true }, { id: "s2", label: "Done", terminal: true }],
        transitions: [{ id: "t1", from: "s1", to: "s2", event: "go", guard: "ok", action: "log" }],
        fragments: [{ id: "f1", operator: "opt", guard: "enabled", fromOrder: 1, toOrder: 1 }],
      });
      expect(validateMorphSemanticSpec(spec)).toEqual({ ok: true, spec });
      const els = morphWith("sequence", spec);
      const stored = parseStoredBoardSnapshot(JSON.stringify({ elements: els, boardTitle: "t" }));
      expect(stored).not.toBeNull();
      const record = stored!.elements.find((e) => e.morphMeta?.groupRecord)!.morphMeta!.groupRecord!;
      expect(record.spec.fragments).toEqual(spec.fragments);
      expect(record.spec.transitions[0]).toMatchObject({ guard: "ok", action: "log" });
      expect(record.spec.actors.map((a) => a.kind)).toEqual(["actor", "queue"]);
      const roles = new Set(stored!.elements.map((e) => e.morphMeta?.role));
      expect(roles.has("activation")).toBe(true);
      expect(roles.has("fragment")).toBe(true);
    });

    it("rejects malformed fragments and container actor kinds", () => {
      const ok = baseSpec({
        actors: [{ id: "a", label: "A" }],
        messages: [{ id: "m1", from: "a", to: "a", label: "x", order: 1 }],
      });
      const bad = (over: Partial<MorphSemanticSpec>) => validateMorphSemanticSpec({ ...ok, ...over }).ok;
      expect(bad({ fragments: [{ id: "f", operator: "loop", guard: "", fromOrder: 3, toOrder: 1 }] })).toBe(false);
      expect(
        bad({ fragments: [{ id: "f", operator: "alt", guard: "a", fromOrder: 1, toOrder: 3, elseFromOrder: 5 }] })
      ).toBe(false);
      expect(
        bad({ fragments: [{ id: "f", operator: "opt", guard: "a", fromOrder: 1, toOrder: 3, elseFromOrder: 2 }] })
      ).toBe(false);
      expect(bad({ actors: [{ id: "a", label: "A", kind: "zone" }] })).toBe(false);
      expect(bad({ actors: [{ id: "a", label: "A", kind: "fragment" }] })).toBe(false);
    });
  });
});

describe("Morph to sequence morphs only the selected flow (SD Sensei URL-shortener boards, 21 Nov)", () => {
  const hld = urlShortenerHld as JevElement[];
  const createFlow = urlShortenerCreateFlow as JevElement[];
  const idOf = (els: JevElement[], label: string) => els.find((e) => e.label === label && e.kind !== "arrow")!.id;
  const WRITE_PATH = ["Client", "Edge: CDN + LB", "API service", "ID generator", "URL DB"].map((l) => idOf(hld, l));

  function internalArrows(els: JevElement[], selected: string[]) {
    const sel = new Set(selected);
    return els.filter((e) => e.kind === "arrow" && sel.has(e.fromId!) && sel.has(e.toId!));
  }

  /** Every message must be one of the user's arrows: same endpoints and label, each arrow used once. */
  function expectEveryMessageHasASourceArrow(spec: MorphSemanticSpec, els: JevElement[], selected: string[]) {
    const labelOf = new Map(spec.actors.map((a) => [a.id, a.label]));
    const byId = new Map(els.map((e) => [e.id, e]));
    const unused = internalArrows(els, selected).map(
      (a) => `${byId.get(a.fromId!)!.label} > ${byId.get(a.toId!)!.label} : ${a.label}`
    );
    for (const m of spec.messages) {
      const key = `${labelOf.get(m.from)} > ${labelOf.get(m.to)} : ${m.label}`;
      const idx = unused.indexOf(key);
      expect(idx, `message "${key}" has no source arrow in the selection`).toBeGreaterThanOrEqual(0);
      unused.splice(idx, 1);
    }
    expect(unused, "arrows in the selection missing from the sequence").toEqual([]);
  }

  it("turns only arrows with both ends selected into messages", () => {
    const res = morphSelectionToNotation(WRITE_PATH, hld, "sequence")!;
    expect(res).not.toBeNull();
    expectEveryMessageHasASourceArrow(res.spec, hld, WRITE_PATH);
    expect(byRole(res.addedElements, "message")).toHaveLength(4);
  });

  it("never moves an arrow whose far end is unselected onto another lifeline (R1/R4 landed on URL DB)", () => {
    const res = morphSelectionToNotation(WRITE_PATH, hld, "sequence")!;
    const added = new Map(res.addedElements.map((e) => [e.id, e]));
    const selected = new Set(WRITE_PATH);
    const boundary = hld.filter(
      (e) => e.kind === "arrow" && selected.has(e.fromId!) !== selected.has(e.toId!)
    );
    expect(boundary.map((a) => a.label).sort()).toEqual([
      "R1 get code · R3 set on miss",
      "R4 click event (async)",
    ]);
    const kept = res.addedElements.filter(
      (e) => e.kind === "arrow" && !e.morphMeta && (e.fromId || e.toId)
    );
    expect(kept).toHaveLength(boundary.length);
    for (const orig of boundary) {
      const copy = kept.find((k) => k.label === orig.label && k.toId === orig.toId)!;
      expect(copy, `boundary arrow "${orig.label}" keeps its unselected end`).toBeDefined();
      const participant = added.get(copy.fromId!)!;
      expect(participant.morphMeta?.role).toBe("actor");
      expect(participant.label, `"${orig.label}" stays on its own participant`).toBe("API service");
    }
    expect(res.replacedIds).not.toContain(idOf(hld, "Redis cache"));
    expect(res.replacedIds).not.toContain(idOf(hld, "Click queue"));
  });

  it("puts boundary arrows back on their own sketch shape on the way back to Sketch", () => {
    let board = hld;
    const toSeq = morphSelectionToNotation(WRITE_PATH, board, "sequence")!;
    board = applyMorphToBoard(board, toSeq);
    const back = morphSelectionToNotation(toSeq.nextSelectedIds, board, "sketch")!;
    board = applyMorphToBoard(board, back);
    const api = idOf(hld, "API service");
    for (const [label, to] of [
      ["R1 get code · R3 set on miss", idOf(hld, "Redis cache")],
      ["R4 click event (async)", idOf(hld, "Click queue")],
    ]) {
      const arrows = board.filter((e) => e.kind === "arrow" && e.label === label);
      expect(arrows).toHaveLength(1);
      expect([arrows[0].fromId, arrows[0].toId]).toEqual([api, to]);
    }
  });

  it("holds only the user's arrows: no invented final 'ack / result' or synthesized returns", () => {
    const all = createFlow.filter((e) => e.kind !== "arrow").map((e) => e.id);
    const res = morphSelectionToNotation(all, createFlow, "sequence")!;
    expectEveryMessageHasASourceArrow(res.spec, createFlow, all);
    const ordered = [...res.spec.messages].sort((a, b) => a.order - b.order);
    expect(ordered.map((m) => `${m.label}${m.isReturn ? " (r)" : ""}`)).toEqual([
      "POST /urls {long_url}",
      "forward + rate-limit",
      "next id",
      "id 4821 → base62 aZ3k9 (r)",
      "INSERT code (unique)",
      "ok (r)",
      "SET code, TTL 24h",
      "201 {short_url} (r)",
    ]);
    expect(byRole(res.addedElements, "message")).toHaveLength(8);
  });

  it("adds no return the user did not draw on an HLD sub-flow", () => {
    const res = morphSelectionToNotation(WRITE_PATH, hld, "sequence")!;
    expect(res.spec.messages.some((m) => m.isReturn)).toBe(false);
  });

  it("invents no participant or message for a single selected shape", () => {
    const res = morphSelectionToNotation([idOf(hld, "URL DB")], hld, "sequence")!;
    expect(res.spec.actors.map((a) => a.label)).toEqual(["URL DB"]);
    expect(res.spec.messages).toEqual([]);
    expect(byRole(res.addedElements, "message")).toEqual([]);
  });

  describe("AI refinement is held to the selection's arrows", () => {
    const heuristic = extractMorphSemanticSpec(WRITE_PATH, hld)!;
    const actorFor = (label: string) => heuristic.actors.find((a) => a.label === label)!.id;
    const [client, edgeLb, api, idGen, urlDb] = [
      "Client",
      "Edge: CDN + LB",
      "API service",
      "ID generator",
      "URL DB",
    ].map(actorFor);

    it("drops messages and participants that are not arrows in the selection, keeps the rest in order", () => {
      const llm: MorphSemanticSpec = {
        ...heuristic,
        actors: [...heuristic.actors, { id: "redis", label: "Redis cache", kind: "cache" }],
        messages: [
          { id: "m1", from: client, to: edgeLb, label: "HTTPS", order: 1 },
          { id: "m2", from: edgeLb, to: api, label: "POST /urls", order: 2 },
          { id: "m3", from: api, to: idGen, label: "next id", order: 3 },
          { id: "m4", from: idGen, to: api, label: "id", order: 4, isReturn: true },
          { id: "m5", from: api, to: urlDb, label: "INSERT", order: 5 },
          { id: "m6", from: api, to: "redis", label: "get code", order: 6 },
          { id: "m7", from: urlDb, to: client, label: "ack / result", order: 7, isReturn: true },
        ],
        fragments: [
          { id: "f1", operator: "opt", guard: "cache hit", fromOrder: 6, toOrder: 6 },
          { id: "f2", operator: "loop", guard: "retry on clash", fromOrder: 3, toOrder: 5 },
        ],
      };
      const constrained = constrainMorphSpecToSelection(llm, heuristic);
      expect(constrained.messages.map((m) => [m.label, m.order])).toEqual([
        ["HTTPS", 1],
        ["POST /urls", 2],
        ["next id", 3],
        ["INSERT", 4],
      ]);
      expect(constrained.actors.map((a) => a.label)).not.toContain("Redis cache");
      expect(constrained.fragments).toEqual([
        { id: "f2", operator: "loop", guard: "retry on clash", fromOrder: 3, toOrder: 4 },
      ]);
    });

    it("checks a server-side selection built from the board graph the same way", () => {
      const graph = serializeBoardToGraph(hld, { selectedIds: WRITE_PATH });
      const fromGraph = selectionSpecFromGraph(graph);
      expect(fromGraph.messages).toHaveLength(4);
      const invented = {
        ...heuristic,
        actors: graph.nodes.filter((n) => WRITE_PATH.includes(n.id)).map((n) => ({ id: n.id, label: n.label })),
        messages: [
          { id: "m1", from: idOf(hld, "API service"), to: idOf(hld, "URL DB"), label: "INSERT", order: 1 },
          { id: "m2", from: idOf(hld, "URL DB"), to: idOf(hld, "Client"), label: "ack / result", order: 2, isReturn: true },
        ],
      };
      expect(constrainMorphSpecToSelection(invented, fromGraph).messages.map((m) => m.label)).toEqual(["INSERT"]);
    });

    it("keeps a return the user drew", () => {
      const flowIds = createFlow.filter((e) => e.kind !== "arrow").map((e) => e.id);
      const flowSpec = extractMorphSemanticSpec(flowIds, createFlow)!;
      const constrained = constrainMorphSpecToSelection(flowSpec, flowSpec);
      expect(constrained.messages).toEqual(flowSpec.messages);
    });
  });
});

describe("validateMorphSemanticSpec: arrays per target notation", () => {
  const sequenceOnly = {
    summary: "Pay",
    actors: [
      { id: "a", label: "API" },
      { id: "b", label: "DB", kind: "database" },
    ],
    messages: [{ id: "m1", from: "a", to: "b", label: "insert", order: 1 }],
  };

  it("defaults the arrays of the other notations to empty", () => {
    const v = validateMorphSemanticSpec(sequenceOnly, "sequence");
    expect(v.ok && [v.spec.steps, v.spec.states, v.spec.transitions, v.spec.entities, v.spec.relations]).toEqual([[], [], [], [], []]);
  });

  it("requires the arrays the target notation draws from", () => {
    expect(validateMorphSemanticSpec(sequenceOnly, "state")).toEqual({ ok: false, error: 'A state morph needs a "states" array' });
    const { messages: _m, ...noMessages } = sequenceOnly;
    expect(validateMorphSemanticSpec(noMessages, "sequence")).toEqual({ ok: false, error: 'A sequence morph needs a "messages" array' });
  });

  it("cuts an over-long summary instead of rejecting the spec", () => {
    const v = validateMorphSemanticSpec({ ...sequenceOnly, summary: "x".repeat(200) }, "sequence");
    expect(v.ok && v.spec.summary).toBe("x".repeat(160));
  });
});
