import json
from pathlib import Path
from typing import List

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import db, deezer_client
from .rooms import RoomManager

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(title="Blind Test JUL")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

rooms = RoomManager()


@app.on_event("startup")
async def on_startup():
    db.init_db()


@app.get("/")
async def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/catalog")
async def api_catalog():
    """Renvoie l'artiste + la liste des albums (pour construire l'écran de réglages)."""
    try:
        artist, albums = await deezer_client.get_catalog()
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {
        "artist": {
            "name": artist["name"],
            "id": artist["id"],
            "picture": artist.get("picture_xl") or artist.get("picture_big") or artist.get("picture_medium"),
            "nb_fan": artist.get("nb_fan"),
        },
        "albums": albums,
    }


class TracksRequest(BaseModel):
    album_ids: List[int]


@app.post("/api/tracks")
async def api_tracks(body: TracksRequest):
    """Renvoie les morceaux (avec extrait) des albums demandés — utilisé par le mode solo."""
    try:
        tracks = await deezer_client.get_tracks_for_albums(body.album_ids)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"tracks": tracks}


@app.get("/api/best-score")
async def get_best_score(player: str):
    return db.get_best(player) or {}


class BestScoreBody(BaseModel):
    player: str
    score: int
    rounds: int


@app.post("/api/best-score")
async def post_best_score(body: BestScoreBody):
    is_new_record = db.save_best_if_better(body.player, body.score, body.rounds)
    return {"is_new_record": is_new_record, **(db.get_best(body.player) or {})}


@app.post("/api/rooms")
async def create_room():
    """Crée un salon multijoueur et renvoie son code à partager aux autres joueurs."""
    code = rooms.create_room()
    return {"code": code}


@app.websocket("/ws/{code}")
async def ws_room(websocket: WebSocket, code: str, name: str = "Joueur"):
    room = rooms.get(code)
    if not room:
        await websocket.close(code=4404, reason="Salon introuvable")
        return

    await websocket.accept()
    player_id = str(id(websocket))
    await room.add_player(player_id, websocket, (name or "Joueur")[:20])

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            msg_type = msg.get("type")

            if msg_type == "start_game":
                await room.start_game(player_id, msg.get("settings"))
            elif msg_type == "answer":
                await room.submit_answer(player_id, msg.get("option_id"))
    except WebSocketDisconnect:
        await room.remove_player(player_id)
        rooms.cleanup_empty()
