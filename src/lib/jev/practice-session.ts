import { z } from "zod";
import { getPracticePrompt, PRACTICE_PROMPT_IDS, type PracticePromptId } from "@/lib/jev/practice-prompts";
import { RUBRIC_KEYS, type PracticeReview } from "@/lib/jev/practice-review";

export interface PracticeSession {
  promptId: PracticePromptId;
  startedAt: number;
  durationMs: number;
  pausedAt: number | null;
  pausedMs: number;
  /** When Review froze the clock. */
  endedAt: number | null;
  phase: "drawing" | "review";
  review: PracticeReview | null;
}

export function practiceStorageKey(roomId: string): string {
  return `jev_practice_${roomId}`;
}

export function startPracticeSession(promptId: PracticePromptId, now: number): PracticeSession {
  const minutes = getPracticePrompt(promptId)?.minutes ?? 45;
  return { promptId, startedAt: now, durationMs: minutes * 60_000, pausedAt: null, pausedMs: 0, endedAt: null, phase: "drawing", review: null };
}

/** For a board about to be opened: it restores the session as it loads. */
export function storePracticeSession(storage: Pick<Storage, "setItem">, roomId: string, session: PracticeSession): void {
  storage.setItem(practiceStorageKey(roomId), JSON.stringify(session));
}

export function remainingMs(s: PracticeSession, now: number): number {
  const clockNow = s.endedAt ?? s.pausedAt ?? now;
  return Math.max(0, s.durationMs - (clockNow - s.startedAt - s.pausedMs));
}

export function isTimeUp(s: PracticeSession, now: number): boolean {
  return s.phase === "drawing" && remainingMs(s, now) === 0;
}

export function pausePractice(s: PracticeSession, now: number): PracticeSession {
  return s.pausedAt !== null || s.endedAt !== null ? s : { ...s, pausedAt: now };
}

export function resumePractice(s: PracticeSession, now: number): PracticeSession {
  return s.pausedAt === null ? s : { ...s, pausedAt: null, pausedMs: s.pausedMs + (now - s.pausedAt) };
}

export function endPracticeClock(s: PracticeSession, now: number): PracticeSession {
  const resumed = resumePractice(s, now);
  return { ...resumed, phase: "review", endedAt: resumed.endedAt ?? now };
}

export function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

const reviewSchema = z.object({
  promptId: z.enum(PRACTICE_PROMPT_IDS),
  total: z.number().int().min(0).max(10),
  max: z.literal(10),
  lines: z.array(
    z.object({
      key: z.enum(RUBRIC_KEYS),
      score: z.union([z.literal(0), z.literal(1), z.literal(2)]),
      reason: z.string(),
      anchorId: z.string().nullable(),
    })
  ),
  comments: z.array(
    z.object({
      id: z.string(),
      rubric: z.enum(RUBRIC_KEYS).nullable(),
      anchorId: z.string().nullable(),
      text: z.string(),
    })
  ),
  source: z.enum(["rules", "ai"]),
});

const sessionSchema = z.object({
  promptId: z.enum(PRACTICE_PROMPT_IDS),
  startedAt: z.number().finite(),
  durationMs: z.number().int().positive(),
  pausedAt: z.number().finite().nullable(),
  pausedMs: z.number().finite().min(0),
  endedAt: z.number().finite().nullable(),
  phase: z.enum(["drawing", "review"]),
  review: reviewSchema.nullable(),
});

export function parsePracticeSession(raw: string | null): PracticeSession | null {
  if (!raw) return null;
  try {
    const parsed = sessionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
