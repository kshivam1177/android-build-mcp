# Testing framework: consolidated Phases 31–40

This giant PR builds on the Phase 24–30 quality-analysis tool and closes two gaps: configurable quality policy decisions and release automation after CI-gated merges.

## Phase 31 — Release dispatch after verified merge

The auto-merge workflow now has `actions: write` permission and explicitly dispatches `.github/workflows/publish.yml` after it merges the exact CI-verified PR head. This is necessary because merge commits created with `GITHUB_TOKEN` do not automatically trigger ordinary `push` workflows. Publishing is not considered complete until the publish workflow itself succeeds.

## Phase 32 — Configurable quality policy

The new `evaluate_test_quality_gate` MCP tool evaluates an optional minimum changed-file coverage percentage and optional baseline regression policy. It is read-only and produces a structured `pass`, `fail`, or `incomplete` decision.

## Phase 33 — Fail closed on missing coverage

When a coverage threshold is configured, changed files with no matching LCOV record are unknown. Unknown coverage yields `incomplete`, not a pass and not an invented 0% value. If the coverage file is missing or unreadable, the tool reports the evidence problem and blocks the configured coverage decision.

## Phase 34 — Baseline regression policy

When baseline and current consolidated summaries are supplied, pass-to-fail changes are surfaced as regressions. The default policy fails on regressions; callers can explicitly set `failOnRegression: false` for exploratory analysis, but that weakens the gate.

## Phase 35 — Deterministic policy helper

The policy evaluator is a pure exported function with unit tests for passing thresholds, below-threshold coverage, unknown coverage, and regression behavior. This keeps the policy testable without Android devices or project fixtures.

## Phase 36 — Separate coverage and regression evidence

The response reports coverage evaluation and regression names separately, so callers can distinguish an actual policy failure from missing evidence.

## Phase 37 — Read-only guarantees

The gate does not build, install, launch, tap, or change CI settings. It evaluates only supplied reports, existing LCOV data, and Git change context.

## Phase 38 — Release workflow contract

The npm publisher remains responsible for version selection, package verification, publishing, and recording the published version. The merge workflow only dispatches it after a verified merge; it does not claim the package was published merely because dispatch succeeded.

## Phase 39 — CI validation

CI must validate TypeScript build, type-check, lint, unit tests, CLI startup, tool metadata, and package contents. The policy unit tests do not replace real-project coverage checks.

## Phase 40 — Usage and limitations

Example: configure a minimum changed-file threshold and regression comparison:

```json
{
  "projectPath": ".",
  "coveragePath": "coverage/lcov.info",
  "minChangedFileCoveragePercent": 80,
  "baselineReportPath": ".testorbit/test-reports/baseline/summary.json",
  "currentReportPath": ".testorbit/test-reports/current/summary.json",
  "failOnRegression": true
}
```

Use `analyze_test_quality` for a read-only diagnostic overview, then `evaluate_test_quality_gate` for an explicit policy decision.

## Limitations

- LCOV is the only coverage format handled by this policy gate in this phase.
- The tool relies on saved report names/statuses; inconsistent test naming may hide regressions.
- A passing policy result is not proof of real-device E2E unless relevant device tests actually ran and their evidence was consolidated.
- The release workflow dispatch must be checked separately; the merge workflow's success alone is not a publish confirmation.
