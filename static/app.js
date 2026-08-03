(function () {
  const el = id => document.getElementById(id);
  const screens = ['home', 'multi-entry', 'lobby', 'setup', 'loading', 'game', 'end', 'end-multi'];
  function showScreen(name) {
    screens.forEach(s => el('screen-' + s).classList.toggle('active', s === name));
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* ---------------- backend REST helpers ---------------- */
  async function apiGet(path) {
    const res = await fetch(path);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `Erreur serveur (${res.status})`);
    }
    return res.json();
  }
  async function apiPost(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error(b.detail || `Erreur serveur (${res.status})`);
    }
    return res.json();
  }

  /* ---------------- catalogue partagé (évite de refaire l'appel pour solo + multi) ---------------- */
  let catalogCache = null;
  async function ensureCatalog() {
    if (catalogCache) return catalogCache;
    catalogCache = await apiGet('/api/catalog');
    return catalogCache;
  }

  function applyHeroVisuals(data) {
    const pic = data.artist && data.artist.picture;
    if (pic) {
      const backdrop = el('page-backdrop');
      backdrop.style.backgroundImage = `url('${pic}')`;
      backdrop.classList.add('loaded');
      const avatar = el('hero-photo');
      avatar.src = pic;
      avatar.style.display = 'block';
    }
    const strip = el('home-filmstrip');
    if (strip && data.albums && data.albums.length) {
      strip.innerHTML = '';
      data.albums.slice(0, 14).forEach(a => {
        const img = document.createElement('img');
        img.src = a.cover;
        img.alt = a.title;
        img.title = a.title;
        img.onerror = () => { img.style.display = 'none'; };
        strip.appendChild(img);
      });
    }
  }

  // On tente de charger le visuel dès l'arrivée sur la page, sans bloquer l'affichage.
  ensureCatalog().then(applyHeroVisuals).catch(() => { /* le thème générique reste affiché */ });

  /* ---------------- shared album/era filter UI ---------------- */
  function computeEras(albums) {
    const years = albums.map(a => a.year).filter(Boolean).sort((a, b) => a - b);
    if (!years.length) return [];
    const min = years[0], max = years[years.length - 1];
    if (min === max) return [{ label: `${min}`, from: min, to: max }];
    const span = max - min;
    const t1 = min + Math.floor(span / 3);
    const t2 = min + Math.floor(2 * span / 3);
    return [
      { label: `Débuts (${min}–${t1})`, from: min, to: t1 },
      { label: `Milieu (${t1 + 1}–${t2})`, from: t1 + 1, to: t2 },
      { label: `Récent (${t2 + 1}–${max})`, from: t2 + 1, to: max },
    ];
  }

  function renderAlbumFilterUI(prefix, albumsMeta, selectedSet) {
    const eraWrap = el(prefix + 'era-row');
    eraWrap.innerHTML = '';
    const allBtn = document.createElement('div');
    allBtn.className = 'era-btn';
    allBtn.textContent = 'Tout sélectionner';
    allBtn.addEventListener('click', () => { albumsMeta.forEach(a => selectedSet.add(a.id)); renderGrid(); });
    eraWrap.appendChild(allBtn);
    const noneBtn = document.createElement('div');
    noneBtn.className = 'era-btn';
    noneBtn.textContent = 'Tout désélectionner';
    noneBtn.addEventListener('click', () => { selectedSet.clear(); renderGrid(); });
    eraWrap.appendChild(noneBtn);
    computeEras(albumsMeta).forEach(era => {
      const b = document.createElement('div');
      b.className = 'era-btn';
      b.textContent = era.label;
      b.addEventListener('click', () => {
        selectedSet.clear();
        albumsMeta.forEach(a => { if (a.year && a.year >= era.from && a.year <= era.to) selectedSet.add(a.id); });
        renderGrid();
      });
      eraWrap.appendChild(b);
    });

    function renderGrid() {
      const grid = el(prefix + 'album-grid');
      grid.innerHTML = '';
      albumsMeta.forEach(a => {
        const chip = document.createElement('div');
        chip.className = 'album-chip' + (selectedSet.has(a.id) ? ' selected' : '');
        chip.style.backgroundImage = `url('${a.cover}')`;
        chip.title = a.title + (a.year ? ` (${a.year})` : '');
        chip.innerHTML = `<div class="dim"></div><span class="check">✓</span><span class="yr">${a.year || ''}</span>`;
        chip.addEventListener('click', () => {
          if (selectedSet.has(a.id)) selectedSet.delete(a.id); else selectedSet.add(a.id);
          chip.classList.toggle('selected');
          el(prefix + 'albums-sub').textContent = `${selectedSet.size} album(s) sélectionné(s) sur ${albumsMeta.length}.`;
        });
        grid.appendChild(chip);
      });
      el(prefix + 'albums-sub').textContent = `${selectedSet.size} album(s) sélectionné(s) sur ${albumsMeta.length}.`;
    }
    renderGrid();
  }

  function renderPills(containerId, options, getCurrent, onSelect) {
    const wrap = el(containerId);
    wrap.innerHTML = '';
    options.forEach(opt => {
      const p = document.createElement('div');
      p.className = 'pill' + (getCurrent() === opt.value ? ' active' : '');
      p.textContent = opt.label;
      p.addEventListener('click', () => { onSelect(opt.value); renderPills(containerId, options, getCurrent, onSelect); });
      wrap.appendChild(p);
    });
  }

  /* ---------------- home screen ---------------- */
  let playerName = '';

  async function refreshBestBadge() {
    if (!playerName) return;
    try {
      const best = await apiGet(`/api/best-score?player=${encodeURIComponent(playerName)}`);
      const badge = el('best-badge');
      if (best && best.score !== undefined) {
        badge.style.display = 'inline-block';
        badge.innerHTML = `Record perso : <b>${best.score}/${best.rounds}</b>`;
      } else {
        badge.style.display = 'none';
      }
    } catch (e) { /* pas grave si indisponible */ }
  }

  function requireName() {
    playerName = el('player-name').value.trim() || 'Joueur';
    return playerName;
  }

  el('mode-solo').addEventListener('click', () => {
    requireName();
    refreshBestBadge();
    goSoloSetup();
  });
  el('mode-multi').addEventListener('click', () => {
    requireName();
    el('multi-entry-error').innerHTML = '';
    showScreen('multi-entry');
  });
  el('btn-back-home-1').addEventListener('click', () => showScreen('home'));
  el('btn-back-home-2').addEventListener('click', () => showScreen('home'));
  el('btn-back-home-3').addEventListener('click', () => showScreen('home'));

  /* ================================================================
     MODE SOLO
     ================================================================ */
  const solo = {
    albumsMeta: [],
    selectedAlbumIds: new Set(),
    roundsCount: 10,
    snippetSeconds: 15,
    pool: [],
    rounds: [],
    roundIdx: 0,
    correctCount: 0,
    points: 0,
    roundPlayStartTs: null,
    streak: 0,
    bestStreak: 0,
    recapLog: [],
  };

  async function goSoloSetup() {
    showScreen('setup');
    el('setup-error').innerHTML = '';
    if (solo.albumsMeta.length) {
      el('setup-loading').style.display = 'none';
      el('setup-body').style.display = 'block';
      renderSoloControls();
      return;
    }
    el('setup-loading').style.display = 'block';
    el('setup-body').style.display = 'none';
    try {
      const data = await ensureCatalog();
      solo.albumsMeta = data.albums;
      solo.albumsMeta.forEach(a => solo.selectedAlbumIds.add(a.id));
      el('setup-loading').style.display = 'none';
      el('setup-body').style.display = 'block';
      renderSoloControls();
    } catch (e) {
      el('setup-loading').style.display = 'none';
      el('setup-error').innerHTML = `<div class="error-box">${e.message} Réessaie dans quelques secondes.</div>`;
    }
  }

  function renderSoloControls() {
    renderPills('solo-rounds-pills',
      [5, 10, 15, 20].map(n => ({ label: n + ' manches', value: n })),
      () => solo.roundsCount, v => solo.roundsCount = v);
    renderPills('solo-difficulty-pills',
      [{ label: 'Facile (30s)', value: 30 }, { label: 'Moyen (15s)', value: 15 }, { label: 'Difficile (6s)', value: 6 }],
      () => solo.snippetSeconds, v => solo.snippetSeconds = v);
    renderAlbumFilterUI('solo-', solo.albumsMeta, solo.selectedAlbumIds);
  }

  function buildRounds(pool, count) {
    const shuffled = shuffle(pool);
    const rounds = [];
    const usedKeys = new Set();
    for (const track of shuffled) {
      if (rounds.length >= count) break;
      const key = (track.title_short || track.title).toLowerCase().trim();
      if (usedKeys.has(key)) continue;
      const others = shuffle(pool.filter(t => t.id !== track.id));
      const distractTitles = new Set([key]);
      const distractors = [];
      for (const d of others) {
        const dk = (d.title_short || d.title).toLowerCase().trim();
        if (distractTitles.has(dk)) continue;
        distractTitles.add(dk);
        distractors.push(d);
        if (distractors.length === 3) break;
      }
      if (distractors.length < 3) continue;
      usedKeys.add(key);
      rounds.push({ track, options: shuffle([track, ...distractors]) });
    }
    return rounds;
  }

  el('btn-launch-solo').addEventListener('click', async () => {
    el('setup-error').innerHTML = '';
    showScreen('loading');
    setLoader('Récupération des morceaux sélectionnés...');
    try {
      let ids = Array.from(solo.selectedAlbumIds);
      if (!ids.length) ids = solo.albumsMeta.map(a => a.id);
      let data = await apiPost('/api/tracks', { album_ids: ids });
      let pool = data.tracks;
      if (pool.length < 4) {
        setLoader('Pas assez de titres sur cette sélection, ajout du catalogue complet...');
        data = await apiPost('/api/tracks', { album_ids: solo.albumsMeta.map(a => a.id) });
        pool = data.tracks;
      }
      solo.pool = pool;
      const count = Math.min(solo.roundsCount, pool.length);
      if (count < 2) throw new Error("Pas assez de titres avec extrait disponible pour cette sélection.");
      solo.rounds = buildRounds(pool, count);
      solo.roundIdx = 0; solo.correctCount = 0; solo.points = 0; solo.streak = 0; solo.bestStreak = 0; solo.recapLog = [];
      el('hud-score-wrap').style.display = 'inline';
      el('live-scores').style.display = 'none';
      showScreen('game');
      renderSoloRound();
    } catch (e) {
      showScreen('setup');
      el('setup-error').innerHTML = `<div class="error-box">${e.message}</div>`;
    }
  });

  el('btn-change-settings').addEventListener('click', goSoloSetup);
  el('btn-replay').addEventListener('click', () => el('btn-launch-solo').click());

  const audio = el('audio-player');
  let snippetTimer = null;

  // L'égaliseur et le bras de platine réagissent directement aux événements
  // natifs de l'élément <audio> : quel que soit l'endroit du code qui
  // démarre/arrête la lecture (solo ou multi), l'affichage reste synchronisé
  // sans avoir à dupliquer la logique à chaque appel.
  audio.addEventListener('play', () => {
    el('eq-bars').classList.add('playing');
    el('tonearm').classList.add('down');
  });
  audio.addEventListener('pause', () => {
    el('eq-bars').classList.remove('playing');
    el('tonearm').classList.remove('down');
  });

  function burstParticles(originEl) {
    if (!originEl) return;
    const rect = originEl.getBoundingClientRect();
    const colors = ['#E3A857', '#FF6F59', '#ffe3b0'];
    for (let i = 0; i < 14; i++) {
      const p = document.createElement('div');
      p.className = 'particle';
      const angle = Math.random() * Math.PI * 2;
      const dist = 50 + Math.random() * 70;
      p.style.setProperty('--dx', Math.cos(angle) * dist + 'px');
      p.style.setProperty('--dy', Math.sin(angle) * dist + 'px');
      p.style.background = colors[i % colors.length];
      p.style.left = (rect.left + rect.width / 2) + 'px';
      p.style.top = (rect.top + rect.height / 2) + 'px';
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 720);
    }
  }

  // Effet de bascule 3D au survol des cartes de mode (Solo / Multijoueur)
  document.querySelectorAll('.mode-card').forEach(card => {
    card.addEventListener('mousemove', (e) => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      card.style.transform = `rotateY(${px * 10}deg) rotateX(${-py * 10}deg) translateY(-2px)`;
    });
    card.addEventListener('mouseleave', () => { card.style.transform = ''; });
  });

  function updateStreakDisplay() {
    el('hud-streak').textContent = solo.streak >= 2 ? `🔥 x${solo.streak}` : '';
  }

  function renderSoloRound() {
    const r = solo.rounds[solo.roundIdx];
    el('hud-round').textContent = solo.roundIdx + 1;
    el('hud-total').textContent = solo.rounds.length;
    el('hud-score').textContent = solo.points;
    updateStreakDisplay();
    el('feedback').textContent = '';
    el('feedback').className = 'feedback';
    el('track-reveal').textContent = '';
    el('btn-next').style.display = 'none';
    el('progress-fill').style.width = '0%';
    el('disc-cover').style.backgroundImage = `url('${(r.track.album && r.track.album.cover) || ''}')`;

    solo.roundPlayStartTs = null;
    clearTimeout(snippetTimer);
    audio.pause();
    audio.src = r.track.preview;
    audio.currentTime = 0;

    const optsWrap = el('options');
    optsWrap.innerHTML = '';
    r.options.forEach((opt, idx) => {
      const btn = document.createElement('button');
      btn.className = 'option';
      btn.innerHTML = `<span class="key">${idx + 1}</span>${opt.title_short || opt.title}`;
      btn.addEventListener('click', () => handleSoloAnswer(opt, r));
      optsWrap.appendChild(btn);
    });

    el('btn-play').disabled = false;
    el('btn-play').textContent = "▶ Écouter l'extrait";
    el('disc').classList.remove('spinning');
    el('btn-play').onclick = () => {
      // Le chrono du bonus de rapidité démarre au premier lancement de
      // l'extrait (et pas avant), pour ne pas pénaliser le temps de
      // réflexion avant de cliquer sur "Écouter".
      if (solo.roundPlayStartTs === null) solo.roundPlayStartTs = Date.now();
      playSnippet(solo.snippetSeconds);
    };
  }

  function playSnippet(snippetSeconds) {
    clearTimeout(snippetTimer);
    audio.currentTime = 0;
    audio.play().catch(() => {});
    el('disc').classList.add('spinning');
    const limitMs = snippetSeconds * 1000;
    const start = Date.now();
    const tick = () => {
      const elapsed = Date.now() - start;
      el('progress-fill').style.width = Math.min(100, (elapsed / limitMs) * 100) + '%';
      if (elapsed < limitMs && !audio.paused) requestAnimationFrame(tick);
    };
    tick();
    snippetTimer = setTimeout(() => { audio.pause(); el('disc').classList.remove('spinning'); }, limitMs);
  }

  function handleSoloAnswer(chosen, r) {
    const correctKey = (r.track.title_short || r.track.title).toLowerCase().trim();
    const chosenKey = (chosen.title_short || chosen.title).toLowerCase().trim();
    const isCorrect = chosenKey === correctKey;

    [...el('options').children].forEach(btn => {
      btn.disabled = true;
      const label = btn.textContent.replace(/^\d+/, '').trim();
      if (label.toLowerCase() === correctKey) btn.classList.add('correct');
    });
    if (!isCorrect) {
      [...el('options').children].forEach(btn => {
        const label = btn.textContent.replace(/^\d+/, '').trim();
        if (label.toLowerCase() === chosenKey) btn.classList.add('wrong');
      });
    }

    let gained = 0;
    if (isCorrect) {
      const elapsedSec = solo.roundPlayStartTs !== null
        ? (Date.now() - solo.roundPlayStartTs) / 1000
        : solo.snippetSeconds; // jamais écouté -> pas de bonus de rapidité
      const speedRatio = Math.max(0, 1 - Math.min(elapsedSec, solo.snippetSeconds) / solo.snippetSeconds);
      gained = Math.round(100 + 900 * speedRatio);
      solo.correctCount++;
      solo.points += gained;
      solo.streak++;
      solo.bestStreak = Math.max(solo.bestStreak, solo.streak);
      if (solo.streak >= 3) burstParticles(el('hud-streak'));
    } else {
      solo.streak = 0;
    }

    el('feedback').textContent = isCorrect ? `Bonne réponse ! +${gained} pts` : 'Raté !';
    el('feedback').className = 'feedback ' + (isCorrect ? 'ok' : 'bad');
    el('hud-score').textContent = solo.points;
    updateStreakDisplay();

    solo.recapLog.push({ title: r.track.title, correct: isCorrect });

    el('disc').classList.add('revealed');
    el('disc').classList.remove('spinning');
    el('track-reveal').innerHTML = `<b>${r.track.title}</b> — ${(r.track.album && r.track.album.title) || ''}`;

    clearTimeout(snippetTimer);
    audio.pause();
    el('btn-play').disabled = true;

    el('btn-next').textContent = solo.roundIdx === solo.rounds.length - 1 ? 'Voir mon score' : 'Manche suivante';
    el('btn-next').style.display = 'inline-block';
    el('btn-next').onclick = nextSoloRoundOrFinish;
  }

  function nextSoloRoundOrFinish() {
    // On retourne le disque vers sa face mystère AVANT de changer la pochette
    // affichée au dos, pour éviter que la prochaine pochette n'apparaisse
    // furtivement pendant l'animation.
    el('disc').classList.remove('revealed');
    el('btn-next').style.display = 'none';
    setTimeout(() => {
      solo.roundIdx++;
      if (solo.roundIdx >= solo.rounds.length) finishSolo();
      else renderSoloRound();
    }, 620);
  }

  async function finishSolo() {
    audio.pause();
    el('final-score').textContent = `${solo.points}`;
    el('final-score-unit').textContent = 'points';
    const ratio = solo.correctCount / solo.rounds.length;
    let tier;
    if (ratio >= 0.9) tier = "Toi t'es OKLM sur JUL, respect.";
    else if (ratio >= 0.6) tier = "Sacré niveau, tu connais tes classiques.";
    else if (ratio >= 0.3) tier = "Pas mal, mais y'a du son à rattraper.";
    else tier = "Retour aux playlists, wesh !";
    let tierLine = `${tier} (${solo.correctCount}/${solo.rounds.length} bonnes réponses`;
    tierLine += solo.bestStreak >= 3 ? `, série max : ${solo.bestStreak})` : ')';
    el('final-tier').textContent = tierLine;

    const recapEl = el('recap');
    recapEl.innerHTML = '';
    solo.recapLog.forEach(item => {
      const row = document.createElement('div');
      row.className = 'recap-item ' + (item.correct ? 'ok' : 'bad');
      row.innerHTML = `<span class="mark">${item.correct ? '✓' : '✗'}</span><span class="rt">${item.title}</span>`;
      recapEl.appendChild(row);
    });

    el('new-record').style.display = 'none';
    try {
      const result = await apiPost('/api/best-score', { player: playerName, score: solo.correctCount, rounds: solo.rounds.length });
      if (result.is_new_record) { el('new-record').style.display = 'block'; burstParticles(el('new-record')); }
    } catch (e) { /* pas grave */ }
    refreshBestBadge();

    showScreen('end');
  }

  document.addEventListener('keydown', (e) => {
    if (!el('screen-game').classList.contains('active')) return;
    if (e.key >= '1' && e.key <= '4') {
      const btn = el('options').children[parseInt(e.key, 10) - 1];
      if (btn && !btn.disabled) btn.click();
    } else if (e.code === 'Space') {
      e.preventDefault();
      if (el('btn-next').style.display !== 'none') el('btn-next').click();
      else if (!el('btn-play').disabled) el('btn-play').click();
    }
  });

  function setLoader(msg) { el('loader-text').textContent = msg; }

  /* ================================================================
     MODE MULTIJOUEUR
     ================================================================ */
  const multi = {
    ws: null,
    code: null,
    isHost: false,
    albumsMeta: [],
    selectedAlbumIds: new Set(),
    roundsCount: 10,
    snippetSeconds: 15,
    myId: null,
  };

  el('btn-create-room').addEventListener('click', async () => {
    el('multi-entry-error').innerHTML = '';
    try {
      const data = await apiPost('/api/rooms', {});
      await connectRoom(data.code, true);
    } catch (e) {
      el('multi-entry-error').innerHTML = `<div class="error-box">${e.message}</div>`;
    }
  });

  el('btn-join-room').addEventListener('click', async () => {
    const code = el('join-code').value.trim().toUpperCase();
    el('multi-entry-error').innerHTML = '';
    if (!code) { el('multi-entry-error').innerHTML = `<div class="error-box">Entre un code de salon.</div>`; return; }
    await connectRoom(code, false);
  });

  el('btn-leave-lobby').addEventListener('click', () => {
    if (multi.ws) multi.ws.close();
    showScreen('home');
  });

  async function connectRoom(code, asHost) {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/ws/${code}?name=${encodeURIComponent(playerName)}`);
    multi.ws = ws;
    multi.code = code;
    multi.isHost = asHost;

    ws.addEventListener('open', () => {
      el('lobby-code').textContent = code;
      el('lobby-error').innerHTML = '';
      showScreen('lobby');
    });

    ws.addEventListener('close', (ev) => {
      if (ev.code === 4404) {
        el('multi-entry-error').innerHTML = `<div class="error-box">Salon introuvable. Vérifie le code.</div>`;
        showScreen('multi-entry');
      }
    });

    ws.addEventListener('error', () => {
      el('multi-entry-error').innerHTML = `<div class="error-box">Connexion au salon impossible.</div>`;
    });

    ws.addEventListener('message', (ev) => handleWsMessage(JSON.parse(ev.data)));

    if (!multi.albumsMeta.length) {
      try {
        const data = await ensureCatalog();
        multi.albumsMeta = data.albums;
        multi.albumsMeta.forEach(a => multi.selectedAlbumIds.add(a.id));
        if (multi.isHost) renderMultiHostControls();
      } catch (e) { /* on retentera si l'hôte ouvre les réglages */ }
    } else if (multi.isHost) {
      renderMultiHostControls();
    }
  }

  function renderMultiHostControls() {
    el('host-setup').style.display = 'block';
    el('waiting-host-msg').style.display = 'none';
    renderPills('rounds-pills',
      [5, 10, 15, 20].map(n => ({ label: n + ' manches', value: n })),
      () => multi.roundsCount, v => multi.roundsCount = v);
    renderPills('difficulty-pills',
      [{ label: 'Facile (30s)', value: 30 }, { label: 'Moyen (15s)', value: 15 }, { label: 'Difficile (6s)', value: 6 }],
      () => multi.snippetSeconds, v => multi.snippetSeconds = v);
    renderAlbumFilterUI('', multi.albumsMeta, multi.selectedAlbumIds);
  }

  el('btn-start-multi').addEventListener('click', () => {
    let ids = Array.from(multi.selectedAlbumIds);
    if (!ids.length) ids = multi.albumsMeta.map(a => a.id);
    multi.ws.send(JSON.stringify({
      type: 'start_game',
      settings: { rounds: multi.roundsCount, snippet_seconds: multi.snippetSeconds, album_ids: ids },
    }));
  });

  function handleWsMessage(msg) {
    switch (msg.type) {
      case 'lobby_update': {
        el('lobby-code').textContent = multi.code;
        const list = el('lobby-players');
        list.innerHTML = '';
        msg.players.forEach(p => {
          const row = document.createElement('div');
          row.className = 'player-row';
          row.innerHTML = `<span>${p.name}</span>${p.host ? '<span class="badge">HÔTE</span>' : ''}`;
          list.appendChild(row);
        });
        const mine = msg.players.find(p => p.host) || {};
        if (!multi.isHost) el('waiting-host-msg').style.display = 'block';
        break;
      }
      case 'error': {
        el('lobby-error').innerHTML = `<div class="error-box">${msg.message}</div>`;
        break;
      }
      case 'round_start': {
        showScreen('game');
        el('hud-score-wrap').style.display = 'none';
        el('live-scores').style.display = 'none';
        renderMultiRound(msg);
        break;
      }
      case 'answer_ack': {
        el('feedback').textContent = msg.correct ? `Bonne réponse ! +${msg.gained} pts (total : ${msg.score})` : 'Raté ! En attente des autres...';
        el('feedback').className = 'feedback ' + (msg.correct ? 'ok' : 'bad');
        if (msg.correct) burstParticles(el('feedback'));
        break;
      }
      case 'round_reveal': {
        renderMultiReveal(msg);
        break;
      }
      case 'game_over': {
        renderMultiGameOver(msg.ranking);
        break;
      }
      default: break;
    }
  }

  function renderMultiRound(msg) {
    el('hud-round').textContent = msg.round_index + 1;
    el('hud-total').textContent = msg.total;
    el('hud-streak').textContent = '';
    el('feedback').textContent = '';
    el('feedback').className = 'feedback';
    el('track-reveal').textContent = '';
    el('btn-next').style.display = 'none';
    el('progress-fill').style.width = '0%';
    el('disc').classList.remove('revealed');
    el('disc-cover').style.backgroundImage = '';

    clearTimeout(snippetTimer);
    audio.pause();
    audio.src = msg.preview;
    audio.currentTime = 0;

    const optsWrap = el('options');
    optsWrap.innerHTML = '';
    const shuffledOptions = msg.options; // déjà mélangées côté serveur
    shuffledOptions.forEach((opt, idx) => {
      const btn = document.createElement('button');
      btn.className = 'option';
      btn.innerHTML = `<span class="key">${idx + 1}</span>${opt.title}`;
      btn.addEventListener('click', () => {
        [...optsWrap.children].forEach(b => { b.disabled = true; });
        btn.classList.add('chosen');
        el('feedback').textContent = 'Réponse envoyée, en attente des autres...';
        el('feedback').className = 'feedback wait';
        multi.ws.send(JSON.stringify({ type: 'answer', option_id: opt.id }));
      });
      optsWrap.appendChild(btn);
    });

    el('btn-play').disabled = false;
    el('btn-play').textContent = "▶ Écouter l'extrait";
    el('btn-play').onclick = () => playSnippet(msg.snippet_seconds);
    // Auto-play dès le début de la manche pour que tout le monde parte en même temps.
    playSnippet(msg.snippet_seconds);
  }

  function renderMultiReveal(msg) {
    clearTimeout(snippetTimer);
    audio.pause();
    [...el('options').children].forEach(btn => {
      btn.disabled = true;
      const label = btn.textContent.replace(/^\d+/, '').trim();
      // on ne connaît l'id correct que via msg.correct_option_id, pas le titre -> comparer par data
    });
    el('disc-cover').style.backgroundImage = `url('${msg.track.cover || ''}')`;
    el('disc').classList.add('revealed');
    el('disc').classList.remove('spinning');
    el('track-reveal').innerHTML = `<b>${msg.track.title}</b> — ${msg.track.album || ''}`;
    el('feedback').textContent = '';

    const list = el('live-scores');
    list.style.display = 'block';
    list.innerHTML = '';
    const ranked = msg.players.slice().sort((a, b) => b.score - a.score);
    ranked.forEach(p => {
      const row = document.createElement('div');
      row.className = 'player-row';
      row.innerHTML = `<span>${p.name}</span><span class="pts">${p.score} pts</span>`;
      list.appendChild(row);
    });
  }

  function renderMultiGameOver(ranking) {
    const list = el('ranking-list');
    list.innerHTML = '';
    ranking.forEach((p, idx) => {
      const row = document.createElement('div');
      row.className = 'ranking-row' + (idx === 0 ? ' gold' : '');
      row.innerHTML = `<span class="pos">#${idx + 1}</span><span class="nm">${p.name}</span><span class="sc">${p.score} pts</span>`;
      list.appendChild(row);
    });
    showScreen('end-multi');
  }
})();
