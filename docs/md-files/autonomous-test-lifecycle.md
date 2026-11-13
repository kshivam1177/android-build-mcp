# Autonomous test lifecycle

TestOrbit separates **planning**, **candidate approval**, **execution**, and **evidence**. These are distinct states: a suggested test is not an approved test, and an approved test is not executed coverage.

## Recommended agent workflow

1. Run `plan_change_aware_test_run` to inspect Git changes, saved test mappings, project instructions, and recent failures. Review its unmapped files and suggested coverage; suggestions are not executed tests.
2. Ask the coding agent to inspect the changed source and produce explicit acceptance criteria. Use `generate_test_candidate` to save a review-required candidate. A candidate with placeholder steps is intentionally not executable.
3. Run `review_test_candidate` with the candidate ID and without `approve=true` first. Inspect validation issues. The tool does not claim it has verified selectors against a live device.
4. Review candidate selectors, actions, expected outcomes and acceptance criteria against the app. Only then call `review_test_candidate` with `approve=true`. Existing saved test cases are never overwritten. Optional `relatedFiles` mappings must be explicitly reviewed.
5. Run `prepare_change_aware_execution_plan` to produce a focused invocation for explicitly mapped cases or a broad-regression recommendation when mapping confidence is insufficient.
6. Review the returned arguments and invoke `run_unified_test_run` explicitly. The preparation tool does not start execution. The unified runner remains the authority for preflight, device/project locking, manifests, retries, resume, evidence and final outcome.
7. Inspect the generated report under `.testorbit/test-reports/YYYY-MM-DD/HHmmss/`. Treat only executed results with valid evidence as outcomes. Unmapped changes and unexecuted candidates remain coverage gaps.

## Safety and status semantics

- **Candidate:** generated content requiring human review; never counted as coverage.
- **Valid, awaiting approval:** candidate structure passed static checks, but it has not been promoted.
- **Approved:** explicitly promoted to `.testorbit/testcases/`; not yet executed.
- **Executed:** run through the unified runner with a run manifest and result.
- **Pass/fail/incomplete:** only determined from the actual execution and the existing evidence/quality gates.

The review tool checks the candidate schema, placeholder descriptions, required targets, text/key inputs and per-step expected outcomes. Static validation cannot prove that a selector exists on a real screen, that a flow is semantically correct, or that an assertion is true. Verify those against the project and target app before approval.

When changes have no explicit saved-test mapping, the execution planner prefers broad regression. It never treats a zero-change diff as evidence that testing is unnecessary. The plan reports its rationale and exact proposed arguments, but never executes the plan itself.

## MCP tools added

- `review_test_candidate`: validate a generated candidate and optionally promote it after explicit approval.
- `prepare_change_aware_execution_plan`: map changed files to saved test IDs and prepare arguments for `run_unified_test_run` without executing tests.
