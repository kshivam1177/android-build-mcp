# Unified execution orchestration

The cross-platform runner executes independent platform targets through a bounded worker pool. Concurrency can be configured on the engine or per MCP run (maxConcurrency, 1–4); the default is 2. Results remain ordered by the test definition even when targets finish out of order. Duplicate platform targets are rejected so one mutable platform driver cannot be scheduled twice within a test.

## Cancellation and resource isolation

The MCP runner accepts runTimeoutMs (1,000–3,600,000 ms) to impose an overall deadline. Expiry aborts the shared run signal, stops scheduling pending targets, and asks active drivers to stop. Results distinguish caller cancellation from an overall timeout.

AbortSignal cancellation is carried from the execution engine to Android ADB commands, iOS Appium requests, and Web Agent Browser CLI processes. Child commands are started without a shell, receive SIGTERM on cancellation or timeout, and receive SIGKILL after a short grace period if they do not exit. Active workers are awaited so their finally blocks can close sessions. A cancelled run does not schedule additional platform work.

A driver instance can own only one live session at a time. Target reservations also prevent two sessions from controlling the same configured target concurrently. Failed or partially completed connections trigger best-effort disconnect cleanup. Use a fresh driver instance for every concurrently running execution.

## Safe retry boundaries

The existing policy.maxRecoveryAttempts setting applies only to read-only waitFor and assert operations. The runner retries only transient stale-snapshot, action-timeout, and driver-unavailable errors, up to the configured bound. A failed assertion is not treated as transient. Mutating actions (tap, type, navigation, lifecycle operations, and gestures) are never automatically retried because the framework cannot prove whether the action reached the target. Each step result records its attempt count. Run summaries and JUnit output include platform totals, failed steps, retried steps, total attempts, cancellation, and timeout status.

## Checkpoint and resume

The run_cross_platform_test MCP tool accepts:
- checkpointPath: project-relative JSON file path for durable run state.
- resume=true: restore completed platform results from that checkpoint.
- restartInterruptedPlatforms=true: explicit opt-in to restart a platform that was active when the previous process stopped.

The checkpoint is atomically replaced after each platform starts and completes. Its fingerprint binds the checkpoint to the exact test definition and runtime variables. Completed platforms are not executed again. If a process stops while a platform is active, resume is blocked by default because the framework cannot know whether the last action reached the device/browser. Restarting that platform can replay non-idempotent actions and therefore requires explicit opt-in after reviewing the previous run.

Checkpoint files may contain execution evidence and UI snapshots. Keep them inside the project’s protected workspace and do not commit them if snapshots contain sensitive application data.

## Continuous integration

The main CI workflow runs build, type-check, lint, unit tests, CLI checks, generated tool inventory validation, and package-content checks on Node 18, 20, and 22. Each matrix leg uploads a JUnit report. A final aggregation job summarizes test, failure, error, and skipped counts in the GitHub Actions job summary and fails if any compatibility leg fails. CI is configured for master-only branch integration.
