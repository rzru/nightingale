# Translating Nightingale

Nightingale keeps one JSON catalog per interface language in this folder. Catalog keys are stable identifiers; English copy lives only in `en.json` and can change without touching application code.

## Add or update a language

1. Copy `en.json` to a file named with the language's lowercase BCP 47 code, such as `de.json` or `pt-BR.json`.
2. Keep every key unchanged and translate its value. Preserve placeholders such as `{{count}}` exactly.
3. Import the catalog in `../index.ts`, add it to `catalogs`, and add its native language name to `LANGUAGE_OPTIONS`.
4. Run `pnpm --dir client format`, `pnpm --dir client quality`, and `pnpm --dir client build` from the repository root.
5. Open a pull request at <https://github.com/rzru/nightingale>.

Use natural, concise interface language rather than translating word for word. Product names, file extensions, and service names such as Nightingale, LRCLIB, Plex, Jellyfin, and Navidrome should stay unchanged.
