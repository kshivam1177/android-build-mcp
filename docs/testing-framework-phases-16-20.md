# Testing framework roadmap: Phases 16–20

This increment builds on the merged phases 11–15. The goal is an explainable, evidence-backed workflow that selects relevant tests, safely runs an existing project-native test suite, diagnoses failures, and reports a strict gate result. It does not claim that a unit test is end-to-end validation.

## Phase 16 — Intelligent test planning

Use `plan_intelligent_tests` to combine the natural-language request, Git change list, explicit source-file mappings on saved test cases, relevant custom instruction lines, and prior failure reports. Scores and reasons are returned for every selected case. Unmapped files, absent coverage, and unavailable Git context trigger conservative broad-regression recommendations. This is deterministic planning, not an LLM claim about code behavior.

## Phase 17 — Reviewable test and Journey candidates

Use `generate_test_candidate` with explicit acceptance criteria and optional proposed steps supplied by an agent that inspected the codebase. The candidate remains non-executable and review-required. The framework does not fabricate Google Android CLI Journey syntax or silently turn guessed selectors into executable tests. Reuse supported Android CLI/Gradle/Flutter runners and verify syntax against the installed official tooling before adopting a native Journey format.

## Phase 18 — UI-change detection and selector repair

Use `propose_selector_repairs` with the original selector and a fresh UI hierarchy. A still-unique selector is reported as valid; ambiguous selectors are flagged; likely alternatives are ranked from resource IDs, content descriptions, and visible text. Every proposed repair is review-required. No stored test or assertion is edited automatically.

## Phase 19 — Failure diagnosis and bounded retries

Use `diagnose_test_failures` to classify environment, assertion, application, test-definition, likely transient/flaky, and unknown failures. Retry advice is capped at two retries and requires explicit safe-to-repeat permission. Assertions, application crashes, and invalid test definitions are not automatically retried to make a red result appear green. The autonomous cycle stores each attempt and its bounded logs.

## Phase 20 — One-command autonomous test cycle

Use `run_autonomous_test_cycle` with a natural-language request and project root.

1. Discover changed files when Git is available; if not, warn and recommend broad coverage.
2. Build an explainable test plan and select a framework-defined Flutter or Gradle suite.
3. Preview the exact supported command by default.
4. When the caller explicitly sets `execute=true`, run only the selected project-native test command with a bounded timeout.
5. Classify failure output and retry only when the failure appears transient, safe-to-repeat was declared by the orchestrator, and the configured retry budget remains.
6. Save immutable attempt logs and a Markdown/JSON summary under `.testorbit/test-reports/YYYY-MM-DD/HHmmss-autonomous-<id>/`.
7. Apply the strict test gate: only an explicit successful runner exit passes; blocked or failed runs do not.

Example MCP input:

```json
{
  "request": "Verify the checkout changes",
  "projectPath": "/absolute/path/to/app",
  "suite": "unit",
  "execute": false,
  "maxRetries": 0
}
```

After reviewing the returned `commandPlan`, rerun with `execute: true` to run the selected suite. For Flutter integration tests or Native Android connected instrumentation tests, choose `suite: "integration"` and ensure a ready target is available.

## Scope and limitations

- Test candidates and selector repairs remain proposals; they do not mutate user-authored tests.
- The autonomous command runs a selected project-native suite. It reports saved test-case matches as recommendations; it does not secretly invoke the separate UI workflow runner.
- Automatic retry defaults to zero; at most two retries may be configured.
- Git diff, test-case mappings, instruction relevance, and failure classification are heuristics. Review them before relying on narrow test selection.
- Real device/emulator E2E validation must be run on a real project/device and its resulting report reviewed separately.
