// Builds a slim EPG (epg.json) for the Streamer app from an Xtream XMLTV feed.
//
// Env:
//   XTREAM_HOST  e.g. http://portal.sarnhost.net   (required unless XMLTV_FILE)
//   XTREAM_USER, XTREAM_PASS                        (required unless XMLTV_FILE)
//   XMLTV_FILE   optional local file to parse instead of fetching (for testing)
//
// Output: ./epg.json  — { generatedAt, channels: { normName: [{ s, e, t }] } }

import { readFileSync, writeFileSync } from 'node:fs';

const WINDOW_BACK = 3 * 3600; // keep programmes from 3h ago...
const WINDOW_FWD = 30 * 3600; // ...to 30h ahead (covers until next 6h run + viewing)
const MAX_PER_CHANNEL = 80;

const DROP = new Set([
  // quality / variant tags
  'fhd', 'uhd', 'hd', 'sd', '4k', 'h265', 'hevc', 'raw', 'vip', 'sub', 'multisub', 'backup', 'ppv',
  // country / language codes
  'se', 'dk', 'no', 'fi', 'is', 'uk', 'gb', 'us', 'usa', 'de', 'nl', 'fr', 'es', 'it', 'pl', 'ie',
  'ca', 'au', 'at', 'ch', 'be', 'pt', 'ro', 'tr', 'gr', 'hr', 'rs', 'ba', 'si', 'cz', 'sk', 'hu',
  'bg', 'ee', 'lv', 'lt', 'ru', 'ua', 'al', 'mk', 'mt', 'lu', 'swe', 'dan', 'nor', 'fin', 'eng',
  'swedish', 'danish', 'norwegian', 'finnish', 'english',
]);

/** Normalize a channel name for fuzzy matching. MUST match the app (src/lib/epg.ts). */
function normName(s) {
  const str = String(s || '')
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ');
  return str
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !DROP.has(t))
    .join('');
}

function decodeEntities(s) {
  return s
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

/** "20260612163000 +0000" -> unix seconds */
function toUnix(s) {
  const m = String(s).match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?/);
  if (!m) return 0;
  let t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000;
  if (m[7]) {
    const sign = m[7][0] === '-' ? -1 : 1;
    t -= sign * (+m[7].slice(1, 3) * 3600 + +m[7].slice(3, 5) * 60);
  }
  return Math.round(t);
}

async function getXml() {
  if (process.env.XMLTV_FILE) return readFileSync(process.env.XMLTV_FILE, 'utf8');
  const host = (process.env.XTREAM_HOST || '').replace(/\/+$/, '');
  const u = encodeURIComponent(process.env.XTREAM_USER || '');
  const p = encodeURIComponent(process.env.XTREAM_PASS || '');
  if (!host || !u || !p) throw new Error('Missing XTREAM_HOST/USER/PASS');
  const url = `${host}/xmltv.php?username=${u}&password=${p}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`xmltv.php responded ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

const xml = await getXml();
const now = Math.floor(Date.now() / 1000);
const from = now - WINDOW_BACK;
const to = now + WINDOW_FWD;

// channelId -> set of normalized display-names
const namesById = new Map();
for (const block of xml.matchAll(/<channel\b[^>]*id="([^"]*)"[^>]*>([\s\S]*?)<\/channel>/g)) {
  const id = decodeEntities(block[1]);
  const set = namesById.get(id) ?? new Set();
  set.add(normName(id.replace(/\.[a-z]{2}$/, ''))); // also index the id minus country suffix
  for (const dn of block[2].matchAll(/<display-name[^>]*>([^<]*)<\/display-name>/g)) {
    const n = normName(decodeEntities(dn[1]));
    if (n) set.add(n);
  }
  namesById.set(id, set);
}

// channelId -> programmes in window
const progById = new Map();
const progRe = /<programme start="([^"]*)" stop="([^"]*)" channel="([^"]*)">([\s\S]*?)<\/programme>/g;
let m;
while ((m = progRe.exec(xml))) {
  const s = toUnix(m[1]);
  const e = toUnix(m[2]);
  if (e < from || s > to) continue;
  const ch = decodeEntities(m[3]);
  const titleMatch = m[4].match(/<title[^>]*>([^<]*)<\/title>/);
  const t = titleMatch ? decodeEntities(titleMatch[1]).trim() : '';
  if (!t) continue;
  const arr = progById.get(ch) ?? [];
  arr.push({ s, e, t });
  progById.set(ch, arr);
}

// Build normalized-name -> programmes
const channels = {};
for (const [id, names] of namesById) {
  const progs = (progById.get(id) ?? []).sort((a, b) => a.s - b.s).slice(0, MAX_PER_CHANNEL);
  if (!progs.length) continue;
  for (const n of names) {
    if (!n) continue;
    if (!channels[n] || channels[n].length < progs.length) channels[n] = progs;
  }
}

const out = { generatedAt: now, channels };
const json = JSON.stringify(out);
writeFileSync('epg.json', json);
console.log(
  `epg.json: ${(json.length / 1e6).toFixed(2)} MB | ${Object.keys(channels).length} namn | ${progById.size} kanaler med program`,
);
