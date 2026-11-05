# On the Same Wave

A pass-and-play spectrum guessing game for two players, friends or parties. It runs on one shared phone or computer, with no installs and no accounts.

## Play
Open `index.html` in a browser, or use the GitHub Pages site once it's deployed (see below).

## Modes
- **Duo:** two players take turns as the Psychic and build a shared score, with stats for rounds, bull's-eyes, average and best streak. By default the Psychic drags the needle to their **honest answer** to a question like *“My ideal Friday night”*, and the other player guesses where they put it.
- **Teams:** any number of teams, each with its own score. The Psychic gives a clue for a **random** hidden target and their own team guesses. The **Left/Right steal** is optional: the next team calls whether the target is left or right of the needle for +1 (no steal on a bull's-eye).

## Playing on two devices (Duo mode)
One player taps **Create a room** and shares the 4-letter code or invite link. The other player taps **Join**. Each phone shows only what that player should see: the Psychic's phone shows the target, and the guesser's never does. The Psychic watches the needle move live as the guesser drags it. Talk on a regular phone or video call while you play. If a phone locks or reloads, tap **Rejoin room** on the setup screen.

The **Play on two devices** card stays hidden until Firebase is set up (about 10 minutes, free):
1. Go to https://console.firebase.google.com and click **Create a project**. Analytics isn't needed.
2. **Build → Realtime Database → Create Database**. Pick a location and start in **locked mode**.
3. On the database's **Rules** tab, paste the contents of [`database.rules.json`](database.rules.json) and click **Publish**.
4. **Project settings (gear) → General → Your apps → Web (`</>`)**. Register an app (no hosting needed) and copy the `firebaseConfig` object.
5. Paste it into [`js/firebase-config.js`](js/firebase-config.js) as `window.FIREBASE_CONFIG = { ... }`, make sure it includes `databaseURL`, and push. These values aren't secret.

To test two-device play without Firebase, open the page in two tabs of the same browser with `?net=local` added to the URL.

**Limits:** anyone with a room code can join or read that room. Codes are random, but this is a casual game, not a secure one. Old rooms aren't deleted automatically; you can clear `rooms` from the Firebase console now and then.

## Features
- **Show / Hide Target** toggle during the Psychic, Guess and Steal phases, so the Psychic can re-check the target without moving the round forward. A red banner warns guessers while it's showing.
- **4 / 3 / 2** scoring zones on a dial you drag with touch or mouse.
- **Decks:** Deep Talk, Get to Know You, Classic, Food & Drink, Pop Culture, Work & School, Sports & Games, Party, Family & Kids, Halloween, Winter Holidays and Valentine's.
- **My Spectrums:** add your own (optional question + left/right ends), saved on the device.
- **Visual themes:** System, Light, Dark, Neon, Retro, Pastel, Halloween, Winter and Valentine.
- Optional guessing timer. Endless play, so there's no winner screen.

## Editing the cards
All spectrums are in [`js/decks.js`](js/decks.js). Each card is `{ q: "optional question", l: "left end", r: "right end" }`.

## Deploying to GitHub Pages
1. In the repo on GitHub, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
2. Push to `main`. The workflow in `.github/workflows/static.yml` publishes the site.
