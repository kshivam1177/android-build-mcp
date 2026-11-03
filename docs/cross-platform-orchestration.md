# Unified execution orchestration

The cross-platform runner executes independent platform targets through a bounded worker pool. Concurrency can be configured on the engine or per MCP run (maxConcurrency, 1–4); the default is 2. Results remain ordered by the test definition even when targets finish out of order.

Cancellation is propagated through the existing AbortSignal contract. Once cancelled, the scheduler stops assigning new targets and waits for active workers to finish their cleanup paths. Drivers must honor the signal in connect, wait, snapshot and action implementations for prompt cancellation.

## Checkpoint and resume

The run_cross_platform_test MCP tool accepts:
- checkpointPath: project-relative JSON file path for durable run state.
- resume=true: restore completed platform results from that checkpoint.
- restartInterruptedPlatforms=true: explicit opt-in to restart a platform that was active when the previous process stopped.

The checkpoint is atomically replaced after each platform starts and completes. Completed platforms are not executed again. If a process stops while a platform is active, resume is blocked by default because the framework cannot know whether the last action reached the device/browser. Restarting that platform can replay non-idempotent actions and therefore requires explicit opt-in after reviewing the previous run.

Checkpoint files may contain execution evidence and UI snapshots. Keep them inside the project’s protected workspace and do not commit them if snapshots contain sensitive application data.
