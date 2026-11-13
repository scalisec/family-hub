# Family Hub

A family wall calendar and organizer.

- **App (phones and tablet):** https://scalisec.github.io/family-hub/ shows Today, Week, Meals and recipes, Groceries and to-dos, Say or type, Themes and Setup.
- **Wall screen:** a private read-only link (More > Wall screen in the app). It shows merged calendars, leave-by times, weather and what to wear, meals and lunches, to-dos, groceries, and a joke and a quote of the day.

## How it fits together

| Piece | Where | What it does |
|---|---|---|
| The app | GitHub Pages (this repo) | Opens instantly. Every change shows on screen straight away and saves in the background. |
| Family data | One file, `Family Hub/family-hub-data.json`, in the owner's Google Drive | People, calendar picks, arrival rules, recipes, meals, groceries, to-dos and settings. The app can only see files it made (`drive.file`). |
| Background helper | Google Apps Script (`apps-script/`), inside the **Family Hub Data** sheet, running as the owner | Reads the calendars every 15 minutes, works out drive times, fetches the joke and quote, and serves the wall link. It only accepts changes signed in as the owner. |

There are no personal details in this repo. Names, emails, calendars and the home address all live in the Drive file.

## Updating

- **App:** push to `main` and GitHub Pages publishes it within a minute. Bump the version in `js/version.js`, `package.json`, `version.json` and `sw.js` (the tests check they match). Open phones show an **Update** note.
- **Helper:** pushing changes under `apps-script/` deploys it automatically (`.github/workflows/deploy.yml`, using the `CLASPRC_JSON` secret). Its address never changes.
- **Tests:** `npm test` (they run on every push too).

## One-time steps for version 3

1. **Re-approve the helper (once).** The helper now runs as you, so Google needs a fresh OK. Open the **Family Hub Data** sheet, then **Extensions > Apps Script**. Pick **authorize** in the function list at the top and press **Run**. Then choose **Review permissions**, pick your account, then **Advanced > Go to Family Hub (unsafe)** and press **Allow**.
2. **Open the app** on your phone and press **Connect Google**. The first time, it copies your people, calendars, rules, recipes and settings from the old version's sheet tabs.
3. **Wall:** in the app, go to **More > Wall screen > Open** and open that link on the wall screen in full screen.

The old version's tabs in the sheet (People, Events, Meals and so on) aren't used any more. Delete them once you're happy with version 3. The helper keeps its own data in a hidden **Store** tab.
