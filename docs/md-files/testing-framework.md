# Natural-language testing framework: Native Android + Flutter

## Product goal

Provide a change-aware testing lifecycle that reads a repository, maintains human-readable test knowledge, converts natural-language requests into explicit plans, reuses existing tests, and writes auditable reports. The shared intelligence/reporting layer supports Native Android and Flutter.

## Reuse instead of reinventing

- Use Google's Android CLI for supported Android capabilities, including Android Studio integration and Journeys where available.
- Reuse Gradle, Android unit/instrumentation tests, Flutter test and integration-test commands, and established project conventions.
- Add adapters only for gaps not covered by existing tools. Detect capabilities rather than assuming each command exists.

## Intended lifecycle

1. Discover platforms, modules, existing tests, instructions and repository state.
2. Analyze the Git diff and map changed files to affected features and dependencies.
3. Combine the diff, saved testing knowledge and the natural-language request into a proposed test plan.
4. Reuse existing tests first; propose generated tests/journeys for uncovered behavior.
5. Validate assertions and preconditions before execution. Require explicit execution opt-in before running project-native tests.
6. Execute through Google Android CLI, Gradle, Flutter tooling or supported automation adapters.
7. Capture structured outcomes, logs, screenshots and environment details. Distinguish pass, fail, blocked, skipped and inconclusive.
8. Propose instruction updates based on verified changes; do not silently replace user-authored instructions.
9. Save immutable run reports under .testorbit/test-reports/YYYY-MM-DD/HHmmss/.

## On-disk layout

All project-local framework data is rooted at .testorbit/:

- config.yaml — framework settings
- instructions/ — user-authored and reviewed testing instructions
- testcases/ — saved structured test-case JSON
- generated-tests/ — review-required candidate JSON; not executable by default
- test-reports/ — immutable timestamped reports, summaries, JUnit XML, command logs, and evidence indexes
- artifacts/screenshots/ — captured screenshot images
- artifacts/ui-snapshots/ — captured semantic UI hierarchy JSON
- artifacts/recordings/ — emulator/device screen recordings
- artifacts/bugreports/ — adb bugreport ZIP archives
- knowledge/ — test knowledge and inventory

The screenshot, snapshot_ui, record_emulator_video, and bug_report tools save outputs to the matching artifacts subdirectory by default. File names are timestamped to avoid replacing earlier evidence. The repository's .gitignore ignores .testorbit/ by default, so evidence and reports remain local unless a project owner intentionally changes that policy.

## Implemented capabilities

- analyze_test_project: read-only Native Android/Flutter scan and Git change summary.
- save_test_instructions: stores Markdown instructions without overwriting unless explicitly authorized.
- save_test_case: stores structured test-case JSON with overwrite protection.
- write_test_report: writes Markdown and JSON reports, without inferring success from missing results.
- analyze_changes: maps Git changes to targeted test suites and recommends broad regression when impact is uncertain.
- resolve_test_instructions: combines global, project, feature, and run-specific instructions with deterministic precedence.
- validate_test_plan: blocks incomplete or malformed test plans before execution.
- audit_screen and analyze_screenshot: inspect visible UI nodes and optional local OCR results.
- fill_form and run_ui_workflow: execute reusable selector-based form and JSON screen/action workflows through supported Android automation.
- run_test_workflow: plans and optionally executes saved test cases with per-step assertions and reports.
- validate_test_environment: read-only preflight for project markers, saved cases, ADB and target readiness.
- consolidate_test_reports: creates Markdown, JSON, and JUnit XML summaries; missing outcomes are not treated as passing.
- run_project_tests: previews or executes framework-selected Flutter and Native Android project-native test suites, with bounded logs and reports.
- aggregate_test_evidence: creates a JSON/Markdown evidence index across reports, including missing artifact references.
- generate_test_candidate: creates non-executable, review-required candidate JSON from explicit acceptance criteria and optional proposed UI actions from a coding agent.
- evaluate_test_gate: evaluates consolidated report status under a strict CI gate policy.

See [Testing Framework Phases 11–15](../testing-framework-phases-11-15.md) for usage and the Native Android/Flutter validation matrix. See Declarative UI workflows and Screenshot OCR for existing UI workflow formats and limitations.

## Test execution safety

- run_project_tests defaults to plan-only mode. Set execute=true only after reviewing the project root and selected suite.
- Only framework-defined Flutter and Gradle test tasks are run. Arbitrary shell commands and arbitrary model-generated command strings are not accepted.
- Flutter integration tests and native connected instrumentation tests require a selected, ready device.
- A test candidate is not executable until a human reviews and converts its placeholder steps into verified interactions and selectors.
- evaluate_test_gate rejects empty reports, explicit failures, and skipped/incomplete results by default. CI must fail the job when its decision is not pass.
- Report output is bounded and secrets are redacted in the structured report. Inspect command logs before sharing them externally.
- Do not delete or overwrite user tests silently.
- Build success does not prove behavioral correctness; assertions must map to stated requirements.
- Report environment failures separately from product failures.
- No real emulator/device end-to-end validation is claimed until the documented sample matrix has actually been executed and its results recorded.


## Phases 16–20 — intelligent and autonomous test cycle

The next increments add explainable test selection, failure diagnosis, selector repair proposals, and a single orchestrating tool. See [Testing framework phases 16–20](../testing-framework-phases-16-20.md).

- `plan_intelligent_tests` ranks saved test cases using request terms, explicit changed-file mappings, custom instruction lines, and previous failure reports. It exposes unmapped changes and recommends broad regression when coverage is uncertain.
- `diagnose_test_failures` classifies evidence and gives bounded retry advice. Automatic retries are never recommended for assertion, application, or test-definition failures; retry permission requires explicit safe-to-repeat input.
- `propose_selector_repairs` compares a stale selector with a supplied current UI hierarchy. Suggestions are review-required and never modify saved tests.
- `run_autonomous_test_cycle` combines Git change discovery, explainable planning, safe project-native Flutter/Gradle test execution, attempt evidence, failure diagnosis, and a strict gate. It defaults to plan-only; execution requires `execute=true`. Retry count defaults to zero and is capped at two.

The autonomous cycle executes the selected project-native suite. Saved test-case matches are recommendations only and are not separately executed by this tool; use `run_test_workflow` for saved UI cases. A successful unit suite is not represented as device E2E validation.


## Unified end-to-end run

Use `run_unified_test_run` to coordinate Native Android Gradle or Flutter unit/integration suites and saved UI test cases under one run ID. The tool is plan-only unless `execute: true` is provided. It stores a durable manifest under `.testorbit/test-reports/.runs/<runId>.json`, saves one final Markdown/JSON report, captures screenshots and redacted logcat when UI actions fail, and applies a strict pass/fail/incomplete evidence gate.

Resume with `resumeRunId`. The project root and Git HEAD must match. Passed items are preserved; interrupted native suites can resume. Interrupted UI cases are not replayed automatically because taps/submissions may have side effects. Native suite retries are capped at two and limited to classified transient infrastructure errors; UI actions and assertions are not retried automatically.

See [Unified E2E and Samsung device regression](../unified-e2e-and-device-regression.md) for invocation and the local physical-device smoke procedure.
