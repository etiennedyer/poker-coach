import logging
import random
from typing import Any, Dict, List, Optional


log = logging.getLogger(__name__)


def _parse_card(card: str) -> Optional[str]:
    if not card or len(card) != 2:
        return None
    rank, suit = card[0].upper(), card[1].lower()
    return f"{rank}{suit}"


def evaluate_with_pokerkit(hero: List[str], bot: List[str], board: List[str]) -> Optional[Dict[str, Any]]:
    try:
        from pokerkit import Card, StandardHighHand
    except Exception:
        log.exception("pokerkit import failed")
        return None
    try:
        hero_cards = tuple(Card.parse("".join(hero)))
        bot_cards = tuple(Card.parse("".join(bot)))
        board_cards = tuple(Card.parse("".join(board)))
        hero_hand = StandardHighHand.from_game(hero_cards, board_cards)
        bot_hand = StandardHighHand.from_game(bot_cards, board_cards)
        if hero_hand > bot_hand:
            winner = "hero"
        elif bot_hand > hero_hand:
            winner = "bot"
        else:
            winner = "split"
        return {"winner": winner, "hero_hand": hero_hand, "bot_hand": bot_hand}
    except Exception:
        log.exception("pokerkit evaluation failed")
        return None


def decide_winner(hero: List[str], bot: List[str], board: List[str], rng: random.Random) -> Dict[str, str]:
    hero_cards = [_parse_card(c) for c in hero if _parse_card(c)]
    bot_cards = [_parse_card(c) for c in bot if _parse_card(c)]
    board_cards = [_parse_card(c) for c in board if _parse_card(c)]

    result = evaluate_with_pokerkit(hero_cards, bot_cards, board_cards)
    if result is None:
        winner = "hero" if rng.random() < 0.5 else "bot"
        return {"winner": winner, "reason": "fallback_random"}

    winner = result["winner"]
    hero_hand = result["hero_hand"]
    bot_hand = result["bot_hand"]

    if winner == "hero":
        reason = str(hero_hand)
    elif winner == "bot":
        reason = str(bot_hand)
    else:
        winner = "hero" if rng.random() < 0.5 else "bot"
        reason = f"Tie ({hero_hand.entry.label.value}) — coin flip to {winner}"

    return {"winner": winner, "reason": reason}
