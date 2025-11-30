import json
import random
from typing import Any, Dict, List, Optional

from .eval import decide_winner


def make_deck(rng: random.Random) -> List[str]:
    ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"]
    suits = ["h", "d", "c", "s"]
    deck = [r + s for s in suits for r in ranks]
    rng.shuffle(deck)
    return deck


class TableManager:
    def __init__(self, seed: Optional[int] = None, store: Optional[Any] = None, hero_id: str = "hero", bot_id: str = "bot") -> None:
        self.rng = random.Random(seed)
        self.starting_stack = 200
        self.small_blind = 1
        self.big_blind = 2
        self.hand_id = 0
        self.hero_stack = self.starting_stack
        self.bot_stack = self.starting_stack
        self.store = store
        self.hero_id = hero_id
        self.bot_id = bot_id
        self._init_hand()

    def _init_hand(self) -> None:
        self.hand_id += 1
        if self.hero_stack < self.big_blind:
            self.hero_stack = self.starting_stack
        if self.bot_stack < self.big_blind:
            self.bot_stack = self.starting_stack
        self.street = "preflop"
        self.deck = make_deck(self.rng)
        self.hero_hand = [self.deck.pop(), self.deck.pop()]
        self.bot_hand = [self.deck.pop(), self.deck.pop()]
        self.board: List[str] = []
        self.pot = 0
        self.hero_bet = 0
        self.bot_bet = 0
        self.hand_over = False
        self.winner: Optional[str] = None
        self.last_action: Optional[str] = None

        # Post blinds: hero = SB/button, bot = BB.
        self.hero_stack -= self.small_blind
        self.bot_stack -= self.big_blind
        self.hero_bet = self.small_blind
        self.bot_bet = self.big_blind
        self.pot = self.small_blind + self.big_blind
        self.to_act = "hero"  # hero acts first preflop in HU as button/SB

    @property
    def current_bet(self) -> int:
        return max(self.hero_bet, self.bot_bet)

    def snapshot(self, hide_bot: bool = True) -> Dict[str, Any]:
        return {
            "hand_id": self.hand_id,
            "street": self.street,
            "pot": self.pot,
            "hero_stack": self.hero_stack,
            "bot_stack": self.bot_stack,
            "hero_bet": self.hero_bet,
            "bot_bet": self.bot_bet,
            "current_bet": self.current_bet,
            "board": self.board.copy(),
            "hero_hand": self.hero_hand.copy(),
            "bot_hand": ["XX", "XX"] if hide_bot else self.bot_hand.copy(),
            "to_act": self.to_act,
            "last_action": self.last_action,
            "hand_over": self.hand_over,
            "winner": self.winner,
        }

    def _progress_street(self) -> Optional[Dict[str, Any]]:
        self.hero_bet = 0
        self.bot_bet = 0
        if self.street == "preflop":
            if len(self.board) < 3:
                self.board.extend([self.deck.pop(), self.deck.pop(), self.deck.pop()])
            self.street = "flop"
            self.to_act = "hero"
            return None
        elif self.street == "flop":
            if len(self.board) < 4:
                self.board.append(self.deck.pop())
            self.street = "turn"
            self.to_act = "hero"
            return None
        elif self.street == "turn":
            if len(self.board) < 5:
                self.board.append(self.deck.pop())
            self.street = "river"
            self.to_act = "hero"
            return None
        else:
            return self._resolve_showdown()

    def _resolve_showdown(self) -> Dict[str, Any]:
        result = decide_winner(self.hero_hand, self.bot_hand, self.board, self.rng)
        return self._end_hand(winner=result["winner"], reason=result["reason"])

    def _award_pot(self) -> None:
        if self.winner == "hero":
            self.hero_stack += self.pot
        elif self.winner == "bot":
            self.bot_stack += self.pot
        self.pot = 0

    def _end_hand(self, winner: str, reason: str) -> Dict[str, Any]:
        self.winner = winner
        self.last_action = reason
        self.hand_over = True
        self._award_pot()
        summary = {
            "type": "hand_summary",
            "winner": winner,
            "reason": reason,
            "board": self.board.copy(),
            "hero_hand": self.hero_hand.copy(),
            "bot_hand": self.bot_hand.copy(),
            "hero_stack": self.hero_stack,
            "bot_stack": self.bot_stack,
            "hand_id": self.hand_id,
            "user_id": self.hero_id,
        }
        if self.store is not None:
            self.store.log_hand(summary)
        return summary

    def _apply_action(self, actor: str, action: str, amount: Optional[int]) -> Dict[str, Any]:
        other = "bot" if actor == "hero" else "hero"
        actor_bet = self.hero_bet if actor == "hero" else self.bot_bet
        actor_stack = self.hero_stack if actor == "hero" else self.bot_stack
        current = self.current_bet
        to_call = max(0, current - actor_bet)
        min_raise = current + self.big_blind if current > 0 else self.big_blind

        if self.hand_over:
            return {"type": "error", "message": "Hand already complete."}

        # Validate legality.
        if to_call > 0:
            if action == "bet":
                action = "raise"
            if action == "check":
                return {"type": "error", "message": "Cannot check facing a bet."}
            if action == "raise" and (amount is None or amount < min_raise):
                return {"type": "error", "message": f"Raise must be at least {min_raise}."}
        else:
            # No bet outstanding.
            if action == "call":
                action = "check"
            if action == "raise":
                action = "bet"
            if action in ("bet",) and (amount is None or amount < self.big_blind):
                return {"type": "error", "message": f"Bet must be at least {self.big_blind}."}

        if action == "fold":
            summary = self._end_hand(winner=other, reason=f"{actor} folded")
            return summary

        if action in ("call", "check"):
            to_call = max(0, current - actor_bet)
            pay = min(to_call, actor_stack)
            actor_stack -= pay
            actor_bet += pay
            self.pot += pay
            self.last_action = f"{actor} {action}"
        elif action in ("bet", "raise"):
            if amount is None:
                amount = current + self.big_blind
            amount = max(amount, min_raise)
            add = max(0, amount - actor_bet)
            add = min(add, actor_stack)
            actor_stack -= add
            actor_bet += add
            self.pot += add
            self.last_action = f"{actor} {action} to {actor_bet}"
        else:
            return {"type": "error", "message": f"Unknown action {action}"}

        if actor == "hero":
            self.hero_stack, self.hero_bet = actor_stack, actor_bet
        else:
            self.bot_stack, self.bot_bet = actor_stack, actor_bet

        # Decide next actor.
        if action in ("bet", "raise"):
            self.to_act = other
        elif action in ("call", "check"):
            if self.hero_bet == self.bot_bet:
                # Move turn to the other actor; street progression handled after bot acts.
                self.to_act = other
            else:
                self.to_act = other
        return {"type": "state_update", "state": self.snapshot()}

    def player_action(self, action: str, amount: Optional[int] = None) -> List[Dict[str, Any]]:
        events: List[Dict[str, Any]] = []
        res = self._apply_action("hero", action, amount)
        if self.store is not None and isinstance(res, dict):
            self.store.log_action(
                {
                    "actor": "hero",
                    "action": action,
                    "amount": amount,
                    "state": self.snapshot(),
                    "hand_id": self.hand_id,
                    "street": self.street,
                    "user_id": self.hero_id,
                    "hand_id": self.hand_id,
                }
            )
        events.append(res)
        if res.get("type") == "hand_summary":
            return events
        if self.hand_over:
            events.append(self._end_hand(self.winner or "bot", self.last_action or "done"))
            return events

        # Bot acts if it's their turn and hand still live.
        if self.to_act == "bot" and not self.hand_over:
            bot_event = self._bot_action()
            bot_action_label = bot_event.get("bot_action") or self.last_action or bot_event.get("type") or "bot acted"
            if self.store is not None and isinstance(bot_event, dict):
                self.store.log_action(
                    {
                        "actor": "bot",
                        "action": bot_action_label,
                        "state": self.snapshot(),
                        "hand_id": self.hand_id,
                        "street": self.street,
                        "user_id": self.bot_id,
                        "hand_id": self.hand_id,
                    }
                )
            # Ensure bot event carries actor/action metadata for UI.
            if isinstance(bot_event, dict):
                bot_event.setdefault("actor", "bot")
                bot_event.setdefault("bot_action", bot_action_label)
            events.append(bot_event)
            if bot_event.get("type") == "hand_summary":
                return events
            if self.hand_over:
                events.append(self._end_hand(self.winner or "bot", self.last_action or "done"))
                return events

            # If both matched after bot acts, progress street and send update.
            if self.hero_bet == self.bot_bet:
                self._progress_street()
                events.append(
                    {
                        "type": "state_update",
                        "state": self.snapshot(),
                        "bot_action": bot_action_label,
                        "actor": "bot",
                    }
                )
            # Emit explicit bot_action event for UI clarity.
            events.append({"type": "bot_action", "action": bot_action_label, "actor": "bot"})

        return events

    def _bot_action(self) -> Dict[str, Any]:
        to_call = self.current_bet - self.bot_bet
        aggressive = self.rng.random() < 0.25
        pot_odds = to_call / (self.pot + to_call) if to_call > 0 else 0
        if to_call == 0:
            if aggressive and self.bot_stack > 0:
                size = min(self.bot_stack, max(4, int(self.pot * 0.6)))
                result = self._apply_action("bot", "bet", size)
            else:
                result = self._apply_action("bot", "check", None)
        else:
            # Facing a bet/raise.
            if to_call > self.bot_stack * 0.6 and self.rng.random() < 0.4:
                result = self._apply_action("bot", "fold", None)
            elif pot_odds < 0.22 and self.rng.random() < 0.3:
                # Fold some vs large pot-odds (tighten up)
                result = self._apply_action("bot", "fold", None)
            elif aggressive and self.bot_stack > to_call + 4:
                raise_to = min(self.bot_stack + self.bot_bet, self.current_bet + max(4, to_call * 2))
                result = self._apply_action("bot", "raise", raise_to)
            else:
                result = self._apply_action("bot", "call", None)

        if result.get("type") == "state_update":
            result["actor"] = "bot"
            result["bot_action"] = self.last_action
        elif result.get("type") == "hand_summary":
            result["actor"] = "bot"
            result["bot_action"] = self.last_action
        return result

    def next_hand(self) -> Dict[str, Any]:
        self._init_hand()
        return {"type": "state_update", "state": self.snapshot()}


def decode_client_message(raw: str) -> Dict[str, Any]:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {"type": "error", "message": "Invalid JSON"}
    if not isinstance(data, dict):
        return {"type": "error", "message": "Message must be an object"}
    return data
