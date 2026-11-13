# Testing framework roadmap: Phases 11–15

This PR bundles the next testing-framework increments into one reviewable change set, building on change-aware planning, saved test cases, UI workflows, report consolidation, and environment preflight.

## Phase 11 — Safe project-native test execution

Use the MCP tool run_project_tests. Preview is the default; set execute=true only after reviewing the plan. The tool reuses existing Flutter or Native Android runners and selects only framework-defined commands: Flutter test / integration_test and Gradle unit / connected instrumentation task names. It uses argv-based process execution rather than a shell command string and writes Markdown/JSON reports plus a bounded command log under .testorbit/test-reports/.

Supported suites:
- Flutter unit/widget tests.
- Flutter integration_test on a selected device.
- Native Android Gradle unit tests.
- Native Android connected instrumentation tests.

The selected project root should be the specific package/module root in a monorepo. Gradle defaults to the debug variant unless overridden with a validated variant name. Arbitrary commands and arbitrary extra arguments are not accepted.

## Phase 12 — Evidence aggregation across retries

Use aggregate_test_evidence to build an immutable JSON/Markdown index of evidence references found in test reports. It indexes screenshots, logs, UI snapshots, recordings, and other referenced files, marks missing artifacts explicitly, and does not copy, overwrite, or delete evidence. Use explicit reportPaths to limit the input set when needed.

## Phase 13 — Reviewable test candidate generation

Use generate_test_candidate with a natural-language request and explicit acceptance criteria. A coding agent that inspected the project may also provide proposedSteps with actions/selectors; those are preserved as unverified draft steps. If no proposed steps are supplied, the candidate contains placeholders. The candidate remains non-executable until a person reviews and saves it as a test case. This version does not claim to synthesize Google's Android CLI Journey syntax or infer missing acceptance criteria.

## Phase 14 — Sample-project validation

Automated unit tests exercise command planning, validation boundaries, evidence aggregation, and report-gate policy without requiring an emulator. Before calling this feature validated end-to-end, run the manual matrix below against real sample projects and record device/tool versions and generated report paths.

| Sample | Validation | Expected evidence |
|---|---|---|
| Native Android | Preview unit tests, then execute after review | Planned Gradle task, exit code, command log, Markdown/JSON report |
| Native Android device | Run integration suite with a selected target | Connected-test result or explicit environment blocker |
| Flutter | Execute unit/widget suite | Flutter output and report |
| Flutter device | Run integration suite with a selected target | Integration output and report |
| Retry evidence | Aggregate after multiple runs | Manifest listing available and missing evidence |

No real emulator/device validation is claimed by this PR unless a maintainer executes and records the matrix above.

## Phase 15 — Explicit CI test gate

Use evaluate_test_gate on a consolidated summary.json. The default policy rejects empty data, failures, skipped/unreported tests, and incomplete summaries. Set allowSkipped=true only when the CI policy intentionally permits skipped tests. The MCP tool reports a gate decision. For a shell/CI gate, build the package and run npm run test:gate -- --report path/to/summary.json; the script exits 0 only when decision is pass, 1 for a failing/incomplete report, and 2 for invalid input or unreadable data.

Recommended agent/CI sequence:

1. Run validate_test_environment with requireDevice=false for preflight.
2. Run run_project_tests with execute=false and review the proposed scope.
3. Execute the approved suite.
4. Run consolidate_test_reports.
5. Run aggregate_test_evidence.
6. Run evaluate_test_gate; fail the external job unless the decision is pass.

## Safety contract

- No arbitrary shell command input.
- No test source files are generated or overwritten by the candidate generator.
- No missing test or artifact is silently marked passed.
- Test outcomes and environment blockers remain distinct.
- Test reports can contain sensitive output; inspect and redact before sharing externally.
