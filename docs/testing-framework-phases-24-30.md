# Testing framework: consolidated Phases 24–30

This single implementation PR groups the next quality-intelligence milestones rather than splitting them into tiny pull requests.

## Phase 24 — Test-matrix inventory

 `analyze_test_quality` discovers conventional Flutter unit/widget, Flutter device-integration, Android Gradle unit, and Android instrumented-test source locations. Each row is marked available or unavailable. This is a filesystem inventory, not a promise that a suite can execute successfully.

## Phase 25 — Changed-file coverage analysis

The tool reads an existing LCOV file (default: `coverage/lcov.info`), maps Git-changed paths to coverage records, and returns covered-line percentage and uncovered line numbers where available. Missing coverage is reported as **unknown**, never fabricated as 0% coverage. XML/Jacoco conversion is not attempted in this phase.

## Phase 26 — Flaky-test signals

Historical recognized report JSON files under `.testorbit/test-reports/` are scanned with a configurable cap. A test is marked potentially flaky only when the same normalized name has at least one explicit pass and one explicit failure. This is a signal for review, not proof of nondeterminism; renamed tests and inconsistent naming can reduce detection quality.

## Phase 27 — Baseline regression comparison

When both `baselineReportPath` and `currentReportPath` are supplied, the tool compares their `tests` arrays and separates pass-to-fail regressions, fail-to-pass improvements, newly appearing tests, and removed tests.

## Phase 28 — Workspace and evidence warnings

The analysis emits warnings for missing project markers, unavailable Git change context, missing coverage files, unreadable historical reports, and incomplete baseline arguments. It does not silently convert unavailable evidence into success.

## Phase 29 — One quality-analysis result

Matrix inventory, changed files, coverage, historical flaky signals, optional baseline comparison, and warnings are returned together in a single structured response. The tool is read-only and does not trigger test commands, modify source files, or alter CI settings.

## Phase 30 — Regression tests and usage documentation

Unit tests cover LCOV parsing, explicit flaky classification, and baseline comparison. CI remains responsible for validating the full TypeScript build, lint/typecheck, and test suite.

## Recommended workflow

1. Run `run_autonomous_test_cycle` with `execute=false` to review the proposed native test command.
2. Execute the selected test suite explicitly and run saved UI cases separately where needed.
3. Consolidate reports with `consolidate_test_reports` and evaluate the strict freshness/provenance gate with `evaluate_test_gate`.
4. Run `analyze_test_quality` to inspect changed-file coverage, historical flaky signals, and (optionally) baseline regressions.

## Boundaries

This milestone does **not** claim to execute saved UI tests and native tests in one invocation. It provides a unified quality-analysis view across their persisted evidence. The test-matrix inventory does not prove that device E2E tests ran, and the tool does not mutate the project or launch builds/tests.
