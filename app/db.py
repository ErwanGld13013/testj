"""Petite persistance SQLite pour le record personnel en mode solo."""
import sqlite3
from pathlib import Path
from typing import Optional

DB_PATH = Path(__file__).resolve().parent.parent / "blindtest.db"


def init_db() -> None:
    con = sqlite3.connect(DB_PATH)
    con.execute(
        """CREATE TABLE IF NOT EXISTS best_scores (
            player TEXT PRIMARY KEY,
            score INTEGER NOT NULL,
            rounds INTEGER NOT NULL,
            ratio REAL NOT NULL
        )"""
    )
    con.commit()
    con.close()


def get_best(player: str) -> Optional[dict]:
    con = sqlite3.connect(DB_PATH)
    row = con.execute(
        "SELECT score, rounds, ratio FROM best_scores WHERE player = ?", (player,)
    ).fetchone()
    con.close()
    if not row:
        return None
    return {"score": row[0], "rounds": row[1], "ratio": row[2]}


def save_best_if_better(player: str, score: int, rounds: int) -> bool:
    """Enregistre le score si c'est un nouveau record pour ce joueur. Renvoie True si record battu."""
    ratio = score / rounds if rounds else 0.0
    con = sqlite3.connect(DB_PATH)
    row = con.execute(
        "SELECT ratio FROM best_scores WHERE player = ?", (player,)
    ).fetchone()
    is_new_record = row is None or ratio > row[0]
    if is_new_record:
        con.execute(
            "REPLACE INTO best_scores (player, score, rounds, ratio) VALUES (?, ?, ?, ?)",
            (player, score, rounds, ratio),
        )
        con.commit()
    con.close()
    return is_new_record
