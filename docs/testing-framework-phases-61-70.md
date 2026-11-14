# Phases 61–70 — Saved cross-platform suite orchestration

## Goal

Close the gap between the existing single-definition cross-platform engine and project-level repeatable regression. Teams can keep JSON definitions in the project workspace, preview the complete suite, execute it through the Android/Flutter/iOS/Web drivers, and receive one evidence-backed result.

## Included in this milestone

- The new run_cross_platform_suite tool discovers JSON definitions in .testorbit/cross-platform-tests/ or a validated project-relative directory.
- The complete selected suite is parsed and validated before any device or browser action begins. Duplicate test IDs and missing requested IDs block execution.
- Preview is the default. execute=true is required before connecting to devices, simulators or browsers.
- Definitions execute sequentially to avoid cross-definition target contention. Each definition may use bounded parallel platform execution (1–4 targets) through the existing engine.
- Per-definition checkpoints are written below .testorbit/test-reports/.runs/cross-platform/.
- One JSON, Markdown and JUnit suite report is produced, with redacted test variables and per-platform/step outcomes.
- The final gate distinguishes pass, fail and incomplete. A pass requires every selected definition to finish successfully, a valid Git HEAD, a clean working tree, a SHA-256 manifest of the exact selected definition files, and confirmation that those files did not change during execution. This explicitly binds ignored project-local test definitions to the report.
- stopOnFailure is opt-in; by default the suite continues so the report captures independent failures.

## Save a test definition

Create .testorbit/cross-platform-tests/login-smoke.json:

    {
      "schemaVersion": "1.0",
      "id": "login-smoke",
      "name": "Login smoke test",
      "platforms": ["android", "flutter", "ios", "web"],
      "targets": {
        "android": { "appId": "com.example.app", "targetId": "emulator-5554" },
        "flutter": { "appId": "com.example.flutterapp", "targetId": "emulator-5554" },
        "ios": { "appId": "com.example.iosapp", "targetId": "booted" },
        "web": { "baseUrl": "https://example.test" }
      },
      "steps": [
        { "id": "wait-ready", "type": "wait", "timeoutMs": 1000 },
        { "id": "assert-ready", "type": "assert", "assertion": {
          "kind": "exists",
          "selector": { "strategy": "accessibilityId", "value": "login-screen" }
        } }
      ]
    }

Selectors and supported actions must be valid for every platform listed. Use platform-specific definitions when UI semantics differ.

## Run safely

1. Call run_cross_platform_suite with execute=false (or omit execute) and review every selected definition and target.
2. Ensure required Android devices, iOS/macOS Appium infrastructure and Agent Browser runtime are installed and ready. Use check_cross_platform_runtime first.
3. Call again with execute=true and a deliberate concurrency/timeout policy.
4. Inspect the JSON, Markdown and JUnit paths returned by the tool. A cancelled, timed-out, failed, skipped or unexecuted definition cannot pass.

## Boundaries and honest verification

- This runner reuses existing platform drivers; it does not provision a device farm, install Xcode/Appium, sign iOS apps, or create CI-hosted devices.
- iOS execution still requires macOS, Xcode and Appium/XCUITest. Web execution requires the supported Agent Browser runtime.
- A CI unit-test pass validates orchestration logic, not real-device behavior.
- A real Android/iOS/Web E2E claim requires executing the suite on the corresponding runtime and retaining the resulting report.
- AI remains advisory and is not invoked to generate or replay actions in this deterministic runner.
