import { z } from "zod";
import {
  ARROW_ENDS,
  ELEMENT_KINDS,
  type BoardSnapshot,
  type JevElement,
  type ShapeKind,
  type TombstoneMap,
} from "./types";

export const MAX_BOARD_ELEMENTS = 500;
export const MAX_LABEL_LENGTH = 500;
export const MAX_SUBLABEL_LENGTH = 500;
export const MAX_MARKDOWN_LENGTH = 20_000;
export const MAX_BOARD_TITLE_LENGTH = 120;
export const MAX_FREEDRAW_POINTS = 2000;
export const MAX_MORPH_SNAPSHOT_ELEMENTS = 48;
export const MAX_MORPH_SNAPSHOT_POINTS = 256;
export const MAX_TOMBSTONES = 500;
export const MAX_WIRE_MESSAGE_BYTES = 512 * 1024;
export const MAX_STORAGE_BYTES = 1024 * 1024;
export const MAX_RECOVERY_SNAPSHOTS = 8;

const COORD_LIMIT = 100_000;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{3,8}$/;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isSafeKey(value: string): boolean {
  return !FORBIDDEN_KEYS.has(value);
}

const safeIdSchema = z
  .string()
  .min(1)
  .max(128)
  .refine(isSafeKey, "Unsafe identifier");

const finiteCoordSchema = z
  .number()
  .finite()
  .min(-COORD_LIMIT)
  .max(COORD_LIMIT);

const pointSchema = z.object({
  x: finiteCoordSchema,
  y: finiteCoordSchema,
});

const elementKindSchema = z.enum(ELEMENT_KINDS);

const colorToneSchema = z.enum([
  "ink",
  "terracotta",
  "cobalt",
  "teal",
  "ochre",
  "plum",
  "slate",
]);

const morphNotationSyncSchema = z.enum([
  "sketch",
  "sequence",
  "flowchart",
  "state",
  "er",
]);

const morphRoleSyncSchema = z.enum([
  "actor",
  "lifeline",
  "message",
  "step",
  "decision",
  "state",
  "transition",
  "entity",
  "relation",
  "activation",
  "fragment",
  "pseudo_state",
  "sketch_item",
]);

/**
 * Shape kinds a morph participant may take: services, stores and people. Containers
 * (frame, zone, fragment) and LLD-only parts (entity, activation, pseudo-states) are not participants.
 */
export const MORPH_ACTOR_KINDS = [
  "node",
  "diamond",
  "database",
  "ellipse",
  "text",
  "queue",
  "cache",
  "lb",
  "blob",
  "external",
  "actor",
  "class",
] as const satisfies readonly ShapeKind[];

export const MORPH_FRAGMENT_OPERATORS = ["alt", "loop", "opt"] as const;

interface FragmentRange {
  operator: (typeof MORPH_FRAGMENT_OPERATORS)[number];
  fromOrder: number;
  toOrder: number;
  elseFromOrder?: number;
}

/** A fragment covers fromOrder..toOrder; only `alt` has an else operand, strictly inside that range. */
export function isValidFragmentRange(f: FragmentRange): boolean {
  if (f.fromOrder > f.toOrder) return false;
  if (f.elseFromOrder === undefined) return true;
  return f.operator === "alt" && f.elseFromOrder > f.fromOrder && f.elseFromOrder <= f.toOrder;
}

export const MORPH_FRAGMENT_RANGE_ERROR =
  "Fragment range must satisfy fromOrder <= toOrder; only alt may set elseFromOrder, inside (fromOrder, toOrder]";

const morphSemanticSpecSyncSchema = z.object({
  summary: z.string().max(160),
  actors: z
    .array(
      z.object({
        id: safeIdSchema,
        label: z.string().max(160),
        kind: z.enum(MORPH_ACTOR_KINDS).optional(),
        tone: colorToneSchema.optional(),
      })
    )
    .max(32),
  messages: z
    .array(
      z.object({
        id: safeIdSchema,
        from: safeIdSchema,
        to: safeIdSchema,
        label: z.string().max(140),
        order: z.number().int().min(0).max(200),
        async: z.boolean().optional(),
        isReturn: z.boolean().optional(),
      })
    )
    .max(48),
  steps: z
    .array(
      z.object({
        id: safeIdSchema,
        label: z.string().max(160),
        kind: z.enum(["start", "process", "decision", "end"]),
        tone: colorToneSchema.optional(),
        branches: z
          .array(
            z.object({
              to: safeIdSchema,
              label: z.string().max(80).optional(),
              fallback: z.boolean().optional(),
            })
          )
          .max(8)
          .optional(),
      })
    )
    .max(40),
  states: z
    .array(
      z.object({
        id: safeIdSchema,
        label: z.string().max(140),
        initial: z.boolean().optional(),
        terminal: z.boolean().optional(),
        tone: colorToneSchema.optional(),
      })
    )
    .max(32),
  transitions: z
    .array(
      z.object({
        id: safeIdSchema,
        from: safeIdSchema,
        to: safeIdSchema,
        event: z.string().max(100),
        guard: z.string().max(100).optional(),
        action: z.string().max(100).optional(),
        fallback: z.boolean().optional(),
      })
    )
    .max(48),
  entities: z
    .array(
      z.object({
        id: safeIdSchema,
        name: z.string().max(120),
        attributes: z.array(z.string().max(120)).max(16),
        tone: colorToneSchema.optional(),
      })
    )
    .max(24),
  relations: z
    .array(
      z.object({
        id: safeIdSchema,
        from: safeIdSchema,
        to: safeIdSchema,
        cardinality: z.string().max(24),
        label: z.string().max(80).optional(),
      })
    )
    .max(48),
  fragments: z
    .array(
      z
        .object({
          id: safeIdSchema,
          operator: z.enum(MORPH_FRAGMENT_OPERATORS),
          guard: z.string().max(100),
          fromOrder: z.number().int().min(0).max(200),
          toOrder: z.number().int().min(0).max(200),
          elseFromOrder: z.number().int().min(0).max(200).optional(),
          elseGuard: z.string().max(100).optional(),
        })
        .refine(isValidFragmentRange, MORPH_FRAGMENT_RANGE_ERROR)
    )
    .max(16)
    .optional(),
});

const sketchSnapshotElementSyncSchema = z
  .object({
    id: safeIdSchema,
    kind: elementKindSchema,
    x: finiteCoordSchema,
    y: finiteCoordSchema,
    width: finiteCoordSchema,
    height: finiteCoordSchema,
    label: z.string().max(MAX_LABEL_LENGTH),
    sublabel: z.string().max(MAX_SUBLABEL_LENGTH).optional(),
    tone: colorToneSchema,
    seed: z.number().finite(),
    fromId: safeIdSchema.optional(),
    toId: safeIdSchema.optional(),
    fromPoint: pointSchema.optional(),
    toPoint: pointSchema.optional(),
    arrowStyle: z.enum(["curved", "straight"]).optional(),
    dashed: z.boolean().optional(),
    bidirectional: z.boolean().optional(),
    startEnd: z.enum(ARROW_ENDS).optional(),
    endEnd: z.enum(ARROW_ENDS).optional(),
    points: z.array(pointSchema).max(MAX_MORPH_SNAPSHOT_POINTS).optional(),
    semanticId: safeIdSchema.optional(),
  })
  .refine(
    (el) => el.kind === "arrow" || (el.width >= 0 && el.height >= 0),
    "Snapshot non-arrow elements must have non-negative dimensions"
  );

const morphGroupRecordSyncSchema = z.object({
  groupId: safeIdSchema,
  anchorBounds: z.object({
    x: finiteCoordSchema,
    y: finiteCoordSchema,
    width: finiteCoordSchema.refine((v) => v >= 0, "Width must be non-negative"),
    height: finiteCoordSchema.refine((v) => v >= 0, "Height must be non-negative"),
  }),
  entrySketchId: safeIdSchema.optional(),
  exitSketchId: safeIdSchema.optional(),
  spec: morphSemanticSpecSyncSchema,
  sketchSnapshot: z
    .array(sketchSnapshotElementSyncSchema)
    .min(1)
    .max(MAX_MORPH_SNAPSHOT_ELEMENTS),
});

export const elementMorphMetaSchema = z.object({
  groupId: safeIdSchema,
  notation: morphNotationSyncSchema,
  semanticId: safeIdSchema.optional(),
  role: morphRoleSyncSchema.optional(),
  groupRecord: morphGroupRecordSyncSchema.optional(),
});

export const jevElementSchema: z.ZodType<JevElement> = z
  .object({
    id: safeIdSchema,
    kind: elementKindSchema,
    x: finiteCoordSchema,
    y: finiteCoordSchema,
    width: finiteCoordSchema,
    height: finiteCoordSchema,
    label: z.string().max(MAX_LABEL_LENGTH),
    sublabel: z.string().max(MAX_MARKDOWN_LENGTH).optional(),
    tone: colorToneSchema,
    seed: z.number().finite(),
    fromId: safeIdSchema.optional(),
    toId: safeIdSchema.optional(),
    fromPoint: pointSchema.optional(),
    toPoint: pointSchema.optional(),
    arrowStyle: z.enum(["curved", "straight"]).optional(),
    dashed: z.boolean().optional(),
    bidirectional: z.boolean().optional(),
    startEnd: z.enum(ARROW_ENDS).optional(),
    endEnd: z.enum(ARROW_ENDS).optional(),
    points: z.array(pointSchema).max(MAX_FREEDRAW_POINTS).optional(),
    morphMeta: elementMorphMetaSchema.optional(),
    createdAt: z.number().finite().min(0),
    updatedAt: z.number().finite().min(0),
    createdBy: z.string().max(128).optional(),
    updatedBy: z.string().max(128).optional(),
    rev: z.number().int().min(0).max(1_000_000_000).optional(),
  })
  .refine(
    (el) => el.kind === "markdown" || (el.sublabel?.length ?? 0) <= MAX_SUBLABEL_LENGTH,
    "Non-markdown sublabel exceeds maximum length"
  )
  .refine(
    (el) => el.kind === "arrow" || (el.width >= 0 && el.height >= 0),
    "Non-arrow elements must have non-negative dimensions"
  );

const tombstoneEntrySchema = z.object({
  deletedAt: z.number().finite().min(0),
  rev: z.number().int().min(0).max(1_000_000_000),
  deletedBy: z.string().max(128).optional(),
});

export const tombstoneMapSchema: z.ZodType<TombstoneMap> = z
  .record(z.string(), tombstoneEntrySchema)
  .refine(
    (map) => {
      const keys = Object.keys(map);
      if (keys.length > MAX_TOMBSTONES) return false;
      return keys.every(
        (k) => k.length >= 1 && k.length <= 128 && isSafeKey(k)
      );
    },
    "Invalid or oversized tombstones map"
  );

const peerIdWireSchema = safeIdSchema;
const peerNameSchema = z.string().trim().min(1).max(64);
const peerColorSchema = z.string().regex(HEX_COLOR_PATTERN);

const helloWireSchema = z.object({
  kind: z.literal("hello"),
  peerId: peerIdWireSchema,
  name: peerNameSchema,
  color: peerColorSchema,
  ts: z.number().finite().min(0),
  joinedAt: z.number().finite().min(0).optional(),
  hasLocalEdits: z.boolean().optional(),
  isAuthoritative: z.boolean().optional(),
});

const cursorWireSchema = z.object({
  kind: z.literal("cursor"),
  peerId: peerIdWireSchema,
  name: peerNameSchema,
  color: peerColorSchema,
  x: finiteCoordSchema,
  y: finiteCoordSchema,
  selectedId: safeIdSchema.nullable().optional(),
  ts: z.number().finite().min(0),
});

const syncStateWireSchema = z.object({
  kind: z.literal("sync_state"),
  peerId: peerIdWireSchema,
  elements: z.array(jevElementSchema).max(MAX_BOARD_ELEMENTS),
  boardTitle: z.string().max(MAX_BOARD_TITLE_LENGTH),
  ts: z.number().finite().min(0),
  authoritative: z.boolean().optional(),
  hasLocalEdits: z.boolean().optional(),
  titleRev: z.number().int().min(0).max(1_000_000_000).optional(),
  titleUpdatedBy: safeIdSchema.optional(),
  titleUpdatedAt: z.number().finite().min(0).optional(),
  tombstones: tombstoneMapSchema.optional(),
  tombstoneHorizonRev: z.number().int().min(0).max(1_000_000_000).optional(),
  tombstoneHorizonAt: z.number().finite().min(0).optional(),
  boardEpoch: safeIdSchema.optional(),
  boardEpochCreatedAt: z.number().finite().min(0).optional(),
  baseRev: z.number().int().min(0).max(1_000_000_000).optional(),
  baseTimestamp: z.number().finite().min(0).optional(),
  fullResync: z.boolean().optional(),
});

const requestSyncWireSchema = z.object({
  kind: z.literal("request_sync"),
  peerId: peerIdWireSchema,
  ts: z.number().finite().min(0),
  reason: z.enum(["initial", "resync"]).optional(),
});

const pingWireSchema = z.object({
  kind: z.literal("ping"),
  peerId: peerIdWireSchema,
  sentAt: z.number().finite().min(0),
});

const pongWireSchema = z.object({
  kind: z.literal("pong"),
  peerId: peerIdWireSchema,
  sentAt: z.number().finite().min(0),
});

export const collabWireMessageSchema = z.discriminatedUnion("kind", [
  helloWireSchema,
  cursorWireSchema,
  syncStateWireSchema,
  requestSyncWireSchema,
  pingWireSchema,
  pongWireSchema,
]);

export type ValidatedCollabWireMessage = z.infer<typeof collabWireMessageSchema>;

export const storedBoardSnapshotSchema = z.object({
  elements: z.array(jevElementSchema).max(MAX_BOARD_ELEMENTS),
  boardTitle: z.string().max(MAX_BOARD_TITLE_LENGTH).optional(),
  titleRev: z.number().int().min(0).max(1_000_000_000).optional(),
  titleUpdatedBy: safeIdSchema.optional(),
  titleUpdatedAt: z.number().finite().min(0).optional(),
  tombstones: tombstoneMapSchema.optional(),
  tombstoneHorizonRev: z.number().int().min(0).max(1_000_000_000).optional(),
  tombstoneHorizonAt: z.number().finite().min(0).optional(),
  boardEpoch: safeIdSchema.optional(),
  boardEpochCreatedAt: z.number().finite().min(0).optional(),
  baseTimestamp: z.number().finite().min(0).optional(),
  hasLocalEdits: z.boolean().optional(),
});

export type StoredBoardSnapshot = Omit<BoardSnapshot, "boardTitle"> & {
  boardTitle?: string;
};

export const boardRecoveryEntrySchema = z.object({
  id: safeIdSchema,
  savedAt: z.number().finite().min(0),
  reason: z.enum([
    "authoritative_replace",
    "authoritative_bulk_delete",
    "remote_change_threshold",
    "peer_quarantine",
    "periodic",
    "manual",
  ]),
  removedCount: z.number().int().min(0),
  editedCount: z.number().int().min(0).optional(),
  previousElementCount: z.number().int().min(0),
  snapshot: storedBoardSnapshotSchema,
});

export type BoardRecoveryEntry = z.infer<typeof boardRecoveryEntrySchema>;

const manualSdpSchema = z.object({
  v: z.literal(1),
  from: safeIdSchema,
  name: peerNameSchema,
  sdp: z.object({
    type: z.enum(["offer", "answer"]),
    sdp: z
      .string()
      .min(10)
      .max(40_000)
      .refine((v) => v.startsWith("v=0"), "Invalid SDP"),
  }),
});

export type ValidatedManualSdp = z.infer<typeof manualSdpSchema>;

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/**
 * Strips any prototype-polluting own keys safely from parsed JSON objects before Zod validation.
 */
export function hasForbiddenOwnKeys(obj: unknown, depth = 0): boolean {
  if (depth > 14 || !obj || typeof obj !== "object") return false;
  if (Array.isArray(obj)) {
    return obj.some((item) => hasForbiddenOwnKeys(item, depth + 1));
  }
  const record = obj as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_KEYS.has(key)) return true;
    if (hasForbiddenOwnKeys(record[key], depth + 1)) return true;
  }
  return false;
}

export function parseWireMessage(
  raw: unknown
): ValidatedCollabWireMessage | null {
  if (!raw || typeof raw !== "object") return null;
  if (hasForbiddenOwnKeys(raw)) return null;
  const parsed = collabWireMessageSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function parseRawDataChannelMessage(
  rawData: unknown
): ValidatedCollabWireMessage | null {
  if (typeof rawData !== "string") return null;
  if (rawData.length === 0 || utf8ByteLength(rawData) > MAX_WIRE_MESSAGE_BYTES) {
    return null;
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(rawData);
  } catch {
    return null;
  }
  return parseWireMessage(decoded);
}

export function parseStoredBoardSnapshot(
  rawJson: string
): StoredBoardSnapshot | null {
  if (
    typeof rawJson !== "string" ||
    rawJson.length === 0 ||
    utf8ByteLength(rawJson) > MAX_STORAGE_BYTES
  ) {
    return null;
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(rawJson);
  } catch {
    return null;
  }
  if (!decoded || typeof decoded !== "object" || hasForbiddenOwnKeys(decoded)) {
    return null;
  }
  const parsed = storedBoardSnapshotSchema.safeParse(decoded);
  return parsed.success ? parsed.data : null;
}

export function parseManualSdpPayload(raw: unknown): ValidatedManualSdp | null {
  if (!raw || typeof raw !== "object" || hasForbiddenOwnKeys(raw)) return null;
  const parsed = manualSdpSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
