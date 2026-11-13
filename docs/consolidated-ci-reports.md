# Consolidated CI test reports

Use the `consolidate_test_reports` MCP tool after test execution to consolidate recognized report JSON files under `.testorbit/test-reports/`.

It writes:
- `summary.md` — human-readable counts and per-test outcomes;
- `summary.json` — machine-readable summary;
- `junit.xml` — JUnit-compatible test cases for CI systems.

Recognized source files are `report.json`, `results.json`, `workflow-report.json`, and `replay-report.json`. Use the optional `since` ISO timestamp to restrict inputs by file modification time.

Only explicit passed/success outcomes count as passed. Failed steps take precedence over a parent success flag; planned, generated, executed-only, blocked, unknown, and missing outcomes are skipped. No recognized reports yields `status: no-data`, not success. If any tests have only skipped, blocked, planned, generated, executed-only, unknown, or missing outcomes, the summary status is `incomplete`. A CI workflow should publish `junit.xml` and fail when the summary status is `failed`, `incomplete`, or `no-data` unless the project explicitly allows skipped tests.

The consolidator does not run tests, modify source reports, or infer that a report with missing outcomes passed.
