---
root: false
targets: ['*']
description: 'Strict TypeScript, React, accessibility, and browser/native parity rules'
globs:
  - '**/*.ts'
  - '**/*.tsx'
  - '**/*.mts'
  - '**/*.js'
  - '**/*.jsx'
  - '**/*.mjs'
---

# TypeScript and React

## Type safety

- Preserve every strict compiler option. Never use `any`, non-null assertions, angle-bracket assertions, double assertions, or routine `as` casts. Narrow `unknown` with runtime checks and prefer `satisfies` for compile-time shape validation.
- Validate network, storage, URL, environment, native-command, media-server, and analyzer data at boundaries. TypeScript types do not validate external data.
- Use type-only imports and exports. Prefer `type` for data shapes and unions. Use readonly inputs and non-mutating transforms unless mutation is an explicit local implementation detail.
- Make exported boundaries explicit and model state machines with discriminated unions. Switches over closed unions must be exhaustive.
- Every promise must be awaited, returned, or handled by a named fire-and-forget boundary that reports failures.
- Keep errors actionable and preserve their source when adding context. Never swallow exceptions or use logging as error handling.

## React

- Use named exports for components. Default exports are not allowed.
- Components and hooks are pure. Never cause side effects during render, mutate props/state, define components inside components, or call hooks conditionally.
- Store minimal source state. Derive values during render; effects only synchronize with external systems and must clean up listeners, timers, subscriptions, media resources, and in-flight work.
- Keep direct parent-child data flow explicit. Use narrowly typed context or Jotai atoms for cohesive client playback/UI state shared across independent branches; do not use ambient state to hide simple props.
- Do not silence exhaustive dependency checks. Stabilize values only when identity has real semantics, not as blanket optimization.
- Keep karaoke/domain behavior outside presentation components and transport calls behind typed bridge adapters. Shared UI must work in browser and Tauri environments.
- Use TanStack React Query for asynchronous server/native reads and mutations. Use Jotai or context for cohesive local interaction/playback state, not as duplicate remote caches. Scope polling to mounted surfaces.
- Use semantic HTML, labeled controls, keyboard and gamepad-compatible interaction where applicable, visible focus, stable domain keys, meaningful alternative text, and safe external links. Accessibility failures are correctness failures.
- Playback and audio-reactive interfaces must honor reduced motion and remain understandable without animation, color, audio, hover, or precise pointer input.
- Represent loading, empty, offline, denied-permission, unavailable-device, and error states explicitly when possible.

## Localization

- Every user-visible string lives in `client/src/i18n/translations/en.json` and is rendered through `t`, `tp`, or `Trans`. Do not hardcode interface copy in components, bridge errors, toasts, or dialogs.
- Translated text is read at render time. A memoized component that renders translated text must subscribe with `useTranslation` or `useLocale`, otherwise its copy freezes on the previous language.
- Counted or pluralized copy uses `tp` with per-form catalog keys, never string concatenation or `if (count === 1)`. Languages that need `few`/`many`/`zero` forms declare them in their own catalog.
- Translation keys are stable identifiers. Never derive them from English copy, never rename a key to match new wording, and reuse an existing key when the meaning is identical.
- Backend, analyzer, and media-server error text is external data, not copy. Translate the surrounding interface text and pass the external message as a placeholder value.

Do not add automated TypeScript or React tests. Validate with strict type checking, Oxlint, Stylelint, production builds, and focused manual behavior checks.

Do not put agent instructions, policy, architectural mandates, or repository rules in source code or comments. Do not add lint suppressions or TypeScript error directives without approval. If a tool is wrong, narrow suppression to one expression and explain the concrete limitation.
