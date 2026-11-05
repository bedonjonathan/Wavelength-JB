/*
 * Remote-play transports. Both expose the same interface:
 *   exists(code) / read(code) / create(code, room) / open(code)
 *   setState(state) / onState(cb) / setNeedle(v) / onNeedle(cb)
 *   setPresence(seat) / onPresence(cb) / leave()
 *
 * - firebase: real two-device play through Firebase Realtime Database
 *   (configure js/firebase-config.js).
 * - local: same-browser stand-in using BroadcastChannel, for testing in two
 *   tabs. Turn it on by adding ?net=local to the page URL.
 */
(() => {
  "use strict";
  const FIREBASE_VERSION = "11.0.2";
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
    };
  }

  async function firebaseTransport(cfg) {
    const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
    const appMod = await import(`${base}/firebase-app.js`);
    const db = await import(`${base}/firebase-database.js`);
    const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(cfg);
    const database = db.getDatabase(app);
    const r = (path) => db.ref(database, path);
    let code = null, seatRef = null;
    const unsubs = [];
    return {
      kind: "firebase",
      async exists(c) { return (await db.get(r(`rooms/${c}/state`))).exists(); },
      async read(c) { return (await db.get(r(`rooms/${c}`))).val(); },
      async create(c, room) { await db.set(r(`rooms/${c}`), room); },
      open(c) { code = c; },
      setState(s) { return db.set(r(`rooms/${code}/state`), s); },
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
      leave() {
        unsubs.splice(0).forEach((u) => u());
        if (seatRef) db.set(seatRef, false).catch(() => {});
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
