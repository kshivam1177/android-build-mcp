# Testing framework roadmap: Phase 22 — Freshness-aware test gate

Phase 22 hardens the final CI/coding-agent decision so an old green report cannot accidentally authorize a current change.

## Behavior

`evaluate_test_gate` now checks the consolidated summary's `generatedAt` timestamp before evaluating its test counts.

- `maxAgeMinutes` is configurable from 1 to 10,080 minutes (7 days); default is 1,440 minutes (24 hours).
- A report within the freshness window is evaluated using the existing strict pass/fail/skipped policy.
- A report older than the configured window is treated as incomplete and cannot pass.
- A missing, invalid, or future timestamp is unverifiable and cannot pass.
- If no summary exists, the gate reports the missing report and freshness status.
- The gate remains read-only: it does not execute tests, modify reports, or change CI settings.

## Example

Use `consolidate_test_reports` after the relevant test workflows, then evaluate the resulting summary:

```json
{
  "projectPath": "/absolute/path/to/app",
  "reportPath": ".testorbit/test-reports/2026-10-28/summary-abc123/summary.json",
  "maxAgeMinutes": 120,
  "allowSkipped": false
}
```

Omit `reportPath` to use the newest summary. The timestamp is the report's own `generatedAt`, not the file's modification time, so copying/touching an old report does not make it fresh.

## Validation and limits

This is a freshness guard, not proof that the report covers the current Git commit. It does not run UI tests or project-native tests. Callers should consolidate reports after the workflows for the current change, and inspect the reported freshness result. A later phase should bind test-run summaries to a Git head SHA and require coverage of the current head before merge.
