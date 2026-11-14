# Change-aware test workflow

The `run_test_workflow` MCP tool joins test planning, optional device execution, and report generation.

## Preview before execution

Call the tool with a natural-language request. Execution defaults to disabled:

```json
{
  "request": "Test the login flow affected by my latest changes",
  "projectPath": ".",
  "base": "HEAD~1",
  "execute": false
}
```

The response includes selected saved test cases, explicit coverage gaps, and a plan-only status. Review it before allowing device actions.

## Execute selected saved cases

```json
{
  "request": "Test the login flow affected by my latest changes",
  "projectPath": ".",
  "targetId": "emulator-5554",
  "execute": true,
  "stopOnFailure": false
}
```

Execution requires saved test cases under `.testorbit/testcases/` and a ready ADB target. Supported saved actions are `tap`, `type_text`, `key_press`, `button`, and `wait_for_ui`. Tap/type targets must resolve uniquely when semantic labels are used; ambiguous matches fail rather than selecting an arbitrary element. Assertions and unsupported actions are not fabricated or silently treated as verified.

Each run writes case JSON reports and aggregate `summary.json` / `summary.md` under `.testorbit/test-reports/YYYY-MM-DD/`. Failed steps attempt to save a screenshot under the same run's `evidence/` directory. A run is not marked passed if any case is failed or incomplete.

The tool uses the existing natural-language planner and saved case mappings. It does not guarantee full coverage: read the returned `coverageGaps` and warnings before using the result as a release gate.
