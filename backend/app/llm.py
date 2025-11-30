import logging
from typing import Any, Dict, Optional

try:
    from openai import AsyncOpenAI  # type: ignore
except Exception:  # pragma: no cover - client may be absent in dev
    AsyncOpenAI = None  # type: ignore

from .config import settings

logger = logging.getLogger(__name__)


class CoachingService:
    def __init__(self) -> None:
        self.enabled = bool(settings.openai_api_key) and AsyncOpenAI is not None
        self.client = AsyncOpenAI(api_key=settings.openai_api_key) if self.enabled else None
        if not self.enabled:
            logger.warning("LLM coaching disabled (missing API key or openai package).")

    async def get_coaching(self, state: Dict[str, Any], facts: Dict[str, Any], action: Dict[str, Any]) -> Dict[str, Any]:
        if not self.enabled or not self.client:
            return {
                "type": "coaching_update",
                "coaching": {
                    "assessment": "LLM disabled (no API key or client).",
                    "advice": "Configure POKER_OPENAI_API_KEY and ensure network access.",
                },
            }

        prompt = self._build_prompt(state, facts, action)
        try:
            resp = await self.client.chat.completions.create(
                model=settings.openai_model,
                messages=prompt,
                temperature=1,
                response_format={"type": "json_object"},
            )
            content = resp.choices[0].message.content
            coaching = self._parse_response(content)
            coaching.pop("suggested_next_action", None)
            coaching.pop("leak", None)
            coaching.pop("risk", None)
            coaching.pop("confidence", None)
            coaching.pop("token_usage", None)
            return {"type": "coaching_update", "coaching": coaching}
        except Exception as exc:
            logger.warning("LLM coaching failed: %s", exc)
            return {
                "type": "coaching_update",
                "coaching": {
                    "assessment": "Coaching unavailable right now.",
                    "advice": "Check network access and API key; try again later.",
                },
            }

    def _build_prompt(self, state: Dict[str, Any], facts: Dict[str, Any], action: Dict[str, Any]) -> list:
        system = (
            "You are a GTO poker coach. Evaluate my last decision with ONLY the information available at that moment. "
            "Do NOT speculate about future streets or unseen cards. Return JSON with keys: "
            "assessment (short), advice (actionable). Do NOT include suggested_next_action."
        )
        user = {
            "state": state,
            "facts": facts.get("facts") if isinstance(facts, dict) else facts,
            "action": action,
            "instructions": "Return JSON with assessment and advice only. Avoid future info.",
        }
        return [
            {"role": "system", "content": system},
            {"role": "user", "content": str(user)},
        ]

    def _parse_response(self, content: Optional[str]) -> Dict[str, Any]:
        import json

        if not content:
            return {}
        try:
            return json.loads(content)
        except Exception:
            return {"assessment": content[:200], "advice": content[:200]}


coaching_service = CoachingService()
