# Cross-platform automation — mega milestone addendum

This addendum expands the initial driver/orchestrator slice with deterministic quality gates and AI safety boundaries.

## Included in this increment

- Snapshot assertion evaluator for existence, visibility, enabled state and exact/contained text.
- Explainable UI state classification for loading, success, empty, error, validation, authentication and unexpected screens.
- Explicit action-risk policy. Risk is supplied as intent by the test author or planner; the framework does not guess destructive intent from labels.
- Recovery advisor that classifies framework failures and proposes next steps without replaying actions.
- Optional AI assistance gateway. No provider is silently enabled; a provider must be injected by the host. Proposals are bounded and validated, and remain advisory.
- JUnit XML reporter and common secret redaction utility.
- Unit tests for assertions, state classification, policy, recovery and JUnit serialization.

## Safety invariants

1. The execution engine does not automatically replay taps, submissions, purchases or deletion actions.
2. An AI proposal is not an action approval and cannot bypass the action allowlist.
3. Destructive risk is explicit metadata, not inferred from a selector string.
4. Reports must preserve failed/skipped distinctions and escape XML output.
5. Credentials should be supplied as runtime variables and redacted before report/log publication.

## Runtime verification still required

These host-side modules do not establish that Appium/XCUITest, ADB or Agent Browser are installed or operational. Integration verification must run on matching hosts:
- Android: Linux/macOS/Windows with ADB and an emulator or device.
- Flutter Android: Flutter app exposing useful accessibility semantics.
- iOS: macOS with Xcode, Appium 2 and the XCUITest driver.
- Web: supported Agent Browser CLI and browser runtime.

Do not merge based only on this addendum's unit tests. Run the complete repository test gate and platform smoke tests.
