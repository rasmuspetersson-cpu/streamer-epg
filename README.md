# streamer-epg

Slim EPG (TV guide) data for the **Streamer** IPTV app.

A GitHub Actions job runs every 6 hours, downloads the provider's full XMLTV
feed, and writes a small `epg.json` (channel name → upcoming programmes, ~1.5 MB)
that the app fetches and caches. The heavy 33 MB parse happens here in the cloud,
not on the phone.

- `build-epg.mjs` — fetches + slims the XMLTV (credentials come from repo secrets).
- `epg.json` — generated output, served via `raw.githubusercontent.com`.
- `.github/workflows/epg.yml` — the scheduled build.

No credentials are stored in this repo — `XTREAM_HOST`, `XTREAM_USER` and
`XTREAM_PASS` are encrypted GitHub Actions secrets.
