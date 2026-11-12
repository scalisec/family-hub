# Family Hub

A family wall calendar and organizer that runs on Google Apps Script:
- **Wall:** merged calendars, leave-by times, weather and what to wear, meals and lunches, to-dos, groceries, plus a joke and a quote of the day.
- **Phones and tablet:** Say or type, a meal planner, a recipe library, groceries, to-dos, themes and Setup.

**Where things live**
- **Code:** this repo. Every push to `main` deploys it automatically (`.github/workflows/deploy.yml`).
- **Personal data:** people, calendars, home address, meals and lists all live in a private **Family Hub Data** Google Sheet in the owner's Drive. None of it is in this repo.
- **Locked down:** the script lives inside that sheet and can only open that one sheet (`spreadsheets.currentonly`), plus read calendars for the sync. Changed code can't reach your other Drive files.

## One-time setup

1. **Turn on the Apps Script API:** go to https://script.google.com/home/usersettings, signed in with the Google account that will own Family Hub, and switch **Google Apps Script API** on.
2. **Create a deploy key on your computer** (needs Node.js):
   ```
   npx @google/clasp@2.4.2 login
   ```
   Approve in the browser. This writes a file called `.clasprc.json` in your home folder (`~/.clasprc.json` on Mac, `C:\Users\<you>\.clasprc.json` on Windows).
3. **Add it as a GitHub secret:** in this repo, go to **Settings → Secrets and variables → Actions → New repository secret**. Name it `CLASPRC_JSON` and paste the whole file as the value. Treat this file like a password: it can change your Apps Script projects. Don't commit it.
4. **Create the data sheet and link it:** make a blank Google Sheet named **Family Hub Data**, open **Extensions → Apps Script → Project Settings**, copy the **Script ID**, and put it in `.clasp.json` (`{"scriptId":"<id>","rootDir":"src"}`). Commit and push: the deploy fills in the code and prints the web app link in the run summary. Then delete the local key: `del $HOME\.clasprc.json` (Windows) or `rm ~/.clasprc.json` (Mac).
5. **Open the link** signed in as the owner, approve permissions (Google shows "unverified app" for personal scripts: **Advanced → Go to Family Hub**), and tap **Set up Family Hub**.
6. In **Setup**:
   - **Home:** add your address. It's used for drive times and weather.
   - **People:** add each person with a colour, their Google email and parent/kid. Then open the data sheet, click **Share**, and add each person as an **Editor** so the app works for them.
   - **Calendars:** tick the calendars to show and pick whose each one is.
7. **Wall screen:** open the wall link shown at the bottom of Setup and go full screen.

## Making changes

Edit the files in `src/`, commit and push to `main`. The workflow redeploys within a couple of minutes and the links stay the same. Data changes (people, calendars, rules, layout, jokes, quotes) don't need a deploy: use Setup or the data sheet.

## Data sheet tabs

| Tab | What it holds |
| --- | --- |
| Settings | Theme, home address, location, dim times, last sync |
| People | Name, colour, email, role. Managed in Setup |
| Feeds | Calendars to show. Managed in Setup; extra iCal links can go in `ical_url` |
| Events | Filled by the 15-minute calendar sync. Don't edit |
| Rules | Arrival buffers by keyword (e.g. `vs` → 60 min early) |
| Layout | Wall tiles: tile, column, order, show |
| Recipes, Meals, Groceries, Todos | Filled in from the app |
| Jokes, Quotes | Optional: your own instead of the daily online ones |

## Optional: live-traffic drive times

Add a Google Maps Platform key with the Routes API enabled as a script property named `MAPS_API_KEY` (Apps Script editor → Project Settings → Script properties). Without it, drive times are a typical drive with no traffic. The key lives in the script's properties, not in this repo.
