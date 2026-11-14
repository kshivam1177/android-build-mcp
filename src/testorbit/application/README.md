# `application/` — use cases

One file per use case: learn, detect, record, convert, run,
copy, generate-map, check-map, rename-screen, report. Use cases
orchestrate `core/` logic and `infrastructure/` adapters; they
own the TestOrbit workflows and nothing else.

## Layer rule

`application/` may import `core/`, `domain/`, `application/`,
and `infrastructure/`. It never imports the CLI or the MCP
server, and it never calls an LLM — the host agent is the only
LLM in the loop.

## What lives here

- `learn-screen.ts`, `detect-variant.ts` — variant learning and
  detection.
- `record-action.ts`, `annotate-recording.ts` — per-action
  detection + recording annotation.
- `convert-recording.ts`, `maestro-export.ts` — recording →
  JSON test case → Maestro YAML.
- `run-test.ts`, `post-run-analysis.ts`, `report.ts` — the
  TestOrbit Runner, post-run failure analysis, run report +
  failure-bundle writer.
- `generate-map.ts`, `check-map.ts` (+ `check-map-screen.ts`,
  `check-map-entries.ts`, `check-map-migration.ts`),
  `rename-screen.ts`, `screen-references.ts` — map, checker,
  rename.
- `copy-test.ts` — cross-platform test copy.

## How to test it

Co-located tests (`<source>.test.ts`), run with `npm test`.
Use cases take their adapters (variant store, Maestro runner,
hierarchy provider) as constructor arguments, so tests inject
fakes and never need a device.
