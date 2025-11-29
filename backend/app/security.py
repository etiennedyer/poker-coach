from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from itsdangerous import BadSignature, URLSafeSerializer
from jose import JWTError, jwt

from .config import settings


class SessionSigner:
    def __init__(self) -> None:
        self.serializer = URLSafeSerializer(settings.session_secret, salt="session")

    def sign(self, payload: Dict[str, Any]) -> str:
        return self.serializer.dumps(payload)

    def unsign(self, token: str) -> Optional[Dict[str, Any]]:
        try:
            return self.serializer.loads(token)
        except BadSignature:
            return None


session_signer = SessionSigner()


def issue_ws_token(user_id: str) -> str:
    now = datetime.now(tz=timezone.utc)
    expire = now + timedelta(minutes=settings.ws_token_minutes)
    payload = {
        "sub": user_id,
        "scope": "ws",
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def verify_ws_token(token: str) -> Optional[Dict[str, Any]]:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError:
        return None
