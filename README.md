# Poker Coach MVP (Terminal UI)

Heads-up poker trainer with a low-fi terminal-style web UI, FastAPI backend, optional OpenAI coaching, and a simple HU engine with a rule-based bot.

## Quick Start
1) Python 3.11+ recommended. Create venv and install deps:
   ```
   cd backend
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```
2) Set env vars in `backend/.env` (do NOT commit):
   - `POKER_GOOGLE_CLIENT_ID`, `POKER_GOOGLE_CLIENT_SECRET` (for Google sign-in; optional, dev fallback exists)
   - `POKER_JWT_SECRET`, `POKER_SESSION_SECRET`
   - `POKER_OPENAI_API_KEY` (optional coaching; network required)
   - `POKER_DB_URL` (optional Postgres for persistence, e.g. `postgresql+asyncpg://user:pass@localhost:5432/poker`)
3) Run the server:
   ```
   cd backend
   python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```
4) Open `http://localhost:8000` in a browser. Use `/auth/google/callback` for a dev session if Google creds are absent.

## Notes
- UI: raw HTML + JS, terminal aesthetic; header ASCII logo; side-by-side bot action and coaching boxes.
- Websocket: `/ws/table?token=...` (get token from `/auth/token`). Actions: `fold|check|call|bet|raise|next_hand|ping` with optional `amount` for bet/raise.
- Engine: HU 1/2 blinds, 200bb stacks, rule-based bot; shows bot hand at showdown; Next Hand button appears after summary.
- Coaching: Uses OpenAI if API key + network; otherwise falls back to “disabled” messaging. Decision-state only, no future info.
- Persistence: in-memory by default; optional async Postgres tables (users, sessions, hands, actions, facts) when `POKER_DB_URL` is set.
- PokerKit: Optional hand eval (requires Py 3.11+); falls back to simple tie-breaker if not installed.
