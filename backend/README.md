# Backend (PR1 skeleton)

FastAPI skeleton with Google OAuth endpoints, session cookie, short-lived websocket JWT minting, and a low-fi ASCII HTML shell served statically.

## Setup
1) `python3 -m venv .venv && source .venv/bin/activate`
2) `pip install -r backend/requirements.txt` (re-run after changing deps; no Rust needed with pinned pydantic v1)
3) Configure env (place a `.env` in `backend/` or export vars):
```
POKER_GOOGLE_CLIENT_ID=your-client-id
POKER_GOOGLE_CLIENT_SECRET=your-client-secret
POKER_GOOGLE_REDIRECT_URI=http://localhost:8000/auth/google/callback
POKER_JWT_SECRET=super-secret
POKER_SESSION_SECRET=another-secret
POKER_ALLOWED_ORIGIN=http://localhost:8000
POKER_ENVIRONMENT=dev
POKER_DB_URL=postgresql+asyncpg://user:pass@localhost:5432/poker   # optional
POKER_OPENAI_API_KEY=your-openai-key                              # optional coaching
```
4) Run from `backend/`: `cd backend && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`

## Notes
- Dev fallback: if Google secrets are missing, `/auth/google/callback` issues a mock session for quick testing.
 - Static UI: served at `/` (raw HTML, terminal-style, no CSS), assets under `/static/...`.
- Tokens: `/auth/token` mints a short-lived JWT for future websocket use; `/auth/me` inspects the session cookie; `/auth/logout` clears it.
- Websocket: `/ws/table?token=...` (token from `/auth/token`). Messages accept `{ "action": "<fold|call|check|bet|raise|next_hand|ping>", "amount": <int> }`. Server emits `session_joined`, `state_update`, `facts_update`, `hand_summary`, `error`, `pong`. TableManager is HU (1/2 blinds, 200 stacks) with a rule-based bot; showdowns use PokerKit evaluation when installed (Py 3.11+), otherwise fall back to a simple tie-breaker. Deterministic fact block includes pot odds, SPR, bet % pot, required equity, position, and board texture flags. Persistence: in-memory by default; if `POKER_DB_URL` is set, async SQLAlchemy tables are created (users, sessions, hands, actions, facts) and writes are fire-and-forget.
- PokerKit requires Python >= 3.11. Ensure your venv uses 3.11+, then `pip install -r backend/requirements.txt` (now pinned to a 0.6.x version available on PyPI) to get PokerKit for showdown evals.
- To test quickly: visit `/auth/google/callback` to get a dev session (when secrets are missing), then click buttons in the ASCII UI to drive actions; websocket will auto start a new hand after a summary.
