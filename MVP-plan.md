# Poker Coaching MVP Plan

Goals: heads-up poker trainer that gives immediate feedback per action, persists hands, and remains affordable (minimal LLM usage, deterministic calculations first; gpt-5-nano with tight token caps).

## Product Scope
- Heads-up cash-game style flow: 1/2 blinds, 200bb stacks, zero rake.
- One human vs bot; bot acts fast with rule-based strategy and mild randomness to avoid predictability.
- UI is intentionally low-fi: raw HTML/ASCII-inspired table, minimal JS, readable and responsive.
- After every player decision, show structured fact block and short LLM coaching note in a side panel.
- Track sessions, hands, and key stats for analytics.

## User Flows
- Auth with Google → lobby/home → “Start session” (creates game + websocket).
- Table view: cards/chips, action buttons (fold/call/raise with sizing presets), bet input, stack/pot info, side panel for facts + coaching.
- In-hand loop: receive state via websocket → user acts → optimistic UI update → server responds with bot action + new state → rinse until showdown/termination.
- Post-hand recap: show action history, fact block snapshot, LLM coaching summary; allow “Next hand” without leaving session.

## Frontend (Raw HTML + Minimal JS)
- Delivery: static HTML/CSS/JS served by FastAPI; no framework. Keep bundle tiny; inline critical styles and use a monospace palette for the ASCII look.
- Auth: “Sign in with Google” link hits backend OAuth; backend sets session cookie; frontend fetches a short-lived backend-signed JWT for websocket use.
- Layout: single-page shell with sections: Session header, ASCII table (pots/stacks/cards rendered textually), Action rail (buttons + numeric input), Side panel (Facts/Coaching/History tabs), notifications/footer.
- Rendering: semantic HTML (no canvas); monospace + ASCII borders/dividers for table; responsive tweaks so action rail stays visible on mobile (sticky bottom bar).
- State: vanilla JS store; fetch session/token; manage websocket lifecycle; optimistic updates; small render helpers to patch DOM nodes.
- WebSocket handling: native `WebSocket` with backoff reconnect, heartbeat/ping, in-flight action lock, message queue for ordered processing.
- Accessibility/UX: keyboard shortcuts for fold/call/raise/send bet; focus styles; high-contrast theme even in ASCII mode.
- Performance: debounce bet input; avoid reflow-heavy DOM work; cache last facts/coaching to reduce LLM calls.

## Backend (FastAPI + WebSockets)
- Services:
  - Auth: exchange Google token for app session/JWT; issue signed short-lived ws token; validate on ws handshake.
  - Table lifecycle: create session, seat user, start hand, manage blinds (1/2), turn engine (PokerKit), showdown/settlement.
  - Bot opponent: HU rule-based strategy with mild variability; must act quickly and deterministically where possible.
  - Deterministic facts: compute pot odds, SPR, bet size % pot, required equity to continue, implied odds approximation, stack depths, position.
  - LLM coaching: after each player action, send state + facts to OpenAI with strict schema (JSON mode); include cost guardrails (tight token caps, stop conditions, daily quota).
  - Persistence: Postgres for users, sessions, hands, actions, fact blocks, coaching responses; store raw game state for reproducibility.
  - Rate limiting: per-account (e.g., requests/min + LLM calls/day); return structured errors and surface in UI.
- Modules / layers:
  - `api`: REST endpoints (`/auth/google/callback`, `/sessions`, `/hands/{id}`, `/analytics`) and websocket endpoint `/ws/table`.
  - `services`: auth, table manager, bot, facts, coaching, analytics, rate limiter.
  - `data`: repositories for Postgres (async SQLAlchemy/psycopg).
  - `models`: Pydantic schemas for messages (game state, actions, facts, coaching, errors).
- WebSocket protocol (draft):
  - Client → server: `join_session`, `player_action` (type, amount), `ack` for receipt, `ping`.
  - Server → client: `session_joined`, `state_update` (full table snapshot), `bot_action`, `facts_update`, `coaching_update`, `hand_summary`, `error`, `rate_limit`, `pong`.
- Error handling: fail-safe defaults (fold) on timeouts; explicit error payloads; replay-on-reconnect with last hand state.

## Data Model (conceptual)
- Users: id, google_id, display_name, email, created_at, rate_limit tier.
- Sessions: id, user_id, started_at, ended_at, hands_played, settings (stakes/blinds).
- Hands: id, session_id, start/end timestamps, final pot, winner, rake (always zero), board, hole cards (stored raw), result delta.
- Actions: id, hand_id, actor (user/bot), street, action_type, amount, stack_before, pot_before, timestamp.
- Facts: hand_id + street + action_index, pot odds, SPR, bet_pct_pot, required_equity, etc. (structured JSON).
- Coaching: hand_id + action_index, prompt hash, model, tokens, response JSON.
- Analytics: daily rollups for sessions/hands; store event stream for “hands per session”, “avg coaching per hand”.

## LLM Request Contract (outline)
- Inputs: game state snapshot (pot, stacks, positions, cards as known, action history), fact block, user action, bot profile, chart recommendation if applicable.
- Output schema (JSON): `assessment` (short), `leak` (category/tag), `advice` (actionable), `risk` (low/med/high), `confidence`, `suggested_next_action`, `token_usage`.
- Guardrails: strict JSON mode; temperature low; input capped (~400 tokens) and output capped (~200 tokens); truncate history to stay cheap; retry with smaller context if limit hit; per-user daily cap aligned to ~$0.05/day.

## Deterministic Fact Block (HU)
- Pot odds, SPR, effective stacks, bet size as % pot, required equity to call, min-raise sizing, position (IP/OOP), current street, board texture flags (paired/flush/straight draws), blockers (rank/suit), previous aggression.
- Keep calculations independent of LLM; include versioning for schema to simplify future changes.

## Preflop Charts (Heads-Up)
- Deferred for MVP; later: store HU SB/BB charts as static JSON, serve via CDN/static endpoint, cached on client.

## Rate Limiting
- Per user: REST rate (e.g., 60/min), websocket action rate (actions/min), LLM coaching quota (per day) targeting ~$0.05/user/day.
- Hard cap LLM calls per day and enforce token ceilings per call to stay within budget.
- Responses include `retry_after` and `limits` to render UX hints; logging for analytics.

## Analytics & Logging
- Counters: sessions started/completed, hands played, coaching calls, rate-limit hits, reconnects.
- Events: `session_created`, `hand_started`, `action_taken`, `coaching_requested`, `coaching_delivered`, `hand_finished`.
- Dashboards: daily/weekly rollups; average hands per session; avg tokens per hand; cost per user.


## Implementation Plan (grouped into Codex PRs)
- PR1: Backend auth + static shell
  - FastAPI app skeleton; Google OAuth endpoints; session cookie and short-lived ws JWT minting/verification.
  - Serve static HTML/CSS/JS shell with ASCII layout scaffolding; config/env plumbing for secrets.

- PR2: Table engine + protocol
  - Integrate PokerKit for HU 1/2 blinds, 200bb stacks, zero rake; implement table lifecycle (start hand, blinds, actions, showdown, settlement).
  - Define message schema; implement websocket handlers for join/session, player_action, bot_action, state_update, hand_summary, error, ping/pong; add reconnect state replay.

- PR3: Bot + deterministic facts
  - Rule-based HU bot with mild randomness; deterministic fact block service (pot odds, SPR, bet % pot, required equity, position, board texture flags) with versioned schema.

- PR5: Persistence + analytics
  - Async Postgres layer (users/sessions/hands/actions/facts/coaching); event logging for sessions/hands/coaching/rate-limit hits; daily rollups.

- PR6: Frontend ASCII UI polish
  - Vanilla JS state/render functions for table/action rail/side panel; keyboard shortcuts; sticky mobile action rail; toasts for rate limit/reconnect; accessibility pass (focus/high contrast).

- PR7: LLM coaching layer
  - OpenAI gpt-5-nano wrapper with strict JSON schema, low temp, ~400 in/~200 out tokens; per-call timeout/retry; enforce ~$0.05/day/user quota and token ceilings; log prompt/response metadata.

- PR8: Rate limiting + guardrails
  - Per-user REST/ws action limits and LLM quota enforcement; structured `rate_limit` payloads with `retry_after`; fail-safe defaults on timeout.
  
- PR9: Testing + CI
  - Simulated hand loop tests (bot vs bot) for engine; ws contract tests with mocks; fact block unit tests; LLM schema contract with mocked responses; load test ws reconnect/action rate; minimal CI workflow to run tests.
