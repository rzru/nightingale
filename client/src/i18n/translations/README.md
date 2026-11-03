# Translating Nightingale

Nightingale keeps one JSON catalog per interface language in this folder. `en.json` is the source of truth: every key it defines must exist in every other catalog, and `pnpm --dir client typecheck` fails when one is missing. Keys are stable identifiers, not copy.

## Add or update a language

1. Copy `en.json` to a file named with the language's lowercase BCP 47 code, such as `de.json` or `pt-br.json`.
2. Keep every key unchanged and translate its value. Preserve placeholders such as `{{count}}` exactly.
3. Import the catalog in `../index.ts`, add it to `catalogs`, and add its language name key to `languageLabels`. The compiler rejects a catalog set without a name for every language.
4. Run `pnpm --dir client format`, `pnpm --dir client quality`, and `pnpm --dir client build` from the repository root.
5. Open a pull request at <https://github.com/rzru/nightingale>.

Use natural, concise interface language rather than translating word for word. Product names, file extensions, and service names such as Nightingale, LRCLIB, Plex, Jellyfin, and Navidrome should stay unchanged.

## Keys

- Write new keys as short scoped identifiers (`library.toolbar.openQueue`), never as the English sentence (`settings.constants.smootherAndMoreConsistentWithDescription`). Old keys keep their names; never rename a key to match new wording.
- Reuse an existing key when the copy means exactly the same thing in both places instead of adding a near-duplicate.
- Counted copy uses plural form keys: `library.analysis.queued.one`, `.other`, and optionally `.few`, `.many`, `.zero` for languages that need them. Application code passes the base key to `tp('library.analysis.queued', count)`, and `{{count}}` is added and formatted automatically.
- A catalog must define `.one` and `.other`; add `.few`, `.many`, or `.zero` only in catalogs whose plural rules use those categories.
