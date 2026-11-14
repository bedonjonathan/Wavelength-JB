/*
 * Remote-play transports. Both expose the same interface:
 *   exists(code) / read(code) / create(code, room) / open(code)
 *   setState(state) / onState(cb) / setNeedle(v) / onNeedle(cb)
 *   setPresence(seat) / onPresence(cb) / leave()
 *   remove(code)  — delete a room
 *   sweep()       — delete rooms nobody has touched for a day
 *
 * - firebase: real two-device play through Firebase Realtime Database
 *   (configure js/firebase-config.js).
 * - local: same-browser stand-in using BroadcastChannel, for testing in two
 *   tabs. Turn it on by adding ?net=local to the page URL.
 */
(() => {
  "use strict";
  const FIREBASE_VERSION = "11.0.2";
  const DAY = 24 * 60 * 60 * 1000;
  const SWEEP_DAYS = 60; // how far back the cleanup looks
  // Rooms are filed under the day they were last active: expiry/<day start in ms>/<code>.
  const dayKey = (t) => String(Math.floor(t / DAY) * DAY);
  const params = new URLSearchParams(location.search);

  function localTransport() {
    const key = (c) => `otsw.localroom.${c}`;
    const read = (c) => { try { return JSON.parse(localStorage.getItem(key(c))); } catch { return null; } };
    const write = (c, v) => { try { localStorage.setItem(key(c), JSON.stringify(v)); } catch { /* ignore */ } };
    let code = null, ch = null;
    const handlers = { state: [], needle: [] };
    return {
      kind: "local",
      async exists(c) { return !!read(c); },
      async read(c) { return read(c); },
      async create(c, room) { write(c, room); },
      open(c) {
        code = c;
        ch = new BroadcastChannel(`otsw-${c}`);
        ch.onmessage = (e) => (handlers[e.data.type] || []).forEach((h) => h(e.data.data));
      },
      async setState(s) {
        const room = read(code) || {};
        room.state = s;
        write(code, room);
        ch.postMessage({ type: "state", data: s });
      },
      onState(cb) {
        handlers.state.push(cb);
        const room = read(code);
        if (room && room.state) setTimeout(() => cb(room.state), 0);
      },
      setNeedle(v) { ch.postMessage({ type: "needle", data: v }); },
      onNeedle(cb) { handlers.needle.push(cb); },
      setPresence() {},
      onPresence() {},
      leave() { if (ch) ch.close(); ch = null; },
      async remove(c) { try { localStorage.removeItem(key(c)); } catch { /* ignore */ } },
      async sweep() {},
    };
  }

  async function firebaseTransport(cfg) {
    const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
    const appMod = await import(`${base}/firebase-app.js`);
    const db = await import(`${base}/firebase-database.js`);
    const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(cfg);
    const database = db.getDatabase(app);
    const r = (path) => db.ref(database, path);
    let code = null, seatRef = null, filedDay = null;
    const unsubs = [];
    // Mark the room active now, and file it under today (once per day).
    const touch = (c) => {
      db.set(r(`rooms/${c}/active`), db.serverTimestamp()).catch(() => {});
      const day = dayKey(Date.now());
      if (day !== filedDay) { filedDay = day; db.set(r(`expiry/${day}/${c}`), true).catch(() => { filedDay = null; }); }
    };
    return {
      kind: "firebase",
      async exists(c) { return (await db.get(r(`rooms/${c}/state`))).exists(); },
      async read(c) { return (await db.get(r(`rooms/${c}`))).val(); },
      async create(c, room) {
        await db.set(r(`rooms/${c}`), Object.assign({}, room, { active: db.serverTimestamp() }));
        touch(c);
      },
      open(c) { code = c; filedDay = null; },
      setState(s) {
        touch(code); // active games are never swept
        return db.set(r(`rooms/${code}/state`), s);
      },
      onState(cb) { unsubs.push(db.onValue(r(`rooms/${code}/state`), (snap) => snap.exists() && cb(snap.val()))); },
      setNeedle(v) { db.set(r(`rooms/${code}/needle`), v).catch(() => {}); },
      onNeedle(cb) { unsubs.push(db.onValue(r(`rooms/${code}/needle`), (snap) => snap.exists() && cb(snap.val()))); },
      setPresence(seat) {
        seatRef = r(`rooms/${code}/online/${seat}`);
        unsubs.push(db.onValue(r(".info/connected"), (snap) => {
          if (snap.val() === true) db.onDisconnect(seatRef).set(false).then(() => db.set(seatRef, true));
        }));
      },
      onPresence(cb) { unsubs.push(db.onValue(r(`rooms/${code}/online`), (snap) => cb(snap.val() || {}))); },
      leave(roomDeleted) {
        unsubs.splice(0).forEach((u) => u());
        if (seatRef) db.onDisconnect(seatRef).cancel().catch(() => {});
        if (seatRef && !roomDeleted) db.set(seatRef, false).catch(() => {});
        seatRef = null;
      },
      async remove(c) {
        await db.remove(r(`rooms/${c}`));
        // Leftover expiry entries are tidied up by sweep().
      },
      // Delete rooms nobody has touched for over a day. The database rules only let
      // anyone read day lists that are at least two days old.
      async sweep() {
        const today = Number(dayKey(Date.now()));
        let removed = 0;
        await Promise.all(Array.from({ length: SWEEP_DAYS - 1 }, (_, i) => today - (i + 2) * DAY).map(async (day) => {
          let codes;
          try { codes = Object.keys((await db.get(r(`expiry/${day}`))).val() || {}); } catch { return; }
          await Promise.all(codes.map(async (c) => {
            try {
              const active = (await db.get(r(`rooms/${c}/active`))).val();
              if (active == null || active < Date.now() - DAY) {
                if (active != null) { await db.remove(r(`rooms/${c}`)); removed++; }
              }
              await db.remove(r(`expiry/${day}/${c}`));
            } catch { /* ignore */ }
          }));
        }));
        return removed;
      },
    };
  }

  window.Net = {
    available() { return params.get("net") === "local" || !!window.FIREBASE_CONFIG; },
    async connect() {
      if (params.get("net") === "local") return localTransport();
      if (!window.FIREBASE_CONFIG) throw new Error("Remote play isn't set up yet. See the README.");
      return firebaseTransport(window.FIREBASE_CONFIG);
    },
  };
})();
