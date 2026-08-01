"""
Gestion des salons multijoueurs.

Le principe : le serveur est la seule autorité sur le déroulement de la
partie (quel morceau, quand ça commence, qui a répondu à temps). Chaque
client ne fait qu'afficher ce que le serveur lui envoie et lui remonter ses
réponses. Ça évite toute triche côté client et ça garde tout le monde
synchronisé, y compris si un joueur a un peu de latence.
"""
import asyncio
import random
import string
import time
from typing import Optional

from fastapi import WebSocket

from . import deezer_client

ANSWER_GRACE_SECONDS = 3   # temps laissé après la fin de l'extrait pour répondre
REVEAL_PAUSE_SECONDS = 4   # pause d'affichage du résultat avant la manche suivante
MIN_SCORE = 100            # points garantis pour une bonne réponse, même tardive
MAX_BONUS = 900            # bonus de rapidité maximum


def _gen_code(n: int = 5) -> str:
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=n))


def _shuffle(seq):
    seq = list(seq)
    random.shuffle(seq)
    return seq


def build_rounds(pool: list[dict], count: int) -> list[dict]:
    """Construit `count` manches à partir du pool de morceaux, sans doublon de titre
    et avec 4 options (1 bonne + 3 distracteurs aux titres tous différents)."""
    shuffled = _shuffle(pool)
    rounds = []
    used_keys = set()
    for track in shuffled:
        if len(rounds) >= count:
            break
        key = (track["title_short"] or track["title"]).lower().strip()
        if key in used_keys:
            continue

        others = _shuffle([t for t in pool if t["id"] != track["id"]])
        distract_keys = {key}
        distractors = []
        for d in others:
            dk = (d["title_short"] or d["title"]).lower().strip()
            if dk in distract_keys:
                continue
            distract_keys.add(dk)
            distractors.append(d)
            if len(distractors) == 3:
                break
        if len(distractors) < 3:
            continue

        used_keys.add(key)
        rounds.append({"track": track, "options": _shuffle([track] + distractors)})
    return rounds


class Player:
    def __init__(self, ws: WebSocket, name: str):
        self.ws = ws
        self.name = name
        self.score = 0
        self.answered_round = -1
        self.last_correct = False


class Room:
    def __init__(self, code: str):
        self.code = code
        self.players: dict[str, Player] = {}
        self.host_id: Optional[str] = None
        self.settings = {"rounds": 10, "snippet_seconds": 15, "album_ids": []}
        self.state = "lobby"  # lobby | playing | finished
        self.pool: list[dict] = []
        self.rounds: list[dict] = []
        self.round_idx = -1
        self.round_start_ts: Optional[float] = None
        self.task: Optional[asyncio.Task] = None

    def player_list(self):
        return [
            {"id": pid, "name": p.name, "score": p.score, "host": pid == self.host_id}
            for pid, p in self.players.items()
        ]

    async def broadcast(self, message: dict):
        dead = []
        for pid, p in self.players.items():
            try:
                await p.ws.send_json(message)
            except Exception:
                dead.append(pid)
        for pid in dead:
            self.players.pop(pid, None)

    async def add_player(self, pid: str, ws: WebSocket, name: str):
        self.players[pid] = Player(ws, name)
        if self.host_id is None:
            self.host_id = pid
        await self.broadcast({"type": "lobby_update", "players": self.player_list(), "code": self.code})
        # Si la partie est déjà en cours, on informe le nouvel arrivant qu'il
        # a rejoint en cours de route (pour simplifier il regardera le round en cours).
        if self.state == "playing":
            await ws.send_json({"type": "game_in_progress"})

    async def remove_player(self, pid: str):
        self.players.pop(pid, None)
        if self.host_id == pid:
            self.host_id = next(iter(self.players), None)
        await self.broadcast({"type": "lobby_update", "players": self.player_list(), "code": self.code})

    async def start_game(self, pid: str, settings: Optional[dict]):
        if pid != self.host_id or self.state != "lobby":
            return
        if settings:
            self.settings.update(settings)

        try:
            album_ids = self.settings.get("album_ids") or []
            if album_ids:
                self.pool = await deezer_client.get_tracks_for_albums(album_ids)
            else:
                self.pool = []
            if len(self.pool) < 4:
                _, albums = await deezer_client.get_catalog()
                self.pool = await deezer_client.get_tracks_for_albums([a["id"] for a in albums])
        except Exception as e:
            await self.broadcast({"type": "error", "message": str(e)})
            return

        count = min(int(self.settings.get("rounds", 10)), len(self.pool))
        self.rounds = build_rounds(self.pool, count)
        if not self.rounds:
            await self.broadcast({"type": "error", "message": "Pas assez de titres distincts pour lancer une partie."})
            return

        self.state = "playing"
        self.round_idx = -1
        for p in self.players.values():
            p.score = 0
            p.answered_round = -1
        self.task = asyncio.create_task(self._run_rounds())

    async def _run_rounds(self):
        snippet = int(self.settings.get("snippet_seconds", 15))
        for idx, rd in enumerate(self.rounds):
            self.round_idx = idx
            for p in self.players.values():
                p.answered_round = -1
            self.round_start_ts = time.time()

            await self.broadcast({
                "type": "round_start",
                "round_index": idx,
                "total": len(self.rounds),
                "preview": rd["track"]["preview"],
                "snippet_seconds": snippet,
                "cover_hint": None,  # jamais envoyé avant la réponse : on ne veut pas spoiler la pochette
                "options": [
                    {"id": o["id"], "title": o["title_short"] or o["title"]}
                    for o in rd["options"]
                ],
            })

            await asyncio.sleep(snippet + ANSWER_GRACE_SECONDS)

            await self.broadcast({
                "type": "round_reveal",
                "correct_option_id": rd["track"]["id"],
                "track": {
                    "title": rd["track"]["title"],
                    "album": rd["track"]["album"]["title"],
                    "cover": rd["track"]["album"]["cover"],
                },
                "players": self.player_list(),
            })

            await asyncio.sleep(REVEAL_PAUSE_SECONDS)

        self.state = "finished"
        ranking = sorted(self.player_list(), key=lambda p: -p["score"])
        await self.broadcast({"type": "game_over", "ranking": ranking})

    async def submit_answer(self, pid: str, option_id):
        p = self.players.get(pid)
        if not p or self.state != "playing" or self.round_idx < 0:
            return
        if p.answered_round == self.round_idx:
            return  # une seule réponse acceptée par manche
        rd = self.rounds[self.round_idx]
        snippet = int(self.settings.get("snippet_seconds", 15))
        elapsed = time.time() - (self.round_start_ts or time.time())
        correct = option_id == rd["track"]["id"]

        p.answered_round = self.round_idx
        p.last_correct = correct
        gained = 0
        if correct:
            speed_ratio = max(0.0, 1 - min(elapsed, snippet) / snippet) if snippet else 0.0
            gained = int(MIN_SCORE + MAX_BONUS * speed_ratio)
            p.score += gained

        # Confirmation immédiate au joueur seul (pas de broadcast : on ne
        # révèle rien aux autres avant la fin de la manche).
        await p.ws.send_json({"type": "answer_ack", "correct": correct, "score": p.score, "gained": gained})


class RoomManager:
    def __init__(self):
        self.rooms: dict[str, Room] = {}

    def create_room(self) -> str:
        code = _gen_code()
        while code in self.rooms:
            code = _gen_code()
        self.rooms[code] = Room(code)
        return code

    def get(self, code: str) -> Optional[Room]:
        return self.rooms.get(code.upper())

    def cleanup_empty(self):
        empty = [c for c, r in self.rooms.items() if not r.players]
        for c in empty:
            self.rooms.pop(c, None)
