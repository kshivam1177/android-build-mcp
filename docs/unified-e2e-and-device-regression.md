# Unified E2E and Samsung device regression

## Unified test run

Call run_unified_test_run with execute=false first to inspect the selected work. Then rerun with execute=true. The tool uses one run ID for native/Flutter suites and saved cases, stores a durable manifest under .testorbit/test-reports/.runs/<runId>.json, and writes summary.json and summary.md into the timestamped report directory.

- Use resumeRunId with the returned run ID to resume pending work. Git HEAD and project root must match.
- Passed work is preserved. Native suites interrupted while running can resume. An interrupted UI case is marked incomplete rather than blindly replayed because taps and submissions may have side effects.
- Native suite retries are capped at two and only used for classified transient infrastructure errors. Assertions, compile failures, selector errors and UI actions are not automatically retried.
- The final gate passes only if every selected item explicitly passed, Git HEAD is available, and the working tree was clean at run start. Failed work yields fail; missing, blocked, unavailable or unproven evidence yields incomplete.
- Failure evidence can include screenshots, redacted logcat, and bounded command output.

## Samsung Galaxy J7 Duo device regression

The regression script uses the framework MCP server and requires a local Android SDK/ADB environment plus an authorized, connected phone. It launches the installed Savera apps and exercises list_devices, doctor, launch_app_device, snapshot_ui, screenshot, and is_keyboard_visible.

    npm ci
    npm run build
    TESTORBIT_DEVICE_ID=5200f9c0b49f25b9 \
    TESTORBIT_TEST_PACKAGES=com.pgi.savera_storewell,com.pgi.saverastaff \
    node scripts/run-samsung-device-regression.mjs

If the device serial changes, replace the ID. Reports are saved under .testorbit/test-reports/YYYY-MM-DD/*-samsung-device-/. The script records failures rather than pretending missing device access is a pass. This is a device-backed smoke test, not full business-flow E2E coverage; use saved UI test cases and the unified runner for app-specific workflows.
