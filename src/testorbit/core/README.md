# `core/` — pure logic

Pure functions for stable element identity, fingerprints,
matching, variant matching, scope coverage, screen diffs, and
secret redaction. No I/O, no device, no LLM.

## Layer rule

`core/` imports only `core/` and `domain/` (plus `node:crypto`
for hashing). If a core file imports `fs`, `child_process`, or
an MCP type, the structure is wrong. Enforced by
`boundaries/element-types` and `src/testorbit/cli/check-layout.ts`.

## What lives here

- `element-id.ts` — one shared stable-id function.
- `fingerprint.ts` — fingerprint v2 (a version stamp only, never
  a run-time check).
- `matcher.ts`, `variant-match.ts` — the B4 match rule.
- `screen-identity.ts`, `screen-diff.ts` — screen
  identification and learn diffs.
- `scope-coverage.ts` — the B3 ≥80% scope rule.
- `migration-check.ts` — split/merge migration-list enforcement.
- `assertions.ts`, `redact.ts` — assertion helpers and the one
  shared secret redactor.

## How to test it

Co-located tests (`<source>.test.ts`), run with `npm test`.
Coverage on `core/` must stay ≥90% statements/lines
(`npm run coverage`).
