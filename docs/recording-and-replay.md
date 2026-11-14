# UI action recording and replay

Recording is opt-in. It captures the core UI automation calls made through `tap`, `long_press`, `swipe`, `type_text`, and `key_press`.

## Record a flow

1. Call `orbit_start_recording` with a unique `flowId` and optional `targetId` / `projectPath`.
2. Use the normal UI tools to perform the flow.
3. Call `orbit_stop_recording` to persist the JSON action sequence and start/stop screenshots.
4. Call `orbit_replay_recording` with the same `flowId` to replay it later.

Files are written under the project root:

- `.testorbit/recordings/<flowId>.json` — versioned action log.
- `.testorbit/recording-evidence/<flowId>/` — starting/ending screenshots and replay failure evidence.
- `.testorbit/test-reports/YYYY-MM-DD/<time>-replay-<runId>/replay-report.json` — per-step replay report.

## Replay behavior and safety

- Semantic selectors are used for recorded element taps where possible; ambiguous selector matches fail rather than tapping an arbitrary element.
- Coordinate actions are normalized to the original screen size and scaled to the current device dimensions.
- Replay stops at the first failed step unless `continueOnFailure` is enabled.
- Typed text is stored in the recording JSON by default. Password/OTP/secret/token/PIN-like selector labels are automatically redacted. Use `redactText: true` in `orbit_start_recording` to redact all text. Redacted text cannot be replayed until the recording JSON is safely edited.
- Existing recordings are never overwritten; use a new `flowId` for each capture.
- Recordings are local project files and are not uploaded by the framework.

This first increment records the five core UI tools listed above. Compound actions executed inside `batch` or `interact_screen` are not expanded into individual recording steps yet.
