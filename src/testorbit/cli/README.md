# `cli/` — the `orbit` entry tool

One entry tool (Decision D3): `orbit run | record | learn |
detect | check | convert | copy | generate-map |
rename-screen`. Thin dispatch only — every command delegates to
an `application/` use case or a `commands/` handler; no
workflow logic lives here.

## Layer rule

`cli/` may import `core/`, `domain/`, `application/`,
`infrastructure/`, `cli/`, and `config/`. Commands are one file
each under `commands/`; `check-layout.ts` enforces the Part D
layout rules the linter cannot express (required directories,
file-size cap, no `console.*` in shipped code).

## What lives here

- `index.ts` — flag parsing + command dispatch (`--project`,
  `--platform`, `--test`, `--recording`, `--screen`,
  `--variantId`, `--required`, `--hierarchy-file`).
- `commands/` — one file per command.
- `check-layout.ts` — `npm run testorbit:check-layout`.

## How to test it

Co-located tests (`commands/*.test.ts`), run with `npm test`.
Command tests call the handler functions with injected sinks
and temp directories — never a live device.
