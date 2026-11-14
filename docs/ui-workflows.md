# Declarative UI workflows

The UI automation workflow runner uses Node.js built-in modules for filesystem access, path validation, child-process execution, timeouts, and report writing. It adds no runtime dependencies. Device layout inspection and semantic input are delegated to Google's separately installed Android CLI; raw coordinate taps use ADB only when a screen definition explicitly provides coordinates and no selector.

## Project files

```text
.testorbit/
  screens/
    login.json
    home.json
  workflows/
    login-flow.json
  test-reports/
    YYYY-MM-DD/
      HHMMSS-<run-id>/
        workflow-report.json
```

A screen definition declares reusable element identities, selectors, and optional coordinate fallbacks:

```json
{
  "schemaVersion": "1.0",
  "id": "login",
  "name": "Login",
  "screenshot": { "width": 1080, "height": 2400 },
  "detection": { "requiredElements": ["email", "password", "submit"] },
  "form": [
    { "id": "email", "type": "input", "selector": { "resourceId": "com.example:id/email" }, "required": true },
    { "id": "password", "type": "input", "selector": { "resourceId": "com.example:id/password" }, "required": true, "sensitive": true },
    { "id": "submit", "type": "button", "selector": { "text": "Sign in" }, "required": true }
  ]
}
```

A workflow references screens by key and executes a bounded, ordered action list:

```json
{
  "schemaVersion": "1.0",
  "id": "login-flow",
  "name": "Login flow",
  "forms": { "login": "login.json", "home": "home.json" },
  "actions": [
    { "id": "wait-login", "type": "assert_screen", "screen": "login", "timeoutMs": 10000 },
    { "id": "enter-email", "type": "type", "screen": "login", "element": "email", "value": "${env:TEST_EMAIL}" },
    { "id": "enter-password", "type": "type", "screen": "login", "element": "password", "value": "${env:TEST_PASSWORD}" },
    { "id": "submit", "type": "tap", "screen": "login", "element": "submit" },
    { "id": "wait-home", "type": "wait_for_screen", "screen": "home", "timeoutMs": 20000 }
  ],
  "settings": { "stopOnFailure": true, "verifyAfterAction": true }
}
```

## Supported actions

- `tap`, `type`: prefer semantic selectors; coordinate fallback is available for taps only.
- `wait`: wait for a bounded duration.
- `wait_for_screen`, `assert_screen`: poll required screen elements using `android layout`.
- `back`, `key`: send a navigation key or supported Android CLI key.

Run the `run_ui_workflow` MCP tool with a JSON path relative to `.testorbit/workflows/`. Absolute paths and traversal outside the managed directory are rejected. Workflow and screen JSON files are size-limited; action count and action types are validated before execution. The runner never evaluates workflow text as JavaScript or invokes a shell.

Install Google Android CLI and ensure `android` is on `PATH`; override the executable with `ANDROID_CLI_PATH` if needed. Install ADB for coordinate fallback. This is an execution engine, not a natural-language agent: use a coding agent to draft screen/workflow JSON, then validate and run it with the MCP tool.
