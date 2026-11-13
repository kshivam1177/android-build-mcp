# TestOrbit — record once, save as a test, replay with 0 LLM calls

TestOrbit is the test-automation kit inside `testorbit`:
a coding agent records a flow once in plain language, the flow is
saved as a deterministic test, and the test replays through
Maestro (mobile) or Playwright (web) with **zero LLM calls**.

## What TestOrbit is

- **Record → save → replay.** The host agent drives the app in
  plain language while TestOrbit records every action with the
  `(screen, variant, elementId)` it acted on. The recording is
  converted to a canonical JSON test case + a generated Maestro
  YAML. `orbit run` replays the YAML.
- **Variant-aware.** A screen is learned once with its variants
  (e.g. checkout with COD vs card); the Runner detects the
  variant before a run and fails with evidence instead of running
  against the wrong state.
- **Deterministic replay.** The saved test is the test. Replay
  needs no model, no API key, no cost.

## What TestOrbit is not

- Not an in-server LLM planner (deferred to a Phase 10 decision,
  only for a named headless case — none exists yet).
- Not a custom YAML executor, not a web screen learner, not
  self-healing. Maestro runs the YAML; Playwright runs the web
  test. TestOrbit wraps them, it does not re-implement them.
- Not a recorder of coordinates: actions address stable element
  ids, never screen coordinates.
- Not a place for secrets: typed values are `${ENV_VAR}`
  references at conversion time and redacted in reports, logs,
  and failure bundles.

## The loop

```
learn   →  screens/<screenId>/ (base + variants/<variantId>.json)
record  →  recordings/<flowId>.json  (two hierarchy dumps per action)
convert →  testcases/<testId>.json + tests/<testId>.yaml
run     →  test-reports/<date>/<run>/run-report.json  (0 LLM calls)
check   →  screen-map.json + check-screen-map report
```

Every TestOrbit file lives under
`<projectRoot>/.testorbit/<platform>/`, one folder
per platform (`android/`, `ios/`, `flutter/`, `web/`). Nothing is
written outside the project folder.

## How to add a screen, a variant, a test

- **Screen:** `orbit learn --screen <id> --variantId default
  --project <root> --platform <platform>` (with a live device,
  or `--hierarchy-file <dump>`). Re-learning needs `--force`.
- **Variant:** drive the app into the new state, then
  `orbit learn --screen <id> --variantId <name>
  --required <id,...>` — designate the elements that define the
  variant; `default` takes the defining subset, not every
  element (see `docs/designs/variant-model.md`).
- **Test:** record a flow, then `orbit convert --recording
  <flowId> --test <testId> --project <root> --platform <platform>`,
  then `orbit run --test <testId> --project <root>
  --platform <platform>`.
- **Rename a screen:** `orbit rename-screen --screen <old>
  --to <new>` rewrites every reference, including recordings,
  then regenerates the map.

## Rules (Part D)

- No LLM during replay. No coordinates. No literal secrets.
- One canonical form per platform: mobile = JSON test case +
  generated Maestro YAML; web = the Playwright test itself.
- Strict TypeScript, branded types, Zod at every parse boundary,
  no `any`, co-located tests (`<source>.test.ts`), functions
  ≤50 lines, files ≤300 lines, JSDoc on public functions, no
  `console.log` in shipped code.
- Layer rules: `core/` imports only `core/` + `domain/`;
  `domain/` only `domain/`; `application/` may use `core`,
  `domain`, `application`, `infrastructure`; `infrastructure/`
  may use `core`, `domain`, `infrastructure`; `cli/` may use
  all layers + `config/`; `config/` may use `domain` + `config`.
  MCP tool handlers stay in `src/tools/` — there is no
  `src/testorbit/tools/`.

## How the LLM plugs in (Part D7)

The LLM is **not inside TestOrbit's code** — TestOrbit never calls an
LLM API. The LLM lives in the host agent and plugs in at three
points: **plan** (once per flow, at record time — the agent
decides each step), **convert** (once per flow — naming the test
and deriving assertions), and **replay (zero times)**. Element
grounding falls back hierarchy → Tesseract OCR → LLM vision,
only at record/convert time, never during replay. The run report
distinguishes plan / record / replay LLM counts.

## Checks and CI

```sh
npm run testorbit:ci   # typecheck, lint, layout, tests, coverage — the local CI
npm run testorbit:check-layout
```

The GitHub workflow is a handover copy at
`~/workspace/your_files/testorbit.yml` (Shivam adds it manually as
`.github/workflows/testorbit.yml`; the App token cannot push
workflow files). Its static job runs on every push to `rewamp`;
its device jobs are gated on pilot-app inputs that do not exist
yet — there is no pilot app, no APK, no demo flow in this repo.

## Docs

- Design docs + index: `docs/designs/` (`SITEMAP.md`).
- Plan of record (not copied into the repo):
  `~/workspace/test-automation-mcp/testorbit-final-implementation-plan.md`.
- Per-module READMEs: `core/`, `domain/`, `application/`,
  `infrastructure/`, `cli/`, `config/` under this directory.
