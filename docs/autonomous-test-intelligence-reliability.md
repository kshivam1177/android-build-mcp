# Autonomous test intelligence and execution reliability

This milestone strengthens the loop from source changes to test planning, execution, evidence, and diagnosis. It complements (rather than replaces) `run_unified_test_run`, `run_autonomous_test_cycle`, the quality gate, and the Samsung device regression runbook.

## Runtime inspection

Use `inspect_test_runtime` before resuming work or diagnosing a previous run. It is read-only and reports:
- project-local framework config presence;
- active project run-lock metadata, if present;
- recent resumable run-manifest summaries;
- the newest available `summary.json` gate result.

It deliberately does not return raw logs, environment variables, or full saved test cases. A manifest is not proof that a run is still active: a hard process termination can leave stale metadata.

## Safe concurrency and path handling

The `runtimeSafety` helpers provide:
- an atomic directory lock at `.testorbit/.run-lock`;
- explicit lock-conflict errors rather than silently stealing an existing lock;
- a guarded release that checks the owner run ID;
- project-root containment checks for artifact paths;
- secret redaction and stable runtime failure categories.

Any executor integrating `acquireProjectRunLock` must release it in a `finally` block. Do not automatically delete a lock solely because its PID appears absent: PIDs can be reused, and a remote or containerized runner may own the workspace. Inspect the owner and confirm no run is active before manual cleanup.

## Structured failure codes

| Code | Meaning | Automatic retry |
|---|---|---|
| `BUILD_FAILED` | Build or compilation failure | No |
| `DEVICE_UNAVAILABLE` | ADB target missing, offline, unauthorized, or ambiguous | Only after the target is revalidated |
| `TEST_FAILED` | Deterministic assertion/test failure | No |
| `EVIDENCE_INCOMPLETE` | Missing provenance or incomplete report | No |
| `TOOLCHAIN_MISSING` | Required executable or SDK missing | No |
| `LOCK_CONFLICT` | Another run owns the workspace lock | No |
| `CANCELLED` | Explicit cancellation | No |
| `TIMEOUT` | Operation exceeded its time budget | Context-dependent; retain original failure |
| `UNKNOWN` | Not enough evidence to classify safely | No |

These codes are diagnostic labels, not a replacement for original output. Always preserve the original failure, command exit code, run ID, Git HEAD, and evidence paths.

## Evidence and security

- Keep reports under the project root and preserve run IDs across native suites and saved UI cases.
- Redact common bearer tokens, API keys, GitHub tokens, and query-string credentials before persisting diagnostic text.
- Never include secrets from environment variables in reports.
- Require explicit confirmation before destructive actions or replaying UI cases that may have side effects.
- Do not automatically replay an interrupted UI case. Inspect the device and decide whether its last action was applied.
- CI on emulators cannot establish OEM-specific physical-device reliability. Run the Samsung regression script on the actual connected device and label the evidence accordingly.

## Suggested operator sequence

1. Run `inspect_test_runtime` to inspect recent state.
2. Run `run_unified_test_run` with `execute=false` and review the plan.
3. Execute only after the plan and target are correct.
4. Use `diagnose_test_failures` and the original evidence for failed work.
5. Require a passing strict evidence gate before treating the run as release evidence.

## Compatibility verification

Release CI should cover the declared minimum Node version and current LTS, run typecheck and unit tests, and smoke-test the exact packed npm artifact. Native Android and Flutter projects should be exercised separately; physical-device regression remains a separate, explicitly labeled check.
