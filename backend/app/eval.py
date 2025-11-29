import random
from typing import Dict, List, Optional


def _parse_card(card: str) -> Optional[str]:
    if not card or len(card) != 2:
        return None
    rank, suit = card[0].upper(), card[1].lower()
    return f"{rank}{suit}"


def evaluate_with_pokerkit(hero: List[str], bot: List[str], board: List[str]) -> Optional[str]:
    try:
        from pokerkit import Card, HandEvaluator
    except Exception:
        return None
    try:
        hero_cards = [Card.from_str(c) for c in hero]
        bot_cards = [Card.from_str(c) for c in bot]
        board_cards = [Card.from_str(c) for c in board]
        hero_score = HandEvaluator.evaluate_hand(hero_cards, board_cards)
        bot_score = HandEvaluator.evaluate_hand(bot_cards, board_cards)
        if hero_score < bot_score:
            return "hero"
        if bot_score < hero_score:
            return "bot"
        return "split"
    except Exception:
        return None


def decide_winner(hero: List[str], bot: List[str], board: List[str], rng: random.Random) -> Dict[str, str]:
    hero_cards = [_parse_card(c) for c in hero if _parse_card(c)]
    bot_cards = [_parse_card(c) for c in bot if _parse_card(c)]
    board_cards = [_parse_card(c) for c in board if _parse_card(c)]

    winner = evaluate_with_pokerkit(hero_cards, bot_cards, board_cards)
    reason = "pokerkit"
    if winner is None:
        winner = "hero" if rng.random() < 0.5 else "bot"
        reason = "fallback_random"
    elif winner == "split":
        winner = "hero" if rng.random() < 0.5 else "bot"
        reason = "split_randomized"

    return {"winner": winner, "reason": reason}
