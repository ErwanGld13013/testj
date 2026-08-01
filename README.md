# Blind Test JUL — version Python (FastAPI)

Backend Python (FastAPI) + petit frontend HTML/JS, avec un mode **solo** et un
mode **multijoueur** en temps réel (WebSocket).

## Pourquoi une version Python ?

La version précédente (un seul fichier HTML) devait contourner la politique
CORS des navigateurs pour appeler l'API Deezer (JSONP, proxys tiers, parfois
instables). Ici, le serveur Python appelle Deezer lui-même : un serveur qui
appelle un autre serveur n'est jamais bloqué par CORS. En bonus, ça permet un
vrai multijoueur : le serveur devient l'arbitre qui envoie le même morceau,
au même moment, à tous les joueurs d'un salon, et calcule les scores.

## 1. Prérequis

- Python 3.10 ou plus récent (`python3 --version` pour vérifier)
- Une connexion internet (pour interroger l'API Deezer)

## 2. Installation

Ouvre un terminal dans le dossier du projet :

```bash
cd blindtest-jul-python

# Crée un environnement virtuel (recommandé, évite de polluer ton Python global)
python3 -m venv venv
source venv/bin/activate        # sur Windows : venv\Scripts\activate

# Installe les dépendances
pip install -r requirements.txt
```

## 3. Lancer le serveur

```bash
uvicorn app.main:app --reload
```

Puis ouvre ton navigateur sur : **http://127.0.0.1:8000**

`--reload` relance automatiquement le serveur quand tu modifies le code
(pratique en développement — à retirer en production).

## 4. Utilisation

- **Solo** : entre un pseudo, clique "Solo", choisis tes réglages (nombre de
  manches, difficulté, albums), lance la partie. Ton meilleur score est
  sauvegardé dans un fichier `blindtest.db` (SQLite) à la racine du projet.
- **Multijoueur** :
  1. Un joueur clique "Multijoueur" → "Créer un salon" → obtient un code à 5
     caractères.
  2. Il le partage aux autres joueurs (message, oral, etc.).
  3. Les autres cliquent "Multijoueur" → "Rejoindre un salon" → entrent le
     code.
  4. Une fois tout le monde dans le salon, **l'hôte** choisit les réglages et
     clique "Lancer la partie".
  5. Chaque manche : tout le monde entend le même extrait en même temps,
     répond, et gagne des points selon la rapidité de sa réponse (jusqu'à
     1000 points pour une bonne réponse immédiate, 100 minimum si elle est
     correcte mais tardive).
  6. Classement final affiché à la fin.

## 5. Structure du projet

```
blindtest-jul-python/
├── requirements.txt
├── blindtest.db              # créé automatiquement (scores solo)
├── app/
│   ├── main.py                # routes FastAPI (REST + WebSocket)
│   ├── deezer_client.py       # appels à l'API Deezer (côté serveur, sans CORS)
│   ├── rooms.py                # logique des salons multijoueurs + boucle de jeu
│   └── db.py                   # sauvegarde SQLite du record personnel (solo)
└── static/
    ├── index.html
    ├── style.css
    └── app.js                  # toute la logique frontend (solo + multi)
```

## 6. Comment ça marche techniquement

- **`deezer_client.py`** cherche l'artiste "JUL" sur Deezer (en excluant les
  autres artistes homonymes — "Jul" signifie aussi "Noël" en
  suédois/norvégien — en gardant celui qui a le plus de fans), récupère ses
  albums, puis les morceaux (avec extrait audio de 30s) à la demande.
- **`rooms.py`** gère chaque salon multijoueur comme une petite machine à
  états : `lobby` → `playing` → `finished`. Une tâche asynchrone
  (`asyncio.create_task`) fait dérouler les manches automatiquement
  (diffusion du morceau, pause pour les réponses, révélation, pause, manche
  suivante), avec le serveur comme unique source de vérité — aucun joueur ne
  peut trafiquer son score car les points sont calculés côté serveur à
  partir de l'horodatage réel de la réponse.
- **`app.js`** gère l'affichage (solo et multi partagent le même écran de
  jeu) et communique soit par simples appels HTTP (solo), soit par
  WebSocket (multi, pour du temps réel).

## 7. Pistes pour aller plus loin

- **Déploiement en ligne** : héberger sur Render, Railway ou Fly.io pour
  jouer entre potes sans être sur le même réseau (actuellement ça tourne en
  local sur `127.0.0.1`).
- **Persistance des salons** : actuellement les salons vivent en mémoire et
  disparaissent si le serveur redémarre. Une base (Postgres/Redis) serait
  utile pour un usage à plus grande échelle.
- **Mode "devine l'année"** ou **mode buzzer compétitif** (premier qui
  répond correctement gagne la manche, façon Kahoot) : facile à ajouter dans
  `rooms.py`, la logique de scoring y est déjà isolée.
- **Reconnexion** : si un joueur perd sa connexion WebSocket en cours de
  partie, il est actuellement retiré du salon — un système de
  reconnexion par identifiant persistant serait la prochaine amélioration
  naturelle.
