from datetime import timedelta
from pathlib import Path
from typing import Optional

import httpx
from fastapi import (
    Depends,
    FastAPI,
    HTTPException,
    Query,
    Request,
    Response,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .config import settings
from .db import get_engine, get_session_factory, init_models
from .facts import build_fact_block
from .models import ClientAction, parse_client_message
from .llm import coaching_service
from .security import issue_ws_token, session_signer, verify_ws_token
from .storage import DbStore, MemoryStore, StoreWrapper
from .table import TableManager


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
INDEX_FILE = STATIC_DIR / "index.html"


class SessionData(BaseModel):
    user_id: str
    email: str = ""
    name: str = ""


app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.allowed_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


def set_session_cookie(response: Response, session: SessionData) -> None:
    signed = session_signer.sign(session.dict())
    response.set_cookie(
        key=settings.session_cookie_name,
        value=signed,
        max_age=int(timedelta(days=7).total_seconds()),
        httponly=True,
        secure=settings.environment == "prod",
        samesite="lax",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=settings.session_cookie_name,
        httponly=True,
        secure=settings.environment == "prod",
        samesite="lax",
    )


def require_session(request: Request) -> SessionData:
    cookie = request.cookies.get(settings.session_cookie_name)
    if not cookie:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No session")
    data = session_signer.unsign(cookie)
    if not data:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")
    return SessionData(**data)


@app.get("/", response_class=FileResponse)
async def index() -> FileResponse:
    return FileResponse(INDEX_FILE)


@app.get("/favicon.ico", include_in_schema=False)
async def favicon() -> FileResponse:
    ico_path = STATIC_DIR / "favicon.ico"
    if ico_path.exists():
        return FileResponse(ico_path)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "app": settings.app_name}


@app.get("/auth/google/login")
async def google_login() -> Response:
    if not settings.google_client_id:
        return JSONResponse(
            {
                "error": "google_client_id_not_configured",
                "message": "Set POKER_GOOGLE_CLIENT_ID to enable Google sign-in.",
            },
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "prompt": "consent",
        "access_type": "online",
    }
    query = httpx.QueryParams(params)
    url = f"https://accounts.google.com/o/oauth2/v2/auth?{query}"
    return RedirectResponse(url=url)


@app.get("/auth/google/callback")
async def google_callback(request: Request, code: Optional[str] = None) -> Response:
    # Dev fallback: allow a session if OAuth is not configured.
    if not settings.google_client_id or not settings.google_client_secret:
        response = RedirectResponse(url="/")
        set_session_cookie(
            response,
            SessionData(user_id="dev-user", email="dev@example.com", name="Dev User"),
        )
        return response

    if not code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing code")

    token_url = "https://oauth2.googleapis.com/token"
    data = {
        "client_id": settings.google_client_id,
        "client_secret": settings.google_client_secret,
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": settings.google_redirect_uri,
    }
    async with httpx.AsyncClient(timeout=10) as client:
        token_resp = await client.post(token_url, data=data)
        if token_resp.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Failed to exchange code with Google",
            )
        tokens = token_resp.json()
        access_token = tokens.get("access_token")
        if not access_token:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="No access token")
        userinfo_resp = await client.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if userinfo_resp.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Failed to fetch user info",
            )
        info = userinfo_resp.json()

    session = SessionData(
        user_id=info.get("id") or info.get("sub") or "",
        email=info.get("email") or "",
        name=info.get("name") or "",
    )
    if not session.user_id:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Missing user id")

    store.log_user(session.user_id, session.email, session.name)
    response = RedirectResponse(url="/")
    set_session_cookie(response, session)
    return response


@app.post("/auth/dev-login")
async def dev_login(body: SessionData) -> Response:
    response = JSONResponse(content=body.dict())
    set_session_cookie(response, body)
    store.log_user(body.user_id, body.email, body.name)
    return response


@app.post("/auth/logout")
async def logout() -> Response:
    response = JSONResponse({"status": "logged_out"})
    clear_session_cookie(response)
    return response


@app.get("/auth/me")
async def me(session: SessionData = Depends(require_session)) -> SessionData:
    return session


@app.get("/auth/token")
async def ws_token(session: SessionData = Depends(require_session)) -> dict:
    token = issue_ws_token(session.user_id)
    return {"ws_token": token, "user": session.dict()}


engine = get_engine()
store = StoreWrapper(db_store=DbStore(get_session_factory(engine)) if engine else None, memory_store=MemoryStore())


@app.on_event("startup")
async def startup_event() -> None:
    if engine:
        await init_models(engine)


@app.websocket("/ws/table")
async def table_socket(websocket: WebSocket, token: str = Query(...)) -> None:
    claims = verify_ws_token(token)
    if not claims or claims.get("scope") != "ws":
        await websocket.close(code=4401)
        return
    user_id = str(claims.get("sub") or claims.get("user_id") or "")
    if not user_id:
        await websocket.close(code=4401)
        return

    await websocket.accept()
    table = TableManager(seed=hash(user_id), store=store, hero_id=user_id)
    store.log_session(user_id)
    initial_state = table.snapshot()
    await websocket.send_json({"type": "session_joined", "state": initial_state})
    fact_payload = build_fact_block(initial_state)
    store.log_fact({"user_id": user_id, **fact_payload})
    await websocket.send_json(fact_payload)

    try:
        while True:
            raw = await websocket.receive_text()
            msg = parse_client_message(raw)
            if not msg:
                await websocket.send_json({"type": "error", "message": "Invalid message"})
                continue

            action = msg.action
            amount = msg.amount

            if action == "ping":
                await websocket.send_json({"type": "pong"})
                continue
            if action == "next_hand":
                next_state = table.next_hand()
                await websocket.send_json(next_state)
                fact_payload = build_fact_block(next_state["state"])
                store.log_fact({"user_id": user_id, **fact_payload})
                await websocket.send_json(fact_payload)
                continue

            decision_state = table.snapshot()
            decision_facts = build_fact_block(decision_state)

            events = table.player_action(action=action, amount=amount)
            latest_state = None
            fact_payload = None
            for event in events:
                await websocket.send_json(event)
                if event.get("type") == "state_update":
                    latest_state = event["state"]
                    fact_payload = build_fact_block(latest_state)
                    store.log_fact({"user_id": user_id, **fact_payload})
                    await websocket.send_json(fact_payload)
                if event.get("type") == "hand_summary":
                    # Auto-start next hand after summary.
                    await websocket.send_json({**event, "can_start_next_hand": True})
            coaching_state = latest_state or decision_state
            coaching_facts = fact_payload or decision_facts
            if coaching_state:
                coaching = await coaching_service.get_coaching(coaching_state, coaching_facts, {"action": action, "amount": amount})
                await websocket.send_json(coaching)
    except WebSocketDisconnect:
        return


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
