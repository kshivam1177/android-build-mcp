# Testing framework: consolidated Phases 51–60

## Phase 51 — Multi-report evidence bundle

Add `validate_test_evidence_bundle` to inspect multiple persisted report files in one call. It reads only report JSON under the selected project root and produces one structured decision.

## Phase 52 — Current Git HEAD binding

Every report must carry a valid `gitHeadSha` matching the current repository HEAD. Missing or mismatched provenance cannot pass.

## Phase 53 — Freshness validation

Each report must have a valid `generatedAt` timestamp within the configured `maxAgeMinutes` (default 1440, maximum 10080). Future-dated reports are rejected.

## Phase 54 — Working-tree integrity

The default policy requires a clean working tree. Dirty or unverifiable working-tree state produces `incomplete`, because the commit SHA does not fingerprint uncommitted edits.

## Phase 55 — Outcome aggregation

The tool aggregates explicit pass/fail/skipped outcomes across report `tests` and matrix `results`. Failed outcomes fail the bundle; skipped, blocked, unrecognized, or empty outcomes prevent a pass.

## Phase 56 — Required-suite coverage

Callers can provide `requiredSuites`, such as `unit`, `integration`, or saved UI case names. Every required name must appear in the supplied outcome evidence.

## Phase 57 — Three-state decisions

The result is `pass`, `fail`, or `incomplete`. Missing evidence is not treated as success, and missing or stale reports do not silently pass.

## Phase 58 — Path and input safety

Report paths are resolved within the selected project root. The tool does not execute commands from reports, mutate files, or trigger builds/devices.

## Phase 59 — Regression tests

Unit tests cover successful provenance, mismatched HEAD, stale evidence, dirty working tree, empty outcomes, failed/skipped outcomes, and missing required suites.

## Phase 60 — Operational runbook

Example:

```json
{
  "projectPath": ".",
  "reportPaths": [
    ".testorbit/test-reports/2026-10-28/030000-native/summary.json",
    ".testorbit/test-reports/2026-10-28/030500-ui/summary.json"
  ],
  "requiredSuites": ["unit", "integration", "ui-login"],
  "maxAgeMinutes": 1440,
  "requireCleanWorkingTree": true
}
```

Use `run_test_suite_matrix` for native test suites and `run_test_workflow` for saved UI cases, then pass their persisted report paths to the bundle validator.

## Important boundaries

- This tool validates evidence; it does not itself execute or orchestrate native and UI suites.
- Every report must currently contain the `gitHeadSha` and `generatedAt` fields to pass.
- The required-suite check uses exact test names from the report payload; choose names that match persisted outcomes.
- Device E2E is only evidenced when an actual device-backed suite ran and recorded a passing outcome.
