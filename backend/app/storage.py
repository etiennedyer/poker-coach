import asyncio
from typing import Any, Dict, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from .orm import Action as ActionORM
from .orm import Fact as FactORM
from .orm import Hand as HandORM
from .orm import Session as SessionORM
from .orm import User as UserORM

class MemoryStore:
    def __init__(self) -> None:
        self.hands: List[Dict[str, Any]] = []
        self.actions: List[Dict[str, Any]] = []
        self.facts: List[Dict[str, Any]] = []

    def log_action(self, payload: Dict[str, Any]) -> None:
        self.actions.append(payload)

    def log_hand(self, payload: Dict[str, Any]) -> None:
        self.hands.append(payload)

    def log_fact(self, payload: Dict[str, Any]) -> None:
        self.facts.append(payload)

    def dump(self) -> Dict[str, List[Dict[str, Any]]]:
        return {"hands": self.hands, "actions": self.actions, "facts": self.facts}


class DbStore:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self.session_factory = session_factory

    async def log_user(self, user_id: str, email: Optional[str], name: Optional[str]) -> None:
        async with self.session_factory() as session:
            existing = await session.get(UserORM, user_id)
            if existing:
                return
            session.add(UserORM(id=user_id, email=email, name=name))
            await session.commit()

    async def log_session(self, user_id: str) -> int:
        async with self.session_factory() as session:
            sess = SessionORM(user_id=user_id)
            session.add(sess)
            await session.flush()
            await session.commit()
            return sess.id

    async def log_hand(self, payload: Dict[str, Any]) -> None:
        async with self.session_factory() as session:
            hand = HandORM(
                session_id=payload.get("session_id"),
                user_id=payload.get("user_id"),
                hand_number=payload.get("hand_id", 0),
                board=" ".join(payload.get("board") or []),
                hero_hand=" ".join(payload.get("hero_hand") or []),
                bot_hand=" ".join(payload.get("bot_hand") or []),
                winner=payload.get("winner"),
                reason=payload.get("reason"),
                hero_stack=payload.get("hero_stack", 0),
                bot_stack=payload.get("bot_stack", 0),
            )
            session.add(hand)
            await session.commit()

    async def log_action(self, payload: Dict[str, Any]) -> None:
        async with self.session_factory() as session:
            action = ActionORM(
                hand_id=payload.get("hand_id"),
                user_id=payload.get("user_id"),
                actor=payload.get("actor", ""),
                action=payload.get("action", ""),
                amount=payload.get("amount"),
                street=payload.get("street"),
                state=payload.get("state"),
            )
            session.add(action)
            await session.commit()

    async def log_fact(self, payload: Dict[str, Any]) -> None:
        async with self.session_factory() as session:
            fact = FactORM(
                hand_id=payload.get("hand_id"),
                user_id=payload.get("user_id"),
                facts=payload.get("facts") or {},
                summary="\n".join(payload.get("summary_lines") or []),
            )
            session.add(fact)
            await session.commit()


class StoreWrapper:
    """
    Provides a unified interface that can wrap async DB store or memory store.
    """

    def __init__(self, db_store: Optional[DbStore] = None, memory_store: Optional[MemoryStore] = None) -> None:
        self.db_store = db_store
        self.memory_store = memory_store or MemoryStore()

    def _fire_and_forget(self, coro) -> None:
        try:
            asyncio.get_running_loop().create_task(coro)
        except RuntimeError:
            pass

    def log_user(self, user_id: str, email: Optional[str], name: Optional[str]) -> None:
        if self.db_store:
            self._fire_and_forget(self.db_store.log_user(user_id, email, name))
        self.memory_store.log_action({"actor": "system", "action": "user_seen", "user_id": user_id})

    def log_session(self, user_id: str) -> None:
        if self.db_store:
            self._fire_and_forget(self.db_store.log_session(user_id))

    def log_hand(self, payload: Dict[str, Any]) -> None:
        if self.db_store:
            self._fire_and_forget(self.db_store.log_hand(payload))
        self.memory_store.log_hand(payload)

    def log_action(self, payload: Dict[str, Any]) -> None:
        if self.db_store:
            self._fire_and_forget(self.db_store.log_action(payload))
        self.memory_store.log_action(payload)

    def log_fact(self, payload: Dict[str, Any]) -> None:
        if self.db_store:
            self._fire_and_forget(self.db_store.log_fact(payload))
        self.memory_store.log_fact(payload)
