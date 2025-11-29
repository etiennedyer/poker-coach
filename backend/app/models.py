from typing import Optional

from pydantic import BaseModel, validator


ALLOWED_ACTIONS = {"fold", "call", "check", "bet", "raise", "next_hand", "ping"}


class ClientAction(BaseModel):
    action: str
    amount: Optional[int] = None
    ts: Optional[str] = None

    @validator("action")
    def validate_action(cls, v: str) -> str:
        if v not in ALLOWED_ACTIONS:
            raise ValueError(f"Unsupported action: {v}")
        return v

    @validator("amount")
    def validate_amount(cls, v: Optional[int], values) -> Optional[int]:
        if v is None:
            return v
        if not isinstance(v, int):
            raise ValueError("amount must be int")
        if v < 0:
            raise ValueError("amount must be non-negative")
        return v


def parse_client_message(raw: str) -> Optional[ClientAction]:
    try:
        return ClientAction.parse_raw(raw)
    except Exception:
        return None
