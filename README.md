# Skot — sketch at the speed of thought

Skot is an Excalidraw-reimagined collaborative architecture & diagramming studio: sketch at the speed of thought. Skot pairs a responsive SVG/`roughjs` infinite canvas with **TypeSafe AI's System One** decision model (`POST https://api.typesafe.ai/v1/systemone`), optional structured-JSON LLM refinement, and honest deterministic local heuristics that work offline with zero API keys.

Internal code still uses the pre-rename `jev` name for folders (`src/lib/jev`, `src/components/jev`), the `/api/jev/decide` route, `JEV_*` environment variables and `jev_*` localStorage keys, so existing deployments and saved boards keep working.

## Key Capabilities

- **Write-to-Draw Instantaneously (`/`)**:
  - **Single-component rapid chaining**: Type `app` → `Enter` → `server` → `Enter` → `postgres` → `Enter` to chain cleanly spaced nodes with thin curved arrows wired automatically.
  - **Natural-language & arrow-shorthand flows**: Type flows like `Client -> Checkout API -> Fraud Check? -> Postgres` or rich architecture descriptions to materialize validated `SemanticGraph` layouts with automatic shape inference (actor ellipses, decision diamonds, database cylinders, zone frames) and HUD-aware viewport auto-fit.
  - **WYSIWYG live ghost & `Tab` switching**: While typing, a live ghost previews exact placement and connections; press `Tab` to cycle candidate slots or connection targets before committing with `Enter`.
- **Fork It! (`F` with selection)**:
  - Select any node, subgraph, or frame and press `F` (or click **Fork it**) to generate **3 genuinely distinct architectural takes** (Queue / Event-Driven, Cache-First / Read Replica, Gateway / Edge-Split, or Circuit-Breaker / Resilient Mesh) with domain-aware naming.
  - Previews render **beside** the dimmed originals (to the right with a `+120px` gap, or below for very wide selections) with automatic viewport framing for crisp before → after comparison.
  - Cycle takes with `Tab` or `1` / `2` / `3`, press `Enter` to swap cleanly in place with external boundary arrows rewired, and press `⌘Z` for single-step Undo.
- **Reversible Notation Morph (`Sketch` · `Sequence` · `Flowchart` · `State` · `ER`)**:
  - Morph any selected diagram in place between **Sketch**, **Sequence** (actors, lifelines, ordered messages), **Flowchart** (start/process/decision/end branches), **State** (states and event transitions), and **ER** (typed entity cards and cardinality relations).
  - Return to **Sketch** at any time without losing your original geometry, edits, or external connections — persisted across Undo/Redo, `localStorage`, and WebRTC P2P sync.
- **3-Option `Tab` + `Enter` Predictive Drafting**:
  - After moving, creating, or renaming elements, Skot detects spatial intent and offers 3 ghost-previewable next moves ranked by TypeSafe System One (or local adaptive feedback when heuristic).
- **First-Run Studio Starters & Adaptive Viewport**:
  - Brand-new local sheets open to an inviting empty canvas with 3 one-click starter flows (**Draw a checkout system**, **Morph to sequence**, **Fork my architecture**) while leaving saved `localStorage` rooms and shared collaboration links untouched.
  - HUD-aware `computeViewportFit` / `computeViewportEnsureVisible` framing keeps diagrams, morphs, forks, and ghosts cleanly inside desktop and mobile viewports.
- **Peer-to-Peer WebRTC Collaboration & Vandalism Recovery**:
  - Real `RTCPeerConnection` + `RTCDataChannel` state sync and live cursors via ephemeral `/api/signal`, automatic same-origin `BroadcastChannel` multi-tab sync, and a zero-server manual SDP Offer/Answer flow.
  - **1-click edit/vandalism recovery & creator reclaim**: Includes a per-sender `>50%` change guard (pauses suspicious bulk edits/deletes with **Keep** / **Revert** controls), a rolling recovery snapshot buffer with 1-click **Restore previous board**, small-board protection, and constant-time creator authority reclaim across reconnects.
- **Pure-SVG Export & Studio Craft**:
  - Export clean, standalone `.svg` files directly from the board model (no DOM clones, selection handles, ghost overlays, or peer cursors).
  - Toggle **Sketch** (`roughjs` hand-drawn ink) vs. **Clean** vectors and **Studio Vellum** (light) vs. **Midnight Blueprint** (dark).

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `/` | Focus the Write-to-Draw Thought Bar |
| `F` | Trigger **Fork It!** when shape(s) are selected (or Zone Frame tool when empty) |
| `Tab` / `Shift+Tab` | Cycle placement slots (while typing), Fork takes, or Top 3 predictions |
| `Enter` | Commit Thought Bar, swap active Fork take, apply ghost prediction, or edit selected label |
| `1` / `2` / `3` | Jump to (or apply) Fork take or prediction option 1, 2, or 3 |
| `Esc` | Cancel Fork It!, dismiss ghost predictions, clear Thought Bar, or deselect |
| `←` / `→` or `[` / `]` | Cycle color tone on selected element(s) |
| `F2` | Edit selected element title in place |
| `S`, `H`, `R`, `D`, `O`, `C`, `A`, `P`, `T` | Select, Hand pan, Box, Decision, Database, Actor, Smart Arrow, Ink Pen, Text Note |
| `Space + Drag` | Quick canvas pan |
| `⌘A` / `Ctrl+A` | Select all elements |
| `⌘D` / `Ctrl+D` | Duplicate selected elements |
| `⌘Z` / `⌘⇧Z` (`Ctrl+Z` / `Ctrl+Y`) | Undo / Redo |

## Tech Stack & Architecture

- **Framework**: Next.js 16.4.6 (App Router, Turbopack), React 19.3, TypeScript 5 (strict), Tailwind CSS v4, shadcn/ui (`@base-ui/react`), an original inline-SVG icon set (`src/brand/icons`, contact sheet at `/icons`), `roughjs`, Zod 4, Vitest 5.
- **UI Components (`src/components/jev/`)**:
  - `JevWorkspace.tsx` — Workspace state, keyboard orchestration, HUD-aware viewport framing, responsive mobile/desktop studio toolbar, `localStorage` persistence, recovery/quarantine banners, and P2P session lifecycle.
  - `JevCanvas.tsx` — Infinite SVG/`roughjs` canvas, marquee multi-selection, drag/resize/edge-connect handles, dimmed-original Fork before/after rendering, ghost preview layer, and in-place label editor.
  - `FirstRunEmptyState.tsx` — Editorial first-run canvas with 3 one-click studio flows and keyboard hint row.
  - `ForkHud.tsx`, `NotationMorphBar.tsx`, `SelectionInspector.tsx`, `PredictionHud.tsx`, `ThoughtBar.tsx`, `ShareP2PDialog.tsx`.
- **Core Engines (`src/lib/jev/`)**:
  - `semantic-graph.ts`, `diagram-parser.ts`, `placement-engine.ts` — Validated `SemanticGraph` schema, local & LLM diagram generation, and collision-free spatial placement.
  - `fork-engine.ts` — Subgraph extraction, domain-aware heuristic naming, beside-placed ghost previews, and atomic in-place swap with external arrow rewiring.
  - `notation-morph.ts` — Lossless reversible morphing across `Sketch`, `Sequence`, `Flowchart`, `State`, and `ER`.
  - `geometry.ts`, `popover-placement.ts`, `rough-paths.ts`, `svg-export.ts`, `colors.ts`, `templates.ts`.
  - `webrtc-collab.ts`, `board-sync.ts`, `board-history.ts`, `recovery-buffer.ts`, `remote-guard.ts`, `room-auth.ts`, `sync-validation.ts`.
  - `typesafe-client.ts`, `llm-graph-client.ts`, `feedback-store.ts`, `intent-engine.ts`, `prediction-engine.ts`.
- **API Routes & Server Hardening (`src/app/api/`, `src/lib/server/`, `src/proxy.ts`)**:
  - `/api/jev/decide` — Unified hardened decision endpoint (`rank_actions`, `classify_prompt`, `place_diagram`, `generate_graph`, `fork_architecture`, `morph_notation`).
  - `/api/signal` — Authenticated ephemeral WebRTC signaling relay with room secret verification, peer tokens, and constant-time creator reclaim.
  - `/api/ice-config` — Runtime STUN/TURN ICE server configuration minting short-lived HMAC-SHA1 coturn credentials for authenticated peers only.
  - `/api/health` — Readiness endpoint (`Cache-Control: no-store`).

## Environment Variables

Copy `.env.example` to `.env.local` for local overrides. Skot runs cleanly with zero API keys in honest `"Heuristic"` mode.

| Variable | Required | Description |
| --- | --- | --- |
| `TRUST_PROXY` | **Required in prod** | Client IP resolution mode for rate limits & room caps: `cloudflare` (trusts `CF-Connecting-IP` only, ignores `X-Forwarded-For`) or `none` (ignores proxy headers; requires direct peer IP or `ALLOW_SINGLE_USER_LOCAL=1`). Production API routes fail fast with `503` when unset. |
| `ALLOW_SINGLE_USER_LOCAL` | Optional | Set to `1` alongside `TRUST_PROXY=none` only for single-user local production runs without a reverse proxy. |
| `TURN_SHARED_SECRET` | Optional | Coturn `static-auth-secret` (`use-auth-secret`) used to mint short-lived (~10 min TTL) HMAC-SHA1 TURN credentials exclusively for authenticated signaling peers. |
| `TURN_URLS` | Optional | Comma-separated `turn:` / `turns:` / `stun:` URLs served alongside default STUN via `GET /api/ice-config` when `TURN_SHARED_SECRET` is configured and the caller is authenticated. |
| `ICE_SERVERS_JSON` | Optional | Custom JSON array of STUN `RTCIceServer` objects for `GET /api/ice-config` (static TURN credentials are ignored). |
| `SITE_URL` | Optional | Absolute origin used for link-preview URLs (`og:image`, `twitter:image`), e.g. `https://skot.lightslips.ai`. When unset, the request host is used, then `https://skot.lightslips.ai`. |
| `AI_GATEWAY_API_KEY` | Optional (the one key) | Vercel AI Gateway key, the single credential Skot needs. It runs jev decisions (ranking, prompt classification, placement, and the jev paths of graph generation and Fork It!) through the Gateway's TypeSafe-compatible API (`POST https://ai-gateway.vercel.sh/typesafe/v1/systemone`, model `typesafe-ai/jev`) and generation (graph generation, Fork It! takes, Notation Morph refinement, context-named next-node suggestions) through `POST https://ai-gateway.vercel.sh/v1/chat/completions`. On Vercel you can leave it unset: the deployment's OIDC token (`x-vercel-oidc-token`, read per request) authenticates instead. Locally, `vercel env pull` writes `VERCEL_OIDC_TOKEN`, which is used when no key is set. Responses report their source, e.g. `"source":"gateway:typesafe-ai/jev"`; a jev ranking that falls back carries a secret-free `degradedReason` such as `gateway:UPSTREAM_HTTP_ERROR:401`. With no credential, Skot falls back honestly to local heuristics. |
| `AI_GATEWAY_MODEL` | Optional | Overrides the AI Gateway model for every route. Defaults per route (`LLM_ROUTE_MODELS` in `src/lib/jev/llm-graph-client.ts`, pinned by its unit test): `anthropic/claude-haiku-5.5` for context suggestions, practice review, SD moves, morph and Fork; `openai/gpt-4.1-mini` for next-action options and graph generation. Every call sends `reasoning_effort: "none"`. |
| `AI_GATEWAY_MODEL_<ROUTE>` | Optional | Overrides one route and wins over `AI_GATEWAY_MODEL`; `<ROUTE>` is `CONTEXT`, `PRACTICE_REVIEW`, `MOVES`, `MORPH`, `NEXT_OPTIONS`, `FORK` or `GENERATE_GRAPH`. |
| `JEV_MODEL` | Optional | AI Gateway jev model id (default `typesafe-ai/jev`; pin e.g. `typesafe-ai/jev-1.14.0`). |
| `TYPESAFE_API_KEY` | Optional | Direct TypeSafe AI key (`POST https://api.typesafe.ai/v1/systemone`), used for jev decisions only when no AI Gateway credential is available. Responses then report `"source":"typesafe-jev"`. |
| `JEV_UPSTREAM_MAX_PER_MINUTE` | Optional | Global per-minute upstream call cap for `/api/jev/decide`, shared by all jev and generation calls (default `120`). Exhausted budgets fall back cleanly to `"Heuristic"` mode. |
| `JEV_UPSTREAM_MAX_PER_DAY` | Optional | Global per-day upstream call cap for `/api/jev/decide`, shared by all jev and generation calls (default `5000`). Exhausted budgets fall back cleanly to `"Heuristic"` mode. |

## Security Model

- **Strict CSP & Security Headers (`src/proxy.ts`, `next.config.ts`)**: Per-request cryptographic CSP nonces (`script-src 'self' 'nonce-...' 'strict-dynamic'`, no `'unsafe-inline'` in `script-src`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, and `Permissions-Policy`.
- **Room Authentication & Secret Hygiene**: Boards live at `/b/<id>` with `>=128-bit` IDs. The secret stays in the browser, or in the fragment of a self-hosted share link (`/b/<id>#k=<secret>`; older `#room=<id>&k=<secret>` links still open), and never appears in HTTP request URLs or referrer logs. Room secrets, peer tokens, and creator reclaim secrets are verified in constant time.
- **Authenticated Short-Lived TURN**: Static TURN credentials are never exposed. `GET /api/ice-config` mints ~10-minute HMAC-SHA1 credentials only after verifying `room`, `x-room-secret`, and `x-peer-token` against the active signaling store; unauthenticated callers receive STUN-only.
- **API Hardening & Honest Fallbacks**: All API inputs pass strict Zod validation, prototype-pollution key checks (`__proto__`/`constructor`/`prototype`), streaming UTF-8 byte limits, per-IP sliding-window rate limits, global upstream spend caps, and `Cache-Control: no-store`. Heuristic responses always declare `isHeuristic: true` and never fabricate AI probabilities.
- **Collaborative Integrity**: Per-sender `>50%` change quarantine, small-board protection, tombstone horizon clamping, epoch resync, and a rolling client recovery ring protect boards against accidental wipes or vandalism.

## Development, Tests & Production Build

```bash
# Install dependencies
pnpm install

# Start development server (http://localhost:3000)
pnpm dev

# Run unit & API security tests (Vitest)
pnpm test

# Generate Next.js route types & run strict TypeScript check
pnpm typecheck

# Run ESLint
pnpm run lint

# Production build & local single-user production run
TRUST_PROXY=none pnpm build
TRUST_PROXY=none ALLOW_SINGLE_USER_LOCAL=1 pnpm start -p 4311
```

### Continuous Integration

GitHub Actions (`.github/workflows/ci.yml`) runs on every pull request and push to `main` on Node 22 with `contents: read` permissions:

- **Secret Scan**: Full-history `gitleaks` scan (`fetch-depth: 0`).
- **Verify**: `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm run lint`, `pnpm test`, and `pnpm run build`.

### Deploy gate: push to `skot-launch`, never to `main`

Vercel deploys `main`. Only the **Gate** workflow (`.github/workflows/gate.yml`) moves `main`: on every push to
`skot-launch` it runs lint, typecheck, unit tests, `next build`, then `next start` plus one end-to-end check per
feature (`verify/features.yml`), and fast-forwards `main` only when all pass. **Post-deploy verify** re-checks
production after each deploy and opens a `prod-verify` issue on failure. Details: [`verify/README.md`](verify/README.md).

> **Deployment note**: Out of the box, `/api/signal` uses an in-memory room relay (single-instance dev/demo scope) and boards persist per room in browser `localStorage`. Multi-instance production deployments should back `/api/signal` with shared state (e.g. Redis/Upstash or WebSockets) and configure `TURN_URLS` + `TURN_SHARED_SECRET` alongside `TRUST_PROXY`.
