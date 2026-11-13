# Measurement model (reporting standard)

Phase 9 tasks 2–5 of the TestOrbit plan. The plan of record is
`~/workspace/test-automation-mcp/testorbit-final-implementation-plan.md`
(Phase 9, Part D D6); this doc is the standard a reader uses to
reproduce TestOrbit's numbers — it does not replace the plan.

## The standard run report (one format, mobile + web)

Every run writes `run-report.json` into
`<platform>/test-reports/<yyyy-mm-dd>/<hhmmss>-testorbit-<runId>/`
(see `converter-and-runner.md` for the field list). The same
format covers mobile (Maestro) and web (Playwright) runs — web's
canonical form is the Playwright test itself, but its report is
this format, with per-step times from Playwright's report.

Per run the report records: steps, per-step wall time, total
seconds, pass/fail per step, LLM calls used, screen-map check
result, variant detection results, flake rate. The failure
bundle (`failure-bundle.json`, same directory) records: step,
expected `(screen, variant)`, actual match result ((screen,
variant) + element diff + warnings), hierarchy path, screenshot
path, exact rerun command — with typed values redacted.

## Measurement model (fixed)

- **Per-step total duration comes from the runner's own report
  only** — Maestro's command timings for mobile, Playwright's
  report for web. Nothing else is a per-step replay time.
- **Repo-side timings are recorded at record time, never invented
  for a Maestro/Playwright run.** Hierarchy-dump time and OCR
  time belong to the recording, not to the replay; a run report
  never carries a hierarchy-dump or OCR duration for a replayed
  step.
- **LLM calls are distinguished as plan / record / replay.**
  Replay is always 0 — the Runner records 0 for the replay
  portion it owns; the host agent reports its own plan/record
  counts. Planning = 1 LLM call (or 0 if a saved YAML exists);
  recording ≈ 1 LLM call per recorded step, plus 1 per LLM-vision
  fallback grounding.
- **Coverage** in the report is the screen-map coverage block
  (screens/variants learned, edges, screens/variants never
  traversed), copied from `<platform>/screen-map.json` at run
  time; absent when the tree has no generated map yet.

## Hierarchy-dump budget (Phase 1)

The Phase 1 cost budget, measured on the parse side only, two
dumps per recorded action:

- ~14–15 ms/action at 500 nodes.
- ~55–59 ms/action at 2000 nodes.

If per-action capture exceeds the budget, the fallback is
navigation-step-only recording, recorded as an explicit decision
(Phase 5 stop rule) — never a silent reduction.

## OCR timing (where applicable)

OCR (Tesseract) runs at record/convert time only, as step 2 of
the grounding fallback chain (hierarchy → Tesseract → LLM
vision). Each recorded action carries `groundedBy`, so a run's
recordings show which actions needed OCR and which needed
LLM vision. OCR time is a record-time cost; it is never added
to a replay step's duration.

## Measurement gate (Phase 9 task 4)

The pilot numbers from Phases 4, 7, and 8 are the baseline. Any
later change that makes a replay slower or flakier than baseline
must be reported, not hidden.

**Status (Phase 9): the baseline is empty.** Phases 7 and 8 have
not run — no pilot apps exist yet (Phase 0 task 1 not done), so
there are no pilot replay numbers to baseline against. The gate
binds from the moment Phase 7/8 numbers land; until then, this
section records that there is nothing to compare against, rather
than inventing a baseline.

## Flake rate (Phase 9 task 5)

**Method (fixed):** run the full suite (all pilot tests, mobile
+ web) 5 times from reset; flake rate = failed runs ÷ total
runs, recorded per test and suite-wide, alongside per-test
replay seconds and variant-detection results.

**Status (Phase 9): not measured — deviation from the plan,
recorded here.** Task 5 cannot run: there are no pilot flows to
run 5 times (Phases 7–8 not done, no pilot apps, no pilot
tests). No flake-rate number is claimed. The first 5× suite run
happens with the Phase 7/8 pilots, using this method.

## Reproducing the numbers

1. `npm run testorbit:ci` — static checks green (typecheck, lint,
   layout, tests, coverage).
2. `orbit run --test <testId> --platform <platform>
   --project <projectRoot>` — replay; read
   `<platform>/test-reports/<date>/<run>/run-report.json` for
   per-step times, LLM counts, and coverage.
3. `orbit check --project <projectRoot> --platform <platform>`
   — screen-map check result.
4. `orbit generate-map --project <projectRoot>
   --platform <platform>` — regenerate the map the coverage
   block is copied from.
