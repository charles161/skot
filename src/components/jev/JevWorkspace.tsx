"use client";

import { boardStorageKey } from "@/lib/jev/storage-keys";
import { BrandWordmark } from "@/brand/BrandWordmark";
import React, { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { AiQuietContext, postDecide } from "@/lib/jev/ai-quiet";
import { getPracticePrompt, type PracticePromptId } from "@/lib/jev/practice-prompts";
import type { ReviewComment } from "@/lib/jev/practice-review";
import { parsePracticeSession, practiceStorageKey, type PracticeSession } from "@/lib/jev/practice-session";
import { useBoardTheme } from "@/lib/theme-store";
import { IconActor, IconArrow, IconBox, IconBroadcast, IconClose, IconDatabase, IconDiamond, IconDownload, IconFit, IconFork, IconFrame, IconHand, IconMinus, IconMoon, IconPacks, IconPen, IconPlus, IconRedo, IconReset, IconSelect, IconSpark, IconSun, IconTarget, IconText, IconTrash, IconUndo } from "@/brand/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ALL_TONES } from "@/lib/jev/colors";
import { duplicateElements } from "@/lib/jev/duplicate";
import type { EditField } from "@/lib/jev/inline-edit";
import { isShapeTool, shapeFromTool } from "@/lib/jev/shape-tools";
import { altLetter, type DockTool, isTypedLetter, toolForShortcut, toolShortcutLabel } from "@/lib/jev/shortcuts";
import {
  ZOOM_STEP_IN,
  ZOOM_STEP_OUT,
  zoomAroundPoint,
  zoomKeyAction,
} from "@/lib/jev/viewport-zoom";
import { parsePromptToElements } from "@/lib/jev/diagram-parser";
import {
  buildFeedbackPreferenceSummary,
  loadFeedbackProfile,
  rankCandidatesWithFeedback,
  recordSuggestionAccepted,
  recordSuggestionRejected,
  recordSuggestionShown,
} from "@/lib/jev/feedback-store";
import {
  applyForkTakeToBoard,
  buildLocalForkTakes,
  extractSelectedSubgraph,
  type ForkTake,
  materializeForkTake,
  type SelectedSubgraph,
  validateForkTakesPayload,
} from "@/lib/jev/fork-engine";
import { buildConstraintForkTakes } from "@/lib/jev/fork-catalogue";
import {
  describeForkConstraint,
  FORK_PRESSURES,
  type ForkConstraint,
} from "@/lib/jev/fork-constraint";
import {
  computeBounds,
  computeViewportEnsureVisible,
  computeViewportFit,
  computeViewportKeepBoard,
  isShapeElement,
  makeSeed,
  Rect,
  uid,
  type ViewportMargins,
} from "@/lib/jev/geometry";
import { detectMoveIntent } from "@/lib/jev/intent-engine";
import {
  applyMorphToBoard,
  constrainMorphSpecToSelection,
  detectSelectionMorphState,
  MORPH_NOTATION_LABELS,
  morphSelectionToNotation,
  validateMorphSemanticSpec,
} from "@/lib/jev/notation-morph";
import { enterDefaultIndex, isFlowText, NO_OPTION, planTypedNode, stepOption } from "@/lib/jev/core-loop";
import {
  buildAfterCreateOptions,
  buildNextOptions,
  appendContextOption,
  bestContextOption,
  predictConcept,
  scoreOptions,
  typingAnchor,
  type NextOptionsResult,
} from "@/lib/jev/next-options";
import {
  applyPredictionToElements,
  buildRankingContext,
  DEFAULT_BOARD_TITLE,
  generateCandidatePool,
  generateStrokePredictions,
  mergeContextSuggestions,
  selectTopSuggestions,
  serializeCanvasStateForJev,
  type ContextSuggestion,
} from "@/lib/jev/prediction-engine";
import { SelectionSuggestTrigger } from "@/lib/jev/selection-trigger";
import { SettledAsk } from "@/lib/jev/settled-ask";
import {
  type BoardEditDelta,
  serializeBoardToGraph,
} from "@/lib/jev/semantic-graph";
import {
  exportBoardToSvg,
  sanitizeExportFilename,
} from "@/lib/jev/svg-export";
import {
  createForkArchitectureStarterElements,
  createRequestFlowStarterElements,
  createStarterElements,
} from "@/lib/jev/templates";
import {
  ElementBox,
  JevElement,
  JevTelemetry,
  MorphNotation,
  PeerCursor,
  Point,
  PredictedAction,
  RenderStyle,
  SpatialIntent,
  TombstoneMap,
  ToolType,
  Viewport,
  isJevModelSource,
  type DecideSource,
} from "@/lib/jev/types";
import {
  BoardHistoryController,
  BroadcastThrottler,
} from "@/lib/jev/board-history";
import {
  applyLocalElementsChange,
  BoardSyncState,
  computeMaxKnownRev,
  createBoardEpoch,
  mergeRemoteBoardState,
  TOMBSTONE_TTL_MS,
} from "@/lib/jev/board-sync";
import {
  popRecoverySnapshot,
  pushRecoverySnapshot,
  type BoardRecoveryEntry,
} from "@/lib/jev/recovery-buffer";
import {
  RemoteChangeGuard,
  type PeerQuarantineIncident,
} from "@/lib/jev/remote-guard";
import {
  parseStoredBoardSnapshot,
  type StoredBoardSnapshot,
} from "@/lib/jev/sync-validation";
import {
  formatRoomHash,
  generateRoomCredentials,
  parseRoomHash,
  RoomCredentials,
} from "@/lib/jev/room-auth";
import { JevP2PCollab } from "@/lib/jev/webrtc-collab";
import {
  BoardFileMenuItems,
  BoardNoticeToast,
  useBoardFileActions,
  useBoardNotice,
  useImportFragment,
} from "./BoardFileMenu";
import { FirstRunEmptyState } from "./FirstRunEmptyState";
import { StarterBoardsMenuItems } from "./StarterBoardsPicker";
import { findStarterBoard } from "@/lib/jev/starter-boards";
import { ForkHud } from "./ForkHud";
import { ForkPressureStep } from "./ForkPressureStep";
import { JevCanvas } from "./JevCanvas";
import { MoreShapesButton } from "./MoreShapesMenu";
import { NotationMorphBar } from "./NotationMorphBar";
import { PackChip } from "./PackChip";
import { PacksPanel } from "./PacksPanel";
import { PracticeHud } from "./PracticeHud";
import { PracticePicker } from "./PracticePicker";
import { PracticePins, PracticeReviewPanel } from "./PracticeReview";
import { PredictionHud } from "./PredictionHud";
import { SelectionInspector } from "./SelectionInspector";
import { ShareP2PDialog } from "./ShareP2PDialog";
import { ThoughtBar } from "./ThoughtBar";
import { usePracticeSession } from "./usePracticeSession";
import { usePacks } from "./use-packs";
import { useMoves } from "./use-moves";
import { MoveNoticeToast, MovesMenu } from "./MovesMenu";
import { MoveOverlay } from "./MoveOverlay";

const TOOLS: Array<{
  id: DockTool;
  label: string;
  key: string;
  icon: React.ReactNode;
}> = [
  { id: "select", label: "Select", key: toolShortcutLabel("select"), icon: <IconSelect className="h-4 w-4" /> },
  { id: "hand", label: "Pan Canvas", key: toolShortcutLabel("hand"), icon: <IconHand className="h-4 w-4" /> },
  { id: "node", label: "Box", key: toolShortcutLabel("node"), icon: <IconBox className="h-4 w-4" /> },
  { id: "diamond", label: "Decision", key: toolShortcutLabel("diamond"), icon: <IconDiamond className="h-4 w-4" /> },
  { id: "database", label: "Database", key: toolShortcutLabel("database"), icon: <IconDatabase className="h-4 w-4" /> },
  { id: "ellipse", label: "Actor", key: toolShortcutLabel("ellipse"), icon: <IconActor className="h-4 w-4" /> },
  { id: "arrow", label: "Smart Arrow", key: toolShortcutLabel("arrow"), icon: <IconArrow className="h-4 w-4" /> },
  { id: "frame", label: "Zone Frame", key: toolShortcutLabel("frame"), icon: <IconFrame className="h-4 w-4" /> },
  { id: "freedraw", label: "Ink Pen", key: toolShortcutLabel("freedraw"), icon: <IconPen className="h-4 w-4" /> },
  { id: "text", label: "Text Note", key: toolShortcutLabel("text"), icon: <IconText className="h-4 w-4" /> },
];

const PEER_NAMES = ["Maya", "Soren", "Nadia", "Kavi", "Elena", "Theo"];
/** Starter boards are large; fit them with slim side margins so text stays legible on a laptop. */
const STARTER_BOARD_FIT_MARGINS = { top: 96, right: 32, bottom: 110, left: 32 };

function getOrCreateRoomCredentials(): RoomCredentials & {
  createdNew: boolean;
} {
  if (typeof window === "undefined") {
    return { roomId: "", roomSecret: "", createdNew: false };
  }
  const parsed = parseRoomHash(window.location.hash);
  if (parsed) {
    return { ...parsed, createdNew: false };
  }
  const fresh = generateRoomCredentials();
  const url = new URL(window.location.href);
  url.searchParams.delete("room");
  url.hash = formatRoomHash(fresh.roomId, fresh.roomSecret);
  window.history.replaceState({}, "", url.toString());
  return { ...fresh, createdNew: true };
}

interface BroadcastSyncPayload {
  elements: JevElement[];
  boardTitle: string;
  titleRev: number;
  titleUpdatedBy: string;
  tombstones: TombstoneMap;
  tombstoneHorizonRev: number;
  tombstoneHorizonAt: number;
  boardEpoch: string;
  boardEpochCreatedAt: number;
  baseRev: number;
  baseTimestamp: number;
  hasLocalEdits: boolean;
}

interface RecoveryToastState {
  entry: BoardRecoveryEntry;
  removedCount: number;
  editedCount: number;
  changedCount: number;
  localCount: number;
  kind: "full_replace" | "bulk_delete" | "remote_changes";
  savedSnapshotsCount: number;
}

interface RankOptions {
  signal?: AbortSignal;
  onRanked?: (top: PredictedAction[]) => void;
  /** False keeps the pool as is: no LLM-proposed nodes are mixed in (pen-stroke conversions). */
  mergeContext?: boolean;
  /**
   * The options on screen keep their order and the highlight: jev's scores are written onto them, and the
   * node the context route named from the board is added after them.
   */
  keepOrder?: boolean;
}

/** One rank_actions request waiting for the board to settle; `shown` is the suggestion list it is about. */
interface RankJob {
  intent: SpatialIntent;
  els: JevElement[];
  pool: PredictedAction[];
  shown: PredictedAction[];
  opts: RankOptions;
}

interface ForkSessionState {
  /** "pressure" asks what has to give before any take is generated. */
  phase: "pressure" | "takes";
  targetIds: string[];
  sourceElements: JevElement[];
  constraint: ForkConstraint | null;
  subgraph: SelectedSubgraph;
  replacedIds: string[];
  takes: ForkTake[];
  activeIndex: number;
  source: DecideSource;
  model: string;
  isHeuristic: boolean;
  latencyMs: number;
  evaluating: boolean;
}

/** Canvas area left free by the practice prompt card and the review panel (desktop) or sheet (phone). */
function reviewViewportMargins() {
  return window.innerWidth >= 640
    ? { top: 110, right: 380, bottom: 110, left: 340 }
    : { top: 130, right: 32, bottom: Math.round(window.innerHeight * 0.5), left: 32 };
}

function getBrowserStorage() {
  return typeof window !== "undefined" ? window.localStorage : null;
}

interface JevWorkspaceProps {
  /** Quiet inferred-pack chips ("ER pack", "Crow's foot", …). Practice mode passes false. */
  packChips?: boolean;
  collabEnabled?: boolean;
}

export function JevWorkspace({ packChips = true, collabEnabled = true }: JevWorkspaceProps = {}) {
  const collabEnabledRef = useRef(collabEnabled);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const startInlineEditRef = useRef<((id: string, field?: EditField) => void) | null>(null);
  const thoughtInputRef = useRef<HTMLInputElement | null>(null);
  const collabRef = useRef<JevP2PCollab | null>(null);
  const lastCursorSentRef = useRef<number>(0);

  const [roomId, setRoomId] = useState("");
  const [roomSecret, setRoomSecret] = useState("");
  const [boardTitle, setBoardTitle] = useState(DEFAULT_BOARD_TITLE);
  const [elements, setElements] = useState<JevElement[]>([]);
  const [boardReady, setBoardReady] = useState(false);
  const [joiningSharedRoom, setJoiningSharedRoom] = useState(false);
  const [historyCounts, setHistoryCounts] = useState({ undo: 0, redo: 0 });
  const historyRef = useRef<BoardHistoryController | null>(null);
  const remoteSyncGenerationRef = useRef<number>(0);
  const tombstonesRef = useRef<TombstoneMap>({});
  const tombstoneHorizonRevRef = useRef<number>(0);
  const tombstoneHorizonAtRef = useRef<number>(0);
  const boardEpochRef = useRef<string>(createBoardEpoch());
  const boardEpochCreatedAtRef = useRef<number>(0);
  const baseTimestampRef = useRef<number>(0);
  const titleRevRef = useRef<number>(0);
  const titleUpdatedByRef = useRef<string>("");
  const hasLocalEditsRef = useRef<boolean>(false);
  const canPersistRef = useRef<boolean>(false);
  const broadcastThrottlerRef =
    useRef<BroadcastThrottler<BroadcastSyncPayload> | null>(null);
  const remoteGuardRef = useRef<RemoteChangeGuard | null>(null);
  const [recoveryToast, setRecoveryToast] = useState<RecoveryToastState | null>(
    null
  );
  const [peerIncidents, setPeerIncidents] = useState<PeerQuarantineIncident[]>(
    []
  );
  const [liveAnnouncement, setLiveAnnouncement] = useState("");
  const announceStatus = useCallback((message: string) => {
    setLiveAnnouncement("");
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => setLiveAnnouncement(message));
    } else {
      setLiveAnnouncement(message);
    }
  }, []);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [canvasInteracting, setCanvasInteracting] = useState(false);
  const [tool, setTool] = useState<ToolType>("select");
  const [theme, setTheme] = useBoardTheme();
  const [renderStyle, setRenderStyle] = useState<RenderStyle>("sketch");
  const [viewport, setViewport] = useState<Viewport>({ x: 80, y: 40, zoom: 1 });
  const [screenSize, setScreenSize] = useState({ width: 1280, height: 800 });

  // Notation Morph state
  const [morphEvaluating, setMorphEvaluating] = useState(false);
  const [morphIsHeuristic, setMorphIsHeuristic] = useState(true);
  const morphAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const sync = () =>
      setScreenSize({ width: window.innerWidth, height: window.innerHeight });
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  // Exact world-space viewport rect & visual center of the user's zoomed view
  const viewportWorld = useMemo<Rect>(() => {
    const safeTop = 76;
    const safeBottom = 175;
    const visibleH = Math.max(220, screenSize.height - safeTop - safeBottom);
    return {
      x: -viewport.x / viewport.zoom,
      y: (safeTop - viewport.y) / viewport.zoom,
      width: screenSize.width / viewport.zoom,
      height: visibleH / viewport.zoom,
    };
  }, [screenSize.width, screenSize.height, viewport.x, viewport.y, viewport.zoom]);

  const viewportCenterWorld = useMemo<Point>(() => {
    return {
      x: Math.round(viewportWorld.x + viewportWorld.width / 2),
      y: Math.round(viewportWorld.y + viewportWorld.height / 2),
    };
  }, [viewportWorld]);

  const [thoughtPrompt, setThoughtPrompt] = useState("");
  const viewportCenterRef = useRef<Point>({ x: 400, y: 300 });
  const viewportWorldRef = useRef<Rect | undefined>(undefined);
  /** The options on screen came from the Thought Bar text (cleared when the text is). */
  const typedModeRef = useRef(false);
  const typedResultRef = useRef<NextOptionsResult | null>(null);
  /** The Thought Bar text `typedResultRef` was built for: Enter commits that preview only for the same text. */
  const typedTextRef = useRef("");
  /** The user pressed Tab / hovered since these options appeared: late LLM answers must not replace the option they chose. */
  const optionsTouchedRef = useRef(false);
  /** Last node the user added, applied or renamed: what typed options attach to when nothing is selected. */
  const lastTouchedIdRef = useRef<string | null>(null);
  /** Tab just accepted a completion: that is a choice of the one-node option, so keep (a) highlighted. */
  const completedRef = useRef(false);
  const subjectOptionsRef = useRef<(subjectId: string, els: JevElement[]) => void>(() => {});
  const [intent, setIntent] = useState<SpatialIntent | null>(null);
  const [predictions, setPredictions] = useState<PredictedAction[]>([]);
  const [activePredIdx, setActivePredIdx] = useState(0);
  const activePredIdxRef = useRef(0);
  useEffect(() => {
    activePredIdxRef.current = activePredIdx;
  }, [activePredIdx]);
  const [telemetry, setTelemetry] = useState<JevTelemetry | null>(null);
  const decideAbortRef = useRef<AbortController | null>(null);
  const rankAskRef = useRef<SettledAsk<RankJob> | null>(null);
  const showSelectionPredictionsRef = useRef<(key: string, signal: AbortSignal) => void>(() => {});
  const selectionTriggerRef = useRef<SelectionSuggestTrigger | null>(null);

  const [forkSession, setForkSession] = useState<ForkSessionState | null>(null);
  const forkAbortRef = useRef<AbortController | null>(null);
  const recentDeltasRef = useRef<BoardEditDelta[]>([]);

  const pushEditDelta = useCallback((delta: Omit<BoardEditDelta, "timestamp">) => {
    recentDeltasRef.current = [
      ...recentDeltasRef.current.slice(-15),
      { ...delta, timestamp: Date.now() },
    ];
  }, []);

  const [shareOpen, setShareOpen] = useState(false);
  const [remotePeers, setRemotePeers] = useState<PeerCursor[]>([]);
  const [demoPeerEnabled, setDemoPeerEnabled] = useState(false);
  const [demoPeer, setDemoPeer] = useState<PeerCursor | null>(null);
  const [collabStatus, setCollabStatus] = useState({
    webrtcPeers: 0,
    broadcastPeers: 0,
    signalingActive: false,
  });

  const elementsRef = useRef(elements);
  const boardTitleRef = useRef(boardTitle);
  const getHistory = useCallback(() => {
    if (!historyRef.current) {
      historyRef.current = new BoardHistoryController(elementsRef.current);
    }
    return historyRef.current;
  }, []);
  useEffect(() => {
    elementsRef.current = elements;
  }, [elements]);
  useEffect(() => {
    boardTitleRef.current = boardTitle;
  }, [boardTitle]);

  // Fit diagram comfortably inside HUD-safe margins
  const zoomViewportAtCenter = useCallback(
    (factor: number, absolute = false) => {
      setViewport((v) =>
        zoomAroundPoint(v, absolute ? factor / v.zoom : factor, {
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        })
      );
    },
    []
  );

  const fitToView = useCallback(
    (targetEls?: JevElement[], margins?: ViewportMargins) => {
      const list = targetEls ?? elementsRef.current;
      const bounds = computeBounds(list);
      if (!bounds || typeof window === "undefined") {
        setViewport({ x: 0, y: 0, zoom: 1 });
        return;
      }
      setViewport(
        computeViewportFit(bounds, {
          screenWidth: window.innerWidth,
          screenHeight: window.innerHeight,
          margins,
        })
      );
    },
    []
  );

  // Ensure new diagrams, morphs, or ghosts stay cleanly inside HUD-safe viewport bounds
  const ensureElementsVisible = useCallback(
    (targetEls: JevElement[], margins?: ViewportMargins, opts: { keepBoard?: boolean } = {}) => {
      const bounds = computeBounds(targetEls);
      if (!bounds || typeof window === "undefined") return;
      // A phone has no room for desktop gutters, and its dock (one chip row and the bar) is short.
      const phone = opts.keepBoard && window.innerWidth < 640;
      const fit = {
        screenWidth: window.innerWidth,
        screenHeight: window.innerHeight,
        margins: phone ? { ...margins, left: 16, right: 16, bottom: 150 } : margins,
      };
      // keepBoard: a growing diagram zooms out to stay whole instead of scrolling its first nodes away. A phone
      // keeps its zoom and pans to the new node.
      const board = opts.keepBoard ? computeBounds(elementsRef.current) : null;
      setViewport((prev) =>
        opts.keepBoard ? computeViewportKeepBoard(prev, bounds, board, fit) : computeViewportEnsureVisible(prev, bounds, fit)
      );
    },
    []
  );

  const [practicePickerOpen, setPracticePickerOpen] = useState(false);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const practiceApi = usePracticeSession(
    roomId,
    () => ({ elements: elementsRef.current, boardTitle: boardTitleRef.current }),
    () => {
      setActiveCommentId(null);
      setSelectedIds([]);
      setInspectorOpen(false);
      if (elementsRef.current.length > 0) fitToView(elementsRef.current, reviewViewportMargins());
    }
  );
  const { practice, restore: restorePractice } = practiceApi;
  const aiQuiet = practice !== null;
  const aiQuietRef = useRef(false);
  useEffect(() => {
    aiQuietRef.current = aiQuiet;
  }, [aiQuiet]);

  const rankWithTypeSafeJev = useCallback(
    async (
      nextIntent: SpatialIntent,
      currentEls: JevElement[],
      pool: PredictedAction[],
      opts: RankOptions = {}
    ) => {
      if (aiQuietRef.current) return;
      if (pool.length === 0) return;
      if (opts.signal?.aborted) return;

      decideAbortRef.current?.abort();
      const controller = new AbortController();
      decideAbortRef.current = controller;
      opts.signal?.addEventListener("abort", () => controller.abort(), { once: true });
      const rankingContext =
        opts.mergeContext === false ? null : buildRankingContext(nextIntent, currentEls, boardTitleRef.current);

      const feedbackProfile = loadFeedbackProfile(getBrowserStorage());
      const preferenceSummary = buildFeedbackPreferenceSummary(feedbackProfile);
      const boardGraph = serializeBoardToGraph(currentEls, {
        subjectId: nextIntent.subjectId,
        recentDeltas: recentDeltasRef.current,
        boardTitle: boardTitleRef.current,
      });

      setTelemetry((prev) => ({
        source: prev?.source ?? "heuristic",
        model: prev?.model ?? "heuristic",
        isHeuristic: prev?.isHeuristic ?? true,
        latencyMs: prev?.latencyMs ?? 0,
        evaluating: true,
      }));

      try {
        const res = await postDecide({
          mode: "rank_actions",
          boardGraph,
          intentSummary: `${nextIntent.headline} (${nextIntent.detail})`.slice(0, 320),
          stateSummary: serializeCanvasStateForJev(nextIntent, currentEls),
          ...(preferenceSummary ? { preferenceSummary } : {}),
          ...(rankingContext ? { context: rankingContext } : {}),
          candidates: pool.map((c) => ({
            id: c.id,
            title: c.title,
            subtitle: c.subtitle,
            category: c.category,
          })),
        }, { aiQuiet: aiQuietRef.current, signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!res || !res.ok) {
          // The AI is down or said no: the options on screen stand as they are, and "deciding" must end.
          setTelemetry((prev) => (prev ? { ...prev, evaluating: false } : null));
          return;
        }
        const data = (await res.json()) as {
          source: DecideSource;
          model: string;
          isHeuristic?: boolean;
          latencyMs: number;
          usage?: { input_tokens?: number };
          nextActionProbabilities?: Record<string, number> | null;
          intentChoice?: string | null;
          intentConfidence?: number | null;
          shouldConnectProb?: number | null;
          contextSuggestions?: ContextSuggestion[];
        };
        if (controller.signal.aborted) return;

        const candidates =
          opts.mergeContext === false
            ? pool
            : mergeContextSuggestions(pool, data.contextSuggestions ?? [], nextIntent, currentEls);
        const isLiveModel =
          isJevModelSource(data.source) && data.isHeuristic !== true;
        const probs = isLiveModel ? data.nextActionProbabilities ?? null : null;
        if (opts.keepOrder) {
          const subject = nextIntent.subjectId ? currentEls.find((e) => e.id === nextIntent.subjectId) : undefined;
          const named =
            subject && opts.mergeContext !== false
              ? bestContextOption(data.contextSuggestions ?? [], probs, subject, currentEls, pool)
              : null;
          setPredictions((prev) => {
            // The panel moved on (the user typed, or picked something): this answer is for options no longer shown.
            if (prev.length !== pool.length || prev.some((p, i) => p.id !== pool[i].id)) return prev;
            const scored = scoreOptions(prev, data.contextSuggestions ?? [], probs);
            return named ? appendContextOption(scored, named) : scored;
          });
          setTelemetry({
            source: isLiveModel ? data.source : "heuristic",
            model: data.model,
            isHeuristic: !isLiveModel,
            latencyMs: data.latencyMs,
            evaluating: false,
          });
          return;
        }
        const ranked = (
          probs
            ? candidates
                .map((action) => ({
                  ...action,
                  probability:
                    typeof probs[action.id] === "number"
                      ? probs[action.id]
                      : undefined,
                }))
                .sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0))
            : rankCandidatesWithFeedback(
                candidates.map((action) => ({
                  ...action,
                  feedbackKeys: action.feedbackKeys ?? [`cat:${action.category}`],
                })),
                feedbackProfile
              ).map(({ item }) => ({ ...item, probability: undefined }))
        );
        const top = selectTopSuggestions(ranked);

        setPredictions(top);
        opts.onRanked?.(top);
        setActivePredIdx(optionsTouchedRef.current ? 0 : NO_OPTION);
        setTelemetry({
          source: isLiveModel ? data.source : "heuristic",
          model: data.model,
          isHeuristic: !isLiveModel,
          latencyMs: data.latencyMs,
          inputTokens: data.usage?.input_tokens,
          intentChoice: data.intentChoice,
          intentConfidence: data.intentConfidence,
          shouldConnectProb: data.shouldConnectProb,
          evaluating: false,
        });
      } catch {
        setTelemetry((prev) => (prev ? { ...prev, evaluating: false } : null));
      }
    },
    []
  );

  // The one way a rank_actions request leaves the browser: after the board settles, and only the latest one.
  useEffect(() => {
    const ask = new SettledAsk<RankJob>({
      send: (job) => void rankWithTypeSafeJev(job.intent, job.els, job.pool, job.opts),
    });
    rankAskRef.current = ask;
    const touch = () => ask.touch();
    window.addEventListener("pointerdown", touch, true);
    window.addEventListener("pointerup", touch, true);
    window.addEventListener("keydown", touch, true);
    return () => {
      ask.cancel();
      window.removeEventListener("pointerdown", touch, true);
      window.removeEventListener("pointerup", touch, true);
      window.removeEventListener("keydown", touch, true);
      rankAskRef.current = null;
    };
  }, [rankWithTypeSafeJev]);

  useEffect(() => {
    rankAskRef.current?.setBusy(canvasInteracting || tool !== "select" || Boolean(forkSession));
  }, [canvasInteracting, tool, forkSession]);

  useEffect(() => {
    rankAskRef.current?.dropUnless((job) => job.shown === predictions);
  }, [predictions]);

  /** Asks the AI about the suggestions just shown, once the board settles. `shown` is the list on screen. */
  const askWhenSettled = useCallback(
    (
      nextIntent: SpatialIntent,
      currentEls: JevElement[],
      pool: PredictedAction[],
      shown: PredictedAction[],
      opts: RankOptions = {}
    ) => {
      if (aiQuietRef.current || pool.length === 0) return;
      rankAskRef.current?.request({ intent: nextIntent, els: currentEls, pool, shown, opts });
    },
    []
  );

  const boardNotice = useBoardNotice();
  const importPending = useImportFragment(boardNotice.show);
  const boardFile = useBoardFileActions(
    () => ({ elements: elementsRef.current, boardTitle: boardTitleRef.current }),
    boardNotice.show
  );

  // Initialize room, load saved state if present, and start WebRTC P2P session
  useEffect(() => {
    if (importPending) return;
    const creds = getOrCreateRoomCredentials();
    const rid = creds.roomId;
    const rsecret = creds.roomSecret;

    const throttler = new BroadcastThrottler<BroadcastSyncPayload>(
      (payload) => {
        collabRef.current?.broadcastState(payload.elements, payload.boardTitle, {
          titleRev: payload.titleRev,
          titleUpdatedBy: payload.titleUpdatedBy,
          tombstones: payload.tombstones,
          tombstoneHorizonRev: payload.tombstoneHorizonRev,
          tombstoneHorizonAt: payload.tombstoneHorizonAt,
          boardEpoch: payload.boardEpoch,
          boardEpochCreatedAt: payload.boardEpochCreatedAt,
          baseRev: payload.baseRev,
          baseTimestamp: payload.baseTimestamp,
          hasLocalEdits: payload.hasLocalEdits,
        });
      },
      60
    );
    broadcastThrottlerRef.current = throttler;

    const initNow = Date.now();
    boardEpochCreatedAtRef.current = initNow;
    baseTimestampRef.current = initNow;

    // Synchronously validate and restore any saved board snapshot before starting P2P
    // so the room host's state is immediately available for incoming handshakes.
    let initialEls = elementsRef.current;
    let initialTitle = boardTitleRef.current;
    let restored = false;
    try {
      const saved = window.localStorage.getItem(boardStorageKey(rid));
      if (saved) {
        const parsed = parseStoredBoardSnapshot(saved);
        if (parsed && (parsed.elements.length > 0 || parsed.hasLocalEdits)) {
          initialEls = parsed.elements;
          if (parsed.boardTitle !== undefined) {
            initialTitle = parsed.boardTitle;
          }
          tombstonesRef.current = parsed.tombstones ?? {};
          tombstoneHorizonRevRef.current = parsed.tombstoneHorizonRev ?? 0;
          tombstoneHorizonAtRef.current = parsed.tombstoneHorizonAt ?? 0;
          if (parsed.boardEpoch) {
            boardEpochRef.current = parsed.boardEpoch;
          }
          if (parsed.boardEpochCreatedAt !== undefined) {
            boardEpochCreatedAtRef.current = parsed.boardEpochCreatedAt;
          }
          if (parsed.baseTimestamp !== undefined) {
            baseTimestampRef.current = parsed.baseTimestamp;
          }
          titleRevRef.current = parsed.titleRev ?? 0;
          titleUpdatedByRef.current = parsed.titleUpdatedBy ?? "";
          hasLocalEditsRef.current = parsed.hasLocalEdits ?? true;
          canPersistRef.current = true;
          elementsRef.current = initialEls;
          boardTitleRef.current = initialTitle;
          getHistory().replaceWithoutHistory(initialEls);
          restored = true;
        }
      }
    } catch {
      // ignore storage errors
    }

    if (creds.createdNew) {
      canPersistRef.current = true;
    }

    let restoredPractice: PracticeSession | null = null;
    try {
      restoredPractice = parsePracticeSession(window.localStorage.getItem(practiceStorageKey(rid)));
    } catch {
      // storage unavailable: no practice to restore
    }
    aiQuietRef.current = restoredPractice !== null;

    const initTimer = window.setTimeout(() => {
      setRoomId(rid);
      setRoomSecret(rsecret);
      restorePractice(restoredPractice);
      if (restored) {
        setElements(initialEls);
        setBoardTitle(initialTitle);
        setJoiningSharedRoom(false);
        setBoardReady(true);
        if (initialEls.length > 0) {
          fitToView(initialEls, restoredPractice?.phase === "review" ? reviewViewportMargins() : undefined);
          const anchor =
            initialEls.find((e) => e.id === "starter_mesh") ??
            initialEls[initialEls.length - 1];
          if (anchor && !restoredPractice) subjectOptionsRef.current(anchor.id, initialEls);
        }
      } else {
        setJoiningSharedRoom(!creds.createdNew);
        setBoardReady(true);
      }
    }, 0);

    // Start WebRTC + BroadcastChannel P2P session
    const remoteGuard = new RemoteChangeGuard(initNow);
    remoteGuardRef.current = remoteGuard;

    const myName =
      PEER_NAMES[Math.floor(Math.random() * PEER_NAMES.length)];
    const collab: JevP2PCollab = new JevP2PCollab(
      rid,
      rsecret,
      myName,
      {
        onPeersChange: (list) => setRemotePeers(list),
        onRemoteState: (remoteEls, remoteTitle, meta) => {
          const now = Date.now();
          const localSync: BoardSyncState = {
            elements: elementsRef.current,
            boardTitle: boardTitleRef.current,
            titleRev: titleRevRef.current,
            titleUpdatedBy: titleUpdatedByRef.current || collab.peerId,
            tombstones: tombstonesRef.current,
            tombstoneHorizonRev: tombstoneHorizonRevRef.current,
            tombstoneHorizonAt: tombstoneHorizonAtRef.current,
            boardEpoch: boardEpochRef.current,
            boardEpochCreatedAt: boardEpochCreatedAtRef.current,
            baseRev: computeMaxKnownRev({
              elements: elementsRef.current,
              tombstones: tombstonesRef.current,
              titleRev: titleRevRef.current,
              tombstoneHorizonRev: tombstoneHorizonRevRef.current,
            }),
            baseTimestamp: baseTimestampRef.current,
            hasLocalEdits: hasLocalEditsRef.current,
          };
          const evaluated = remoteGuard.evaluateIncoming({
            local: localSync,
            remote: {
              elements: remoteEls,
              boardTitle: remoteTitle,
              titleRev: meta?.titleRev,
              titleUpdatedBy: meta?.titleUpdatedBy,
              titleUpdatedAt: meta?.titleUpdatedAt,
              tombstones: meta?.tombstones,
              tombstoneHorizonRev: meta?.tombstoneHorizonRev,
              tombstoneHorizonAt: meta?.tombstoneHorizonAt,
              boardEpoch: meta?.boardEpoch,
              boardEpochCreatedAt: meta?.boardEpochCreatedAt,
              baseRev: meta?.baseRev,
              baseTimestamp: meta?.baseTimestamp,
              fullResync: meta?.fullResync,
              hasLocalEdits: meta?.hasLocalEdits,
              senderPeerId: meta?.senderPeerId ?? "remote",
              verifiedSenderPeerId: meta?.verifiedSenderPeerId,
            },
            localPeerId: collab.peerId,
            senderName: meta?.senderName,
            mergeOptions: {
              authoritativePeerId: meta?.authoritativePeerId,
              now,
              tombstoneTtlMs: TOMBSTONE_TTL_MS,
            },
            now,
          });

          if (evaluated.decision === "resync") {
            if (meta?.authoritativePeerId === collab.peerId) {
              collab.sendFullResync(
                meta?.verifiedSenderPeerId ?? meta?.senderPeerId
              );
            } else {
              collab.requestFullResync(meta?.authoritativePeerId ?? undefined);
            }
            return;
          }

          if (evaluated.decision === "noop") {
            return;
          }

          const storage =
            typeof window !== "undefined" ? window.localStorage : null;

          if (evaluated.decision === "paused") {
            if (evaluated.recoveryEntry) {
              pushRecoverySnapshot(storage, rid, evaluated.recoveryEntry);
            }
            setPeerIncidents(remoteGuard.getActiveIncidents());
            return;
          }

          const merged = evaluated.merged;
          if (evaluated.recoveryEntry) {
            const savedList = pushRecoverySnapshot(
              storage,
              rid,
              evaluated.recoveryEntry
            );
            if (evaluated.showRestoreToast && evaluated.toastSummary) {
              setRecoveryToast({
                entry: evaluated.recoveryEntry,
                removedCount: evaluated.toastSummary.removedCount,
                editedCount: evaluated.toastSummary.editedCount,
                changedCount: evaluated.toastSummary.changedCount,
                localCount: evaluated.toastSummary.localCount,
                kind: evaluated.toastSummary.kind,
                savedSnapshotsCount: Math.max(1, savedList.length),
              });
            }
          }

          const wasEmptyBeforeSync = elementsRef.current.length === 0;
          elementsRef.current = merged.state.elements;
          boardTitleRef.current = merged.state.boardTitle;
          titleRevRef.current = merged.state.titleRev ?? 0;
          titleUpdatedByRef.current = merged.state.titleUpdatedBy ?? "";
          tombstonesRef.current = merged.state.tombstones;
          tombstoneHorizonRevRef.current = merged.state.tombstoneHorizonRev ?? 0;
          tombstoneHorizonAtRef.current = merged.state.tombstoneHorizonAt ?? 0;
          if (merged.state.boardEpoch) {
            boardEpochRef.current = merged.state.boardEpoch;
          }
          if (merged.state.boardEpochCreatedAt !== undefined) {
            boardEpochCreatedAtRef.current = merged.state.boardEpochCreatedAt;
          }
          baseTimestampRef.current = merged.state.baseTimestamp ?? now;
          hasLocalEditsRef.current = merged.state.hasLocalEdits;
          canPersistRef.current = true;

          if (merged.changed) {
            // Clear local undo/redo and bump remoteSyncGeneration so any in-progress drag drops its stale snapshot
            const history = getHistory();
            history.applyRemote(merged.state.elements, {
              clearHistory: true,
            });
            remoteSyncGenerationRef.current = history.remoteSyncGeneration;
            setHistoryCounts({ undo: 0, redo: 0 });
          }

          setJoiningSharedRoom(false);
          setElements(merged.state.elements);
          setBoardTitle(merged.state.boardTitle);
          if (wasEmptyBeforeSync && merged.state.elements.length > 0) {
            fitToView(merged.state.elements);
          }
        },
        onGetLocalState: () => ({
          elements: elementsRef.current,
          boardTitle: boardTitleRef.current,
          titleRev: titleRevRef.current,
          titleUpdatedBy: titleUpdatedByRef.current || collab.peerId,
          tombstones: tombstonesRef.current,
          tombstoneHorizonRev: tombstoneHorizonRevRef.current,
          tombstoneHorizonAt: tombstoneHorizonAtRef.current,
          boardEpoch: boardEpochRef.current,
          boardEpochCreatedAt: boardEpochCreatedAtRef.current,
          baseRev: computeMaxKnownRev({
            elements: elementsRef.current,
            tombstones: tombstonesRef.current,
            titleRev: titleRevRef.current,
            tombstoneHorizonRev: tombstoneHorizonRevRef.current,
          }),
          baseTimestamp: baseTimestampRef.current,
          hasLocalEdits: hasLocalEditsRef.current,
        }),
        onStatusChange: (status) => setCollabStatus(status),
      },
      {
        isRoomCreator: creds.createdNew || restored,
        signaling: collabEnabledRef.current,
      }
    );
    collab.start();
    collabRef.current = collab;

    const periodicSnapshotTimer = window.setInterval(() => {
      const now = Date.now();
      const currentState: BoardSyncState = {
        elements: elementsRef.current,
        boardTitle: boardTitleRef.current,
        titleRev: titleRevRef.current,
        titleUpdatedBy: titleUpdatedByRef.current || collab.peerId,
        tombstones: tombstonesRef.current,
        tombstoneHorizonRev: tombstoneHorizonRevRef.current,
        tombstoneHorizonAt: tombstoneHorizonAtRef.current,
        boardEpoch: boardEpochRef.current,
        boardEpochCreatedAt: boardEpochCreatedAtRef.current,
        baseTimestamp: baseTimestampRef.current,
        hasLocalEdits: hasLocalEditsRef.current,
      };
      const periodicEntry = remoteGuard.maybeTakePeriodicSnapshot(
        currentState,
        now
      );
      if (periodicEntry) {
        pushRecoverySnapshot(
          typeof window !== "undefined" ? window.localStorage : null,
          rid,
          periodicEntry
        );
      }
    }, 15_000);

    return () => {
      window.clearTimeout(initTimer);
      window.clearInterval(periodicSnapshotTimer);
      decideAbortRef.current?.abort();
      forkAbortRef.current?.abort();
      throttler.cancel();
      broadcastThrottlerRef.current = null;
      remoteGuardRef.current = null;
      collab.destroy();
      collabRef.current = null;
    };
  }, [importPending, fitToView, rankWithTypeSafeJev, getHistory, restorePractice]);

  // Persist to localStorage quietly (only once local edits exist or host state was synced/created)
  useEffect(() => {
    if (!roomId || !canPersistRef.current) return;
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(
          boardStorageKey(roomId),
          JSON.stringify({
            elements,
            boardTitle,
            titleRev: titleRevRef.current,
            titleUpdatedBy: titleUpdatedByRef.current || undefined,
            tombstones: tombstonesRef.current,
            tombstoneHorizonRev: tombstoneHorizonRevRef.current,
            tombstoneHorizonAt: tombstoneHorizonAtRef.current,
            boardEpoch: boardEpochRef.current,
            boardEpochCreatedAt: boardEpochCreatedAtRef.current,
            baseTimestamp: baseTimestampRef.current,
            hasLocalEdits: hasLocalEditsRef.current,
          })
        );
      } catch {
        // ignore quota errors
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [elements, boardTitle, roomId]);

  // Optional Live Collaborator Demo Peer animation
  useEffect(() => {
    if (!demoPeerEnabled) return;
    let frame = 0;
    const interval = window.setInterval(() => {
      frame += 1;
      const t = frame * 0.09;
      const anchor = elementsRef.current[0];
      const cx = (anchor?.x ?? 320) + 210 + Math.cos(t) * 190;
      const cy = (anchor?.y ?? 240) + 40 + Math.sin(t * 1.4) * 95;
      setDemoPeer({
        peerId: "demo_peer_ada",
        name: "Ada (Demo)",
        color: "#0F766E",
        x: cx,
        y: cy,
        transport: "simulated",
        lastSeen: Date.now(),
        rttMs: 12,
      });
    }, 65);
    return () => window.clearInterval(interval);
  }, [demoPeerEnabled]);

  const allPeers = useMemo(
    () =>
      demoPeerEnabled && demoPeer ? [...remotePeers, demoPeer] : remotePeers,
    [remotePeers, demoPeer, demoPeerEnabled]
  );

  useEffect(() => {
    viewportCenterRef.current = viewportCenterWorld;
    viewportWorldRef.current = viewportWorld;
  }, [viewportCenterWorld, viewportWorld]);

  /**
   * Shows the options at once (all local, instant). Nothing is highlighted unless `highlight` says so: Enter on
   * the empty bar only takes what the user typed, picked, or a connection of the node they just added. While
   * the user is typing nothing is asked of the AI
   * (`ask: false`). After a node is added, applied or clicked there is one call, sent once the board settles:
   * the context route names a next node from the board and jev scores the options. The highlight only moves
   * when the user moves it.
   */
  const presentNextOptions = useCallback(
    (
      result: NextOptionsResult,
      els: JevElement[],
      opts: { signal?: AbortSignal; keepMinimal?: boolean; ask?: boolean; highlight?: number } = {}
    ) => {
      if (aiQuietRef.current) return;
      setIntent(result.intent);
      setPredictions(result.options);
      setActivePredIdx(opts.highlight ?? NO_OPTION);
      optionsTouchedRef.current = Boolean(opts.keepMinimal);
      recordSuggestionShown(getBrowserStorage(), result.options.flatMap((o) => o.feedbackKeys ?? []));
      decideAbortRef.current?.abort();
      rankAskRef.current?.cancel();
      setTelemetry(null);
      if (opts.ask === false) return;
      askWhenSettled(result.intent, els, result.options, result.options, { keepOrder: true, signal: opts.signal });
    },
    [askWhenSettled]
  );

  /** What Tab completes the typed text to; the same concept the options are built from. */
  const completion = useMemo(() => {
    const text = thoughtPrompt.trim();
    if (!text) return null;
    if (isFlowText(text)) return null;
    const anchor = typingAnchor(elements, text, selectedIds);
    return predictConcept(text, elements, anchor)?.completion ?? null;
  }, [thoughtPrompt, elements, selectedIds]);

  // Type-ahead: every keystroke shows what Enter will add (option 1, as a ghost) and two bigger options.
  useEffect(() => {
    const text = thoughtPrompt.trim();
    if (!text || text.startsWith("/") || forkSession || aiQuiet) {
      if (typedModeRef.current) {
        typedModeRef.current = false;
        typedResultRef.current = null;
        typedTextRef.current = "";
        setPredictions([]);
        setIntent(null);
      }
      return;
    }
    const result = buildNextOptions({
      elements: elementsRef.current,
      text,
      selectedIds: selectedIds,
      subjectId: lastTouchedIdRef.current ?? undefined,
      viewportCenter: viewportCenterRef.current,
      viewport: viewportWorldRef.current,
    });
    if (!result) {
      if (typedModeRef.current) {
        typedResultRef.current = null;
        typedTextRef.current = "";
        setPredictions([]);
        setIntent(null);
      }
      return;
    }
    typedModeRef.current = true;
    typedResultRef.current = result;
    typedTextRef.current = text;
    const keepMinimal = completedRef.current;
    completedRef.current = false;
    presentNextOptions(result, elementsRef.current, { keepMinimal, ask: false, highlight: 0 });
  }, [thoughtPrompt, elements, selectedIds, forkSession, aiQuiet, presentNextOptions]);

  const updateElements = useCallback(
    (
      updater: (prev: JevElement[]) => JevElement[],
      opts?: {
        recordUndo?: boolean;
        undoSnapshot?: JevElement[];
        expectedRemoteSyncGeneration?: number;
        broadcast?: boolean;
        throttleBroadcast?: boolean;
        flushBroadcast?: boolean;
      }
    ): JevElement[] => {
      const recordUndo = opts?.recordUndo ?? true;
      const shouldBroadcast = opts?.broadcast ?? true;
      const prev = elementsRef.current;
      const rawNext = updater(prev);
      const peerId = collabRef.current?.peerId ?? "local";
      const now = Date.now();
      const stamped = applyLocalElementsChange(
        prev,
        rawNext,
        tombstonesRef.current,
        peerId,
        now,
        tombstoneHorizonRevRef.current,
        {
          ttlMs: TOMBSTONE_TTL_MS,
          prevHorizonAt: tombstoneHorizonAtRef.current,
        }
      );

      const history = getHistory();
      history.commitLocal(stamped.elements, {
        recordUndo,
        undoSnapshot: opts?.undoSnapshot,
        expectedRemoteSyncGeneration: opts?.expectedRemoteSyncGeneration,
      });
      elementsRef.current = stamped.elements;
      tombstonesRef.current = stamped.tombstones;
      tombstoneHorizonRevRef.current = stamped.tombstoneHorizonRev;
      tombstoneHorizonAtRef.current = stamped.tombstoneHorizonAt;
      if (
        (collabRef.current?.getConnectedPeerCount() ?? 0) > 0 ||
        baseTimestampRef.current === 0
      ) {
        baseTimestampRef.current = now;
      }
      hasLocalEditsRef.current = true;
      canPersistRef.current = true;
      remoteGuardRef.current?.markLocalChange(now);

      setElements(stamped.elements);
      setHistoryCounts({
        undo: history.undoCount,
        redo: history.redoCount,
      });

      if (shouldBroadcast) {
        const payload: BroadcastSyncPayload = {
          elements: stamped.elements,
          boardTitle: boardTitleRef.current,
          titleRev: titleRevRef.current,
          titleUpdatedBy: titleUpdatedByRef.current || peerId,
          tombstones: stamped.tombstones,
          tombstoneHorizonRev: stamped.tombstoneHorizonRev,
          tombstoneHorizonAt: stamped.tombstoneHorizonAt,
          boardEpoch: boardEpochRef.current,
          boardEpochCreatedAt: boardEpochCreatedAtRef.current,
          baseRev: computeMaxKnownRev({
            elements: stamped.elements,
            tombstones: stamped.tombstones,
            titleRev: titleRevRef.current,
            tombstoneHorizonRev: stamped.tombstoneHorizonRev,
          }),
          baseTimestamp: baseTimestampRef.current,
          hasLocalEdits: true,
        };
        if (opts?.throttleBroadcast && !opts?.flushBroadcast) {
          broadcastThrottlerRef.current?.schedule(payload);
        } else {
          broadcastThrottlerRef.current?.flushNow(payload);
        }
      }

      return stamped.elements;
    },
    [getHistory]
  );

  const presentPool = useCallback(
    (
      nextIntent: SpatialIntent,
      currentEls: JevElement[],
      pool: PredictedAction[],
      rankOpts: { mergeContext?: boolean } = {}
    ) => {
      if (aiQuietRef.current) return;
      setIntent(nextIntent);
      const storage = getBrowserStorage();
      const profile = loadFeedbackProfile(storage);
      const adapted = rankCandidatesWithFeedback(
        pool.map((action) => ({
          ...action,
          feedbackKeys: action.feedbackKeys ?? [`cat:${action.category}`],
        })),
        profile
      ).map(({ item }) => ({ ...item, probability: undefined }));
      const top3 = selectTopSuggestions(adapted);
      if (top3.length > 0) {
        recordSuggestionShown(
          storage,
          top3.flatMap((p) => p.feedbackKeys ?? [])
        );
      }
      setPredictions(top3);
      setActivePredIdx(NO_OPTION);
      optionsTouchedRef.current = false;
      askWhenSettled(nextIntent, currentEls, adapted, top3, rankOpts);
    },
    [askWhenSettled]
  );

  const refreshPredictions = useCallback(
    (nextIntent: SpatialIntent, currentEls: JevElement[]) =>
      presentPool(nextIntent, currentEls, generateCandidatePool(nextIntent, currentEls)),
    [presentPool]
  );

  useEffect(() => {
    const trigger = new SelectionSuggestTrigger({
      onFire: (key, signal) => showSelectionPredictionsRef.current(key, signal),
    });
    selectionTriggerRef.current = trigger;
    return () => {
      trigger.reset();
      selectionTriggerRef.current = null;
    };
  }, []);

  useEffect(() => {
    selectionTriggerRef.current?.adopt(selectedIds);
  }, [selectedIds]);

  useEffect(() => {
    showSelectionPredictionsRef.current = (key, signal) => {
      if (aiQuietRef.current) return;
      if (signal.aborted || typedModeRef.current) return;
      const els = elementsRef.current;
      const result = buildNextOptions({ elements: els, selectedIds: key.split("|"), viewportCenter: viewportCenterRef.current });
      if (!result) return;
      presentNextOptions(result, els, { signal });
    };
  }, [presentNextOptions]);

  /** Tiered next steps for the node the user just added, applied or renamed. */
  const presentSubjectOptions = useCallback(
    (subjectId: string, els: JevElement[]) => {
      lastTouchedIdRef.current = subjectId;
      const result = buildNextOptions({ elements: els, subjectId, viewportCenter: viewportCenterRef.current });
      if (result) presentNextOptions(result, els);
      else setPredictions([]);
    },
    [presentNextOptions]
  );
  useEffect(() => {
    subjectOptionsRef.current = presentSubjectOptions;
  }, [presentSubjectOptions]);

  /**
   * After a node is added: its connections to the board are offered first (never applied on their own), then
   * the usual next steps. The order is the board's; jev only marks its pick.
   */
  const presentAfterCreate = useCallback(
    (nodeId: string, anchorIds: string[], els: JevElement[], userPicked = false, offerEnter = true) => {
      lastTouchedIdRef.current = nodeId;
      if (aiQuietRef.current) return;
      const result = buildAfterCreateOptions({ elements: els, nodeId, anchorIds, userPicked, viewportCenter: viewportCenterRef.current });
      if (!result) {
        setPredictions([]);
        setIntent(null);
        return;
      }
      // Enter takes the node's first offered connection, once. After that its other connections wait for Tab.
      presentNextOptions(result, els, { highlight: offerEnter ? enterDefaultIndex(result.options, nodeId) : NO_OPTION });
    },
    [presentNextOptions]
  );

  /** Text in the Thought Bar ends a Fork It preview: the user has moved on to naming a node. */
  const changeThought = useCallback(
    (val: string) => {
      if (forkSession && val.trim()) {
        forkAbortRef.current?.abort();
        setForkSession(null);
      }
      setThoughtPrompt(val);
    },
    [forkSession]
  );

  /** A letter typed on the board: append it to the Thought Bar and put the caret there, after the text. */
  const typeIntoThoughtBar = useCallback(
    (letter: string) => {
      const input = thoughtInputRef.current;
      const next = (input?.value ?? "") + letter;
      // Rendered at once: the next key may arrive before a deferred render and would land ahead of this letter.
      flushSync(() => changeThought(next));
      input?.focus({ preventScroll: true });
      input?.setSelectionRange(next.length, next.length);
    },
    [changeThought]
  );

  const dismissPredictions = useCallback(() => {
    const active = predictions[activePredIdx] ?? predictions[0];
    if (active?.feedbackKeys && active.feedbackKeys.length > 0) {
      recordSuggestionRejected(getBrowserStorage(), active.feedbackKeys);
    }
    decideAbortRef.current?.abort();
    setPredictions([]);
    setIntent(null);
    selectionTriggerRef.current?.dismiss();
  }, [predictions, activePredIdx]);

  const handleElementMoved = useCallback(
    (moved: JevElement, dragStart: ElementBox) => {
      const latest = elementsRef.current.map((e) =>
        e.id === moved.id ? moved : e
      );
      pushEditDelta({
        op: "move",
        elementIds: [moved.id],
        labels: [moved.label],
        dx: moved.x - dragStart.x,
        dy: moved.y - dragStart.y,
        summary: `Moved ${moved.label || moved.kind}`,
      });
      selectionTriggerRef.current?.consume();
      const detected = detectMoveIntent(moved, dragStart, latest);
      refreshPredictions(detected, latest);
    },
    [refreshPredictions, pushEditDelta]
  );

  const handleElementCreated = useCallback(
    (created: JevElement) => {
      const latest = elementsRef.current.some((e) => e.id === created.id)
        ? elementsRef.current
        : [...elementsRef.current, created];
      pushEditDelta({
        op: "add",
        elementIds: [created.id],
        labels: [created.label],
        summary: `Added ${created.label || created.kind}`,
      });
      presentAfterCreate(created.id, [], latest);
    },
    [presentAfterCreate, pushEditDelta]
  );

  const handleStrokeCreated = useCallback(
    (stroke: JevElement) => {
      selectionTriggerRef.current?.consume();
      const latest = elementsRef.current.some((e) => e.id === stroke.id)
        ? elementsRef.current
        : [...elementsRef.current, stroke];
      const res = generateStrokePredictions(stroke, latest, { boardTitle: boardTitleRef.current });
      if (!res || aiQuietRef.current) return;
      // The stroke's own reading (connect, shape, lasso) is the order: the feedback profile must not reshuffle it.
      decideAbortRef.current?.abort();
      setIntent(res.intent);
      setPredictions(selectTopSuggestions(res.pool));
      setActivePredIdx(0);
    },
    []
  );

  const handleElementLabelEdited = useCallback(
    (edited: JevElement) => {
      const latest = elementsRef.current.map((e) =>
        e.id === edited.id ? edited : e
      );
      pushEditDelta({
        op: "update",
        elementIds: [edited.id],
        labels: [edited.label],
        summary: `Renamed to ${edited.label || edited.kind}`,
      });
      selectionTriggerRef.current?.consume();
      const wired = latest.some((e) => e.kind === "arrow" && (e.fromId === edited.id || e.toId === edited.id));
      if (wired) presentSubjectOptions(edited.id, latest);
      else presentAfterCreate(edited.id, [], latest);
    },
    [presentSubjectOptions, presentAfterCreate, pushEditDelta]
  );

  const applyAction = useCallback(
    (pred: PredictedAction) => {
      if (pred.feedbackKeys && pred.feedbackKeys.length > 0) {
        recordSuggestionAccepted(getBrowserStorage(), pred.feedbackKeys);
      }

      const nextElsSnapshot = updateElements((prev) => applyPredictionToElements(prev, pred));

      pushEditDelta({
        op: "add",
        elementIds: pred.addElements.map((e) => e.id).slice(0, 8),
        summary: `Applied ${pred.title}`,
      });

      typedModeRef.current = false;
      typedResultRef.current = null;
      typedTextRef.current = "";
      setThoughtPrompt("");
      const nextFocus = pred.focusId
        ? nextElsSnapshot.find((e) => e.id === pred.focusId)
        : undefined;
      const placed = pred.addElements.filter((e) => e.kind !== "arrow");
      if (placed.length > 0) {
        ensureElementsVisible(placed, { top: 104, right: 64, bottom: 255, left: 64 }, { keepBoard: true });
      }
      if (!nextFocus) {
        setPredictions([]);
        setIntent(null);
        return;
      }
      // The selection is the user's alone: a node the app adds or extends is never selected for them, so the
      // handles on the board always mean "the next node lands beside this".
      setInspectorOpen(false);
      selectionTriggerRef.current?.consume();
      // An accepted link: offer what else the node could connect to before moving on to bigger steps. Nothing
      // is highlighted, so pressing Enter again does not wire the node to the rest of the board.
      const acceptedLink = pred.category === "connect" && !pred.tier && placed.length === 0;
      if (acceptedLink) presentAfterCreate(nextFocus.id, [], nextElsSnapshot, false, false);
      else presentSubjectOptions(nextFocus.id, nextElsSnapshot);
    },
    [updateElements, presentSubjectOptions, presentAfterCreate, pushEditDelta, ensureElementsVisible]
  );

  const applyPrediction = useCallback(
    (idx: number) => {
      const pred = predictions[idx];
      if (pred) applyAction(pred);
    },
    [predictions, applyAction]
  );

  /**
   * Enter in the Thought Bar. Always the same, with or without AI or network:
   *   a name            one node with that name, in free space (the ghost shown while typing)
   *   a flow (a -> b)   the nodes and arrows as typed
   * A bigger option is drawn only when the user moved the highlight to it themselves.
   */
  const submitThought = useCallback(
    (prompt: string) => {
      const previewed = typedModeRef.current && typedTextRef.current === prompt ? typedResultRef.current : null;
      const picked = previewed && activePredIdx > 0 ? predictions[activePredIdx] : null;
      if (picked) {
        applyAction(picked);
        return;
      }
      const input = {
        elements: elementsRef.current,
        text: prompt,
        selectedIds: selectedIds,
        viewportCenter: viewportCenterRef.current,
        viewport: viewportWorldRef.current,
      };
      if (isFlowText(prompt)) {
        const flow = (previewed ?? buildNextOptions({ ...input, subjectId: lastTouchedIdRef.current ?? undefined }))?.options[0];
        if (flow && flow.addElements.length > 0) {
          applyAction(flow);
        } else {
          setThoughtPrompt("");
          announceStatus("That flow is already on the board");
        }
        return;
      }
      const plan = previewed?.typed ?? planTypedNode({ ...input, lastFocusedId: lastTouchedIdRef.current });
      if (!plan) return;
      const now = Date.now();
      const node: JevElement = { ...plan.node, createdAt: now, updatedAt: now };
      const next = updateElements((prev) => [...prev, node]);
      pushEditDelta({ op: "add", elementIds: [node.id], labels: [node.label], summary: `Added ${node.label}` });
      typedModeRef.current = false;
      typedResultRef.current = null;
      typedTextRef.current = "";
      setThoughtPrompt("");
      ensureElementsVisible([node], { top: 104, right: 64, bottom: 255, left: 64 }, { keepBoard: true });
      announceStatus(`Added ${node.label}`);
      // The suggestions now on screen are this node's: a click made a moment ago must not replace them.
      setInspectorOpen(false);
      selectionTriggerRef.current?.consume();
      presentAfterCreate(node.id, plan.anchorIds, next, plan.userPicked);
    },
    [
      predictions,
      activePredIdx,
      selectedIds,
      applyAction,
      updateElements,
      pushEditDelta,
      ensureElementsVisible,
      announceStatus,
      presentAfterCreate,
    ]
  );

  /** Draws a whole prompt at once (starter cards; the Thought Bar while AI is quiet), then offers next steps. */
  const drawPromptNow = useCallback(
    (prompt: string) => {
      const current = elementsRef.current;
      const parsed = parsePromptToElements(prompt, current, viewportCenterRef.current);
      if (parsed.elements.length === 0) return;
      const combined = updateElements((prev) => {
        const frames = parsed.elements.filter((e) => e.kind === "frame");
        return [...frames, ...prev, ...parsed.elements.filter((e) => e.kind !== "frame")];
      });
      pushEditDelta({
        op: "prompt",
        elementIds: parsed.elements.map((e) => e.id).slice(0, 8),
        summary: `Drew "${prompt.slice(0, 60)}"`,
      });
      fitToView(parsed.elements, { top: 104, right: 64, bottom: 255, left: 64 });
      const focus = parsed.focusId ? combined.find((e) => e.id === parsed.focusId) : undefined;
      if (focus && !aiQuietRef.current) presentSubjectOptions(focus.id, combined);
    },
    [updateElements, pushEditDelta, fitToView, presentSubjectOptions]
  );

  /** Thought Bar Tab: first complete a partial word ("api" -> "API Gateway"), then cycle the three options. */
  const handleThoughtTab = useCallback(
    (reverse: boolean) => {
      if (!reverse && completion && thoughtPrompt.trim().toLowerCase() !== completion.toLowerCase()) {
        completedRef.current = true;
        setThoughtPrompt(completion);
        return;
      }
      if (predictions.length === 0) return;
      optionsTouchedRef.current = true;
      setActivePredIdx((idx) => stepOption(idx, predictions.length, reverse));
    },
    [thoughtPrompt, predictions.length, completion]
  );

  // --- FORK IT: pressure step, then 3 ghosted takes ---
  const startForkSelection = useCallback(
    (overrideIds?: string[], overrideEls?: JevElement[]) => {
      if (aiQuietRef.current) return;
      const targetIds = overrideIds ?? selectedIds;
      const currentEls = overrideEls ?? elementsRef.current;
      const subgraph = extractSelectedSubgraph(targetIds, currentEls);
      if (!subgraph) return;

      setPredictions([]);
      setIntent(null);
      setInspectorOpen(false);
      setThoughtPrompt("");
      forkAbortRef.current?.abort();

      setForkSession({
        phase: "pressure",
        targetIds,
        sourceElements: currentEls,
        constraint: null,
        subgraph,
        replacedIds: subgraph.replacedIds,
        takes: [],
        activeIndex: 0,
        source: "heuristic",
        model: "heuristic",
        isHeuristic: true,
        latencyMs: 0,
        evaluating: false,
      });
      announceStatus("Fork It: pick a pressure, or skip for the classic takes");
      fitToView([...subgraph.selectedShapes, ...subgraph.selectedFrames], {
        top: 100,
        right: 64,
        bottom: 300,
        left: 64,
      });
    },
    [selectedIds, fitToView, announceStatus]
  );

  const generateForkTakes = useCallback(
    async (constraint: ForkConstraint | null) => {
      if (!forkSession || aiQuietRef.current) return;
      const { targetIds, sourceElements: currentEls } = forkSession;
      const localResult = constraint
        ? buildConstraintForkTakes(targetIds, currentEls, constraint)
        : buildLocalForkTakes(targetIds, currentEls);
      if (!localResult) return;

      const storage = getBrowserStorage();
      const profile = loadFeedbackProfile(storage);
      const orderedTakes = constraint
        ? localResult.takes
        : rankCandidatesWithFeedback(localResult.takes, profile).map(({ item }) => ({
            ...item,
            probability: undefined,
          }));

      recordSuggestionShown(
        storage,
        orderedTakes.flatMap((t) => t.feedbackKeys)
      );

      forkAbortRef.current?.abort();
      const controller = new AbortController();
      forkAbortRef.current = controller;

      setForkSession({
        ...forkSession,
        phase: "takes",
        constraint,
        subgraph: localResult.subgraph,
        replacedIds: localResult.replacedIds,
        takes: orderedTakes,
        activeIndex: 0,
        source: "heuristic",
        model: localResult.model,
        isHeuristic: true,
        latencyMs: 0,
        evaluating: true,
      });

      try {
        const boardGraph = serializeBoardToGraph(currentEls, {
          selectedIds: targetIds,
          recentDeltas: recentDeltasRef.current,
          boardTitle: boardTitleRef.current,
        });
        const preferenceSummary = buildFeedbackPreferenceSummary(profile);

        const res = await postDecide({
          mode: "fork_architecture",
          selectedIds: targetIds,
          boardGraph,
          ...(preferenceSummary ? { preferenceSummary } : {}),
          ...(constraint ? { constraint } : {}),
          candidateTakes: orderedTakes.map((t) => ({
            archetype: t.archetype,
            title: t.title,
            rationale: t.rationale,
            tradeoffTag: t.tradeoffTag,
          })),
        }, { aiQuiet: aiQuietRef.current, signal: controller.signal });
        if (!res || !res.ok || controller.signal.aborted) {
          setForkSession((prev) => (prev ? { ...prev, evaluating: false } : null));
          return;
        }

        const data = (await res.json()) as {
          source: DecideSource;
          model: string;
          isHeuristic?: boolean;
          latencyMs: number;
          takeProbabilities?: Record<string, number> | null;
          takes?: unknown;
        };
        if (controller.signal.aborted) return;

        const isLiveModel =
          (isJevModelSource(data.source) || data.source === "llm-json") &&
          data.isHeuristic !== true;

        if (data.source === "llm-json" && data.takes) {
          const validated = validateForkTakesPayload({ takes: data.takes }, { constraint });
          if (validated.ok) {
            const materialized = validated.takes.map((spec) =>
              materializeForkTake(spec, localResult.subgraph)
            );
            setForkSession((prev) =>
              prev
                ? {
                    ...prev,
                    takes: materialized,
                    activeIndex: 0,
                    source: "llm-json",
                    model: data.model,
                    isHeuristic: false,
                    latencyMs: data.latencyMs,
                    evaluating: false,
                  }
                : null
            );
            return;
          }
        }

        if (isLiveModel && data.takeProbabilities) {
          const probs = data.takeProbabilities;
          setForkSession((prev) => {
            if (!prev) return null;
            const ranked = prev.takes
              .map((t) => ({
                ...t,
                probability:
                  typeof probs[t.archetype] === "number"
                    ? probs[t.archetype]
                    : undefined,
              }))
              .sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0));
            return {
              ...prev,
              takes: ranked,
              activeIndex: 0,
              source: data.source,
              model: data.model,
              isHeuristic: false,
              latencyMs: data.latencyMs,
              evaluating: false,
            };
          });
          return;
        }

        setForkSession((prev) =>
          prev
            ? {
                ...prev,
                source: "heuristic",
                isHeuristic: true,
                latencyMs: data.latencyMs ?? 0,
                evaluating: false,
              }
            : null
        );
      } catch {
        if (!controller.signal.aborted) {
          setForkSession((prev) => (prev ? { ...prev, evaluating: false } : null));
        }
      }
    },
    [forkSession]
  );

  const returnToForkPressure = useCallback(() => {
    forkAbortRef.current?.abort();
    setForkSession((prev) =>
      prev ? { ...prev, phase: "pressure", takes: [], activeIndex: 0, evaluating: false } : null
    );
  }, []);

  const applyForkTake = useCallback(
    (idx: number) => {
      if (!forkSession) return;
      const take = forkSession.takes[idx];
      if (!take) return;

      forkAbortRef.current?.abort();
      recordSuggestionAccepted(getBrowserStorage(), take.feedbackKeys);

      const nextElements = updateElements((prev) =>
        applyForkTakeToBoard(prev, forkSession.replacedIds, take)
      );

      const newShapeIds = take.elements
        .filter((e) => isShapeElement(e) && e.kind !== "frame")
        .map((e) => e.id);

      pushEditDelta({
        op: "fork",
        elementIds: newShapeIds.slice(0, 8),
        summary: `Forked into ${take.title}`,
      });

      setForkSession(null);
      setSelectedIds(newShapeIds);
      setInspectorOpen(false);
      announceStatus(`Swapped in fork take: ${take.title}`);
      fitToView(nextElements, { top: 104, right: 64, bottom: 255, left: 64 });

      const anchor =
        nextElements.find((e) => e.id === take.exitElementId) ??
        nextElements.find((e) => newShapeIds.includes(e.id));
      if (anchor) {
        const followUpIntent: SpatialIntent = {
          kind: "domain_continue",
          headline: `Swapped in "${take.title}"`,
          detail: "⌘Z to undo in one step · Tab + Enter to continue",
          subjectId: anchor.id,
          relatedIds: newShapeIds.slice(0, 4),
          timestamp: Date.now(),
        };
        refreshPredictions(followUpIntent, nextElements);
      }
    },
    [forkSession, updateElements, pushEditDelta, refreshPredictions, fitToView, announceStatus]
  );

  const cancelForkSession = useCallback(() => {
    forkAbortRef.current?.abort();
    if (forkSession) {
      const active =
        forkSession.takes[forkSession.activeIndex] ?? forkSession.takes[0];
      if (active) {
        recordSuggestionRejected(getBrowserStorage(), active.feedbackKeys);
      }
      announceStatus("Cancelled Fork It preview");
    }
    setForkSession(null);
  }, [forkSession, announceStatus]);

  // --- NOTATION MORPH: Reversible In-Place Semantic Morphing ---
  const selectionMorphState = useMemo(
    () => detectSelectionMorphState(selectedIds, elements),
    [selectedIds, elements]
  );

  const handleMorphNotation = useCallback(
    async (
      targetNotation: MorphNotation,
      overrideIds?: string[],
      overrideEls?: JevElement[]
    ) => {
      const targetIds = overrideIds ?? selectedIds;
      const currentEls = overrideEls ?? elementsRef.current;
      const morph = morphSelectionToNotation(
        targetIds,
        currentEls,
        targetNotation
      );
      if (!morph) return;

      morphAbortRef.current?.abort();
      forkAbortRef.current?.abort();
      setForkSession(null);
      setPredictions([]);
      setIntent(null);

      const morphedBoard = updateElements((prev) =>
        applyMorphToBoard(prev, morph)
      );

      setSelectedIds(morph.nextSelectedIds);
      setInspectorOpen(morph.nextSelectedIds.length === 1);
      setMorphIsHeuristic(true);

      const morphedOnly = morphedBoard.filter((e) =>
        morph.nextSelectedIds.includes(e.id) ||
        e.morphMeta?.groupId === morph.groupId
      );
      if (morphedOnly.length >= morphedBoard.length * 0.7) {
        fitToView(morphedBoard, { top: 128, right: 64, bottom: 132, left: 64 });
      } else {
        ensureElementsVisible(morphedOnly, {
          top: 128,
          right: 64,
          bottom: 132,
          left: 64,
        });
      }

      pushEditDelta({
        op: "update",
        elementIds: morph.nextSelectedIds.slice(0, 8),
        summary: `Morphed to ${MORPH_NOTATION_LABELS[targetNotation]}`,
      });
      announceStatus(
        targetNotation === "sketch"
          ? "Restored selection to Sketch notation"
          : `Morphed selection to ${MORPH_NOTATION_LABELS[targetNotation]} notation`
      );

      if (targetNotation === "sketch" || aiQuietRef.current) {
        setMorphEvaluating(false);
        return;
      }

      const controller = new AbortController();
      morphAbortRef.current = controller;
      setMorphEvaluating(true);

      try {
        const boardGraph = serializeBoardToGraph(currentEls, {
          selectedIds: targetIds,
          recentDeltas: recentDeltasRef.current,
          boardTitle: boardTitleRef.current,
        });
        const res = await postDecide({
          mode: "morph_notation",
          targetNotation,
          selectedIds: targetIds,
          boardGraph,
          currentSpec: morph.spec,
        }, { aiQuiet: aiQuietRef.current, signal: controller.signal });
        if (!res || !res.ok || controller.signal.aborted) {
          setMorphEvaluating(false);
          return;
        }
        const data = (await res.json()) as {
          source: "llm-json" | "heuristic";
          model: string;
          isHeuristic?: boolean;
          latencyMs: number;
          spec?: unknown;
        };
        if (controller.signal.aborted) return;

        if (data.source === "llm-json" && data.isHeuristic !== true && data.spec) {
          const validated = validateMorphSemanticSpec(data.spec);
          if (validated.ok) {
            const refined = morphSelectionToNotation(
              morph.nextSelectedIds,
              morphedBoard,
              targetNotation,
              {
                specOverride: constrainMorphSpecToSelection(validated.spec, morph.spec),
                isHeuristic: false,
              }
            );
            if (refined) {
              const refinedBoard = updateElements(
                (prev) => applyMorphToBoard(prev, refined),
                { recordUndo: false }
              );
              setSelectedIds(refined.nextSelectedIds);
              setInspectorOpen(refined.nextSelectedIds.length === 1);
              setMorphIsHeuristic(false);
              ensureElementsVisible(refinedBoard, {
                top: 128,
                right: 64,
                bottom: 132,
                left: 64,
              });
              setTelemetry({
                source: "llm-json",
                model: data.model,
                isHeuristic: false,
                latencyMs: data.latencyMs,
                evaluating: false,
              });
              announceStatus(
                `Refined ${MORPH_NOTATION_LABELS[targetNotation]} notation with AI`
              );
            }
          }
        }
      } catch {
        // Keep deterministic local morph cleanly
      } finally {
        if (!controller.signal.aborted) {
          setMorphEvaluating(false);
        }
      }
    },
    [selectedIds, updateElements, pushEditDelta, fitToView, ensureElementsVisible, announceStatus]
  );

  const packs = usePacks({
    elements,
    elementsRef,
    selectedIds,
    viewport,
    viewportCenterWorld,
    // A ghost preview owns the canvas: pack chips would sit on its edges and labels.
    chipsEnabled: packChips && !aiQuiet && predictions.length === 0,
    updateElements,
    setSelectedIds,
    morph: (notation, ids) => void handleMorphNotation(notation, ids),
    pushEditDelta,
    announceStatus,
    ensureElementsVisible,
  });

  const moves = useMoves({
    elementsRef,
    selectedIds,
    aiQuiet,
    updateElements,
    pushEditDelta,
    announceStatus,
    ensureElementsVisible,
    insertEstimate: (text) => packs.insertStarter("estimate", text),
    promptEstimate: () => {
      setThoughtPrompt("/estimate ");
      window.requestAnimationFrame(() => thoughtInputRef.current?.focus());
    },
    showGhosts: (action, headline, detail) => {
      setTelemetry({ source: "heuristic", model: "rule-based", isHeuristic: true, latencyMs: 0 });
      setIntent({ kind: "prompt_follow_up", headline, detail, relatedIds: [], timestamp: Date.now() });
      setPredictions([action]);
      setActivePredIdx(0);
    },
  });

  const handleUndo = useCallback(() => {
    const history = getHistory();
    const prev = elementsRef.current;
    const target = history.undo();
    if (!target) return;

    const peerId = collabRef.current?.peerId ?? "local";
    const now = Date.now();
    const stamped = applyLocalElementsChange(
      prev,
      target,
      tombstonesRef.current,
      peerId,
      now,
      tombstoneHorizonRevRef.current,
      {
        ttlMs: TOMBSTONE_TTL_MS,
        prevHorizonAt: tombstoneHorizonAtRef.current,
      }
    );
    history.replaceWithoutHistory(stamped.elements);
    elementsRef.current = stamped.elements;
    tombstonesRef.current = stamped.tombstones;
    tombstoneHorizonRevRef.current = stamped.tombstoneHorizonRev;
    tombstoneHorizonAtRef.current = stamped.tombstoneHorizonAt;
    if ((collabRef.current?.getConnectedPeerCount() ?? 0) > 0) {
      baseTimestampRef.current = now;
    }
    hasLocalEditsRef.current = true;
    canPersistRef.current = true;
    remoteGuardRef.current?.markLocalChange(now);

    setElements(stamped.elements);
    forkAbortRef.current?.abort();
    setForkSession(null);
    setHistoryCounts({ undo: history.undoCount, redo: history.redoCount });
    broadcastThrottlerRef.current?.flushNow({
      elements: stamped.elements,
      boardTitle: boardTitleRef.current,
      titleRev: titleRevRef.current,
      titleUpdatedBy: titleUpdatedByRef.current || peerId,
      tombstones: stamped.tombstones,
      tombstoneHorizonRev: stamped.tombstoneHorizonRev,
      tombstoneHorizonAt: stamped.tombstoneHorizonAt,
      boardEpoch: boardEpochRef.current,
      boardEpochCreatedAt: boardEpochCreatedAtRef.current,
      baseRev: computeMaxKnownRev({
        elements: stamped.elements,
        tombstones: stamped.tombstones,
        titleRev: titleRevRef.current,
        tombstoneHorizonRev: stamped.tombstoneHorizonRev,
      }),
      baseTimestamp: baseTimestampRef.current,
      hasLocalEdits: true,
    });
  }, [getHistory]);

  const handleRedo = useCallback(() => {
    const history = getHistory();
    const prev = elementsRef.current;
    const target = history.redo();
    if (!target) return;

    const peerId = collabRef.current?.peerId ?? "local";
    const now = Date.now();
    const stamped = applyLocalElementsChange(
      prev,
      target,
      tombstonesRef.current,
      peerId,
      now,
      tombstoneHorizonRevRef.current,
      {
        ttlMs: TOMBSTONE_TTL_MS,
        prevHorizonAt: tombstoneHorizonAtRef.current,
      }
    );
    history.replaceWithoutHistory(stamped.elements);
    elementsRef.current = stamped.elements;
    tombstonesRef.current = stamped.tombstones;
    tombstoneHorizonRevRef.current = stamped.tombstoneHorizonRev;
    tombstoneHorizonAtRef.current = stamped.tombstoneHorizonAt;
    if ((collabRef.current?.getConnectedPeerCount() ?? 0) > 0) {
      baseTimestampRef.current = now;
    }
    hasLocalEditsRef.current = true;
    canPersistRef.current = true;
    remoteGuardRef.current?.markLocalChange(now);

    setElements(stamped.elements);
    forkAbortRef.current?.abort();
    setForkSession(null);
    setHistoryCounts({ undo: history.undoCount, redo: history.redoCount });
    broadcastThrottlerRef.current?.flushNow({
      elements: stamped.elements,
      boardTitle: boardTitleRef.current,
      titleRev: titleRevRef.current,
      titleUpdatedBy: titleUpdatedByRef.current || peerId,
      tombstones: stamped.tombstones,
      tombstoneHorizonRev: stamped.tombstoneHorizonRev,
      tombstoneHorizonAt: stamped.tombstoneHorizonAt,
      boardEpoch: boardEpochRef.current,
      boardEpochCreatedAt: boardEpochCreatedAtRef.current,
      baseRev: computeMaxKnownRev({
        elements: stamped.elements,
        tombstones: stamped.tombstones,
        titleRev: titleRevRef.current,
        tombstoneHorizonRev: stamped.tombstoneHorizonRev,
      }),
      baseTimestamp: baseTimestampRef.current,
      hasLocalEdits: true,
    });
  }, [getHistory]);

  const applyRestoredSnapshot = useCallback(
    (snapshot: StoredBoardSnapshot, forceBumpRevs = false) => {
      const peerId = collabRef.current?.peerId ?? "local";
      const now = Date.now();
      const prev = elementsRef.current;
      const stamped = applyLocalElementsChange(
        prev,
        snapshot.elements,
        tombstonesRef.current,
        peerId,
        now,
        tombstoneHorizonRevRef.current,
        {
          ttlMs: TOMBSTONE_TTL_MS,
          prevHorizonAt: tombstoneHorizonAtRef.current,
        }
      );

      // When reverting a quarantined incident, bump element revs so rebroadcast overrides any peer-side vandalism
      const restoredElements = forceBumpRevs
        ? stamped.elements.map((el) => ({
            ...el,
            rev: Math.max((el.rev ?? 0) + 1, tombstoneHorizonRevRef.current + 1),
            updatedAt: Math.max(now, (el.updatedAt ?? 0) + 1),
            updatedBy: peerId,
          }))
        : stamped.elements;

      const restoredTitle =
        snapshot.boardTitle !== undefined
          ? snapshot.boardTitle
          : boardTitleRef.current;
      if (forceBumpRevs || restoredTitle !== boardTitleRef.current) {
        titleRevRef.current =
          Math.max(titleRevRef.current, snapshot.titleRev ?? 0) + 1;
        titleUpdatedByRef.current = peerId;
      }

      const history = getHistory();
      history.commitLocal(restoredElements, { recordUndo: true });
      elementsRef.current = restoredElements;
      boardTitleRef.current = restoredTitle;
      tombstonesRef.current = stamped.tombstones;
      tombstoneHorizonRevRef.current = stamped.tombstoneHorizonRev;
      tombstoneHorizonAtRef.current = stamped.tombstoneHorizonAt;
      baseTimestampRef.current = now;
      hasLocalEditsRef.current = true;
      canPersistRef.current = true;
      remoteGuardRef.current?.resetAfterRestore(now);

      setElements(restoredElements);
      setBoardTitle(restoredTitle);
      forkAbortRef.current?.abort();
      setForkSession(null);
      setSelectedIds([]);
      setInspectorOpen(false);
      setHistoryCounts({ undo: history.undoCount, redo: history.redoCount });
      setRecoveryToast(null);

      broadcastThrottlerRef.current?.flushNow({
        elements: restoredElements,
        boardTitle: restoredTitle,
        titleRev: titleRevRef.current,
        titleUpdatedBy: titleUpdatedByRef.current || peerId,
        tombstones: stamped.tombstones,
        tombstoneHorizonRev: stamped.tombstoneHorizonRev,
        tombstoneHorizonAt: stamped.tombstoneHorizonAt,
        boardEpoch: boardEpochRef.current,
        boardEpochCreatedAt: boardEpochCreatedAtRef.current,
        baseRev: computeMaxKnownRev({
          elements: restoredElements,
          tombstones: stamped.tombstones,
          titleRev: titleRevRef.current,
          tombstoneHorizonRev: stamped.tombstoneHorizonRev,
        }),
        baseTimestamp: baseTimestampRef.current,
        hasLocalEdits: true,
      });
    },
    [getHistory]
  );

  const handleRestorePreviousBoard = useCallback(() => {
    const storage =
      typeof window !== "undefined" ? window.localStorage : null;
    const popped = popRecoverySnapshot(storage, roomId);
    const entry = popped.entry ?? recoveryToast?.entry ?? null;
    if (!entry) {
      setRecoveryToast(null);
      return;
    }
    applyRestoredSnapshot(entry.snapshot, false);
    announceStatus("Restored previous board snapshot");
  }, [applyRestoredSnapshot, recoveryToast, roomId, announceStatus]);

  const handleKeepPeerChanges = useCallback(
    (peerId: string) => {
      const guard = remoteGuardRef.current;
      const collab = collabRef.current;
      if (!guard) return;
      const now = Date.now();
      const resolution = guard.resolvePeerIncident(peerId, "keep", now);
      setPeerIncidents(guard.getActiveIncidents());
      if (!resolution || resolution.action !== "keep") return;

      let current: BoardSyncState = {
        elements: elementsRef.current,
        boardTitle: boardTitleRef.current,
        titleRev: titleRevRef.current,
        titleUpdatedBy: titleUpdatedByRef.current || collab?.peerId || "local",
        tombstones: tombstonesRef.current,
        tombstoneHorizonRev: tombstoneHorizonRevRef.current,
        tombstoneHorizonAt: tombstoneHorizonAtRef.current,
        boardEpoch: boardEpochRef.current,
        boardEpochCreatedAt: boardEpochCreatedAtRef.current,
        baseRev: computeMaxKnownRev({
          elements: elementsRef.current,
          tombstones: tombstonesRef.current,
          titleRev: titleRevRef.current,
          tombstoneHorizonRev: tombstoneHorizonRevRef.current,
        }),
        baseTimestamp: baseTimestampRef.current,
        hasLocalEdits: hasLocalEditsRef.current,
      };

      let anyChanged = false;
      for (const entry of resolution.entriesToApply) {
        const merged = mergeRemoteBoardState(
          current,
          entry.payload,
          collab?.peerId ?? "local",
          {
            authoritativePeerId: entry.authoritativePeerId,
            now,
            tombstoneTtlMs: TOMBSTONE_TTL_MS,
          }
        );
        if (merged.changed || merged.adoptedAuthoritative) {
          current = merged.state;
          anyChanged = true;
        }
      }

      if (anyChanged) {
        elementsRef.current = current.elements;
        boardTitleRef.current = current.boardTitle;
        titleRevRef.current = current.titleRev ?? 0;
        titleUpdatedByRef.current = current.titleUpdatedBy ?? "";
        tombstonesRef.current = current.tombstones;
        tombstoneHorizonRevRef.current = current.tombstoneHorizonRev ?? 0;
        tombstoneHorizonAtRef.current = current.tombstoneHorizonAt ?? 0;
        if (current.boardEpoch) boardEpochRef.current = current.boardEpoch;
        if (current.boardEpochCreatedAt !== undefined) {
          boardEpochCreatedAtRef.current = current.boardEpochCreatedAt;
        }
        baseTimestampRef.current = current.baseTimestamp ?? now;
        hasLocalEditsRef.current = current.hasLocalEdits;
        canPersistRef.current = true;

        const history = getHistory();
        history.applyRemote(current.elements, { clearHistory: true });
        remoteSyncGenerationRef.current = history.remoteSyncGeneration;
        setHistoryCounts({ undo: 0, redo: 0 });
        setElements(current.elements);
        setBoardTitle(current.boardTitle);
      }
      announceStatus("Kept peer board changes");
    },
    [getHistory, announceStatus]
  );

  const handleRevertPeerChanges = useCallback(
    (peerId: string) => {
      const guard = remoteGuardRef.current;
      if (!guard) return;
      const now = Date.now();
      const resolution = guard.resolvePeerIncident(peerId, "revert", now);
      setPeerIncidents(guard.getActiveIncidents());
      if (!resolution || resolution.action !== "revert") return;
      applyRestoredSnapshot(resolution.restoreSnapshot, true);
      announceStatus("Reverted peer board changes");
    },
    [applyRestoredSnapshot, announceStatus]
  );

  const handleDeleteIds = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const delSet = new Set(ids);
      updateElements((prev) =>
        prev.filter(
          (e) =>
            !delSet.has(e.id) &&
            (!e.fromId || !delSet.has(e.fromId)) &&
            (!e.toId || !delSet.has(e.toId))
        )
      );
      pushEditDelta({
        op: "delete",
        elementIds: ids.slice(0, 8),
        summary: `Deleted ${ids.length} element${ids.length === 1 ? "" : "s"}`,
      });
      setSelectedIds((curr) => curr.filter((id) => !delSet.has(id)));
      setPredictions([]);
      setForkSession(null);
    },
    [updateElements, pushEditDelta]
  );

  const handleDuplicateIds = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const srcSet = new Set(ids);
      const sources = elementsRef.current.filter((e) => srcSet.has(e.id));
      if (sources.length === 0) return;
      const clones = duplicateElements(
        sources,
        (src) => uid(src.kind === "frame" ? "frm" : "el"),
        { x: 42, y: 42 },
        Date.now()
      );
      updateElements((prev) => [...prev, ...clones]);
      setSelectedIds(clones.map((c) => c.id));
      if (clones.length === 1) {
        handleElementCreated(clones[0]);
      }
    },
    [updateElements, handleElementCreated]
  );

  const handleWrapSelectionInFrame = useCallback(() => {
    const selectedSet = new Set(selectedIds);
    const chosen = elementsRef.current.filter((e) => selectedSet.has(e.id));
    const bounds = computeBounds(chosen);
    if (!bounds) return;
    const id = uid("frm");
    const now = Date.now();
    const frame: JevElement = {
      id,
      kind: "frame",
      x: Math.round(bounds.x - 32),
      y: Math.round(bounds.y - 44),
      width: Math.round(bounds.width + 64),
      height: Math.round(bounds.height + 72),
      label: "Group Zone",
      tone: "slate",
      seed: makeSeed(id),
      createdAt: now,
      updatedAt: now,
    };
    updateElements((prev) => [frame, ...prev]);
    setSelectedIds([id]);
  }, [selectedIds, updateElements]);

  const spawnShapeAtCenter = useCallback(
    (kind: ToolType) => {
      if (!isShapeTool(kind)) return;
      const id = uid(kind === "frame" ? "frm" : "el");
      const placed = shapeFromTool(kind, viewportCenterWorld, viewportCenterWorld, id, Date.now());
      const created: JevElement = placed.behind ? placed.element : { ...placed.element, tone: "cobalt" };
      updateElements((prev) => (placed.behind ? [created, ...prev] : [...prev, created]));
      setSelectedIds([id]);
      handleElementCreated(created);
      setTool("select");
    },
    [viewportCenterWorld, updateElements, handleElementCreated]
  );

  const handlePatchElement = useCallback(
    (id: string, patch: Partial<JevElement>) => {
      updateElements((prev) =>
        prev.map((el) =>
          el.id === id ? { ...el, ...patch, updatedAt: Date.now() } : el
        )
      );
    },
    [updateElements]
  );

  // Global keyboard shortcuts (Tab + Enter predictions, /, tools, Undo/Redo)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;

      if (inInput) return;

      // "/" focuses the Thought Bar
      if (e.key === "/" && !aiQuiet) {
        e.preventDefault();
        thoughtInputRef.current?.focus();
        return;
      }

      // A letter typed anywhere on the board is the start of a node name: it goes to the Thought Bar, and
      // the node will land beside whatever is selected. (Tools are on Alt+letter.)
      if (!aiQuiet && isTypedLetter(e) && !document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')) {
        e.preventDefault();
        typeIntoThoughtBar(e.key);
        return;
      }

      // Alt+letter: Fork It for a selection (Alt+F), otherwise the dock tool with that letter
      if (altLetter(e) === "F" && selectedIds.length > 0 && !aiQuiet) {
        const selSet = new Set(selectedIds);
        if (elementsRef.current.some((el) => selSet.has(el.id) && isShapeElement(el))) {
          e.preventDefault();
          startForkSelection();
          return;
        }
      }
      if (altLetter(e) === "F") {
        // Alt+F is Fork It and nothing else: with nothing to fork it says so instead of doing something different.
        e.preventDefault();
        if (!aiQuiet) announceStatus("Select a node first: Alt+F forks the selection");
        return;
      }
      const shortcutTool = toolForShortcut(e);
      if (shortcutTool) {
        e.preventDefault();
        setTool(shortcutTool);
        return;
      }

      // Fork pressure step: 1-5 pick a pressure, Enter skips to the classic takes, Esc cancels
      if (forkSession?.phase === "pressure") {
        if (e.key === "Escape") {
          e.preventDefault();
          cancelForkSession();
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          void generateForkTakes(null);
          return;
        }
        const pressureIdx = Number(e.key) - 1;
        if (!e.metaKey && !e.ctrlKey && !e.altKey && pressureIdx >= 0 && pressureIdx < FORK_PRESSURES.length) {
          e.preventDefault();
          void generateForkTakes({ pressure: FORK_PRESSURES[pressureIdx] });
          return;
        }
      }

      // Active FORK IT session shortcuts (Tab / Shift+Tab, 1/2/3, Enter, Esc)
      if (forkSession?.phase === "takes") {
        if (e.key === "Tab") {
          e.preventDefault();
          setForkSession((prev) => {
            if (!prev || prev.takes.length === 0) return prev;
            const len = prev.takes.length;
            const nextIdx = e.shiftKey
              ? (prev.activeIndex - 1 + len) % len
              : (prev.activeIndex + 1) % len;
            return { ...prev, activeIndex: nextIdx };
          });
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          applyForkTake(forkSession.activeIndex);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          cancelForkSession();
          return;
        }
        if (
          (e.key === "1" || e.key === "2" || e.key === "3") &&
          !e.metaKey &&
          !e.ctrlKey &&
          !e.altKey
        ) {
          const idx = Number(e.key) - 1;
          if (idx < forkSession.takes.length) {
            e.preventDefault();
            if (forkSession.activeIndex === idx) {
              applyForkTake(idx);
            } else {
              setForkSession((prev) =>
                prev ? { ...prev, activeIndex: idx } : null
              );
            }
            return;
          }
        }
      }

      // Tab cycles through the 3 predictions
      if (e.key === "Tab" && predictions.length > 0) {
        e.preventDefault();
        optionsTouchedRef.current = true;
        setActivePredIdx((idx) => stepOption(idx, predictions.length, e.shiftKey));
        return;
      }

      // Enter materializes the active ghost prediction, or edits title in place when a single item is selected
      if (e.key === "Enter") {
        if (predictions[activePredIdx]) {
          e.preventDefault();
          applyPrediction(activePredIdx);
          return;
        }
        if (selectedIds.length === 1) {
          e.preventDefault();
          startInlineEditRef.current?.(selectedIds[0]);
          return;
        }
      }

      // F2 edits selected item's title in place anytime
      if (e.key === "F2" && selectedIds.length === 1) {
        e.preventDefault();
        startInlineEditRef.current?.(selectedIds[0]);
        return;
      }

      // Left / Right arrows (or [ / ]) cycle color tone on selected element(s)
      if (
        selectedIds.length > 0 &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        (e.key === "ArrowLeft" ||
          e.key === "ArrowRight" ||
          e.key === "[" ||
          e.key === "]")
      ) {
        e.preventDefault();
        const delta = e.key === "ArrowRight" || e.key === "]" ? 1 : -1;
        const primary = elementsRef.current.find((el) => el.id === selectedIds[0]);
        if (primary) {
          const curIdx = ALL_TONES.indexOf(primary.tone);
          const nextTone =
            ALL_TONES[
              ((curIdx === -1 ? 0 : curIdx) + delta + ALL_TONES.length) %
                ALL_TONES.length
            ];
          const selSet = new Set(selectedIds);
          updateElements((prev) =>
            prev.map((el) =>
              selSet.has(el.id)
                ? { ...el, tone: nextTone, updatedAt: Date.now() }
                : el
            )
          );
        }
        return;
      }

      // 1 / 2 / 3 / 4 quick select prediction
      if (
        (e.key === "1" || e.key === "2" || e.key === "3" || e.key === "4") &&
        predictions.length > 0 &&
        !e.metaKey &&
        !e.ctrlKey
      ) {
        const idx = Number(e.key) - 1;
        if (idx < predictions.length) {
          e.preventDefault();
          if (activePredIdx === idx) {
            applyPrediction(idx);
          } else {
            optionsTouchedRef.current = true;
            setActivePredIdx(idx);
          }
          return;
        }
      }

      if (e.key === "Escape") {
        if (predictions.length > 0) {
          dismissPredictions();
        } else {
          setSelectedIds([]);
          setTool("select");
        }
        return;
      }

      const zoomAction = zoomKeyAction(e);
      if (zoomAction) {
        e.preventDefault();
        if (zoomAction === "fit") fitToView();
        else if (zoomAction === "reset") zoomViewportAtCenter(1, true);
        else zoomViewportAtCenter(zoomAction === "in" ? ZOOM_STEP_IN : ZOOM_STEP_OUT);
        return;
      }

      // Select all (⌘A)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelectedIds(elementsRef.current.map((el) => el.id));
        return;
      }

      // Undo / Redo
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        handleRedo();
        return;
      }

      // Duplicate
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "d" &&
        selectedIds.length > 0
      ) {
        e.preventDefault();
        handleDuplicateIds(selectedIds);
        return;
      }

      // Delete
      if (
        (e.key === "Backspace" || e.key === "Delete") &&
        selectedIds.length > 0
      ) {
        e.preventDefault();
        handleDeleteIds(selectedIds);
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    typeIntoThoughtBar,
    forkSession,
    applyForkTake,
    cancelForkSession,
    generateForkTakes,
    startForkSelection,
    predictions,
    activePredIdx,
    applyPrediction,
    dismissPredictions,
    selectedIds,
    handleUndo,
    handleRedo,
    handleDuplicateIds,
    handleDeleteIds,
    updateElements,
    announceStatus,
    fitToView,
    zoomViewportAtCenter,
    aiQuiet,
  ]);

  const handleCursorMove = useCallback(
    (worldPt: Point) => {
      const now = performance.now();
      if (now - lastCursorSentRef.current < 45) return;
      lastCursorSentRef.current = now;
      collabRef.current?.broadcastCursor(
        worldPt.x,
        worldPt.y,
        selectedIds[0] ?? null
      );
    },
    [selectedIds]
  );

  // Export board to standalone pure SVG (no DOM clone, handles, ghosts, or cursors)
  const exportSvg = () => {
    const serialized = exportBoardToSvg(elementsRef.current, {
      theme,
      renderStyle,
      title: boardTitleRef.current,
    });
    const blob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = sanitizeExportFilename(boardTitleRef.current, "svg");
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCanvasSelectIds = useCallback((ids: string[]) => {
    thoughtInputRef.current?.blur();
    if (forkSession) {
      forkAbortRef.current?.abort();
      setForkSession(null);
    }
    setSelectedIds(ids);
    setInspectorOpen(ids.length === 1);
    selectionTriggerRef.current?.select(ids);
  }, [forkSession]);

  const resetToStarter = () => {
    forkAbortRef.current?.abort();
    setForkSession(null);
    const fresh = createStarterElements();
    updateElements(() => fresh);
    setSelectedIds([]);
    setInspectorOpen(false);
    fitToView(fresh);
    const anchor = fresh.find((e) => e.id === "starter_mesh");
    if (anchor) presentSubjectOptions(anchor.id, fresh);
  };

  const loadStarterBoard = (boardId: string) => {
    const board = findStarterBoard(boardId);
    if (!board) return;
    forkAbortRef.current?.abort();
    setForkSession(null);
    setJoiningSharedRoom(false);
    const fresh = board.build();
    updateElements(() => fresh);
    boardTitleRef.current = board.title;
    setBoardTitle(board.title);
    setSelectedIds([]);
    setInspectorOpen(false);
    lastTouchedIdRef.current = null;
    setPredictions([]);
    setIntent(null);
    fitToView(fresh, STARTER_BOARD_FIT_MARGINS);
  };

  const clearBoard = () => {
    forkAbortRef.current?.abort();
    setForkSession(null);
    updateElements(() => []);
    setSelectedIds([]);
    setInspectorOpen(false);
    lastTouchedIdRef.current = null;
    setPredictions([]);
    setIntent(null);
  };

  const startPractice = (promptId: PracticePromptId) => {
    const prompt = getPracticePrompt(promptId);
    if (!prompt) return;
    aiQuietRef.current = true;
    decideAbortRef.current?.abort();
    morphAbortRef.current?.abort();
    setMorphEvaluating(false);
    selectionTriggerRef.current?.dismiss();
    if (elementsRef.current.length > 0) {
      clearBoard();
    } else {
      forkAbortRef.current?.abort();
      setForkSession(null);
      setPredictions([]);
      setIntent(null);
    }
    setThoughtPrompt("");
    setJoiningSharedRoom(false);
    setActiveCommentId(null);
    setPracticePickerOpen(false);
    practiceApi.start(promptId);
    announceStatus(`Practice started: ${prompt.title}. AI is off until Review.`);
  };

  const exitPractice = () => {
    practiceApi.exit();
    setActiveCommentId(null);
    announceStatus("Practice ended");
  };

  const selectReviewComment = (comment: ReviewComment) => {
    setActiveCommentId(comment.id);
    const el = comment.anchorId ? elementsRef.current.find((e) => e.id === comment.anchorId) : undefined;
    if (!el) return;
    setSelectedIds([el.id]);
    setInspectorOpen(false);
    fitToView([el], reviewViewportMargins());
  };

  const practicePrompt = practice ? getPracticePrompt(practice.promptId) : null;

  const handleStarterCheckout = useCallback(() => {
    setJoiningSharedRoom(false);
    boardTitleRef.current = "Checkout System";
    setBoardTitle("Checkout System");
    drawPromptNow("Checkout system with payment gateway, fraud check, and ledger db");
  }, [drawPromptNow]);

  const handleStarterMorphSequence = useCallback(() => {
    setJoiningSharedRoom(false);
    const flow = createRequestFlowStarterElements();
    boardTitleRef.current = "Checkout Request Flow";
    setBoardTitle("Checkout Request Flow");
    const committed = updateElements(() => flow);
    const shapeIds = committed
      .filter((e) => isShapeElement(e) && e.kind !== "frame")
      .map((e) => e.id);
    setSelectedIds(shapeIds);
    void handleMorphNotation("sequence", shapeIds, committed);
  }, [updateElements, handleMorphNotation]);

  const handleStarterForkArchitecture = useCallback(() => {
    setJoiningSharedRoom(false);
    const arch = createForkArchitectureStarterElements();
    boardTitleRef.current = "Orders Architecture";
    setBoardTitle("Orders Architecture");
    const committed = updateElements(() => arch);
    const forkIds = ["arch_orders_api", "arch_orders_db"].filter((id) =>
      committed.some((e) => e.id === id)
    );
    setSelectedIds(forkIds);
    startForkSelection(forkIds, committed);
  }, [updateElements, startForkSelection]);

  const selectedElement = useMemo(
    () =>
      selectedIds.length === 1
        ? elements.find((e) => e.id === selectedIds[0]) ?? null
        : null,
    [elements, selectedIds]
  );

  const multiSelectBarPos = useMemo(() => {
    if (selectedIds.length < 2) return null;
    const set = new Set(selectedIds);
    const groupBounds = computeBounds(elements.filter((e) => set.has(e.id)));
    if (!groupBounds) return null;
    const centerScreenX =
      viewport.x + (groupBounds.x + groupBounds.width / 2) * viewport.zoom;
    const topScreenY = viewport.y + groupBounds.y * viewport.zoom - 68;
    const barW = Math.min(620, screenSize.width - 24);
    const x = Math.max(
      12,
      Math.min(screenSize.width - 12 - barW, Math.round(centerScreenX - barW / 2))
    );
    const minTop = screenSize.width < 640 ? 118 : 76;
    const y = Math.max(
      minTop,
      Math.min(screenSize.height - 230, Math.round(topScreenY))
    );
    return { x, y };
  }, [selectedIds, elements, viewport, screenSize]);

  const activeForkGhost = useMemo<PredictedAction | null>(() => {
    if (!forkSession) return null;
    const take = forkSession.takes[forkSession.activeIndex];
    if (!take) return null;
    return {
      id: take.id,
      title: take.title,
      subtitle: take.rationale,
      category: "structure",
      addElements: take.previewElements,
      removeIds: forkSession.replacedIds,
      focusId: take.exitElementId,
    };
  }, [forkSession]);

  const activePrediction = activeForkGhost ?? predictions[activePredIdx] ?? null;

  // Smoothly auto-fit viewport whenever the active Fork It take changes (e.g. Tab / click / LLM upgrade)
  const activeForkTakeId = forkSession?.takes[forkSession.activeIndex]?.id ?? null;
  const activeForkAnnouncement =
    forkSession && forkSession.takes[forkSession.activeIndex]
      ? `Fork take ${forkSession.activeIndex + 1} of ${forkSession.takes.length}: ${forkSession.takes[forkSession.activeIndex].title}`
      : "";

  useEffect(() => {
    if (!forkSession || !activeForkTakeId) return;
    const take = forkSession.takes[forkSession.activeIndex];
    if (!take) return;
    const rafId = window.requestAnimationFrame(() => {
      fitToView(
        [
          ...forkSession.subgraph.selectedShapes,
          ...forkSession.subgraph.selectedFrames,
          ...take.previewElements,
        ],
        { top: 100, right: 64, bottom: 300, left: 64 }
      );
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [activeForkTakeId, forkSession, fitToView]);

  // Keep Tab ghost suggestions cleanly inside the visible safe viewport
  const activeNonForkPredId = !forkSession
    ? predictions[activePredIdx]?.id ?? null
    : null;
  useEffect(() => {
    if (!activeNonForkPredId || forkSession) return;
    const pred = predictions[activePredIdx];
    if (!pred || pred.addElements.length === 0) return;

    const contextEls: JevElement[] = [...pred.addElements];
    if (intent?.subjectId) {
      const subj = elementsRef.current.find((e) => e.id === intent.subjectId);
      if (subj) contextEls.push(subj);
    }
    for (const p of pred.patchElements ?? []) {
      const target = elementsRef.current.find((e) => e.id === p.id);
      if (target) {
        contextEls.push(target);
        if (target.fromId) {
          const fromEl = elementsRef.current.find((e) => e.id === target.fromId);
          if (fromEl) contextEls.push(fromEl);
        }
      }
    }

    const rafId = window.requestAnimationFrame(() => {
      ensureElementsVisible(contextEls, { top: 100, right: 64, bottom: 255, left: 64 }, { keepBoard: true });
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [
    activeNonForkPredId,
    activePredIdx,
    predictions,
    forkSession,
    intent?.subjectId,
    ensureElementsVisible,
  ]);

  const showFirstRunEmptyState =
    boardReady &&
    elements.length === 0 &&
    !joiningSharedRoom &&
    !thoughtPrompt.trim() &&
    !forkSession &&
    !aiQuiet;

  return (
    <AiQuietContext value={aiQuiet}>
    <div className="relative h-dvh w-full overflow-hidden">
      {/* Screen-reader live status regions for Fork, Morph & recovery feedback */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {liveAnnouncement}
      </div>
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {activeForkAnnouncement}
      </div>

      {/* FULL-BLEED INFINITE CANVAS */}
      <JevCanvas
        svgRef={svgRef}
        startEditRef={startInlineEditRef}
        remoteSyncGenerationRef={remoteSyncGenerationRef}
        elements={elements}
        selectedIds={selectedIds}
        tool={tool}
        theme={theme}
        renderStyle={renderStyle}
        viewport={viewport}
        activePrediction={aiQuiet ? null : activePrediction}
        peers={allPeers}
        forkActive={Boolean(forkSession)}
        onViewportChange={setViewport}
        onSelectIds={handleCanvasSelectIds}
        onToolChange={setTool}
        onElementsChange={updateElements}
        onElementMoved={handleElementMoved}
        onElementCreated={handleElementCreated}
        onStrokeCreated={handleStrokeCreated}
        onElementLabelEdited={handleElementLabelEdited}
        onCursorMove={handleCursorMove}
        onInteractingChange={(active) => {
          if (active) thoughtInputRef.current?.blur();
          setCanvasInteracting(active);
          selectionTriggerRef.current?.setBusy(active);
        }}
      />

      <MoveOverlay
        elements={elements}
        viewport={viewport}
        theme={theme}
        trace={moves.trace}
        highlights={moves.highlights}
        onStop={moves.stopOverlay}
        onTracePath={moves.setTracePath}
      />

      {/* FIRST-RUN 30-SECOND WOW EMPTY STATE (brand-new local boards only) */}
      {showFirstRunEmptyState && (
        <FirstRunEmptyState
          onDrawCheckout={handleStarterCheckout}
          onMorphSequence={handleStarterMorphSequence}
          onForkArchitecture={handleStarterForkArchitecture}
          onPractice={() => setPracticePickerOpen(true)}
          onStarterBoard={loadStarterBoard}
          onDescribe={drawPromptNow}
        />
      )}

      {/* TOP FLOATING STUDIO BAR */}
      <header className="pointer-events-none fixed inset-x-0 top-0 z-20 flex flex-wrap items-center justify-between gap-2 p-3 sm:flex-nowrap sm:items-start sm:p-4">
        {/* Left: Skot Wordmark & Board Menu */}
        <div className="jev-glass pointer-events-auto order-1 flex max-w-[calc(100vw-24px)] shrink-0 items-center gap-2 rounded-2xl px-3 py-1.5 shadow-sm">
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Board menu"
              className="flex min-h-[36px] items-center gap-2 rounded-xl pr-1.5 text-left outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
            >
              <BrandWordmark />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56 rounded-xl">
              <BoardFileMenuItems actions={boardFile} />
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={exportSvg} className="gap-2 text-xs">
                <IconDownload className="h-3.5 w-3.5" aria-hidden="true" />
                Export Diagram (.svg)
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => fitToView()}
                className="gap-2 text-xs"
              >
                <IconFit className="h-3.5 w-3.5" aria-hidden="true" />
                Zoom to Fit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => packs.openPanel()} className="gap-2 text-xs">
                <IconPacks className="h-3.5 w-3.5" aria-hidden="true" />
                Notation Packs
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setPracticePickerOpen(true)}
                className="gap-2 text-xs"
              >
                <IconTarget className="h-3.5 w-3.5" aria-hidden="true" />
                Practice a problem
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={resetToStarter}
                className="gap-2 text-xs"
              >
                <IconReset className="h-3.5 w-3.5" aria-hidden="true" />
                Load Starter Canvas
              </DropdownMenuItem>
              <StarterBoardsMenuItems onPick={loadStarterBoard} />
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={clearBoard}
                className="gap-2 text-xs text-destructive focus:text-destructive"
              >
                <IconTrash className="h-3.5 w-3.5" aria-hidden="true" />
                Blank Sheet
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {boardFile.fileInput}

          <span className="hidden h-4 w-px bg-border sm:block" aria-hidden="true" />

          <input
            value={boardTitle}
            onChange={(e) => {
              const nextTitle = e.target.value;
              const peerId = collabRef.current?.peerId ?? "local";
              boardTitleRef.current = nextTitle;
              titleRevRef.current += 1;
              titleUpdatedByRef.current = peerId;
              hasLocalEditsRef.current = true;
              canPersistRef.current = true;
              remoteGuardRef.current?.markLocalChange(Date.now());
              setBoardTitle(nextTitle);
              broadcastThrottlerRef.current?.schedule({
                elements: elementsRef.current,
                boardTitle: nextTitle,
                titleRev: titleRevRef.current,
                titleUpdatedBy: peerId,
                tombstones: tombstonesRef.current,
                tombstoneHorizonRev: tombstoneHorizonRevRef.current,
                tombstoneHorizonAt: tombstoneHorizonAtRef.current,
                boardEpoch: boardEpochRef.current,
                boardEpochCreatedAt: boardEpochCreatedAtRef.current,
                baseRev: computeMaxKnownRev({
                  elements: elementsRef.current,
                  tombstones: tombstonesRef.current,
                  titleRev: titleRevRef.current,
                  tombstoneHorizonRev: tombstoneHorizonRevRef.current,
                }),
                baseTimestamp: baseTimestampRef.current,
                hasLocalEdits: true,
              });
            }}
            aria-label="Board title"
            className="hidden w-32 rounded-md bg-transparent px-1 py-0.5 text-xs font-semibold text-foreground/90 outline-none focus:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:block"
          />

          <div className="hidden items-center gap-0.5 border-l border-border pl-1.5 lg:flex">
            <button
              type="button"
              onClick={handleUndo}
              disabled={historyCounts.undo === 0}
              aria-label="Undo"
              title="Undo (⌘Z)"
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-35"
            >
              <IconUndo className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={handleRedo}
              disabled={historyCounts.redo === 0}
              aria-label="Redo"
              title="Redo (⌘⇧Z)"
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-35"
            >
              <IconRedo className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Center: Tactile Drafting Tool Dock (scrolls cleanly on 390px mobile) */}
        <nav
          aria-label="Drawing tools"
          className="jev-glass pointer-events-auto order-3 mx-auto flex max-w-[calc(100vw-24px)] items-center gap-0.5 overflow-x-auto rounded-2xl p-1 shadow-sm sm:order-2 sm:mx-0 sm:max-w-[calc(100vw-420px)] lg:max-w-[calc(100vw-480px)]"
        >
          {TOOLS.map((t) => {
            const active = tool === t.id;
            return (
              <Fragment key={t.id}>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label={`${t.label} tool (${t.key})`}
                        aria-pressed={active}
                        onClick={() => setTool(t.id)}
                        onDoubleClick={() => spawnShapeAtCenter(t.id)}
                        className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8 sm:w-8 ${
                          active
                            ? "bg-[#1C2028] text-[#F8F6F1] shadow-xs dark:bg-[#F1EDE4] dark:text-[#11151D]"
                            : "text-foreground/80 hover:bg-secondary hover:text-foreground"
                        }`}
                      />
                    }
                  >
                    <span aria-hidden="true">{t.icon}</span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    {t.label} <span className="ml-1 font-mono opacity-75">{t.key}</span>
                  </TooltipContent>
                </Tooltip>
                {t.id === "ellipse" && <MoreShapesButton tool={tool} onPick={setTool} onOpenPacks={() => packs.openPanel()} />}
              </Fragment>
            );
          })}
        </nav>

        {/* Right: Render Style, Theme & WebRTC P2P */}
        <div className="jev-glass pointer-events-auto order-2 flex max-w-[calc(100vw-24px)] shrink-0 items-center gap-1 rounded-2xl p-1.5 shadow-sm sm:order-3">
          {/* Sketch vs Clean drafting style */}
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-pressed={renderStyle === "sketch"}
                  aria-label={`Drafting style: ${renderStyle === "sketch" ? "Sketch" : "Clean"}. Switch to ${renderStyle === "sketch" ? "Clean" : "Sketch"}`}
                  onClick={() =>
                    setRenderStyle((s) => (s === "sketch" ? "clean" : "sketch"))
                  }
                  className="hidden items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[11.5px] font-medium text-foreground/85 transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex"
                />
              }
            >
              <IconSpark className="h-3.5 w-3.5 text-[#C2411D] dark:text-[#FF8562]" aria-hidden="true" />
              {renderStyle === "sketch" ? "Sketch" : "Clean"}
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              Toggle hand-drawn RoughJS ink vs crisp vector lines
            </TooltipContent>
          </Tooltip>

          {/* Studio Vellum vs Midnight Blueprint */}
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={
                    theme === "vellum"
                      ? "Switch to Midnight Blueprint dark theme"
                      : "Switch to Studio Vellum light theme"
                  }
                  aria-pressed={theme === "midnight"}
                  onClick={() =>
                    setTheme(theme === "vellum" ? "midnight" : "vellum")
                  }
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-foreground/85 transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8 sm:w-8"
                />
              }
            >
              {theme === "vellum" ? (
                <IconMoon className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <IconSun className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              Switch to {theme === "vellum" ? "Midnight Blueprint" : "Studio Vellum"}
            </TooltipContent>
          </Tooltip>

          {/* Live WebRTC P2P Button */}
          {collabEnabled && (
          <button
            type="button"
            aria-label={
              allPeers.length > 0
                ? `Peer-to-peer sharing, ${allPeers.length + 1} peers active`
                : "Open Peer-to-Peer sharing dialog"
            }
            onClick={() => setShareOpen(true)}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl bg-[#0F766E] px-2.5 py-1.5 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-[#0D655E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card sm:min-h-0 sm:px-3"
          >
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-200" />
            </span>
            <IconBroadcast className="hidden h-3.5 w-3.5 sm:block" aria-hidden="true" />
            <span className="sm:hidden">
              {allPeers.length > 0 ? `${allPeers.length + 1}` : "P2P"}
            </span>
            <span className="hidden sm:inline">
              {allPeers.length > 0 ? `P2P · ${allPeers.length + 1}` : "Share P2P"}
            </span>
          </button>
          )}
        </div>
      </header>

      <BoardNoticeToast notice={boardNotice.notice} onDismiss={boardNotice.dismiss} />
      <MoveNoticeToast notice={moves.notice} onDismiss={moves.dismissNotice} />

      {/* PER-SENDER >50% PAUSED CHANGE GUARD & CUMULATIVE RECOVERY TOASTS */}
      {(peerIncidents.length > 0 || recoveryToast) && (
        <div className="fixed left-1/2 top-[116px] z-40 flex w-[calc(100vw-24px)] max-w-[640px] -translate-x-1/2 flex-col items-center gap-2 sm:top-[72px] sm:w-auto">
          {peerIncidents.map((incident) => (
            <div
              key={incident.peerId}
              role="alert"
              aria-live="assertive"
              className="jev-glass flex w-full flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-[#D94E28]/45 px-3.5 py-2 shadow-[0_14px_36px_-12px_rgba(15,23,42,0.32)] sm:w-auto"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#D94E28]/15 text-[#C2411D] dark:text-[#FF8562]">
                  <IconReset className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <div className="flex min-w-0 flex-col">
                  <span className="text-xs font-semibold text-foreground">
                    {incident.peerName} made large changes
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    Paused after {incident.changedCount} of {incident.baselineCount}{" "}
                    {incident.baselineCount === 1 ? "element" : "elements"} changed
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleKeepPeerChanges(incident.peerId)}
                  className="min-h-[36px] shrink-0 rounded-xl border border-border bg-secondary px-3 py-1 text-xs font-semibold text-foreground transition-colors hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0 sm:px-2.5"
                >
                  Keep
                </button>
                <button
                  type="button"
                  onClick={() => handleRevertPeerChanges(incident.peerId)}
                  className="min-h-[36px] shrink-0 rounded-xl bg-[#D94E28] px-3 py-1 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-[#C0411E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0 sm:px-2.5"
                >
                  Revert
                </button>
              </div>
            </div>
          ))}

          {recoveryToast && (
            <div
              role="status"
              aria-live="polite"
              className="jev-glass flex w-full flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-[#D94E28]/30 px-3.5 py-2 shadow-[0_14px_36px_-12px_rgba(15,23,42,0.28)] sm:w-auto sm:flex-nowrap"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#D94E28]/15 text-[#C2411D] dark:text-[#FF8562]">
                  <IconReset className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <span className="min-w-0 text-xs font-medium text-foreground">
                  {recoveryToast.kind === "full_replace"
                    ? `Host replaced the board (${recoveryToast.removedCount} ${recoveryToast.removedCount === 1 ? "element" : "elements"} removed).`
                    : recoveryToast.kind === "bulk_delete"
                      ? `Host removed ${recoveryToast.removedCount} of ${recoveryToast.localCount} elements.`
                      : `Large board update (${recoveryToast.changedCount} of ${recoveryToast.localCount} ${recoveryToast.localCount === 1 ? "element" : "elements"} changed).`}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleRestorePreviousBoard}
                  className="min-h-[36px] shrink-0 rounded-xl bg-[#D94E28] px-3 py-1 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-[#C0411E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0 sm:px-2.5"
                >
                  Restore previous board
                </button>
                <button
                  type="button"
                  onClick={() => setRecoveryToast(null)}
                  aria-label="Dismiss recovery notice"
                  className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0 sm:min-w-0"
                >
                  <IconClose className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* COMPACT, UNOBTRUSIVE FLOATING PILL (colors via ←/→, shape icons, Fork It, in-place rename) */}
      <SelectionInspector
        element={
          inspectorOpen && !thoughtPrompt.trim() && !forkSession
            ? selectedElement
            : null
        }
        allElements={elements}
        ghostElements={aiQuiet ? [] : activePrediction?.addElements ?? []}
        viewport={viewport}
        theme={theme}
        hasPredictionHud={
          Boolean(forkSession) ||
          (!thoughtPrompt.trim() && (Boolean(intent) || predictions.length > 0))
        }
        hiddenWhileInteracting={canvasInteracting}
        activeNotation={selectionMorphState.notation}
        isMorphedGroup={Boolean(selectionMorphState.groupId)}
        morphEvaluating={morphEvaluating}
        morphIsHeuristic={morphIsHeuristic}
        onPatch={handlePatchElement}
        onStartInlineEdit={(id, field) => startInlineEditRef.current?.(id, field)}
        onFork={aiQuiet ? undefined : () => startForkSelection()}
        onMorphNotation={(notation) => void handleMorphNotation(notation)}
        onDuplicate={(id) => handleDuplicateIds([id])}
        onDelete={(id) => handleDeleteIds([id])}
      />

      {packs.panelOpen && (
        <PacksPanel
          pack={packs.panelPack}
          onPackChange={packs.setPanelPack}
          onClose={packs.closePanel}
          onPlace={packs.placeItem}
          onStarter={(command) => packs.insertStarter(command)}
        />
      )}

      {packs.chip && !aiQuiet && !canvasInteracting && !thoughtPrompt.trim() && !forkSession && !morphEvaluating && (
        <PackChip
          key={packs.chip.id}
          chip={packs.chip}
          viewport={viewport}
          screen={screenSize}
          onApply={packs.applyChip}
          onDismiss={packs.dismissChip}
        />
      )}

      {/* MULTI-SELECTION FLOATING ACTION BAR */}
      {multiSelectBarPos && !canvasInteracting && !thoughtPrompt.trim() && !forkSession && (
        <div
          role="toolbar"
          aria-label="Multi-selection actions"
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            transform: `translate3d(${multiSelectBarPos.x}px, ${multiSelectBarPos.y}px, 0)`,
          }}
          className="jev-glass fixed left-0 top-0 z-30 flex max-w-[calc(100vw-24px)] flex-wrap items-center gap-1.5 rounded-2xl px-2.5 py-1.5 shadow-[0_14px_36px_-12px_rgba(15,23,42,0.26)]"
        >
          <span className="px-1 font-mono text-[11px] font-semibold text-foreground">
            {selectedIds.length} selected
          </span>
          <span className="h-3.5 w-px bg-border" aria-hidden="true" />
          <NotationMorphBar
            activeNotation={selectionMorphState.notation}
            isMorphedGroup={Boolean(selectionMorphState.groupId)}
            evaluating={morphEvaluating}
            isHeuristic={morphIsHeuristic}
            onSelectNotation={(notation) => void handleMorphNotation(notation)}
          />
          <span className="h-3.5 w-px bg-border" aria-hidden="true" />
          {!aiQuiet && (
          <button
            type="button"
            onClick={() => startForkSelection()}
            title="Generate 3 architectural takes (Alt+F)"
            className="inline-flex min-h-[36px] items-center gap-1 rounded-lg bg-[#D94E28]/12 px-2.5 py-1 text-[11.5px] font-semibold text-[#C2411D] transition-colors hover:bg-[#D94E28] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-[#FF8562] dark:hover:text-white sm:min-h-0 sm:px-2"
          >
            <IconFork className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Fork it</span>
            <kbd className="ml-0.5 hidden rounded border border-current/25 px-1 font-mono text-[9px] sm:inline">
              Alt F
            </kbd>
          </button>
          )}
          <button
            type="button"
            onClick={handleWrapSelectionInFrame}
            className="inline-flex min-h-[36px] items-center gap-1 rounded-lg px-2.5 py-1 text-[11.5px] font-medium text-foreground/85 transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0 sm:px-2"
          >
            <IconFrame className="h-3.5 w-3.5" aria-hidden="true" />
            Frame
          </button>
          <button
            type="button"
            onClick={() => handleDuplicateIds(selectedIds)}
            className="min-h-[36px] rounded-lg px-2.5 py-1 text-[11.5px] font-medium text-foreground/85 transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0 sm:px-2"
          >
            Copy
          </button>
          <button
            type="button"
            aria-label="Delete selected elements"
            onClick={() => handleDeleteIds(selectedIds)}
            className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg p-1 text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0 sm:min-w-0"
            title="Delete selected"
          >
            <IconTrash className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* BOTTOM FLOATING INTELLIGENCE DOCK: Fork HUD OR PredictionHud stacked cleanly above ThoughtBar */}
      <div className="pointer-events-none fixed inset-x-0 bottom-3 z-20 flex flex-col items-center gap-2 sm:bottom-4">
        {forkSession && !aiQuiet && forkSession.phase === "pressure" ? (
          <ForkPressureStep
            selectedCount={forkSession.subgraph.selectedShapes.length}
            onChoose={(constraint) => void generateForkTakes(constraint)}
            onSkip={() => void generateForkTakes(null)}
            onCancel={cancelForkSession}
          />
        ) : forkSession && !aiQuiet ? (
          <ForkHud
            takes={forkSession.takes}
            activeIndex={forkSession.activeIndex}
            source={forkSession.source}
            model={forkSession.model}
            isHeuristic={forkSession.isHeuristic}
            latencyMs={forkSession.latencyMs}
            evaluating={forkSession.evaluating}
            selectedCount={forkSession.subgraph.selectedShapes.length}
            constraintLabel={forkSession.constraint ? describeForkConstraint(forkSession.constraint) : null}
            onChangePressure={returnToForkPressure}
            onSelectIndex={(idx) =>
              setForkSession((prev) =>
                prev ? { ...prev, activeIndex: idx } : null
              )
            }
            onApply={applyForkTake}
            onCancel={cancelForkSession}
          />
        ) : (
          <div className="flex w-full justify-center">
            <PredictionHud
              intent={intent}
              predictions={predictions}
              activeIndex={activePredIdx}
              telemetry={telemetry}
              onHoverIndex={(idx) => {
                optionsTouchedRef.current = true;
                setActivePredIdx(idx);
              }}
              onApply={applyPrediction}
              onDismiss={dismissPredictions}
              completion={completion}
              typing={thoughtPrompt.trim().length > 0 && !thoughtPrompt.trimStart().startsWith("/")}
            />
          </div>
        )}

        {practice && practicePrompt && (
          <PracticeHud
            prompt={practicePrompt}
            session={practice}
            now={practiceApi.now}
            reviewPending={practiceApi.reviewPending}
            onPause={practiceApi.pause}
            onResume={practiceApi.resume}
            onReview={() => void practiceApi.review()}
            onExit={exitPractice}
          />
        )}

        {!aiQuiet && (
        <ThoughtBar
          inputRef={thoughtInputRef}
          value={thoughtPrompt}
          hasPredictions={Boolean(forkSession) || predictions.length > 0}
          completion={completion}
          onChange={changeThought}
          accessory={<MovesMenu onRun={(move) => moves.run(move)} quiet={aiQuiet} />}
          onSubmit={(prompt) => {
            if (packs.runPaletteCommand(prompt) || moves.runCommand(prompt)) setThoughtPrompt("");
            else submitThought(prompt);
          }}
          onClear={() => setThoughtPrompt("")}
          submitLabel={isFlowText(thoughtPrompt) || activePredIdx > 0 ? "Draw" : "Add"}
          focusOnOpen={Boolean(roomId) && !joiningSharedRoom}
          onEmptyEscape={dismissPredictions}
          onTypedTab={handleThoughtTab}
          onEmptyTab={(reverse) => {
            if (forkSession) {
              setForkSession((prev) => {
                if (!prev || prev.takes.length === 0) return prev;
                const len = prev.takes.length;
                return {
                  ...prev,
                  activeIndex: reverse
                    ? (prev.activeIndex - 1 + len) % len
                    : (prev.activeIndex + 1) % len,
                };
              });
              return;
            }
            optionsTouchedRef.current = true;
            setActivePredIdx((idx) => stepOption(idx, predictions.length, Boolean(reverse)));
          }}
          onEmptyEnter={() => {
            if (forkSession?.phase === "pressure") {
              void generateForkTakes(null);
              return;
            }
            if (forkSession) {
              applyForkTake(forkSession.activeIndex);
              return;
            }
            if (predictions[activePredIdx]) applyPrediction(activePredIdx);
          }}
          onEmptyUndo={handleUndo}
          onEmptyRedo={handleRedo}
        />
        )}
      </div>

      {practice?.phase === "review" && practice.review && practicePrompt && (
        <>
          <PracticePins
            comments={practice.review.comments}
            elements={elements}
            viewport={viewport}
            activeCommentId={activeCommentId}
            onSelectComment={selectReviewComment}
          />
          <PracticeReviewPanel
            review={practice.review}
            prompt={practicePrompt}
            pending={practiceApi.reviewPending}
            activeCommentId={activeCommentId}
            onSelectComment={selectReviewComment}
          />
        </>
      )}

      {/* BOTTOM-RIGHT ZOOM & FIT PILL */}
      <div
        role="group"
        aria-label="Canvas zoom controls"
        className="jev-glass fixed bottom-4 right-4 z-20 hidden items-center gap-1 rounded-xl p-1 shadow-sm lg:flex"
      >
        <button
          type="button"
          onClick={() =>
            zoomViewportAtCenter(ZOOM_STEP_OUT)
          }
          aria-label="Zoom out"
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <IconMinus className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => fitToView()}
          aria-label={`Zoom ${Math.round(viewport.zoom * 100)} percent. Fit diagram to viewport`}
          title="Fit diagram to viewport"
          className="min-w-[48px] rounded-lg px-1.5 py-1 font-mono text-[11px] font-medium text-foreground/85 transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {Math.round(viewport.zoom * 100)}%
        </button>
        <button
          type="button"
          onClick={() =>
            zoomViewportAtCenter(ZOOM_STEP_IN)
          }
          aria-label="Zoom in"
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <IconPlus className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      {/* PEER-TO-PEER WEBRTC COLLABORATION MODAL */}
      <ShareP2PDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        roomId={roomId}
        roomSecret={roomSecret}
        peers={allPeers}
        webrtcPeers={collabStatus.webrtcPeers}
        broadcastPeers={collabStatus.broadcastPeers}
        demoPeerEnabled={demoPeerEnabled}
        onToggleDemoPeer={setDemoPeerEnabled}
        onCreateManualOffer={async () => {
          if (!collabRef.current) throw new Error("Session not ready");
          return collabRef.current.createManualOfferCode();
        }}
        onAcceptManualOffer={async (code) => {
          if (!collabRef.current) throw new Error("Session not ready");
          return collabRef.current.acceptManualOfferAndCreateAnswer(code);
        }}
        onCompleteManualAnswer={async (code) => {
          if (!collabRef.current) throw new Error("Session not ready");
          await collabRef.current.completeManualAnswer(code);
        }}
      />

      <PracticePicker
        open={practicePickerOpen}
        onOpenChange={setPracticePickerOpen}
        boardHasContent={elements.length > 0}
        onStart={startPractice}
      />
    </div>
    </AiQuietContext>
  );
}
