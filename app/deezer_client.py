"""
Petit client pour l'API publique Deezer.

Comme ce code tourne côté serveur (et non dans le navigateur), on n'a plus du
tout besoin des contournements CORS (JSONP, proxys tiers) utilisés dans la
version 100% front-end : un serveur qui appelle un autre serveur n'est jamais
soumis à la politique CORS, celle-ci ne concerne que les requêtes émises
depuis un navigateur.
"""
import time
from typing import Optional

import httpx

DEEZER = "https://api.deezer.com"

# Cache mémoire très simple pour éviter de re-taper l'API à chaque requête.
_cache = {"artist": None, "albums": None, "albums_ts": 0.0}
CACHE_TTL_SECONDS = 3600
_track_cache: dict[int, list[dict]] = {}  # album_id -> tracks


async def _get(client: httpx.AsyncClient, path: str, **params) -> dict:
    resp = await client.get(f"{DEEZER}{path}", params=params, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    if isinstance(data, dict) and data.get("error"):
        raise RuntimeError(data["error"].get("message", "Erreur API Deezer"))
    return data


async def _find_jul_artist(client: httpx.AsyncClient) -> dict:
    data = await _get(client, "/search/artist", q="JUL")
    results = data.get("data", [])
    if not results:
        raise RuntimeError("Artiste JUL introuvable sur Deezer.")

    # Plusieurs artistes s'appellent exactement "Jul" sur Deezer (le mot
    # signifie "Noël" en suédois/norvégien, donc des compilations de Noël
    # matchent aussi). On isole les correspondances exactes du nom, puis on
    # garde celle qui a le plus de fans : le rappeur français en a des
    # millions, très loin devant n'importe quel autre "Jul".
    exact = [a for a in results if a["name"].strip().lower() == "jul"]
    candidates = exact or results
    return max(candidates, key=lambda a: a.get("nb_fan", 0))


async def get_catalog(force: bool = False) -> tuple[dict, list[dict]]:
    """Retourne (artiste, liste des albums) avec mise en cache."""
    now = time.time()
    if not force and _cache["albums"] and now - _cache["albums_ts"] < CACHE_TTL_SECONDS:
        return _cache["artist"], _cache["albums"]

    async with httpx.AsyncClient() as client:
        artist = await _find_jul_artist(client)
        data = await _get(client, f"/artist/{artist['id']}/albums", limit=200)

    albums = []
    for a in data.get("data", []):
        year: Optional[int] = None
        if a.get("release_date"):
            try:
                year = int(a["release_date"][:4])
            except ValueError:
                pass
        albums.append({
            "id": a["id"],
            "title": a["title"],
            "cover": a.get("cover_medium"),
            "year": year,
        })
    albums.sort(key=lambda a: (a["year"] or 0), reverse=True)

    if not albums:
        raise RuntimeError("Aucun album trouvé pour cet artiste.")

    _cache["artist"] = artist
    _cache["albums"] = albums
    _cache["albums_ts"] = now
    return artist, albums


async def get_tracks_for_albums(album_ids: list[int]) -> list[dict]:
    """Récupère les morceaux (avec extrait audio) des albums demandés."""
    tracks_by_id: dict[int, dict] = {}
    async with httpx.AsyncClient() as client:
        for album_id in album_ids:
            if album_id in _track_cache:
                tracks = _track_cache[album_id]
            else:
                data = await _get(client, f"/album/{album_id}")
                cover = data.get("cover_medium")
                title = data.get("title")
                tracks = []
                for t in data.get("tracks", {}).get("data", []):
                    if not t.get("preview"):
                        continue
                    tracks.append({
                        "id": t["id"],
                        "title": t["title"],
                        "title_short": t.get("title_short") or t["title"],
                        "preview": t["preview"],
                        "album": {"title": title, "cover": cover},
                    })
                _track_cache[album_id] = tracks
            for t in tracks:
                tracks_by_id[t["id"]] = t
    return list(tracks_by_id.values())
