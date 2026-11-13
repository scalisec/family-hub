// Family Hub settings. Nothing personal lives here: people, calendars, the home address and
// every list live in a file in the owner's Google Drive ("Family Hub" folder).
export const GOOGLE_CLIENT_ID = '1061398617166-8t015jus9o3vb95n6r46t01v46jnetkk.apps.googleusercontent.com';

// drive.file: only files this app creates (it can't see anything else in Drive).
// userinfo.email: so the background helper can check it's really the owner.
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
];

// The background helper (Google Apps Script, runs as the owner): calendar sync, drive times, wall feed.
export const RELAY_URL = 'https://script.google.com/macros/s/AKfycbzqs7crVhcBHQk4GboUBccZBKxdcVTqf8wB6fOu4s33mW8l6p6QvBLhYF6SJSFyzIfaBQ/exec';

export const ROOT_FOLDER = 'Family Hub';
export const DATA_FILE = 'family-hub-data.json';
export const TIME_ZONE = 'America/Toronto';
