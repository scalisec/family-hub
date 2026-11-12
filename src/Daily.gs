/**
 * Joke and quote of the day. Picked once per day and kept for the whole day,
 * so every screen shows the same one.
 * - Jokes tab has rows → one of yours (rotates by day). Empty → icanhazdadjoke.com.
 * - Quotes tab has rows → one of yours. Empty → ZenQuotes "quote of the day"
 *   (free tier requires the on-screen credit, which the tile shows).
 */

function getDaily_() {
  const today = dateKey_(new Date());
  const props = PropertiesService.getScriptProperties();
  const key = 'daily:' + today;
  const saved = props.getProperty(key);
  if (saved) return JSON.parse(saved);

  const dayNum = Math.floor(new Date().getTime() / 86400000);
  const out = { date: today, joke: '', quote: '', author: '', quoteCredit: false };

  const myJokes = safe_(function () { return rows_('Jokes'); }, []).map(function (r) { return String(r.text).trim(); }).filter(String);
  if (myJokes.length) out.joke = myJokes[dayNum % myJokes.length];
  else out.joke = safe_(fetchJoke_, '') || 'Why did the hockey player bring string to the game? To tie the score.';

  const myQuotes = safe_(function () { return rows_('Quotes'); }, []).filter(function (r) { return String(r.text).trim(); });
  if (myQuotes.length) {
    const q = myQuotes[dayNum % myQuotes.length];
    out.quote = String(q.text).trim();
    out.author = String(q.author || '').trim();
  } else {
    const z = safe_(fetchQuote_, null);
    if (z) { out.quote = z.q; out.author = z.a; out.quoteCredit = true; }
    else { out.quote = 'Do your best today. Then do it again tomorrow.'; out.author = ''; }
  }

  // Save today's pick and clear older days.
  Object.keys(props.getProperties()).forEach(function (k) { if (k.indexOf('daily:') === 0 && k !== key) props.deleteProperty(k); });
  props.setProperty(key, JSON.stringify(out));
  return out;
}

function fetchJoke_() {
  const res = UrlFetchApp.fetch('https://icanhazdadjoke.com/', {
    muteHttpExceptions: true,
    headers: { Accept: 'application/json', 'User-Agent': 'Family Hub (personal family dashboard, Google Apps Script)' }
  });
  if (res.getResponseCode() !== 200) return '';
  return String(JSON.parse(res.getContentText()).joke || '').slice(0, 300);
}

function fetchQuote_() {
  const res = UrlFetchApp.fetch('https://zenquotes.io/api/today', { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  const j = JSON.parse(res.getContentText());
  if (!Array.isArray(j) || !j[0] || !j[0].q) return null;
  return { q: String(j[0].q).slice(0, 300), a: String(j[0].a || '').slice(0, 80) };
}
