# Cross-platform automation engine

The framework is moving toward one test definition and one orchestration contract, with platform-specific execution drivers.

## Current foundation

- \`src/platform/contracts.ts\`: driver, session, snapshot, semantic selector, action, wait, evidence and error contracts.
- \`src/platform/specification.ts\`: strict Zod validation for versioned \`schemaVersion: "1.0"\` test definitions.
- \`src/platform/selectors.ts\`: deterministic selector matching, ambiguity rejection, disabled-element rejection and snapshot-generation validation.
- \`src/platform/session.ts\`: session ownership, target connection reservation and reverse-order cleanup.
- \`src/platform/index.ts\`: public exports.

Runtime references are ephemeral. Persist semantic selectors in test files and resolve them against a fresh snapshot immediately before each action. An action must fail explicitly when its selector is ambiguous, missing, disabled or stale.

## Driver rollout

| Platform | Initial driver strategy | Status |
|---|---|---|
| Android | TypeScript + ADB, reusing the existing Android automation backend | Contract foundation |
| Flutter | OS accessibility/semantics first; optional Patrol bridge | Planned |
| iOS | Appium XCUITest adapter | Planned |
| Web | Agent Browser adapter | Planned |

The shared contract does not imply that every platform supports every action. Drivers must publish capabilities and reject unsupported actions with \`UNSUPPORTED_CAPABILITY\`; they must never silently no-op.

## AI execution policy

- \`disabled\`: deterministic execution only.
- \`assisted\`: default; AI may propose missing values, selector alternatives or recovery, but the orchestrator validates every proposal.
- \`discovery\`: AI may help explore and draft candidate test definitions.

Destructive operations require explicit policy approval. Never retry a non-idempotent action merely because its response was lost.

## Compatibility

The existing Android workflow and MCP tools remain in place during migration. New platform drivers are introduced behind the contract before existing Android paths are redirected.

## Implemented adapters and execution flow

- AndroidAdbDriver adapts the existing ADB backend and normalizes UIAutomator hierarchy nodes.
- FlutterSemanticsDriver uses the host OS accessibility tree: Android via ADB and iOS via XCUITest. Configure targets.flutter.metadata.osPlatform as android or ios.
- AppiumXCUITestDriver speaks the Appium 2 WebDriver protocol and uses the XCUITest automation name. It expects a running Appium server and a macOS/Xcode environment for simulator/device execution.
- AgentBrowserDriver controls the Agent Browser CLI using an isolated named session. Install the CLI and its browser runtime separately; set AGENT_BROWSER_PATH if it is not on PATH.
- createPlatformDrivers() constructs the first-party adapters and permits dependency injection for tests/custom drivers.
- AutomationEngine runs the same validated steps against each requested platform, records independent platform results and closes each session.

### Example definition

```json
{
  "schemaVersion": "1.0",
  "id": "login-smoke",
  "name": "Login smoke",
  "platforms": ["android", "ios", "web"],
  "targets": {
    "android": { "targetId": "emulator-5554", "appId": "com.example.app" },
    "ios": { "appId": "com.example.app" },
    "web": { "baseUrl": "https://staging.example.test" }
  },
  "steps": [
    { "id": "email", "type": "type", "selector": { "strategy": "accessibilityId", "value": "email" }, "value": "${EMAIL}" },
    { "id": "submit", "type": "tap", "selector": { "strategy": "accessibilityId", "value": "sign-in" } }
  ]
}
```

The targets schema currently accepts appId, baseUrl and targetId; adapter-specific settings are supplied in DriverConfig.metadata by programmatic callers. Keep secrets in runtime variables/environment injection, not committed test definitions.

### Current limitations (intentional fail-closed behavior)

- Android ADB text replacement (clearFirst) is explicitly unsupported until a safe, verified clearing strategy is added.
- Native iOS generic key events and URL navigation are unsupported.
- Agent Browser long-press is unsupported in this adapter version.
- Flutter semantics quality depends on app accessibility labels and OS accessibility exposure. Apps using inaccessible custom-painted controls need semantic improvements or a future Patrol/native bridge.
- This adapter foundation is not yet a claim of completed device/browser end-to-end validation. The next integration phase must add runtime preflight, assertions/state transitions, MCP/CLI entrypoints, reports and platform CI.
