---
root: true
targets: ['*']
description: 'Nightingale engineering contract and required quality gates'
---

# Nightingale engineering contract

Nightingale is a karaoke application delivered through a React client, a Tauri desktop adapter, and a self-hosted web adapter. Shared karaoke behavior lives in the Rust application core. The repository also contains an Astro/mdBook website. Follow repository evidence instead of guessing. Read relevant manifests, nearby implementation, and these rules before changing code.

Use `pnpm` exclusively for JavaScript tooling. Run application tooling from `client/` and site tooling from `site/`. Do not use npm, yarn, bun, or npx. Keep committed lockfiles reproducible and do not weaken dependency build-script controls.

Treat `.rulesync/rules/*.md` as the only source of truth for agent instructions. Never hand-edit generated `AGENTS.md`. Agents must not add policy, architecture rules, coding rules, TODO mandates, or agent instructions to application source files or code comments. Put repository-wide guidance in `.rulesync/rules/` only. After changing a source rule, run `pnpm --dir client rules:generate` and `pnpm --dir client rules:check`.

## Scope and design

- Make the smallest coherent change that satisfies the request. Do not add speculative layers, compatibility shims, dead code, or unrelated cleanup.
- Separate logically distinct or modular code blocks with one blank line. Keep tightly coupled declarations and operations together.
- UI copy must earn its space: add text only when it communicates state, enables an action, prevents confusion, or improves accessibility.
- Preserve the shared-core, dual-adapter direction in `10-architecture.md`; do not fork karaoke behavior between desktop and server transports.
- Do not invent karaoke scoring, library, metadata, authentication, persistence, or deployment semantics. Ask when repository evidence does not decide them.
- Treat self-hosted endpoints, Tauri commands, media-server integrations, analyzer IPC, files, URLs, and metadata as trust boundaries.
- Keep generated output, vendored code, lockfiles, and binary assets out of manual edits unless the task specifically requires them.

## Required validation

After code or configuration changes:

1. Add a brief, friendly, user-facing entry under the appropriate `[Unreleased]` subsection in `CHANGELOG.md` for every finished change that affects application behavior. Describe the benefit or visible change without implementation details or exhaustive edge cases. If a feature or improvement was introduced in the current release and already has an `[Unreleased]` entry, update that entry when refining it instead of adding a separate one. Do not add entries for changes limited to `site/` or documentation.
2. Re-read modified files and remove accidental comments, dead code, broad suppressions, and unrelated edits.
3. Run `pnpm --dir client format`.
4. Run `pnpm --dir client quality`.
5. Run `pnpm --dir client build` when build configuration, frontend production behavior, assets, or packaging changed.
6. Run `pnpm --dir site build` when website or documentation behavior changed.
7. Run `pnpm --dir client audit:rust` when Rust dependencies or Cargo policy changed and `cargo-deny` is available.

Do not create or request Rust or TypeScript/React tests. This project deliberately relies on strict static analysis, type checking, compilation, and focused manual/product validation instead of automated test suites.

A change is not complete while an applicable check fails. Fix root causes. Never relax a compiler, formatter, lint, security, or agent rule merely to make a check green. Any unavoidable suppression must be narrow, explain the tool limitation or invariant, and receive explicit approval. Report checks that could not run; never claim success without evidence.
