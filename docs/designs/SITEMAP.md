# TestOrbit design docs — SITEMAP

EGM rule: approved specs live under `docs/designs/` with this
index. This file is the drift report's input (Phase 10): it maps
each design doc to the plan section it summarises and the code
that implements it.

## Plan of record (not copied here)

The full implementation plan — 132 KB, Parts A–F, Phases 0–10 —
lives **outside the repo** at
`~/workspace/test-automation-mcp/testorbit-final-implementation-plan.md`.
It is deliberately not copied into the repo. The docs below are
short design summaries + pointers; where a doc and the plan
disagree, the plan wins and the divergence goes in the drift
report.

## Design docs

| Doc | Plan section | Code |
| --- | --- | --- |
| [variant-model.md](variant-model.md) | Part B B2/B4/D8/D9, Phase 2 | `src/testorbit/application/learn-screen.ts`, `detect-variant.ts`; `src/testorbit/core/variant-match.ts`, `matcher.ts`, `fingerprint.ts` |
| [converter-and-runner.md](converter-and-runner.md) | Part A, Part C C1/C4, D6, Phase 4 | `src/testorbit/application/convert-recording.ts`, `maestro-export.ts`, `run-test.ts`, `report.ts`, `post-run-analysis.ts` |
| [recorder.md](recorder.md) | Part B B8, Part D D2/D7, Phase 5 | `src/testorbit/application/record-action.ts`, `annotate-recording.ts`; `src/tools/ui-automation/recording-probe.ts` |
| [map-and-checker.md](map-and-checker.md) | Part B B7/B12/C3/C16, D11, Phase 6 | `src/testorbit/application/generate-map.ts`, `check-map.ts` (+ split files), `rename-screen.ts`; `src/testorbit/domain/screen-map.ts` |
| [measurement-model.md](measurement-model.md) | Phase 9 tasks 2–5, Part D D6 | `src/testorbit/application/report.ts`, `run-test.ts`; `src/testorbit/domain/testcase-schemas.ts` (`RunReport`) |
| [screen-split-merge-migration.md](screen-split-merge-migration.md) | Phase 3 task 3, enforced Phase 6 | `src/testorbit/core/migration-check.ts`, `src/testorbit/application/check-map-migration.ts` |

## Other TestOrbit docs

- `src/testorbit/README.md` — the TestOrbit README (Phase 9 task 7):
  what TestOrbit is and is not, the record → save → replay loop,
  folder layout, how to add a screen / variant / test, the rules.
- `src/testorbit/{core,domain,application,infrastructure,cli,config}/README.md`
  — one short README per module (Phase 9 task 7).
- `~/workspace/your_files/testorbit.yml` — the CI workflow handover
  copy (Phase 9 task 1). Lives outside the repo by design; Shivam
  adds it manually as `.github/workflows/testorbit.yml`. The local
  equivalent is `npm run testorbit:ci`.

## Phase 9 status (2026-11-13)

Done in this phase: CI handover copy + `testorbit:ci` script;
standard run-report format with the screen-map coverage block;
standard failure-bundle format; design docs placed here with
this index; TestOrbit README + per-module READMEs.

**Not done, by necessity — no pilot apps exist yet** (Phase 0
task 1 not done; Phases 7–8 not run):

- The 5× full-suite flake-rate run (Phase 9 task 5) — method
  fixed in `measurement-model.md`, no number claimed.
- The measurement-gate baseline (Phase 9 task 4) — empty until
  Phase 7/8 pilot numbers land.
- The pilot-dependent CI jobs (emulator + Maestro, iOS) — written
  in the handover copy, gated on repository variables that are
  unset until Phase 0 task 1 names the pilots.
- "A fresh checkout reproduces a green run from the README
  alone" (Phase 9 Verify) — the static half is verifiable
  (`npm run testorbit:ci`); the pilot half cannot be reproduced
  until the pilots exist.

## Open items (decided and documented, not silently rewired)

1. **`save_test_case` writes the flat path** — the host-agent
   tool writes `.testorbit/testcases/` while the
   platform-wise rule puts test cases under `<platform>/`.
   Recommended resolution + owner in
   [converter-and-runner.md](converter-and-runner.md#open-item-save_test_case-still-writes-the-flat-path).
2. **`default` variant designated-required subset** — the
   host-agent `orbit_learn_screen` passes no designated subset, so
   `default` requires every interactive id. Recommended fix +
   owner in
   [variant-model.md](variant-model.md#open-gap-default-variant-designated-required-subset).
3. **Non-Android handler providers in the recording path** —
   WDA (iOS) and Patrol (Flutter) readers exist but are not wired
   into live recording. Deferred to the Phase 7 pilot work; see
   [recorder.md](recorder.md#deferred-non-android-handler-providers-in-the-recording-path).
