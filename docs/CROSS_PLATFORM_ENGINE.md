# Unified cross-platform automation engine

The engine provides a common versioned test definition and deterministic orchestration across Android, Flutter, iOS and Web.

## MCP tools

Enable the optional workflow in the project configuration with:

\`\`\`yaml
enabledWorkflows:
  - cross-platform-automation
\`\`\`

- \`validate_cross_platform_test\`: schema validation only; does not connect to a target.
- \`run_cross_platform_test\`: deterministic execution with JSON, Markdown, JUnit and failure evidence.
- \`inspect_cross_platform_target\`: read-only target connection, capability inspection, accessibility snapshot and UI state classification.
- \`diagnose_cross_platform_failure\`: classify a supplied failure and suggest safe next steps; never replays actions.

## Test definition

See [login-smoke.json](../examples/cross-platform/login-smoke.json) for a shared journey example. Runtime credentials should be passed through the \`variables\` input, not committed into the JSON file.

Assertions are first-class steps:

\`\`\`json
{
  "id": "assert-home",
  "type": "assert",
  "assertion": {
    "kind": "textContains",
    "selector": { "strategy": "accessibilityId", "value": "home-title" },
    "expected": "Home"
  }
}
\`\`\`

Supported assertion kinds: \`exists\`, \`visible\`, \`enabled\`, \`textEquals\`, and \`textContains\`.

## Platform requirements

- Android: ADB target serial and accessibility hierarchy support.
- Flutter: \`metadata.osPlatform\` must be \`android\` or \`ios\`; the adapter reads the OS accessibility tree. Native Flutter test tooling remains separate.
- iOS: macOS, Xcode, Appium 2 and Appium XCUITest driver.
- Web: Agent Browser CLI and its browser runtime.

## Execution and safety

- The default execution path is deterministic. The optional \`AssistanceGateway\` only invokes a provider explicitly injected by the host.
- AI proposals are advisory and schema-checked; they are not approvals.
- Action-risk policy requires declared risk metadata from a planner/caller. The framework does not infer destructive intent from labels.
- A failed action is never automatically replayed.
- Reports are written beneath \`.androidmcp-framework/test-reports/YYYY-MM-DD/<time-run-id>/\`.
- Screenshots and snapshots are retained as evidence. Reports redact common credential formats and supplied runtime variable values.

## Current limitations

This implementation does not yet supply a hosted AI provider, a full iOS simulator lifecycle manager, Patrol integration, or a browser binary installer. Platform E2E must be verified on actual compatible hosts. iOS requires macOS; successful host-side unit tests alone do not prove device integration.
