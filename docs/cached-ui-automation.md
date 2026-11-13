# Cached UI automation

This feature reduces repeated discovery work by persisting project-specific screen maps and caching the exact workflow definition after a successful run. It does not run OCR during ordinary screen-map capture.

## Files written

```text
.testorbit/
  screen-maps/
    login.json
    images/
      login.png
  action-sequences/
    login-flow.json
  test-reports/
    YYYY-MM-DD/
      HHMMSS-<run-id>/
        workflow-report.json
```

## Capture a screen map

Call the `save_screen_map` MCP tool with a stable screen ID such as `login`. It captures the screenshot and Android UI hierarchy concurrently, then writes:

- each element's resource ID, text, content description, and class selector when available;
- bounds, center coordinates, and normalized center coordinates;
- clickability, enabled/focusable/scrollable/checkable state;
- device ID, display dimensions, screenshot path, and a SHA-256 screen fingerprint.

The screen map is written to `.testorbit/screen-maps/<screenId>.json`; the image is saved under `screen-maps/images/`. Capturing the map does not run Sharp or Tesseract. Re-capturing a given ID updates that screen's current reference image and map.

## Record and replay successful flows

Define a normal workflow in `.testorbit/workflows/` and run it with `run_ui_workflow`. Only when every action succeeds, the runner writes a replayable copy to `.testorbit/action-sequences/<workflow-id>.json`. The copy includes cache metadata for the source workflow, last successful run, total duration, and per-step durations. Environment placeholders such as `${env:TEST_PASSWORD}` remain placeholders; secrets are not copied from the runtime environment.

Replay the saved sequence by calling `run_ui_workflow` with:

```json
{
  "workflowFile": "action-sequences/login-flow.json",
  "projectPath": "/path/to/your/project"
}
```

Screen definitions are still loaded from `.testorbit/screens/`, so the sequence can be validated and updated independently from the screen map.

## Fast path and safety

- Use semantic selectors first. Coordinate fallback should be reserved for controls without stable selectors.
- Prefer normalized coordinates when adapting to different display dimensions; absolute coordinates are tied to the captured display.
- Keep `verifyAfterAction` disabled for stable flows unless per-action hierarchy verification is needed. Explicit `wait_for_screen` and `assert_screen` steps remain available at important transitions.
- A cached sequence is a reusable plan, not proof the app has not changed. Validate key screen transitions and assertions. Re-capture the screen map when layout, app version, or device geometry changes.
- Failed runs are reported but do not overwrite the last known successful sequence.
- A successful sequence still invokes the configured Android CLI for its actions. This cache avoids repeated AI planning and preserves successful steps; it does not eliminate Android CLI process startup time per action.
