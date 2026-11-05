(() => {
  "use strict";

  // ---------- Constants ----------
  // Dial values run 0 (far left) .. 100 (far right). Zone half-widths, in dial units:
  const ZONES = [
    { half: 2.5, points: 4, cls: "z4" },
    { half: 7.5, points: 3, cls: "z3" },
    { half: 12.5, points: 2, cls: "z2" },
  ];
  const CX = 100, CY = 100, R = 95;
  const STORE = { prefs: "otsw.prefs", custom: "otsw.custom", theme: "otsw.theme" };
  const THEMES = [
    ["system", "System"], ["light", "Light"], ["dark", "Dark"], ["neon", "Neon"],
    ["retro", "Retro"], ["pastel", "Pastel"], ["halloween", "Halloween"],
    ["winter", "Winter"], ["valentine", "Valentine"],
  ];

  // ---------- Storage helpers (never throw) ----------
  const load = (k, fallback) => {
    try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) n.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids) if (kid != null) n.append(kid);
    return n;
  };
  const svgEl = (tag, attrs = {}) => {
    const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };

  // ---------- State ----------
  const defaults = {
    mode: "duo",
    players: ["Player 1", "Player 2"],
    teams: ["Team 1", "Team 2"],
    decks: ["deep-talk", "get-to-know", "just-us"],
    targetSource: "honest",
    timer: 0,
    steal: true,
  };
  const MODE_DECKS = {
    duo: ["deep-talk", "get-to-know", "just-us"],
    teams: ["classic", "get-to-know", "food", "pop"],
  };
  const prefs = Object.assign({}, defaults, load(STORE.prefs, {}));
  // Migrate settings saved by earlier versions.
  if (prefs.mode === "couple") prefs.mode = "duo";
  if (Array.isArray(prefs.partners)) { prefs.players = prefs.partners; delete prefs.partners; }
  prefs.players = (prefs.players || defaults.players).map((n, i) => (/^Partner [12]$/.test(n) ? `Player ${i + 1}` : n));
  const RENAMED = { "couples-therapy": "deep-talk", "couples-everyday": "get-to-know" };
  const hadOldDeep = (prefs.decks || []).includes("couples-therapy");
  prefs.decks = [...new Set((prefs.decks || []).map((d) => RENAMED[d] || d).concat(hadOldDeep ? ["just-us"] : []))];
  let customCards = load(STORE.custom, []);
  if (!Array.isArray(customCards)) customCards = [];

  const game = {
    phase: "setup",       // setup | psychic | guess | steal | reveal
    mode: "duo",
    players: [],          // [{ name, score }] — two players (duo) or teams
    turn: 0,              // index of current psychic (player/team)
    sharedScore: 0,
    stats: { rounds: 0, bulls: 0, streak: 0, bestStreak: 0 },
    card: null,
    target: 50,
    needle: 50,
    targetVisible: true,
    stealGuess: null,
    lastPoints: 0,
    lastSteal: null,
    pool: [], poolPos: 0,
    timerId: null, timerEnd: 0,
  };

  // ---------- Theme ----------
  const mql = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function applyTheme(name) {
    const real = name === "system" ? (mql && mql.matches ? "dark" : "light") : name;
    document.documentElement.dataset.theme = real;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#ffffff";
  }
  function initTheme() {
    const sel = $("themeSelect");
    THEMES.forEach(([v, label]) => sel.append(el("option", { value: v }, label)));
    sel.value = load(STORE.theme, "system");
    if (!THEMES.some(([v]) => v === sel.value)) sel.value = "system";
    applyTheme(sel.value);
    sel.addEventListener("change", () => { save(STORE.theme, sel.value); applyTheme(sel.value); });
    if (mql && mql.addEventListener) mql.addEventListener("change", () => sel.value === "system" && applyTheme("system"));
  }

  // ---------- Setup screen ----------
  let setupTeams = [...prefs.teams];

  function renderMode() {
    document.querySelectorAll(".seg").forEach((b) => b.classList.toggle("active", b.dataset.mode === prefs.mode));
    const duo = prefs.mode === "duo";
    $("duoSetup").classList.toggle("hidden", !duo);
    $("teamsSetup").classList.toggle("hidden", duo);
    $("stealSetting").classList.toggle("hidden", duo);
    $("modeHint").textContent = duo
      ? "Two players take turns being the Psychic and build one shared score."
      : "Teams take turns. The Psychic's own team guesses, and each team keeps its own score.";
  }

  function renderSetupTeams() {
    const list = $("teamList");
    list.replaceChildren();
    setupTeams.forEach((name, i) => {
      const input = el("input", { class: "input", value: name, maxlength: 24, "aria-label": `Team ${i + 1} name` });
      input.addEventListener("input", () => { setupTeams[i] = input.value; });
      const del = el("button", {
        type: "button", class: "icon-btn", "aria-label": "Remove team", disabled: setupTeams.length <= 2,
        onclick: () => { setupTeams.splice(i, 1); renderSetupTeams(); },
      }, "✕");
      list.append(el("li", {}, input, del));
    });
  }

  function renderDeckList() {
    const list = $("deckList");
    list.replaceChildren();
    const decks = [...window.DECKS, { id: "custom", name: "My Spectrums", blurb: `${customCards.length} saved on this device`, cards: customCards }];
    decks.forEach((d) => {
      const cb = el("input", { type: "checkbox", value: d.id, checked: prefs.decks.includes(d.id) });
      cb.addEventListener("change", () => {
        prefs.decks = cb.checked ? [...new Set([...prefs.decks, d.id])] : prefs.decks.filter((x) => x !== d.id);
      });
      list.append(el("label", { class: "deck" }, cb,
        el("span", {}, el("b", {}, d.name), el("small", {}, `${d.blurb} · ${d.cards.length} cards`))));
    });
    $("customCount").textContent = customCards.length;
  }

  function initSetup() {
    $("playerA").value = prefs.players[0] || "";
    $("playerB").value = prefs.players[1] || "";
    $("targetSource").value = prefs.targetSource;
    $("timerSelect").value = String(prefs.timer);
    $("stealToggle").checked = !!prefs.steal;

    document.querySelectorAll(".seg").forEach((b) => b.addEventListener("click", () => {
      if (prefs.mode === b.dataset.mode) return;
      prefs.mode = b.dataset.mode;
      // Sensible default target source per mode (still changeable).
      prefs.targetSource = prefs.mode === "duo" ? "honest" : "random";
      $("targetSource").value = prefs.targetSource;
      prefs.decks = [...MODE_DECKS[prefs.mode], ...(prefs.decks.includes("custom") ? ["custom"] : [])];
      renderMode();
      renderDeckList();
    }));
    $("btnAddTeamSetup").addEventListener("click", () => {
      setupTeams.push(`Team ${setupTeams.length + 1}`);
      renderSetupTeams();
    });
    $("btnStart").addEventListener("click", startGame);
    renderMode();
    renderSetupTeams();
    renderDeckList();
  }

  function readSetup() {
    prefs.players = [$("playerA").value.trim() || "Player 1", $("playerB").value.trim() || "Player 2"];
    prefs.teams = setupTeams.map((t, i) => t.trim() || `Team ${i + 1}`);
    prefs.targetSource = $("targetSource").value;
    prefs.timer = Number($("timerSelect").value) || 0;
    prefs.steal = $("stealToggle").checked;
    save(STORE.prefs, prefs);
  }

  // ---------- Custom spectrums ----------
  function renderCustomList() {
    const list = $("customList");
    list.replaceChildren();
    if (!customCards.length) list.append(el("li", { class: "empty" }, "No custom spectrums yet."));
    customCards.forEach((c, i) => {
      list.append(el("li", {},
        el("span", {}, c.q ? el("i", {}, c.q) : null, `${c.l} ↔ ${c.r}`),
        el("button", {
          type: "button", class: "icon-btn", "aria-label": "Delete spectrum",
          onclick: () => { customCards.splice(i, 1); save(STORE.custom, customCards); renderCustomList(); renderDeckList(); },
        }, "✕")));
    });
  }
  function initCustom() {
    $("btnCustom").addEventListener("click", () => { renderCustomList(); $("customDialog").showModal(); });
    $("customForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const l = $("customL").value.trim(), r = $("customR").value.trim(), q = $("customQ").value.trim();
      if (!l || !r) return;
      customCards.push(q ? { q, l, r } : { l, r });
      save(STORE.custom, customCards);
      if (!prefs.decks.includes("custom")) prefs.decks.push("custom");
      $("customL").value = $("customR").value = $("customQ").value = "";
      $("customL").focus();
      renderCustomList();
      renderDeckList();
    });
  }

  // ---------- Deck pool ----------
  function buildPool() {
    const cards = [];
    window.DECKS.forEach((d) => { if (prefs.decks.includes(d.id)) cards.push(...d.cards); });
    if (prefs.decks.includes("custom")) cards.push(...customCards);
    return cards;
  }
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function drawCard() {
    if (game.poolPos >= game.pool.length) {
      const last = game.card;
      shuffle(game.pool);
      if (game.pool.length > 1 && game.pool[0] === last) game.pool.push(game.pool.shift());
      game.poolPos = 0;
    }
    return game.pool[game.poolPos++];
  }

  // ---------- Game flow ----------
  function startGame() {
    readSetup();
    const pool = buildPool();
    if (!pool.length) { alert("Pick at least one deck that has spectrums in it."); return; }
    game.mode = prefs.mode;
    game.players = (game.mode === "duo" ? prefs.players : prefs.teams).map((name) => ({ name, score: 0 }));
    game.turn = 0;
    game.sharedScore = 0;
    game.stats = { rounds: 0, bulls: 0, streak: 0, bestStreak: 0 };
    game.pool = shuffle([...pool]);
    game.poolPos = 0;
    game.card = null;
    $("setupScreen").classList.add("hidden");
    $("gameScreen").classList.remove("hidden");
    newRound();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function randomTarget() { return 4 + Math.random() * 92; }

  function newRound() {
    stopTimer();
    game.card = drawCard();
    game.target = prefs.targetSource === "honest" ? 50 : randomTarget();
    game.needle = 50;
    game.targetVisible = true;
    game.stealGuess = null;
    game.lastSteal = null;
    game.phase = "psychic";
    render();
  }

  function skipQuestion() {
    game.card = drawCard();
    if (prefs.targetSource !== "honest") game.target = randomTarget();
    render();
  }

  function hideForGuessers() {
    if (prefs.targetSource === "honest") game.target = game.needle;
    game.needle = 50;
    game.targetVisible = false;
    game.phase = "guess";
    startTimer();
    render();
  }

  function stealTeamIndex() {
    if (game.mode !== "teams" || !prefs.steal || game.players.length < 2) return -1;
    return (game.turn + 1) % game.players.length;
  }

  function lockGuess() {
    stopTimer();
    game.targetVisible = false;
    if (stealTeamIndex() >= 0) { game.phase = "steal"; render(); }
    else reveal();
  }

  function scoreFor(diff) {
    for (const z of ZONES) if (diff <= z.half) return z.points;
    return 0;
  }

  function reveal() {
    const pts = scoreFor(Math.abs(game.needle - game.target));
    game.lastPoints = pts;
    game.stats.rounds++;
    if (pts === 4) game.stats.bulls++;
    game.stats.streak = pts > 0 ? game.stats.streak + 1 : 0;
    game.stats.bestStreak = Math.max(game.stats.bestStreak, game.stats.streak);

    if (game.mode === "duo") game.sharedScore += pts;
    else game.players[game.turn].score += pts;

    const si = stealTeamIndex();
    if (si >= 0 && game.stealGuess) {
      const actual = game.target < game.needle ? "left" : "right";
      const correct = pts !== 4 && game.stealGuess === actual;
      if (correct) game.players[si].score += 1;
      game.lastSteal = { team: game.players[si].name, correct, bull: pts === 4 };
    }
    game.targetVisible = true;
    game.phase = "reveal";
    render();
  }

  function nextRound() {
    game.turn = (game.turn + 1) % game.players.length;
    newRound();
  }

  function toggleTarget() {
    game.targetVisible = !game.targetVisible;
    render();
  }

  // ---------- Timer ----------
  function startTimer() {
    stopTimer();
    if (!prefs.timer) return;
    game.timerEnd = Date.now() + prefs.timer * 1000;
    game.timerId = setInterval(tickTimer, 250);
    tickTimer();
  }
  function stopTimer() {
    if (game.timerId) clearInterval(game.timerId);
    game.timerId = null;
    $("timer").classList.add("hidden");
  }
  function tickTimer() {
    const t = $("timer");
    const left = Math.max(0, Math.ceil((game.timerEnd - Date.now()) / 1000));
    t.classList.remove("hidden");
    t.classList.toggle("low", left <= 10);
    if (left === 0) {
      t.textContent = "Time's up! Lock it in!";
      clearInterval(game.timerId);
      game.timerId = null;
      try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch { /* ignore */ }
      return;
    }
    t.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  }

  // ---------- Dial geometry ----------
  function pt(v, r) {
    const a = ((180 - v * 1.8) * Math.PI) / 180;
    return [CX + r * Math.cos(a), CY - r * Math.sin(a)];
  }
  function wedge(v1, v2) {
    const [x1, y1] = pt(v1, R), [x2, y2] = pt(v2, R);
    return `M${CX} ${CY} L${x1.toFixed(2)} ${y1.toFixed(2)} A${R} ${R} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
  }
  function drawTarget() {
    const g = $("targetGroup");
    g.replaceChildren();
    if (!game.targetVisible) return;
    const t = game.target;
    // Outermost first so inner zones paint on top.
    [...ZONES].reverse().forEach((z, idx, arr) => {
      const inner = arr[idx + 1] ? arr[idx + 1].half : 0;
      const segs = inner ? [[t - z.half, t - inner], [t + inner, t + z.half]] : [[t - z.half, t + z.half]];
      segs.forEach(([a, b]) => {
        g.append(svgEl("path", { d: wedge(a, b), class: `band ${z.cls}` }));
        const mid = (a + b) / 2;
        if (mid > 1 && mid < 99) {
          const [lx, ly] = pt(mid, 80);
          const txt = svgEl("text", { x: lx.toFixed(2), y: ly.toFixed(2), class: "band-label" });
          txt.textContent = z.points;
          g.append(txt);
        }
      });
    });
  }
  function drawNeedle(show) {
    $("needleGroup").classList.toggle("hidden", !show);
    const [x, y] = pt(game.needle, R - 6);
    const n = $("needle");
    n.setAttribute("x2", x.toFixed(2));
    n.setAttribute("y2", y.toFixed(2));
  }

  function canDrag() {
    return game.phase === "guess" || (game.phase === "psychic" && prefs.targetSource === "honest");
  }

  function initDial() {
    const svg = $("dial");
    let dragging = false;
    const update = (e) => {
      const p = svg.createSVGPoint();
      p.x = e.clientX; p.y = e.clientY;
      const m = svg.getScreenCTM();
      if (!m) return;
      const s = p.matrixTransform(m.inverse());
      let deg = (Math.atan2(CY - s.y, s.x - CX) * 180) / Math.PI;
      if (deg < 0) deg = s.x < CX ? 180 : 0; // below the baseline: snap to nearest end
      game.needle = Math.min(100, Math.max(0, (180 - deg) / 1.8));
      if (game.phase === "psychic") game.target = game.needle;
      drawNeedle(game.phase !== "psychic");
      if (game.phase === "psychic") drawTarget();
    };
    svg.addEventListener("pointerdown", (e) => {
      if (!canDrag()) return;
      dragging = true;
      try { svg.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      update(e);
      e.preventDefault();
    });
    svg.addEventListener("pointermove", (e) => { if (dragging) update(e); });
    const end = () => { dragging = false; };
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);
  }

  // ---------- Rendering ----------
  function btn(label, cls, onclick, extra = {}) {
    return el("button", Object.assign({ type: "button", class: `btn ${cls}`, onclick }, extra), label);
  }
  function toggleBtn() {
    const on = game.targetVisible;
    return btn(on ? "Hide Target" : "Show Target (Psychic only)", "btn-toggle" + (on ? " on" : ""), toggleTarget,
      { "aria-pressed": on ? "true" : "false" });
  }

  function psychicName() { return game.players[game.turn].name; }
  function guesserName() {
    if (game.mode === "duo") return game.players[(game.turn + 1) % game.players.length].name;
    return game.players[game.turn].name;
  }

  function setPill(emoji, label, name) {
    $("pillEmoji").textContent = emoji;
    $("pillLabel").textContent = label;
    $("pillName").textContent = name;
    $("statusPill").classList.toggle("alt", game.turn % 2 === 1);
  }

  const REACTIONS = {
    4: ["Bull's-eye!", "Perfectly in sync.", "Mind reader."],
    3: ["So close!", "Nearly read their mind.", "Great guess."],
    2: ["In the neighborhood.", "Warm, getting there.", "Partly tuned in."],
    0: ["Missed this time.", "Way off. Ask what they meant.", "Different wavelengths."],
  };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  function render() {
    if (game.phase === "setup") return;
    const { card, phase } = game;
    const honest = prefs.targetSource === "honest";
    const actions = $("actions");
    actions.replaceChildren();

    $("labelLeft").textContent = card.l;
    $("labelRight").textContent = card.r;
    $("question").textContent = card.q || "";
    $("question").classList.toggle("hidden", !card.q);
    $("result").classList.add("hidden");
    $("instructions").classList.remove("hidden");
    $("dialFace").classList.toggle("revealed", game.targetVisible);
    $("dial").classList.toggle("draggable", canDrag());

    const peeking = game.targetVisible && (phase === "guess" || phase === "steal");
    $("peekWarning").classList.toggle("hidden", !peeking);

    if (phase === "psychic") {
      setPill("🔮", "PSYCHIC TURN", psychicName());
      $("instructions").textContent = honest
        ? `Only ${psychicName()} looks! Drag on the dial to set your honest answer, then tap “Hide for Guessers”.`
        : `Only ${psychicName()} looks! Think of a clue that points to the target, then tap “Hide for Guessers”.`;
      actions.append(
        btn("Hide for Guessers", "btn-primary", hideForGuessers),
        btn("Skip Question", "btn-secondary", skipQuestion),
        toggleBtn(),
      );
      drawNeedle(false);
    } else if (phase === "guess") {
      setPill("🤔", "NOW GUESSING", guesserName());
      $("instructions").textContent = honest
        ? `${guesserName()}: where did ${psychicName()} put their answer? Drag the needle, then lock it in.`
        : `${guesserName()}: listen to ${psychicName()}'s clue, drag the needle, then lock it in.`;
      actions.append(btn("Lock In Guess", "btn-primary btn-wide", lockGuess), toggleBtn());
      drawNeedle(true);
    } else if (phase === "steal") {
      const st = game.players[stealTeamIndex()].name;
      setPill("🕵️", "STEAL CHANCE", st);
      $("instructions").textContent = `${st}: is the target LEFT or RIGHT of the needle? A correct call earns 1 point.`;
      actions.append(
        btn("◀ Left", "btn-primary", () => { game.stealGuess = "left"; reveal(); }),
        btn("Right ▶", "btn-primary", () => { game.stealGuess = "right"; reveal(); }),
        toggleBtn(),
      );
      drawNeedle(true);
    } else if (phase === "reveal") {
      const pts = game.lastPoints;
      setPill("🏆", "POINTS AWARDED", game.mode === "duo" ? "Shared score" : psychicName());
      $("instructions").classList.add("hidden");
      const res = $("result");
      res.replaceChildren();
      const head = game.mode === "duo" ? `+${pts} point${pts === 1 ? "" : "s"}!` : `${psychicName()} scored ${pts} point${pts === 1 ? "" : "s"}!`;
      res.append(head, el("small", {}, pick(REACTIONS[pts])));
      if (game.lastSteal) {
        const s = game.lastSteal;
        res.append(el("small", {}, s.bull ? `Bull's-eye, so no steal for ${s.team}.` : s.correct ? `${s.team} stole 1 point!` : `${s.team}'s steal missed.`));
      }
      res.classList.remove("hidden");
      actions.append(btn("Next Round", "btn-primary btn-wide", nextRound));
      drawNeedle(true);
    }

    drawTarget();
    renderScores();
  }

  function renderScores() {
    const list = $("scoreList");
    list.replaceChildren();
    const duo = game.mode === "duo";
    const rename = (p) => () => {
      const name = prompt("Rename", p.name);
      if (name && name.trim()) { p.name = name.trim().slice(0, 24); render(); }
    };

    game.players.forEach((p, i) => {
      const active = i === game.turn;
      const nameBtn = el("button", { type: "button", class: "team-name", onclick: rename(p) }, p.name);
      let middle, right;
      if (duo) {
        middle = el("span", { class: "hint", style: "margin:0" }, active ? "Psychic" : "Guesser");
        right = el("span");
      } else {
        middle = el("span", { class: "score" }, String(p.score));
        right = el("span", { class: "score-adjust" },
          el("button", { type: "button", class: "icon-btn", "aria-label": `Minus 1 for ${p.name}`, onclick: () => { p.score--; renderScores(); } }, "−"),
          el("button", { type: "button", class: "icon-btn", "aria-label": `Plus 1 for ${p.name}`, onclick: () => { p.score++; renderScores(); } }, "+"),
          el("button", {
            type: "button", class: "icon-btn", "aria-label": `Delete ${p.name}`, disabled: game.players.length <= 2,
            onclick: () => deleteTeam(i),
          }, "✕"));
      }
      list.append(el("li", { class: active ? "active" : "" }, nameBtn, middle, right));
    });

    if (duo) {
      list.append(el("li", {},
        el("span", { class: "team-name", style: "cursor:default" }, "Shared score"),
        el("span", { class: "score" }, String(game.sharedScore)),
        el("span", { class: "score-adjust" },
          el("button", { type: "button", class: "icon-btn", "aria-label": "Minus 1", onclick: () => { game.sharedScore--; renderScores(); } }, "−"),
          el("button", { type: "button", class: "icon-btn", "aria-label": "Plus 1", onclick: () => { game.sharedScore++; renderScores(); } }, "+"))));
      const s = game.stats;
      const avg = s.rounds ? (game.sharedScore / s.rounds).toFixed(1) : "–";
      const stats = $("duoStats");
      stats.replaceChildren(
        el("span", {}, "Rounds ", el("b", {}, String(s.rounds))),
        el("span", {}, "Bull's-eyes ", el("b", {}, String(s.bulls))),
        el("span", {}, "Avg ", el("b", {}, avg)),
        el("span", {}, "Best streak ", el("b", {}, String(s.bestStreak))));
    }
    $("duoStats").classList.toggle("hidden", !duo);
    $("btnAddTeamGame").classList.toggle("hidden", duo);
    $("scoreHint").textContent = duo ? "Tap a name to rename." : "Tap a team name to rename. Use − / + to fix a score.";
  }

  function deleteTeam(i) {
    if (game.players.length <= 2) return;
    if (!confirm(`Remove ${game.players[i].name}?`)) return;
    const wasCurrent = i === game.turn;
    game.players.splice(i, 1);
    if (i < game.turn) game.turn--;
    if (game.turn >= game.players.length) game.turn = 0;
    if (wasCurrent && game.phase !== "reveal") newRound();
    else render();
  }

  // ---------- Global buttons ----------
  function initGlobal() {
    $("btnHowTo").addEventListener("click", () => $("howToDialog").showModal());
    $("btnNewGame").addEventListener("click", () => {
      if (game.phase !== "setup" && !confirm("Start a new game? Current scores will be cleared.")) return;
      stopTimer();
      game.phase = "setup";
      setupTeams = game.mode === "teams" ? game.players.map((p) => p.name) : setupTeams;
      if (game.mode === "duo" && game.players.length === 2) {
        $("playerA").value = game.players[0].name;
        $("playerB").value = game.players[1].name;
      }
      renderSetupTeams();
      renderDeckList();
      $("gameScreen").classList.add("hidden");
      $("setupScreen").classList.remove("hidden");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    $("btnAddTeamGame").addEventListener("click", () => {
      game.players.push({ name: `Team ${game.players.length + 1}`, score: 0 });
      renderScores();
    });
  }

  initTheme();
  initSetup();
  initCustom();
  initDial();
  initGlobal();
})();
