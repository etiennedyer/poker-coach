from __future__ import annotations

from typing import Dict, List, Tuple


FACTS_VERSION = "0.1.0"

RANK_ORDER = {"2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "T": 10, "J": 11, "Q": 12, "K": 13, "A": 14}


def _parse_board(board: List[str]) -> Tuple[List[int], List[str]]:
    ranks: List[int] = []
    suits: List[str] = []
    for card in board:
        if not card or len(card) != 2:
            continue
        rank = RANK_ORDER.get(card[0].upper())
        suit = card[1].lower()
        if rank:
            ranks.append(rank)
        suits.append(suit)
    return ranks, suits


def _board_flags(board: List[str]) -> Dict[str, bool]:
    ranks, suits = _parse_board(board)
    paired = len(ranks) != len(set(ranks))
    suit_counts: Dict[str, int] = {}
    for s in suits:
        suit_counts[s] = suit_counts.get(s, 0) + 1
    max_suit = max(suit_counts.values()) if suit_counts else 0
    flush_draw_possible = max_suit >= 3  # 3+ to one suit on board
    monotone = max_suit == len(board) and len(board) > 0

    straight_draw_possible = False
    if len(ranks) >= 3:
        unique = sorted(set(ranks))
        for i in range(len(unique)):
            window = unique[i : i + 3]
            if len(window) == 3 and max(window) - min(window) <= 4:
                straight_draw_possible = True
                break

    return {
        "paired_board": paired,
        "flush_draw_possible": flush_draw_possible,
        "straight_draw_possible": straight_draw_possible,
        "monotone_board": monotone,
    }


def build_fact_block(state: Dict) -> Dict:
    pot = state.get("pot", 0) or 0
    hero_bet = state.get("hero_bet", 0) or 0
    bot_bet = state.get("bot_bet", 0) or 0
    current_bet = max(hero_bet, bot_bet)
    hero_stack = state.get("hero_stack", 0) or 0
    bot_stack = state.get("bot_stack", 0) or 0
    to_call = max(0, current_bet - hero_bet)
    effective_stack = min(hero_stack, bot_stack)
    spr = round(effective_stack / pot, 2) if pot > 0 else None
    required_equity = round(to_call / (pot + to_call), 3) if to_call > 0 else 0.0
    bet_pct_pot = round((to_call / pot) * 100, 1) if pot > 0 and to_call > 0 else 0.0

    flags = _board_flags(state.get("board") or [])
    position = "Button (IP)" if state.get("street") == "preflop" else "Button (acts first here)"

    facts = {
        "version": FACTS_VERSION,
        "street": state.get("street"),
        "pot": pot,
        "to_call": to_call,
        "current_bet": current_bet,
        "effective_stack": effective_stack,
        "spr": spr,
        "bet_pct_pot": bet_pct_pot,
        "required_equity": required_equity,
        "position": position,
        "board_flags": flags,
    }

    summary_lines = [
        f"Pot: {pot} | To call: {to_call} | Required equity: {required_equity:.3f}",
        f"SPR: {spr if spr is not None else 'inf'} | Bet % pot: {bet_pct_pot}%",
        f"Position: {position} | Board: paired={flags['paired_board']}, flush_draw={flags['flush_draw_possible']}, straight_draw={flags['straight_draw_possible']}",
    ]

    return {
        "type": "facts_update",
        "facts": facts,
        "summary_lines": summary_lines,
    }
