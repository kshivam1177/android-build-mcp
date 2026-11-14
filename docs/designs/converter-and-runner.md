# Converter and Runner

Phase 4 of the TestOrbit plan. The plan of record is
`~/workspace/test-automation-mcp/testorbit-final-implementation-plan.md`
(Part A, Part C C1/C4, D6); this doc is the design summary the drift
report reads — it does not replace the plan.

## Converter: recording → test case → Maestro YAML

One canonical form per platform (mobile): the **JSON test case**
(`<platform>/testcases/<testId>.json`, `schemaVersion: 2`) plus the
**generated Maestro YAML** (`<platform>/tests/<testId>.yaml`).
Web is the deliberate exception — web's canonical form is the
Playwright test itself (no JSON, no converter, no map in v1); the
Playwright exporter is deferred to product v2, after Maestro is
stable.

- `src/testorbit/application/convert-recording.ts` reads a v2
  recording (via the one shared `recording-reader.ts`) and writes
  the JSON test case. `setup`/`teardown` are mandatory;
  `provenance` is mandatory with `"unknown"` allowed where the
  host agent cannot supply a value.
- `src/testorbit/application/maestro-export.ts` emits the Maestro
  YAML from the JSON test case. The export is **one-way and
  lossy**: the JSON is canonical, the YAML is generated from it.
- Every generated YAML carries a header with the source JSON's
  hash + `generatedAt` + `schemaVersion: 2`. CI regenerates the
  YAML and fails on diff (B15; see `~/workspace/your_files/testorbit.yml`).
- The converter emits the variant assertion (`assertVisible` on an
  element unique to the expected variant) as the first step of
  every variant-scoped test.
- Secrets: the converter never emits literal typed values into
  YAML or logs; typed values are replaced by `${ENV_VAR}`
  references at conversion time, and typed values are redacted in
  reports, logs, and failure bundles (C5).
- A copied test carries `provenance.copiedFrom` and
  `verificationStatus: "copied-unverified"` until its first green
  run on the target platform (C4). `orbit copy` replicates an
  Android test case to iOS; unmapped steps fail loudly, naming
  them.

## Runner: `orbit run`

The TestOrbit Runner (`src/testorbit/application/run-test.ts`) is a thin
wrapper around Maestro, owning exactly the five duties a wrapper
*can* do:

1. **Before a flow (pre-flow only):** dump a fresh hierarchy, run
   screen identification + variant detection, and select the
   Maestro flow for the detected `(screen, variant)`. On mismatch
   it fails with evidence and never runs Maestro against an
   unknown screen.
2. Run `maestro test` for the selected flow.
3. **After a run (post-run only):** on failure, dump the current
   hierarchy, compute the element diff against the expected
   `(screen, variant)`, and write the failure bundle file.
4. Record timing: per-step wall time from Maestro's own report,
   plus the total duration; the LLM-call counter records 0 for
   replay.
5. Variant assertion: the first step's `assertVisible` is emitted
   by the converter, not evaluated by the Runner.

Mid-run verification is explicitly NOT a Runner duty — checks
during a run are the Maestro assertions the converter emits.
There is no per-segment Maestro invocation and no repo-side
executor path. Replay is 0 LLM calls — that is the whole point.

## Run report (standardised Phase 9)

One format, mobile + web (`run-report.json` in
`<platform>/test-reports/<yyyy-mm-dd>/<hhmmss>-testorbit-<runId>/`):

- `testId`, `platform`, `startedAt`, `durationMs`, `success`.
- `llmCalls`: `{ plan, record, replay }` — replay is always `0`
  (the Runner records 0 for the replay portion it owns; the host
  agent reports its own plan/record counts).
- `steps`: per-step `{ index, command, status, durationMs }` —
  wall time from the runner's own report only (see
  `measurement-model.md`).
- `coverage` (optional, added Phase 9): the screen-map coverage
  block — screens/variants learned, edges, screens/variants never
  traversed — copied from `<platform>/screen-map.json` at run time
  when the map exists. A missing or invalid map yields no block
  and never fails a run.
- `maestroReportPath`, `failureBundlePath`, `error` when present.

## Failure bundle (standardised Phase 9)

`failure-bundle.json` in the same run directory, written by the
Runner (Phase 4) and standardised here: step, expected
`(screen, variant)`, actual match result ((screen, variant) +
element diff + warnings), hierarchy path, screenshot path, exact
rerun command — with typed values redacted.

## Open item: `save_test_case` still writes the flat path

**Status (Phase 9): open inconsistency, documented — not silently
rewired.**

The platform-wise rule says every TestOrbit file lives under
`<platform>/` in the project tree. The converter and the Runner
follow it: test cases live at
`<platform>/testcases/<testId>.json` and the Runner reads exactly
that path. But the host-agent `save_test_case` MCP tool
(`src/tools/testing-intelligence/save_test_case.ts`) still writes
to the flat `.testorbit/testcases/` path — only its
schema changed to v2. The flat path is also what
`list_test_cases` and `run_test_case` read.

**Consequence:** a test saved via `save_test_case` lands where
the Runner never looks, and a test saved via `orbit convert`
lands where `save_test_case`'s siblings never look. The two
writers disagree about where a test case lives.

**Recommended resolution (follow-up, not Phase 9):** make
`save_test_case` platform-aware — accept a platform, write to
`<platform>/testcases/`, and migrate (or one-time copy) the
existing flat files into their platform folders; update
`list_test_cases` and `run_test_case` to read the platform path
in the same change. Owner: whoever owns the host-agent
testing-intelligence tools (`save_test_case`,
`list_test_cases`, `run_test_case`) — not the TestOrbit Runner,
which already follows the platform-wise rule. Until the
follow-up lands, tests intended for `orbit run` must be created
via `orbit convert`, not via `save_test_case`.
