# Testing framework: consolidated Phases 41–50

## Phase 41 — Sequential suite matrix execution

The new `run_test_suite_matrix` tool can preview or sequentially execute selected project-native suites in one invocation. It supports Flutter unit/widget tests and Flutter integration tests, plus Android Gradle unit and connected instrumentation tests.

## Phase 42 — Preview by default

`execute` defaults to `false`. The plan lists each requested suite, filesystem evidence for availability, and the safe command plan. Set `execute: true` only after reviewing the target project and selected suites.

## Phase 43 — Fixed command allowlist

The tool uses framework-owned Flutter arguments and Gradle task names. It does not accept arbitrary shell commands. Gradle module names and variant names are validated, and suites run sequentially rather than in parallel.

## Phase 44 — Device-required suites fail visibly

Device integration suites resolve an explicit/session/single ready target. If no target is available, the integration suite is recorded as blocked while other selected suites can still run. A blocked suite cannot make the overall matrix pass.

## Phase 45 — Suite-level outcomes

Every selected suite is reported as passed, failed, blocked, or unavailable. A matrix passes only when every requested suite ran and passed. Empty matrices, unavailable suites, and blocked device tests cannot pass the gate.

## Phase 46 — Bounded redacted logs

Captured stdout/stderr are redacted for common secret patterns and bounded to the last 20,000 characters per stream before they are persisted. The report stores per-suite command, exit code, duration, and error summary.

## Phase 47 — Timestamped evidence

Execution writes `summary.json`, `report.json`, and `summary.md` under `.testorbit/test-reports/YYYY-MM-DD/`. The JSON includes suite results, counts, warnings, and limitations.

## Phase 48 — Provenance and dirty-tree disclosure

Git HEAD is captured before execution. The report also records whether the working tree was clean and a bounded list of changed paths. If the tree is dirty, the tool warns that the commit SHA alone does not identify the uncommitted content.

## Phase 49 — Regression tests

Unit tests cover all-pass, failure, blocked/unavailable, and empty-matrix outcome behavior. These tests do not execute Android devices or Flutter/Gradle commands.

## Phase 50 — Runbook and honest boundaries

Example preview:

```json
{
  "projectPath": ".",
  "suites": ["unit", "integration"],
  "targetId": "emulator-5554",
  "execute": false
}
```

After reviewing the preview, explicitly set `execute: true` to run. Saved UI cases remain a separate workflow: use `run_test_workflow`, then consolidate the resulting reports and evaluate the freshness/provenance gate.

## Limitations

- Filesystem source-set discovery is conventional and can miss custom Gradle source sets or nested monorepo apps.
- Gradle test task exit status is not parsed into individual test-case counts in this phase.
- The matrix runner does not execute saved UI cases.
- No real-device E2E result is claimed unless an actual device suite runs and reports its outcome.
